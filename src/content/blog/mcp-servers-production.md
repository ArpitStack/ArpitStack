---
title: "MCP Servers in Production: Architecture, Security, and Failure Modes"
date: "2027-01-14"
tags: ["MCP", "AI Agents", "System Design", "Security"]
description: "Model Context Protocol servers in production: HLD, auth, sandboxing tool execution, input validation, failure modes, scaling, and observability. An engineer's guide."
readingTime: 14
---

Model Context Protocol (MCP) standardizes how AI agents connect to external tools and data sources. Instead of every agent implementing custom integrations, an MCP server exposes capabilities (tools, resources, prompts) over a standard protocol, and any MCP-compatible client can use them. In 2026, MCP has become the de facto interface between agents and enterprise systems. This post covers what it takes to run MCP servers in production: architecture, security, failure modes, and scaling.

## What MCP Actually Is

At its core, MCP is a client-server protocol. The agent (client) connects to one or more MCP servers. Each server advertises:

- **Tools.** Functions the agent can call, with JSON schemas for inputs and outputs. Example: `query_database`, `create_ticket`, `read_file`.
- **Resources.** Read-only data the agent can access, addressed by URI. Example: `config://app/settings`, `docs://api/reference`.
- **Prompts.** Reusable prompt templates with parameters.

The protocol handles capability negotiation, request/response framing, and (in newer versions) streaming. Transports include stdio for local servers and HTTP/SSE or WebSocket for remote ones.

The key insight: MCP moves integration logic out of the agent and into separately deployable, independently securable servers. That is good for separation of concerns, but it means each MCP server is now a production service with its own availability, security, and scaling requirements.

## High-Level Architecture

```
+-------------+        +-------------------+        +------------------+
| Agent Client| <----> |   MCP Gateway     | <----> |  MCP Server: DB  |
+-------------+        | (auth, routing,   |        +------------------+
                       |  rate limiting,   |
+-------------+        |  audit)           |        +------------------+
| Agent Client| <----> |                   | <----> | MCP Server: Files|
+-------------+        +-------------------+        +------------------+
                                                        |
                       +-------------------+        +------------------+
                       |   Observability   |        | MCP Server: APIs |
                       | (traces, metrics, |        +------------------+
                       |  tool call logs)  |
                       +-------------------+
```

In production, clients rarely talk to MCP servers directly. A gateway sits in front for authentication, routing, rate limiting, and audit logging. Behind the gateway, each MCP server is scoped to a domain: database access, file operations, ticket systems, and so on. Narrow scope per server limits blast radius.

## System Architecture

The topology diagram above shows deployment shapes. This is the request path: what happens, in order, when an agent calls a tool.

1. The agent client authenticates to the gateway with mTLS or an OAuth access token.
2. The gateway verifies the token (with a local cache of verified principals, not a round trip to the identity provider on every call), checks per-client and per-tool rate limits, resolves the principal, routes to the right server, and records the intent in the audit log.
3. The MCP server validates the input against the versioned tool schema, checks the principal's permission for that specific tool, and loads its scoped credentials from the secret manager.
4. Execution follows the risk tier: read-only tools run in-process, mutating tools wait on approval gates, arbitrary code runs in the tool sandbox.
5. The result is sanitized against the output schema, returned to the agent, and the full trace (principal, tool, sanitized arguments, duration, outcome) is emitted to observability.

```text
+----------------+     +----------------+     +----------------+
| Agent Client   |---->| MCP Gateway    |---->| MCP Server     |
+----------------+     +-------+--------+     +-------+--------+
                               |                      |
                               v                      v
                       +----------------+     +----------------+
                       | Audit Log      |     | Tool Sandbox   |
                       | (immutable)    |     +----------------+
                       +----------------+            |
                                                     v
                                              +----------------+
                                              | Scoped Secrets |
                                              +----------------+
```

