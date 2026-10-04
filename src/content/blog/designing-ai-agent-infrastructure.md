---
title: "AI Agent Infrastructure for Production: Full Architecture"
date: "2026-11-26"
tags: ["AI Agents", "System Design", "Platform Engineering", "Security"]
description: "A production-grade HLD for AI agent platforms: orchestrator, tool router, per-session sandboxes, memory stores, and observability. Isolation tiers, secrets, egress, and cost controls included."
readingTime: 15
---

Most AI agent demos run on a laptop. Production is a different problem. When an agent can call tools, read data, and take actions on behalf of users, it becomes a workload with a blast radius. This post lays out a production-grade architecture for AI agent infrastructure: what the components are, how they fit together, and where the hard tradeoffs live.

## Why Agents Need Infrastructure, Not Just an API Key

A single LLM call is stateless and bounded. An agent is neither. It runs a loop: plan, call a tool, observe the result, plan again. That loop touches your systems. It reads files, queries databases, calls APIs, and sometimes writes data. Each iteration expands the surface area for failure, misuse, and cost.

The 2026 shift is that enterprises now treat agents as workloads, not features. That means the same disciplines apply: isolation, identity, observability, cost attribution, and incident response. The architecture below reflects that.

## High-Level Architecture

```
                    +------------------+
                    |   API Gateway    |
                    | (auth, rate limit)|
                    +--------+---------+
                             |
                    +--------v---------+
                    | Agent Orchestrator|
                    | - session mgmt   |
                    | - policy engine  |
                    | - budget tracker |
                    +---+----+----+----+
                        |    |    |
        +---------------+    |    +---------------+
        |                    |                    |
+-------v-------+   +--------v--------+   +-------v-------+
|  Tool Router  |   |  Memory Store   |   | Observability |
| - registry    |   | - short-term    |   | - traces      |
| - permissions |   | - long-term     |   | - token usage |
| - validation  |   | - vector index  |   | - tool calls  |
+-------+-------+   +-----------------+   +---------------+
        |
+-------v---------------------------------------+
|          Per-Session Sandbox                  |
|  +----------------------------------------+   |
|  |  Agent Runtime (Firecracker / gVisor)  |   |
|  |  - ephemeral filesystem                |   |
|  |  - network egress allowlist            |   |
|  |  - scoped credentials (short-lived)    |   |
|  +----------------------------------------+   |
+-----------------------------------------------+
```

Each layer has one job. The gateway handles identity and throttling. The orchestrator manages the agent loop and enforces policy. The tool router decides what the agent is allowed to touch. The sandbox contains what it actually does. Observability records everything for later.

## System Architecture

The diagram above shows the components at rest. Here is the system in motion: the request lifecycle for a single agent session, which is what you actually debug at 2 a.m.

```
+-----------------+     +----------------+     +-------------------+
| Client Request  |---->| API Gateway    |---->| Agent Orchestrator|
+-----------------+     | auth, throttle |     +--------+----------+
                        +----------------+              |
                                                        |
               +----------------------------------------+
               v
     +------------------+     +-------------------+
     | Session Context  |---->| Policy + Budget   |
     | Load (Memory)    |     | Check (in-memory) |
     +------------------+     +---------+---------+
                                        |
                                        v
                              +-------------------+
                              | Tool Router       |
                              | validate + permit |
                              +---------+---------+
                                        |
                                        v
                              +-------------------+
                              | Per-Session       |
                              | Sandbox (exec)    |
                              +---------+---------+
                                        |
                                        v
                              +-------------------+
                              | Observability     |
                              | spans, cost, logs |
                              +-------------------+
```

Every loop iteration walks this path: load context, check policy and budget, validate the tool call, execute in the sandbox, record the outcome. The policy check sits in the hot path on purpose. Moving it async would cut per-iteration latency, but it would also let a denied action execute before the denial arrives, which defeats the purpose. The practical compromise is to keep policy evaluation in-memory inside the orchestrator (no network hop) and treat the decision log as the async part: the check is synchronous, the audit write is buffered.

Two interface details matter. First, every tool call carries an idempotency key derived from the session ID and iteration number, so a retried orchestrator does not double-execute a mutating tool. Second, context loading is explicit and bounded: the orchestrator fetches a fixed-size context window from memory stores rather than letting context grow until the model chokes. Both are cheap to add and expensive to retrofit.

