---
title: "AI Agent Cost Observability: Metering Tokens in Production"
date: "2026-10-05"
tags: ["AI Agents", "Cost Observability", "DevOps", "LLM"]
description: "Coding agents burn tokens the way servers burn CPU, but most teams still cannot say where the tokens go. Token metering, budget guardrails, and per-team attribution are how you fix that."
readingTime: 15
---

Your coding agents are spending money right now. Can you tell me how much they spent yesterday, which team spent it, and what it bought you?

If you run a platform team, this should feel familiar. Ten years ago the question was about cloud spend. EC2 bills arrived as a single number and nobody could say which service, team, or feature was responsible. An entire discipline grew up around answering it. We are now replaying that movie with AI tokens, and most teams are still in the opening scene.

## Why agent spend is invisible

Provider dashboards will show you totals. The model providers all meter API usage and invoice it accurately. What they do not give you is attribution. A monthly total does not tell you which team burned it, which project it served, or whether the expensive run was worth it.

Coding agents make this worse in three specific ways.

First, a single task fans out. You ask an agent to fix a bug. Behind that one request, the agent makes dozens of model calls: reading files, running tools, retrying failed commands, spawning subagents that spawn their own calls. Splunk's Token Meter project documented exactly this problem in its September 2026 design notes: child agents can keep consuming tokens after the parent session appears quiet, and the first version of the dashboard had no parent-to-child cost view. Your bill sees one API key. The reality is a tree of sessions.

Second, context is expensive and mostly invisible. Every retry re-sends the accumulated context. Every tool result gets appended. A run that looks like one task from the outside can carry hundreds of thousands of input tokens you never consciously approved. The token counter on your provider dashboard moves, but nothing in your workflow explains why.

Third, there is no natural owner. Cloud spend eventually got tagged: every resource carries labels, every team owns its namespace. Agent usage usually runs through shared API keys or a single enterprise contract. When finance asks who spent what, the honest answer is "the engineers, collectively," which is not an answer.

## What token metering looks like

The good news is that tooling is arriving. In September 2026, Splunk open-sourced Token Meter, a local-first dashboard for AI coding agents. It reads the trace files that agents like Claude Code, Codex, Cursor, OpenCode, Kiro, and Pi already write to disk, and prices them against public model rates. Out of the box it shows output speed in tokens per second, time spent waiting on the model, the split between fresh input and generated output, tool activity, context growth, retries, and failures. It compares sessions across agents, models, and days, and it sends a notification when a run crosses a budget threshold or cost spikes.

```bash
git clone https://github.com/splunk/token-meter.git
./token-meter/scripts/install
```

Two design choices in Token Meter are worth noting because they point at where the industry is heading.

The first is local-first. The tool runs entirely on your machine: Python standard library, no API keys needed for trace analysis, no telemetry leaves your laptop. That matters because agent traces are sensitive. They contain file paths, code contents, and sometimes secrets. Teams are rightly wary of shipping that to a third-party dashboard. Expect the serious cost-observability tooling for agents to follow this pattern: measure locally, aggregate centrally, never move raw traces further than necessary.

The second is the read-only MCP server. Token Meter exposes its data through a Model Context Protocol server so an AI coding agent can pull its own cost data. That is a small detail with a large implication. Once agents can see their own meter, you can build workflows where the agent itself decides whether to continue, switch to a cheaper model, or ask for approval. Cost awareness moves from a dashboard humans check into the loop itself.

## System Architecture

A production cost-observability stack for agents has five pieces: collectors that parse traces where they are written, a pricing engine that turns tokens into money, an attribution store that holds aggregates, a budget service that answers "can this call proceed," and alerting on top. The data flows one way, from the edge inward, and raw traces never travel further than they have to.

```
+------------------+     +------------------+     +------------------+
| Agent Trace      |---->| Collector        |---->| Pricing Engine   |
| Files (per host) |     | (local parse,   |     | (rate cards,     |
+------------------+     | redact)         |     | versioned)       |
                         +--------+---------+     +--------+---------+
                                  |                        |
                                  v                        v
                         +------------------+     +------------------+
                         | Attribution      |<----| Aggregates Only  |
                         | Store (central)  |     | (no raw prompts) |
                         +--------+---------+     +------------------+
                                  |
                                  v
                         +------------------+
                         | Budget Service   |
                         | pre-call checks  |
                         | alerts, kill     |
                         +------------------+
```

Three design decisions carry most of the weight.

