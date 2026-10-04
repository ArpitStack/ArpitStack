---
title: "Attributing LLM API Costs to Features, Users, and Requests"
date: "2027-01-11"
tags: ["AI", "LLMs", "Cost Attribution", "Engineering"]
description: "Token metering, per-request tagging, cost allocation models, and budget guardrails. How to know exactly which feature is burning your OpenAI budget."
readingTime: 13
---

LLM API bills are opaque by default. You get a total: $4,200 last month to OpenAI. But which feature spent it? Which user? Which specific API call pattern? Without attribution, you cannot optimize, you cannot charge back, and you cannot tell whether that new AI feature is profitable or a money pit.

I build cost attribution systems. This post covers how to meter LLM usage at the request level, allocate costs to features and users, and enforce budgets before the spend happens.

## Why LLM Costs Are Hard to Attribute

Traditional cloud costs map to infrastructure: this EC2 instance, that S3 bucket. LLM costs map to API calls, and API calls do not carry business context by default.

The specific challenges:

**Token counts vary per request.** The same endpoint can cost $0.001 or $0.50 depending on input length and output length. You cannot estimate from request count alone.

**No built-in tagging.** AWS lets you tag resources. OpenAI, Anthropic, and other providers give you an API key and a bill. The mapping from "API call" to "business unit" is entirely your problem.

**Shared API keys.** If your backend uses one API key for all LLM calls, the provider sees one customer. You need to split that internally.

**Model differences.** GPT-4 costs roughly 20x more than GPT-3.5 per token. If different features use different models, a simple per-request split is wrong.

**Streaming responses.** Token counts for streamed responses are not known until the stream completes. You need to count after the fact.

## Token Metering

The foundation is accurate per-request metering. For every LLM API call, record:

```python
@dataclass
class LLMUsageRecord:
    request_id: str
    timestamp: datetime
    feature: str          # which product feature initiated this
    user_id: str          # which end user (if applicable)
    team: str             # owning team
    model: str            # e.g., "gpt-4", "claude-3-opus"
    input_tokens: int
    output_tokens: int
    input_cost: Decimal   # calculated from pricing table
    output_cost: Decimal
    total_cost: Decimal
    latency_ms: int
    status: str           # success, error, timeout
```

**Where to meter:** In a middleware layer or API gateway that wraps all LLM calls. Do not rely on each feature team to instrument correctly. Centralize it.

```python
class MeteredLLMClient:
    def __init__(self, provider_client, meter):
        self.client = provider_client
        self.meter = meter

    def complete(self, *, feature, user_id, model, messages, **kwargs):
        start = time.time()
        try:
            response = self.client.chat.completions.create(
                model=model, messages=messages, **kwargs
            )
            usage = response.usage
            self.meter.record(LLMUsageRecord(
                request_id=str(uuid4()),
                timestamp=datetime.utcnow(),
                feature=feature,
                user_id=user_id,
                team=self.resolve_team(feature),
                model=model,
                input_tokens=usage.prompt_tokens,
                output_tokens=usage.completion_tokens,
                input_cost=self.price_input(model, usage.prompt_tokens),
                output_cost=self.price_output(model, usage.completion_tokens),
                total_cost=...,  # sum
                latency_ms=int((time.time() - start) * 1000),
                status="success",
            ))
            return response
        except Exception as e:
            self.meter.record(...status="error"...)
            raise
```

**Pricing tables.** Maintain a pricing table per model per provider, updated when providers change prices (which happens regularly). Store the price version with each record so historical costs remain accurate even after price changes.

**Streaming.** For streamed responses, accumulate tokens as chunks arrive, then record the total when the stream closes. Most providers include usage in the final chunk or a trailing metadata message.

## Per-Request Tagging

Metering tells you the cost. Tagging tells you who to blame (or credit).

**Feature tagging.** Every LLM call must carry a feature identifier. Enforce this at the client wrapper level: make `feature` a required parameter. No feature tag, no API call.

