---
title: "Don't Trust Your AI Agents: Sandboxing Strategies for Production"
date: "2026-10-08"
tags: ["AI Agents", "Security", "AWS", "Infrastructure"]
description: "Agents that execute code are remote execution services with a natural language interface. Isolation, identity, and audit trails are infrastructure problems, not model problems."
readingTime: 13
---

If your AI agent can run shell commands, it is not a chatbot. It is a remote execution service with a natural language interface. Everything you know about securing remote execution applies, and most teams have not applied it yet.

## The trust boundary sits below the model

A production coding agent does more than generate text. It executes software, inspects repositories, queries databases, and calls internal services. The security boundary that matters is not the model's content filter. It is the boundary between the agent and the code it executes.

A useful way to see the stack:

```text
model
  |
agent loop
  |
tool call
  |
  +-----------------------------+
  | per-session sandbox         |
  |                             |
  | shell / code / filesystem   |
  | network / packages / tools  |
  +-----------------------------+
```

The model never needs direct access to the host operating system. The agent runtime decides which tool call to perform, and the sandbox provides the environment where the call runs. That separation is the whole game. Everything below is about how strong that box is, and what the box is allowed to touch.

September 2026 gave us a sharp reminder of why this matters. Security researcher Gal Weizman of Forever Security published "BragJack" on September 16: a demonstration that a single browser extension, holding only two utterly commonplace permissions (a content script that modifies pages, which every ad blocker has, and declarativeNetRequest for rewriting network requests), could hijack the built-in AI assistants in five Chromium-based browsers: Chrome's Gemini, Edge's Copilot, Opera Neon, Perplexity's Comet, and Anthropic's Claude in Chrome.

The technique, which the researchers call "prompt forcing," is what makes it instructive. Instead of smuggling a malicious fragment into page content (classic prompt injection), the extension takes over the trusted prompt channel itself: it injects into the vendor page the assistant listens to, or redirects the assistant's own script loads, and then speaks to the AI as if it were the vendor. The attacker authors the entire prompt sequence. Model-level safety filters never engage, because from the model's perspective the instructions arrived through the legitimate channel. Depending on the product, the hijacked assistant could read emails, take screenshots, read local files, and in Chrome's case access the camera and microphone. Google assigned CVE-2026-0628 (CVSS 8.8). Microsoft assigned CVE-2026-55945. All five vendors patched and paid bounties.

Two caveats, because precision matters. First, the attack requires the malicious extension to be installed in the first place. It is an escalation of an existing risk, not a remote exploit out of thin air. Second, no in-the-wild exploitation was reported. This is proof of concept, not an incident report.

But the architectural lesson stands regardless. When the execution channel is trusted implicitly, every control above it is theater. Your agent sandbox design should assume the agent itself can be turned: by a malicious extension, by a poisoned MCP server, by a prompt injection buried in a README the agent was told to read. The sandbox is what stands between a compromised agent and your infrastructure.

## Pick your isolation tier

Not every workload needs the same box. Three tiers cover the realistic options.

**Firecracker MicroVMs** are the strongest practical choice for untrusted code. AWS Lambda MicroVMs, which went GA in June 2026, expose Firecracker isolation as a managed primitive: each session gets a VM-level isolated environment with its own kernel, snapshot-based startup in seconds, automatic suspension when idle at near-zero cost, and session lifetimes up to 8 hours. On September 18, 2026, AWS published architecture guidance specifically for self-hosted AI agent sandboxes on Lambda MicroVMs: the agent control plane stays outside the sandbox while each session gets a fresh MicroVM that runs shell commands, touches files, and executes generated code inside the customer's own AWS account. The agent loop and the execution environment are separate, exactly like the diagram above.

**gVisor** sits a tier down: lighter weight than a full MicroVM, with syscall filtering that interposes between the container and the host kernel. Reasonable for semi-trusted workloads where you control the inputs but want defense in depth. It is not the same as a separate kernel, and you should not pretend it is.

**Plain containers** are fine for trusted code and nothing else. A shared kernel is a shared fate. If the code running inside was written by an agent operating on untrusted input, a container boundary is not a security boundary.

The rule of thumb: the less you trust the code, the stronger the box. Agent-generated code operating on untrusted input gets a MicroVM. Everything else is a judgment call you should be able to defend in a review.

## Design the session, not just the box

A strong box with a bad session design still fails. Per-session sandboxing means:

- Fresh environment per session, launched from a hardened snapshot. No shared filesystem state between sessions, no leftover credentials from the last run.
- Destroy after use. The sandbox is ephemeral. Anything the session needs to keep goes through an explicit, logged export path, not through persistence of the sandbox itself.
- A narrow API between the agent loop and the sandbox. The agent runtime should invoke a small set of well-defined operations (run command, read file, write file) rather than handing the model a raw shell on shared infrastructure.