Component notes: the gateway is stateless and scales independently of the servers. Each MCP server is stateless too, scoped to one domain, with its own credentials and scaling policy. The secret manager is the only component that holds long-lived credentials. The audit log is append-only and immutable: it is a compliance record, not a debug log, so writes for mutating tools are synchronous even though that costs latency.

## Deployment Topologies

**Sidecar (local).** The MCP server runs alongside the agent, communicating over stdio. Lowest latency, simplest auth (local trust boundary). Best for developer tools and single-tenant agents. Does not scale to multi-tenant production.

**Gateway (remote).** MCP servers run as network services behind a gateway, communicating over HTTP. This is the production topology for shared infrastructure. It enables centralized auth, rate limiting, and observability, at the cost of network latency per tool call.

**Hybrid.** Latency-sensitive, low-risk tools run as sidecars. High-risk or shared tools (database writes, production APIs) go through the gateway. This is the most common mature setup.

The tradeoff is latency versus control. Every network hop adds milliseconds to each agent loop iteration, and agents make many tool calls per session. Keep the gateway and servers in the same region and availability zone as the agent runtime. For high-frequency tools, prefer sidecar deployment.

## Security: The Hard Part

MCP servers execute actions on behalf of agents, which act on model output. That chain (model output to tool execution) is the attack surface. Treat every MCP server as a privileged service.

### Authentication and Authorization

- **Client auth.** Every MCP client authenticates to the gateway: mTLS, OAuth tokens, or API keys depending on the deployment. Anonymous access is never acceptable in production.
- **Principal propagation.** The gateway must propagate the original principal (the user or service that started the agent session) through to each MCP server. Tool-level authorization decisions depend on knowing who is actually asking.
- **Tool-level permissions.** Not every principal gets every tool. A read-only analyst principal should not reach the `execute_sql_write` tool. Permissions are deny-by-default, granted explicitly per principal or role.

### Sandboxing Tool Execution

Tools execute code or touch systems. The execution environment depends on the tool's risk tier:

- **Read-only tools** (query, search, fetch): run in the server process with input validation and query timeouts.
- **Mutating tools** (write, delete, deploy): run with additional approval gates. For high-risk mutations, require human confirmation before execution.
- **Arbitrary code tools** (run script, execute command): run inside a sandbox (container at minimum, MicroVM preferred), with no network access unless explicitly required, and with strict resource limits.

### Input Validation

Every tool input is validated against its JSON schema before execution. This is the primary defense against prompt injection reaching your systems. Even if the model is manipulated into calling a tool with attacker-crafted arguments, schema validation rejects anything outside the expected shape.

Go further for sensitive tools: allowlist validation on string parameters (for example, table names must match a known list, not arbitrary strings), range checks on numerics, and size limits on all inputs.

### Secrets Handling

MCP servers often need credentials for downstream systems (database passwords, API keys). Rules:

1. Secrets live in a secret manager (Vault, AWS Secrets Manager), never in server config files or environment variables checked into repos.
2. Servers fetch secrets at startup or on rotation, with short TTLs.
3. Secrets are never returned in tool outputs, never logged, and never included in error messages.
4. Each MCP server gets its own scoped credentials. A compromised file server should not yield database credentials.

## Security Considerations

The security section above covers the mechanisms. This section covers the decisions that determine whether those mechanisms hold up.

Tool permission scoping needs a real model, not vibes. Maintain an explicit matrix of principals to tools, deny-by-default, reviewed on a schedule. Split read and write into separate tools; a single tool that reads or writes based on a flag is one confused-deputy bug away from a bad day. Treat any tool that escalates privilege (granting access, changing permissions, deploying) as its own risk tier with human approval, regardless of how routine it feels.

Prompt injection via tool outputs deserves its own design attention, because it bypasses every input validation you built. Tool outputs are untrusted data, not instructions. Wrap outputs in explicit delimiters that the agent's system prompt marks as data-only, validate outputs against the expected schema before handing them to the agent, and never allow a tool output to modify the tool registry, session policy, or the agent's own instructions. If a tool returns markdown with embedded instructions from a third-party page, your agent should treat it the way a browser treats user input in a text field: displayed, never executed.