## Component 1: The Agent Orchestrator

The orchestrator is the control plane. It owns the session lifecycle: creation, the plan-act-observe loop, termination, and cleanup. Key responsibilities:

- **Session management.** Every agent run gets a session ID, a principal (who or what requested it), and a budget (tokens, tool calls, wall-clock time). Sessions are the unit of isolation, billing, and auditing.
- **Policy enforcement.** Before each tool call, the orchestrator checks policy: is this tool allowed for this principal? Is the session within budget? Has a human approval gate been triggered? Policy checks happen synchronously in the request path, not after the fact.
- **Loop control.** Agents can loop forever. The orchestrator enforces max iterations, detects non-progress (same tool called repeatedly with no state change), and terminates runaway sessions.

The tradeoff here is latency versus safety. Every policy check adds milliseconds to each loop iteration. For interactive agents, that matters. The practical answer is to keep policy evaluation in-memory and local to the orchestrator, not behind a network call.

## Component 2: The Tool Router

Tools are the agent's hands. The router is a registry plus a permission layer:

- **Registry.** Each tool declares its name, input schema, output schema, side effects (read-only versus mutating), and risk tier. Registration is explicit. No dynamic tool loading from untrusted sources.
- **Permissions.** Tools are scoped per principal and per session. A support agent might read tickets but not issue refunds. A coding agent might read a repo but not push to main. Permissions are deny-by-default.
- **Input validation.** Tool inputs are validated against schemas before execution. This is where prompt injection gets contained: even if the model is tricked into calling a tool with malicious arguments, validation rejects malformed inputs.

The hardest tradeoff is granularity. Coarse permissions are easy to manage but over-privilege the agent. Fine-grained permissions are safer but become an operational burden. Start coarse, tighten based on audit findings.

## Component 3: Per-Session Sandboxes

This is the most important layer. The sandbox is where untrusted code runs, and it must assume the agent is compromised.

**Isolation tiers, from strongest to weakest:**

1. **Firecracker MicroVMs.** Full VM isolation with millisecond boot times. Each session gets its own microVM with an ephemeral root filesystem. This is what AWS uses for Lambda, and it is the right default for agents running untrusted code. The cost is operational complexity: you need VM image management and a fast snapshot/restore path.

2. **gVisor.** A user-space kernel that intercepts syscalls. Lighter than a full VM, stronger than plain containers. Good middle ground when MicroVM overhead is too much but you still need syscall-level filtering.

3. **Plain containers.** Namespace and cgroup isolation only. Acceptable for trusted, first-party tools with no network access. Not sufficient for agents executing model-generated code.

**What goes inside the sandbox:**

- **Ephemeral filesystem.** Fresh on session start, destroyed on session end. Nothing persists between sessions unless explicitly exported through the orchestrator.
- **Network egress allowlist.** Default deny. Only explicitly approved endpoints are reachable. This is the single most effective control against data exfiltration.
- **Scoped credentials.** No long-lived secrets inside the sandbox. The orchestrator mints short-lived, narrowly scoped tokens per session (for example, a database credential valid for 15 minutes with read-only access to specific tables).

The tradeoff is cold start versus security. Fresh MicroVMs per session add hundreds of milliseconds. Snapshot/restore and warm pools reduce this, but warm pools reintroduce cross-session contamination risk. For most workloads, per-session fresh sandboxes with snapshot-based fast boot is the right balance.

## Component 4: Memory and Context Stores

Agents need memory across turns and sessions. This splits into two tiers:

- **Short-term (session) memory.** Conversation history, intermediate tool results, current plan state. Lives in fast storage (Redis or in-memory), scoped to the session, deleted on termination.
- **Long-term memory.** Embeddings, user preferences, learned patterns. Lives in a vector store, scoped per principal with strict access controls. This is sensitive: long-term memory is a cross-session data leak vector if principals are not properly isolated.

The tradeoff is utility versus privacy. Richer memory makes agents more capable but increases the blast radius of a compromised session. Default to session-scoped memory. Add long-term memory only with explicit principal isolation and audit logging on every read.

## Component 5: Observability

You cannot operate what you cannot see. Agent observability has four pillars:

- **Traces.** Every session produces a trace: the full sequence of model calls, tool invocations, inputs, outputs, and latencies. Use OpenTelemetry with a custom span schema for agent loops.
- **Token usage.** Track prompt tokens, completion tokens, and cost per session, per principal, per tool. This is the foundation for cost attribution.
- **Tool call logs.** Every tool invocation with arguments, results, duration, and policy decisions. This is your audit trail for security incidents.
- **Business context.** Link sessions to business entities: which ticket, which user, which deployment. Without this, you have telemetry with no way to answer "what did the agent do to customer X?"

Sampling matters. Full-fidelity tracing for every session is expensive at scale. Sample 100 percent of failures and policy denials, and a configurable percentage of successes. Never sample away security-relevant events.

## Secrets Management

Agents need credentials to do useful work, and credentials are the highest-value target. The rules:

1. Secrets never enter the model context. The agent references tools by name; the router injects credentials at execution time.
2. All session credentials are short-lived (minutes, not hours) and narrowly scoped.
3. Credential issuance is logged and tied to the session ID.
4. On session termination, all issued credentials are revoked, even if not yet expired.

This is non-negotiable. A leaked long-lived credential from a compromised agent session is a full breach.

## Cost Controls

Agent costs are unpredictable by default. Each loop iteration burns tokens, and there is no natural upper bound. The control ladder:

1. **Per-session token budgets.** Hard cap. Session terminates when exceeded.
2. **Per-principal rate limits.** Prevent one user or service from consuming the entire budget.
3. **Model routing.** Route simple tasks to cheaper models, reserve frontier models for hard problems. This is the highest-impact cost control.
4. **Human approval gates.** For high-cost or high-risk actions (large batch operations, production writes), pause the loop and require human confirmation.

Track cost per session from day one. Retrofitting cost attribution later is painful.

## Failure Modes to Design For

- **Runaway loops.** Mitigated by max iterations, non-progress detection, and budgets.
- **Tool timeouts.** Every tool call needs a timeout. A hung tool should not hang the session.
- **Cascading failures.** If a downstream service degrades, agents retrying aggressively make it worse. Circuit breakers on tool calls, same as any distributed system.
- **State inconsistency.** If the sandbox is destroyed mid-write, what is the source of truth? Design tools to be idempotent and sessions to be resumable from the orchestrator's state, not the sandbox's.

## Scalability

The architecture above works for hundreds of concurrent sessions on a single orchestrator. At 10x and 100x, different parts break first, and the fixes are different.

**Where the bottlenecks appear.** The orchestrator is the first ceiling: session state, policy evaluation, and loop control all converge there. Next is the sandbox pool: cold starts serialize session creation, and pool exhaustion turns into queueing delay. Third is observability write throughput: every tool call emits spans, and at high session counts the trace pipeline becomes the noisiest writer in the system. The memory store's vector index is fourth, mostly on read latency during context loading.

**10x: scale out the stateless parts.** Make the orchestrator horizontally scalable by externalizing session state into a fast key-value store (Redis or equivalent). Route by session ID with consistent hashing so any orchestrator replica can serve any session, but a given session mostly sticks to one replica. Sandbox pools get warmer: maintain a standby pool of snapshotted MicroVMs sized to the p95 session start rate, and scale the pool with a target-tracking metric on pool depth. Observability moves to batched, buffered span export with backpressure handled at the exporter, not in the agent loop.

**100x: shard and shed.** At this point the orchestrator is a fleet, sessions are sharded by principal or by hash ring, and policy evaluation is served from cached decision tables with short TTLs (seconds, not minutes) so rule changes propagate without a deploy. Egress allowlists are compiled per sandbox image, not evaluated per request. The vector memory store is sharded by principal with read replicas. Most importantly, the system learns to say no: bounded per-principal queues at the gateway, explicit "session rejected: capacity" responses instead of unbounded queueing, and separate priority lanes for interactive versus batch agents so a bulk backfill cannot starve live users.

**Queueing and backpressure.** Queues exist in exactly two places: at the gateway for session admission, and at the sandbox pool for session start. Both are bounded, both expose depth metrics, and both shed load when full. Inside a running session there is no unbounded queue: tool calls execute or fail fast with a timeout. If a downstream tool degrades, the circuit breaker trips and the orchestrator fails the iteration rather than piling up retries. Backpressure is a policy decision (deny new sessions) rather than an accident (OOM the orchestrator).