First, parsing happens at the edge. The collector runs on the same host as the agent (or as a sidecar in the agent's infrastructure), parses trace files locally, redacts anything sensitive, and ships only aggregates: token counts by model, session, and team, plus metadata like duration and retry counts. This is the local-first principle extended to a fleet. Raw prompts and tool outputs stay where they were written.

Second, rate cards are versioned. Model prices change, sometimes mid-month. Every priced record carries the rate-card version it was priced with, and the pricing engine keeps old versions so historical numbers stay reproducible. Nothing erodes trust in a cost dashboard faster than last month's numbers changing because a price was updated.

Third, ingestion is idempotent. Collectors retry, networks drop, and the same session's aggregates will arrive twice. Dedupe on (session ID, collector ID, sequence number) at the store so retries are safe. Without this, every network blip inflates someone's bill.

The budget service is the only component in the agent's request path. It keeps an in-memory ledger of spend per session, team, and principal, synced from the attribution store on a short interval, and answers allow-or-deny in single-digit milliseconds. The rest of the system can be minutes behind. The budget check cannot.

## From metering to guardrails

A meter tells you what happened. A guardrail changes what happens next. There is a meaningful difference between the two, and most teams stop at the first.

Alerts are the lightest guardrail. Token Meter's threshold notifications are a good start: tell me when a session crosses a dollar amount, or when spend spikes relative to baseline. This is the equivalent of a cloud budget alert. Useful, but it fires after the money is gone.

The next level is per-session and per-team budgets with enforcement. Concretely, this means:

- Per-session caps. A single agent run should not be able to burn an unbounded amount. Set a default cap per session and require explicit approval to raise it.
- Per-team budgets. Give each team a monthly token budget the way you give them a cloud budget. Make it visible. Teams that can see their burn rate manage it.
- Approval gates for long runs. When an agent wants to continue past a threshold, it should ask. The read-only MCP pattern above makes this natural: the agent checks its own meter and requests approval through the same channel it uses for everything else.
- Kill switches. A runaway agent loop, retrying the same failing command hundreds of times, should be stoppable automatically, not discovered on Monday morning.

The strongest form is pre-call enforcement: checking the budget before the API call is made, not after. Post-hoc reporting tells you that you overspent. Pre-call enforcement means the call that would have broken the budget never happens. This is the harder system to build, because it has to sit in the request path with low latency, but it is the only approach that actually prevents surprises. It is also the approach I have been building toward with CostReveal, my cost attribution project: budgets enforced before spend happens, not invoiced after.

Pre-call enforcement has a latency budget and an identity problem, and both need answers before you ship it. The latency budget: the check sits between the agent and the model API, so it has to return in single-digit milliseconds. That rules out a database round trip. The working design is a local budget cache per enforcement point, synced from the ledger every few seconds, with the overshoot bounded by the sync interval. You accept that a session can exceed its budget by at most one sync window of spend. That is a tunable tradeoff, not a flaw: tighten the sync interval and you pay more in sync traffic, loosen it and you accept more overshoot. Pick the interval from the numbers, not from instinct.

The identity problem: the budget has to be keyed on the principal (the team, the service account, the human), not the API key. If budgets are keyed on API keys, anyone who can rotate a key can reset their budget, and shared keys make attribution impossible anyway. This is the same lesson cloud cost allocation learned with tags: unenforced identity is unenforced policy. Bind the agent session to a principal at creation, propagate that identity through every subagent spawn, and make the budget service reject calls with no principal attached. The Splunk anecdote about child agents consuming tokens after the parent went quiet is exactly what happens when identity does not propagate down the spawn tree.

## Attribution: the part that actually changes behavior

Metering and guardrails control cost. Attribution changes culture. The moment a team can see its own agent spend broken down by project, the conversation shifts from "AI is expensive" to "this is what our AI usage costs per unit of work."

Three attribution cuts are worth building:

1. By team and project. The same chargeback model used for cloud cost allocation. If the data platform team spends three times what the frontend team spends on agents, that should be a visible fact, not a surprise buried in a shared bill.

2. By unit of work. Cost per merged pull request. Cost per resolved ticket. Cost per feature shipped. These numbers let you answer the question executives actually ask: is this spend producing value? A team spending $2,000 a month on agents that ships twice as fast has a story. A team spending the same amount with nothing to show has a problem.

3. By model and agent for the same task class. This is where metering pays for itself. If 80 percent of your agent tasks are routine refactors that a cheaper model handles fine, routing those to the cheaper model is pure savings. But you cannot make that call without per-task-class cost data. Token Meter's cross-model comparison views are built for exactly this analysis.

## Scalability

Token metering starts as a script on one laptop and ends as fleet infrastructure. The scaling story is mostly about write volume and keeping the budget check fast.

**10x: one team, many agents.** A single collector per host handles thousands of sessions a day without trying. The attribution store keys records by (team, day, model) and ingests in batches. Alerting is a scheduled query over the store. At this scale the only real bottleneck is trace file I/O on busy dev machines, solved by tailing files incrementally instead of re-reading them.

**100x: a fleet of collectors.** Now there are collectors on every host, streaming into a partitioned ingestion pipeline. The fixes are standard but they have to be deliberate. Pre-aggregate at the edge: the collector ships 5-minute rollups per session instead of per-call records, which cuts central write volume by two orders of magnitude while keeping per-call detail available locally for debugging. Partition the store by team so one team's backfill does not slow another team's dashboard. Cache rate cards in memory at the pricing engine; a price lookup should never be a network call.

**Queueing and backpressure.** The budget check is the one place where backpressure meets the agent loop. Give each enforcement point a bounded local queue and a local budget cache. If the ledger sync lags, the enforcement point keeps answering from its cache and marks decisions as stale. If the cache itself is exhausted, the safe default depends on your posture: fail-open keeps agents running but risks overspend, fail-closed stops work but guarantees the budget. Most teams start fail-open with aggressive alerting on staleness, then move high-risk principals to fail-closed once the ledger sync is proven reliable. The ingestion pipeline behind the store uses the same pattern as any telemetry system: bounded buffers, drop detail before dropping aggregates, and a visible metric for data loss so nobody confuses a quiet dashboard with a quiet system.

**The bottleneck that surprises people.** It is not the store or the collectors. It is the budget check's p99 latency creeping up as the principal count grows, because the local cache gets evicted more often. Size the cache for principals, not sessions, and prefetch the hot principals. A budget check that takes 50 milliseconds on a loop that iterates hundreds of times has added seconds to every agent run.

## Security Considerations

Cost telemetry is sensitive in ways that surprise teams used to infrastructure metrics. A token count is boring. The trace it was derived from contains prompts, file paths, code contents, and sometimes credentials the agent was shown.

**Keep raw traces local.** The collector redacts before shipping: strip prompt contents, tool arguments that look like secrets, and file paths beyond the project root. The central store holds aggregates and hashes, never raw prompts. This is not just hygiene. If the attribution store is breached, the blast radius should be billing metadata, not source code.

**Auth and access control.** Collectors authenticate to the ingestion endpoint with per-host credentials, and dashboards enforce per-team RBAC: a team sees its own spend in detail and everyone else's only as anonymized aggregates. Finance gets the full rollup. Nobody gets raw traces except the security team, and their access is logged.

**Attack vectors.** Spoofed trace data is the obvious one: a compromised host could under-report its spend to dodge budgets. Mitigate by signing trace batches at the collector and verifying at ingestion, and by reconciling collector-reported totals against provider invoices on a schedule. Budget bypass via key rotation is the second: as discussed above, budgets key on principal identity, not API keys, so rotating a key changes nothing. Rate-card tampering is the third: rate cards are versioned and signed, and the pricing engine rejects unsigned updates. An attacker who can change prices can hide spend or manufacture false overruns.

**Encryption.** TLS in transit everywhere, encryption at rest for the attribution store. The store is a financial record, so treat it like one: immutable priced records (append-only, no updates), access logging, and retention policies that match your finance team's audit requirements.

## Production Checklist

**Monitoring.** Track ingestion lag per collector, parse error rate, unpriced tokens (tokens for a model with no rate card entry, which means money you cannot explain), budget denial rate, and alert delivery success. The unpriced-token metric deserves emphasis: every new model launch creates a window where spend is real but unattributed. Alert on it.

**Alerting.** Threshold crossings per session and per team, spend spikes versus a rolling baseline, budget exhaustion forecasts (at current burn, team X runs out on Thursday), and collector health. Route budget alerts to the team channel, not to an individual, so the information survives someone being on leave.

**Runbooks.** Rate-card update (add the new model, backfill unpriced tokens, verify totals against the provider invoice). Collector outage (local buffer fills, backfill on recovery, verify no double-counting via idempotent ingestion). Disputed chargeback (pull the priced records with rate-card versions, walk the team through the session tree). Runaway agent (kill switch, confirm spend stopped, post-mortem on why the budget did not catch it).

**Failure modes.** If a collector dies, traces buffer on disk and backfill when it restarts; the local alert threshold still fires from the trace files directly. If the central store is down, dashboards go stale but enforcement continues from local budget caches, which is exactly why the budget path does not depend on the store. If trace timestamps skew across hosts, attribution windows get fuzzy; use collector-receipt time as the canonical timestamp for billing windows and keep agent timestamps as metadata.

**Graceful degradation.** When the ledger sync fails, enforcement falls back to the last-known budget cache with staleness alerts. When the pricing engine has no rate card for a model, tokens are recorded as unpriced rather than dropped: losing data is worse than unattributed data. The metering system must never block the agent loop. An agent that cannot run because the cost dashboard is down will get the cost dashboard deleted.

## What to do this week

You do not need a platform project to start. Install Token Meter and run it for a week. You will learn two things immediately: which sessions are expensive, and how much of your spend is retries and context regrowth versus actual work.

Then set one alert. A per-day threshold that notifies the team channel is enough to start. The goal is not to restrict usage on day one. The goal is to make the spend visible.

Attribution and enforcement come after visibility, in that order. Teams that can see their spend will manage most of it themselves. Guardrails are for the remainder: the runaway loops, the forgotten sessions, the subagent trees that nobody watched.

The cloud industry learned this sequence a decade ago: measure, alert, attribute, enforce. Agent spend is following the same path, just faster. The teams that build the metering now will be the ones with sane AI bills later.