OAuth token handling has sharp edges. Access tokens are short-lived and audience-restricted to the gateway; refresh tokens never reach the agent runtime. The gateway caches verification results but never caches the tokens themselves alongside logs. Propagate identity downstream with token exchange or a signed assertion carrying the principal, never by forwarding the raw user token to tools that do not need it. Log token use, never token values.

Encryption and keys: TLS 1.2 or better on every hop, including server to downstream; secrets encrypted at rest in the manager with per-server access policies; audit logs with integrity protection so tampering is detectable. Each server holds only its own scoped credentials, rotation happens without restarts, and there is a break-glass revocation path that does not require a deploy.

The attack list to keep on the wall: poisoned tool descriptions (validate at registration, freeze metadata at deploy), a compromised server (blast radius limited by narrow scope and scoped credentials), credential leakage through tool output (output filtering on secrets-shaped strings), and replayed tool calls (idempotency keys plus nonces on anything mutating).

## Failure Modes

### Tool Timeouts

Tools call downstream systems that hang. Every tool invocation needs a timeout, and the timeout must be enforced by the MCP server, not trusted to the downstream system. On timeout: return a structured error to the agent, log the incident, and do not retry automatically unless the tool is documented as idempotent and safe to retry.

### Cascading Failures

An agent retrying a failing tool in a tight loop is a self-inflicted DDoS. Defenses:

- **Circuit breakers** per tool per downstream dependency. After N consecutive failures, stop calling the tool for a cooldown period and return errors immediately.
- **Rate limits** per client per tool. Even legitimate agents should not call an expensive tool hundreds of times per minute.
- **Backoff with jitter** on retries, with a maximum retry count.

### State Consistency

Some tools are stateful across calls (multi-step workflows, transactions). If the MCP server restarts mid-workflow, what happens? Design tools to be idempotent where possible: include client-generated idempotency keys, make operations safe to retry, and keep workflow state in an external store (not server memory) so any server instance can resume.

### Version Skew

Clients and servers evolve independently. A new server version with a changed tool schema can break older clients. Mitigations: version tool schemas explicitly, support at least one previous schema version during rollouts, and use the protocol's capability negotiation to let clients discover what the server supports.

### Poisoned Tool Descriptions

A subtle 2026 attack vector: if tool metadata (descriptions, schemas) comes from an untrusted source, it can contain prompt injection aimed at the agent. Treat tool descriptions as untrusted input. Validate them at registration time, and never allow runtime modification of tool metadata without an explicit deployment.

## Scaling Strategies

MCP servers scale like any stateless service, with two wrinkles:

1. **Session affinity.** If tools maintain per-session state, route requests from the same session to the same server instance, or externalize the state. Prefer externalized state; it makes scaling trivial.

2. **Tool heterogeneity.** Different tools have wildly different resource profiles. A vector search tool is CPU and memory heavy; a simple config lookup is trivial. Do not scale the entire server based on the heaviest tool. Split heavy tools into dedicated server deployments with independent scaling policies.

Horizontal scaling behind a load balancer works for most cases. For very high throughput, consider connection pooling to downstream systems and response caching for read-only tools with appropriate TTLs.

## Scalability

Scaling strategies above cover the tactics. This is how behavior changes as load grows.

At 10x current load, the stateless servers scale horizontally without drama, provided session state is externalized (Redis or equivalent) rather than sticky. The first real bottleneck is usually downstream: agent tool calls are chatty, so add connection pooling between MCP servers and the databases they wrap, and add response caching with explicit TTLs for read-only tools. The gateway needs its own scaling policy separate from the servers; its work per request is small but constant.