Snapshot-based startup is what makes this practical. If every session took minutes to boot, teams would reuse long-lived sandboxes and the whole model would collapse. Second-scale resume from snapshot is the feature that makes per-session isolation affordable.

## Secrets and egress: what the box may touch

Isolation means little if the sandbox holds the keys to everything. Two rules cover most of the risk.

First, no long-lived credentials inside sandboxes. Agents should never see a static API key, a permanent database password, or a broad IAM role. Mint short-lived, narrowly scoped tokens per session, inject them at runtime, and let them expire with the session. If a sandbox is compromised, the blast radius is one session's worth of permissions for a few hours, not your production database forever.

Second, control egress. Most tool sandboxes have no business reaching the open internet. Define an egress allowlist: the package registry, the git host, the specific internal services the task needs. Everything else is denied. Data exfiltration through a compromised agent gets much harder when the sandbox cannot phone home to arbitrary endpoints.

Secrets go in at runtime, never baked into images. This sounds obvious and is violated constantly, usually for convenience: the base image with the deploy key "just for now." Do not.

## Identity and audit: who did what

Every agent action should be attributable to a session and to a human owner. That means per-agent service accounts, not one shared key that five agents use. It means the session ID travels with every tool call, every file access, every network request.

And log all of it. Tool invocations, arguments, file paths touched, network destinations, the fact of secrets access (not the values). Feed these logs into the same observability pipeline as the rest of your infrastructure, with the same retention and the same alerting. When something goes wrong, and eventually something will, the difference between a two-hour investigation and a two-week one is whether the audit trail exists.

## System Architecture

A production sandbox design has six components with a strict request path. A single tool call flows like this:

1. The agent control plane proposes a tool call for a session. It never executes code itself. It only decides.
2. The policy engine checks admission: is the session still valid, is the tool on the session's allowlist, are the arguments within policy bounds. Rejections happen here, fast, before any compute is spent.
3. The sandbox pool assigns a MicroVM, ideally pre-warmed from a signed, hardened snapshot. Cold restore is the fallback path, not the normal one.
4. The token broker mints short-lived, narrowly scoped credentials and injects them into the MicroVM through the guest agent channel. No secrets live in the image, and nothing long-lived ever crosses into the sandbox.
5. The tool call executes inside the MicroVM. Any network access leaves through the egress proxy, which enforces the allowlist and logs every destination.
6. Every step emits structured audit events to the observability pipeline, keyed by session ID.

```text
+----------------+     +----------------+     +----------------+
| Agent Control  |---->| Policy Engine  |---->| Sandbox Pool   |
| Plane          |     | (admission,    |     | (pre-warmed    |
|                |     |  tool allow-   |     |  MicroVMs)     |
|                |     |  list)         |     |                |
+----------------+     +----------------+     +-------+--------+
                                                       |
                                                       v
                       +----------------+     +----------------+
                       | Token Broker   |---->| Session MicroVM|
                       | (short-lived,  |     |                |
                       |  scoped creds) |     |                |
                       +----------------+     +-------+--------+
                                                       |
                        +------------------------------+
                        v                              v
               +----------------+              +----------------+
               | Egress Proxy   |              | Audit + Traces |
               | (deny by       |              |                |
               |  default)      |              |                |
               +----------------+              +----------------+
```

The key property: each arrow in the diagram crosses a trust boundary, and each boundary is enforced by infrastructure, not by the model. The control plane cannot be talked into skipping the policy engine, because the sandbox pool only accepts assignments the policy engine approved. The MicroVM cannot be talked into reaching the open internet, because its only route out is the proxy.

## Scalability

The unit of scale is the session: one MicroVM per session. Cost and capacity scale linearly with concurrent sessions, which is the honest model. Any design that breaks this relationship (shared sandboxes, reused environments) breaks the isolation guarantee, so treat linearity as a feature, not a cost to optimize away.

At 10x concurrent sessions, the first bottleneck is snapshot restore throughput. Pre-warm a pool of idle MicroVMs sized to your p95 concurrency, and keep warm spares on every host so a restore storm does not become an admission queue. The token broker is the next bottleneck: session-start bursts mean credential minting bursts, so cache signing keys (never tokens) and keep the mint path allocation-free on the hot path. The egress proxy scales horizontally, but connection tracking tables are finite, so size per expected concurrent connections, not per session.