## Security Considerations

Assume the agent is compromised and design from there. The threat model has four actors: a malicious prompt injection steering a legitimate agent, a compromised tool returning hostile output, a cross-tenant attacker trying to read another principal's memory, and a legitimate agent accidentally exfiltrating data through a poorly scoped tool.

**Identity and auth.** Every session gets a workload identity, minted at creation and bound to the requesting principal. Components authenticate to each other with mutual TLS; there is no unauthenticated east-west traffic. Human-facing entry goes through the API gateway with the organization's existing identity provider. Machine principals (CI systems, cron-driven agents) get their own identities, never a shared service account.

**Encryption.** TLS 1.2 or better on every connection, internal and external. AES-256 at rest for memory stores, trace archives, and session logs. Treat trace data as sensitive by default: it contains prompts, tool outputs, and occasionally secrets the agent was shown. Encrypt it and restrict read access to the on-call and security teams.

**Key management.** Keys live in a managed KMS or HSM, never in config files or sandbox environment variables. Per-session data encryption keys are derived at session start and destroyed at session end. Tool credentials are minted per session with minutes-long lifetimes and revoked on termination. Rotation is automatic and boring: if rotating a key requires a runbook, it will not happen often enough.

**Attack vectors and mitigations.** Prompt injection is contained by input validation at the tool router plus output filtering on tool results (strip anything that looks like an instruction before it re-enters context). Tool squatting is prevented by the explicit registry: tool definitions are versioned and signed, and the router refuses anything not in the registry. Session fixation is prevented by cryptographically random session IDs bound to the principal at creation. Log injection is handled with structured logging and output sanitization at the observability layer. Egress is the last line: default-deny with an allowlist means even a fully compromised agent can only talk to approved endpoints.

None of this replaces the human approval gate for high-risk actions. Defense in depth means the attacker has to beat the policy engine, the sandbox, and the egress filter, and the risky action still pauses for a human.

## Production Checklist

**Monitoring.** Track session success and failure rates, iterations per session (a sudden rise means loops are misbehaving), p50 and p99 tool call latency, token burn rate per principal, sandbox pool depth and cold-start latency, policy denial rate, and memory store read latency. If you only graph five things, make them: active sessions, denial rate, token burn, pool depth, and tool error rate.

**Alerting.** Alert on runaway sessions (iterations above a threshold for a single session), cost spikes relative to a rolling baseline, sandbox pool exhaustion, anomalous credential issuance (many short-lived tokens for one principal), and downstream tool error rate spikes. Page on pool exhaustion and suspected exfiltration patterns. Everything else can wait for business hours.

**Runbooks.** Write them before you need them: kill a session and revoke its credentials, quarantine a sandbox image suspected of contamination, rotate all tool credentials, and the suspected-exfiltration playbook (freeze the session, preserve the traces, notify security, then investigate). Each runbook gets a named owner and a quarterly dry run.

**Failure modes.** The orchestrator is stateless with session state in the KV store, so a replica can die and sessions resume elsewhere. If a sandbox node fails, in-flight sessions on that node are terminated and retried from orchestrator state, not sandbox state. If the memory store goes down, sessions degrade to stateless mode with session-scoped context only, and long-term memory reads fail open to empty rather than failing the session. If the observability pipeline backs up, spans buffer locally with a bounded buffer and backfill when the pipeline recovers; the agent loop never blocks on telemetry.

**Graceful degradation.** When the approval service is unreachable, gated actions default to deny, and the session pauses with a clear status instead of hanging. When the vector store is slow, context loading falls back to recent-turns-only. The principle: a degraded agent platform should run fewer, dumber agents, never unguarded ones.

## Putting It Together

The architecture is deliberately boring. API gateway, orchestrator, router, sandbox, stores, observability. These are the same patterns as any distributed system, applied to a new workload type. That is the point: agents do not need exotic infrastructure. They need the standard disciplines, applied rigorously, with sandboxing as the one genuinely new requirement.

Start with the sandbox and the audit trail. Everything else can be added incrementally. But if you ship agents without isolation and without knowing what they did, you are flying blind with a loaded system.