At 100x, split deployments by tool weight. A vector search tool and a config lookup must not share a scaling policy or a fate. Per-tool rate limits graduate into per-principal quotas with burst allowances, because at this scale one misbehaving agent session can starve the rest. Token verification becomes a hot path: cache aggressively at the gateway and keep verification logic minimal. Audit ingestion must keep up with 100x the tool calls; buffer it asynchronously for reads, but keep synchronous writes for mutating tools, since an audit gap on a write is a compliance failure, not a performance tradeoff.

Queueing and backpressure: give each tool a bounded queue. When the downstream is slow, shed load with a 429 and a retry-after rather than queueing without bound; unbounded queues turn latency into timeouts and timeouts into agent retries, which is the self-inflicted DDoS described in the failure modes section. Circuit breakers are the automatic backpressure: once open, they convert a slow downstream into fast failures the agent can reason about. The gateway should return structured overload errors, not generic 500s, so the agent can back off or choose a different plan instead of hammering the same tool.

Size the audit pipeline and the gateway's TLS termination as first-class capacity concerns. Both are shared across every tool, so both become the ceiling before any individual server does.

## Observability

Every MCP server should emit:

- **Traces.** Per tool call: client identity, tool name, arguments (sanitized), duration, result status. Propagate trace context from the agent through the gateway to the server.
- **Metrics.** Tool call rate, error rate, latency percentiles (p50, p95, p99) per tool. Downstream dependency health. Queue depths if applicable.
- **Audit logs.** Immutable record of every mutating tool call: who, what, when, with what arguments, and what the result was. Retain per compliance requirements.

Alert on: error rate spikes per tool, p99 latency degradation, auth failure spikes (possible attack), and circuit breaker state changes.

## Operational Checklist

Before putting an MCP server in production:

- [ ] Gateway with auth, rate limiting, and audit logging in front
- [ ] Tool schemas versioned, inputs validated, outputs sanitized
- [ ] Timeouts on every tool call, circuit breakers on downstream dependencies
- [ ] Secrets in a secret manager, scoped per server, never logged
- [ ] Sandbox for code-execution tools, approval gates for mutations
- [ ] Idempotency keys for stateful tools, externalized session state
- [ ] Full observability: traces, metrics, immutable audit logs
- [ ] Runbooks for: server down, downstream down, auth failure spike, suspected prompt injection

## Operational Concerns

The checklist above is the gate. This is the ongoing operation.

Monitoring centers on per-tool rate, error rate, and latency percentiles, plus gateway queue depth, circuit breaker state, token verification failure rate, audit write lag, and downstream dependency health. A dashboard per tool is not overkill; tools fail independently and you will debug them independently.

Alert on error rate spikes per tool, p99 latency degradation, auth failure spikes, breaker state changes, and audit lag beyond your compliance threshold. An auth failure spike is often the first signal of a credential stuffing attempt or a misconfigured rollout; either way it deserves a page, not a ticket.

Runbooks: server down (drain traffic, shift to healthy instances, check the downstream first, since most MCP outages are downstream outages wearing a costume); downstream down (the breaker is already open; communicate the degraded tool set to agents explicitly rather than letting them discover it); auth failure spike (check the identity provider, and if compromise is suspected, rotate gateway keys through the break-glass path); suspected prompt injection (quarantine the tool, review recent tool outputs for injected instructions, rotate credentials the tool could have touched).

Failure modes specific to operations: version skew during rollouts (keep N-1 schema support until clients confirm), secret rotation races (briefly accept two credential versions), gateway overload (shed read traffic before write traffic).

Graceful degradation is explicit: disable non-critical tools first, serve cached read results marked with their staleness, and tell the agent it is in degraded mode. An agent that knows the tool set shrank will plan around it; an agent that discovers it through failures will loop.

MCP is plumbing. Unremarkable when it works, catastrophic when it does not. The engineering is in the boring parts: validation, timeouts, auth, and audit trails. Get those right and the protocol fades into the background, which is exactly where infrastructure belongs.