**User attribution.** For user-facing features, propagate the end-user ID through the call chain. This usually means threading context through your request handling:

```python
# In your request handler
with llm_context(feature="support-chatbot", user_id=request.user.id):
    response = assistant.generate_reply(user_message)
    # All LLM calls within this context are automatically tagged
```

Context variables (Python's `contextvars`, Go's `context.Context`) are the clean way to do this without passing tags through every function signature.

**Team mapping.** Maintain a mapping from feature to owning team. This can be a config file, a database table, or derived from your service ownership metadata. The point is that cost reports roll up to teams without manual mapping.

## Reference Architecture

Every LLM call in the organization flows through one metered path. No direct provider calls, no exceptions.

```
+----------------+     +----------------+     +----------------+
| App Services   |---->| Metered        |---->| Provider APIs  |
| support chat   |     | LLM Gateway    |     | OpenAI Anthropic|
| code assist    |     | auth plus tag  |     | Gemini         |
| summarizer     |     | budget check   |     +-------+--------+
+-------+--------+     +-------+--------+             |
        |                      |                      v
        | tags flow            |              +-------+--------+
        | with requests        |              | Usage Records  |
        +----------------------+              | per request    |
                                              | tokens plus cost|
                                              +-------+--------+
                                                      |
                                                      v
                                              +-------+--------+
                                              | Stream Proc    |
                                              | validate       |
                                              | enrich         |
                                              +-------+--------+
                                                      |
                                                      v
                                              +----------------+
                                              | Attribution DB |
                                              | Postgres       |
                                              | priced records |
                                              +-------+--------+
                                                      |
                                                      v
                                              +----------------+
                                              | Dashboards     |
                                              | per team       |
                                              | per feature    |
                                              +----------------+
                                                      |
                                                      v
                                              +----------------+
                                              | Budget Alerts  |
                                              | 50 80 100 pct  |
                                              | kill switches  |
                                              +----------------+
                                                      |
                                                      v
                                              +----------------+
                                              | Monthly Recon  |
                                              | vs provider    |
                                              | invoice        |
                                              +----------------+
```

Application services never call providers directly. They call the metered gateway with feature, user, and team context, and the gateway does three things before the request leaves: it verifies the feature tag is present, it checks the budget (pre-call enforcement), and it records the usage afterward with token counts and computed cost from the versioned pricing table. Usage records stream into a processing layer that validates and enriches them, then lands in Postgres keyed by date, team, feature, and user. Dashboards, budget alerts, and kill switches all read from this database, and a monthly reconciliation job compares metered totals against the provider invoice to catch metering gaps.

## Cost Allocation Models

Once you have per-request records, allocation is a reporting problem:

**Direct attribution.** The simplest model. Each request's cost goes to its tagged feature, user, and team. This covers 80% of cases.

**Shared costs.** Some LLM usage is shared: a background embedding pipeline that serves multiple features, or a fine-tuned model used across products. Allocate shared costs by a defined rule:

- Proportional to direct usage (if Feature A uses 70% of the shared pipeline's output, it gets 70% of the cost)
- Equal split (for truly shared infrastructure)
- Custom weights (defined by finance or product leadership)

Document the allocation rules. When someone questions a chargeback, "here is the rule we applied" is the answer.

**Model cost normalization.** If you want to compare efficiency across features using different models, normalize to a reference. For example, express all costs in "GPT-4-equivalent tokens" so a feature using a cheap model does not look artificially efficient.

## Budget Guardrails

Attribution tells you what happened. Guardrails prevent bad things from happening.

**Alert thresholds.** Set budgets per feature, per team, per user. Alert at 50%, 80%, 100% of budget. Alerts should go to the team that owns the spend, not to a central cost alias that nobody reads.

**Pre-call enforcement.** For high-risk patterns, check budget before making the API call:

```python
def guarded_complete(self, *, feature, user_id, estimated_tokens, **kwargs):
    budget = self.budget_store.get_remaining(feature, period="monthly")
    estimated_cost = self.estimate_cost(kwargs.get("model"), estimated_tokens)

    if estimated_cost > budget.remaining:
        raise BudgetExceededError(
            f"Feature '{feature}' has ${budget.remaining:.2f} remaining, "
            f"estimated cost ${estimated_cost:.2f}"
        )

    if estimated_cost > budget.warning_threshold:
        self.alert(f"Feature '{feature}' approaching budget limit")

    return self.complete(feature=feature, user_id=user_id, **kwargs)
```

Estimation is imperfect (you do not know output tokens in advance), but you can estimate conservatively using the maximum output tokens configured for the request.

**Rate limiting per user.** For user-facing AI features, per-user rate limits prevent both cost blowouts and abuse. A user generating 10,000 requests/hour is either a power user or a script. Either way, they need a limit.

**Kill switches.** Every AI feature needs a kill switch that stops LLM calls immediately without a deployment. When a prompt injection attack or a runaway loop starts burning money, you need to stop it in seconds, not after a CI pipeline finishes.

## Reporting

The output of all this metering is reports that different audiences actually use:

**For engineering teams:** Daily cost per feature, trend lines, anomaly alerts. "Your feature's LLM spend doubled yesterday" should trigger investigation, not surprise at month end.

**For product managers:** Cost per user, cost per active user, cost as percentage of revenue per feature. This is how you decide whether an AI feature is economically viable.

**For finance:** Monthly rollups by team, by cost center, with allocation rules documented. They need numbers that reconcile with the provider invoice.

**Reconciliation.** Your metered total should match the provider bill within a small margin (1-2%). If it does not, you have a metering gap: untracked API keys, direct provider calls bypassing your wrapper, or pricing table errors. Reconcile monthly.

## Scalability

**At 10x request volume:** The gateway is the first scaling concern. Every LLM call passes through it, so gateway latency adds directly to user-facing latency. Keep the hot path lean: budget checks should hit an in-memory cache of remaining budgets, not a database query per request. The metering write path needs to be asynchronous: record to a fast buffer (Kafka, or even a local queue with batch flush) and never block the LLM response on a database insert. At 10x, a synchronous meter insert that takes 20ms adds 20ms to every user request, which is how cost infrastructure becomes a performance problem.

**At 100x:** The attribution database becomes a genuine big-data problem. One hundred times the requests means billions of usage records per month, and nobody queries raw records at that scale. The pattern is rollup tiers: raw records kept for 30 days for debugging, hourly aggregates per feature per team kept for a year, daily aggregates kept indefinitely. Budget enforcement moves to a dedicated low-latency store (Redis with per-feature counters, refilled on a schedule) because the relational database cannot serve 100x budget checks at p99 under 5ms. Pricing table updates become a deployment event with versioning, since a bad price propagates to every record until caught.

**What breaks first:** The budget check path, then the metering pipeline, then reconciliation. Budget checks break first because they sit in the request path and every millisecond counts; a slow budget store either adds latency or, worse, gets bypassed under pressure, which defeats the purpose. Next the metering pipeline falls behind, and you discover the gap days later when dashboards show yesterday's spend as zero. Reconciliation breaks last but hurts most: at 100x, a 1 percent metering gap is real money, and finding whether it is untracked keys or pricing drift takes forensic work. Mitigations in order: cache budgets aggressively with conservative fallbacks (fail closed on budget, fail open on metering), monitor metering lag as a first-class metric, and automate reconciliation daily instead of monthly so gaps surface while the logs still exist.

**Horizontal scaling strategy:** The gateway scales horizontally behind a load balancer with no shared state except the budget cache, which is fine to be eventually consistent within a minute. Partition usage records by month from day one; time-based partitioning is correct here because queries are always time-ranged. Shard the stream processing by feature so one runaway feature's volume does not delay metering for everyone else.

## Security Considerations

**API key management.** Provider API keys are the crown jewels: whoever holds them can spend your money. Store them in a secrets manager, inject at deploy time, rotate on a schedule, and never let them reach application code or logs. Better yet, use a single key per provider held only by the gateway, so rotation touches one place. Monitor key usage patterns: a key used from an unexpected network or at 3 AM deserves investigation.

**PII in prompts and logs.** Usage records contain prompts, or at least prompt metadata, and prompts contain whatever users typed: names, account numbers, health details. Decide explicitly what gets stored. The safe default is to store token counts, feature tags, and cost, but not prompt text. If you need prompts for debugging, store them encrypted with restricted access and a short TTL. Your cost attribution database will otherwise quietly become a PII warehouse subject to deletion requests you cannot honor.

**Access control on cost data.** Cost per feature per team is sensitive: it reveals margins, usage patterns, and business priorities. Dashboards need role-based access so teams see their own spend in detail and only aggregates for others. Finance gets everything. The API that serves cost data authenticates every caller.

**Attack vectors specific to LLM spend.** Prompt injection is a cost attack, not just a correctness problem: an attacker who tricks your assistant into generating maximal-length outputs in a loop burns money at machine speed. Rate limits per user, per-feature output token caps, and anomaly detection on spend velocity are your defenses. Also watch for key exfiltration through the application: if any endpoint echoes provider errors verbatim, it might leak key prefixes or account details. And model the insider case: a team member with gateway access can disable budget checks, so changes to guardrail configuration need approval and audit logs.

**Secrets handling.** Beyond provider keys: the signing keys for usage records (if you need tamper-evident metering for chargeback disputes), database credentials, and alerting webhook URLs all live in the secrets manager. Rotate on schedule, audit access, and make sure staging uses different keys from production so a staging leak does not become a production bill.

## Production Checklist

**Metrics to monitor:**
- Metering lag: time from LLM call to recorded usage (should be seconds)
- Metered total vs provider dashboard total, tracked daily
- Budget check latency p50 and p99 on the gateway hot path
- Requests rejected by budget enforcement, by feature
- Pricing table version in use and age of last update
- Untagged or untrackable request rate (should be zero; any nonzero is a metering gap)
- Anomaly alerts fired per day per feature
- Kill switch state per feature (know which are armed)

**Alert thresholds:**
- Metering lag above 5 minutes: ticket. Above 30 minutes: page. Stale metering means stale budgets.
- Daily metered total diverges more than 2 percent from provider dashboard: ticket. More than 5 percent: page.
- Any untagged request: ticket immediately. One untagged path becomes ten.
- Feature spend velocity 3x its 7-day baseline: page the owning team. This is the runaway-loop detector.
- Pricing table older than 30 days without review: ticket. Providers change prices quietly.

**Failure modes and runbooks:**
- *Runaway spend from a prompt loop:* runbook covers hitting the feature kill switch, identifying the triggering input pattern from usage records, and the criteria for re-enabling.
- *Metering pipeline down:* runbook covers the backlog drain procedure, how to estimate unmetered spend from provider dashboard during the gap, and backfill into the attribution DB.
- *Pricing table error:* runbook covers identifying affected records by price version, recomputing costs, and notifying finance of restated numbers.
- *Provider API outage:* runbook covers gateway behavior (fail fast with cached responses where safe, queue non-urgent batch work), and spend impact estimation.

**Capacity planning:** The gateway needs headroom for 3x normal peak because LLM traffic is bursty (product launches, viral features). The attribution database grows linearly with request volume: project record counts 12 months out and pre-create partitions. Review per-feature budgets monthly with the owning teams; a budget set a year ago is either blocking growth or too loose to matter.

## What Not to Do

- Do not try to attribute costs from the provider dashboard alone. It does not have your business context.
- Do not let feature teams use their own API keys directly. Centralize through a metered gateway.
- Do not set budgets without alerting. A budget nobody monitors is decoration.
- Do not optimize token usage before you can measure it. Metering comes first, optimization second.

The goal is simple: every dollar of LLM spend should be traceable to the feature, user, and request that caused it. Once you have that, cost optimization becomes a data-driven exercise instead of guesswork.