At 100x, shard pools by tenant or team. Sharding bounds blast radius and isolates noisy neighbors, and it lets you place pools near the workloads they serve. Distribute snapshots to each host's local cache; fetching snapshot data over the network at restore time becomes a latency killer at this scale. Keep the control plane stateless so it scales horizontally without coordination, and run regional token brokers backed by KMS rather than one global broker.

Queueing and backpressure belong in front of the pool. When the pool is saturated, do not slow-start sessions for everyone; either fail fast with a retry-after or hold requests in a bounded queue and drop anything that waits past your p99 wait SLO. Autoscale the pool on queue depth and restore latency, not on VM CPU, because the VMs are supposed to be busy. Backpressure must propagate to the agent as a structured, retryable error, never as a hang. An agent that hangs on a saturated pool will retry, and retries turn saturation into an outage.

The binding constraint on host density is almost always memory: each guest needs its kernel plus working memory, and that floor does not compress. Size hosts for it.

## Security Considerations

Start from the threat model: the agent is already compromised. A prompt injection in a README, a poisoned tool description, a malicious browser extension speaking through the trusted channel. The sandbox is the last line of defense, so design it as if the attacker is already inside the guest.

Escape vectors are real even for MicroVMs. The hypervisor attack surface concentrates in virtio device drivers, so attach the minimum: no unused block or network devices, no vsock unless the design needs it, no shared folders. Run a minimal guest kernel with unneeded drivers compiled out, and apply seccomp filtering to the guest agent process so a compromised agent inside the VM has fewer syscalls to work with. Sign your snapshots and verify the signature at restore time; a poisoned snapshot poisons every session restored from it. For the most sensitive workloads, consider single-tenant host pools: side-channel leakage between tenants sharing a host is a residual risk no software boundary fully removes.

Resource limits are enforced by the host, never by code inside the guest. Cgroups v2 caps on CPU and memory per MicroVM, disk quotas, maximum process counts, and a wall-clock timeout on every tool call with kill on exceed. A fork bomb or memory exhaustion attempt should hit a host-enforced ceiling and die there, taking down one session and nothing else.

Network egress stays deny-by-default. The allowlist proxy is the only route out; DNS gets filtered to block tunneling; the cloud metadata endpoint is blocked outright, since it is the classic path from code execution to credential theft. There are no inbound connections to the MicroVM except the control channel, and the control channel uses mutual TLS.

Encryption covers the rest: snapshots encrypted at rest with KMS-managed keys, ephemeral disks destroyed with their keys at session end (cryptographic shredding beats overwriting), and per-session data keys under envelope encryption. Keys are minted per session, rotated when snapshots are rebuilt, and never baked into images.

## Production Checklist

Monitoring: pool depth versus demand, warm spare count per host, snapshot restore latency (p50 and p99), session lifetime distribution, token mint latency and error rate, egress deny rate, and audit pipeline lag. If you cannot see the pool, you cannot operate it.

Alerting: snapshot restore failure rate spike, pool exhaustion (queue depth crossing the shed-load threshold), token broker errors, egress deny spikes (a compromised agent probing the boundary looks exactly like this), and audit ingestion lag. Losing audit visibility during an incident is how a two-hour investigation becomes a two-week one.

Runbooks you need before launch: suspected escape (isolate the host, preserve a memory snapshot for forensics, rotate snapshot signing keys, rebuild the pool from the last known-good snapshot); pool exhaustion (shed load per policy, page the capacity owner, know which tenants get priority); snapshot corruption (halt new restores, fall back to the previous signed snapshot).

Failure modes to design for: snapshot restore failure (fall back to cold boot from the golden image, slower but safe); host failure (every session on that host dies, so the agent must retry as a new session, which is why tool calls need idempotency); control plane outage (fail closed: no new sessions start, existing sessions run to their TTL); egress proxy outage (sessions lose network access and tool calls fail closed, never open).

Graceful degradation under saturation: stop admitting new sessions first, keep existing ones healthy, and optionally restrict new tool calls to a read-only set. Never degrade the security path. Skipping policy checks because the system is under load is how a capacity incident becomes a security incident.

## What to build first

You do not need all of this on day one. In order:

1. Get untrusted generated code into MicroVMs. This is the single highest-value move. If your agents run code anywhere with a shared kernel today, fix that first.
2. Split the control plane from execution. The agent loop makes decisions; the sandbox executes. Narrow API between them.
3. Kill long-lived credentials in agent contexts. Short-lived, scoped, per-session.
4. Add egress allowlists and audit logging. These are cheap once the sandbox exists.

Isolation, identity, and observability have to be enforced by infrastructure, because they cannot be enforced by the model. The model is the thing you are defending against. Build accordingly.
