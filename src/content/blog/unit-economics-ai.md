---
title: "Unit Economics for AI Products: Cost Per Request Done Right"
date: "2027-03-15"
tags: ["AI", "Cost Attribution", "Product", "Engineering"]
description: "Model costs, infrastructure overhead, and margin math. How to calculate whether your AI feature is actually profitable."
readingTime: 16
---

"We added AI to the product" is easy to say. Knowing whether the AI feature makes money is harder. Many teams ship AI features without understanding the unit economics, then discover months later that their most popular feature loses money on every request.

This post covers how to calculate cost per request properly, including the costs teams forget, and how to use the math to make product decisions.

## Why Unit Economics Matter for AI

Traditional SaaS has well-understood unit economics: cost per user is dominated by infrastructure that scales sublinearly. Add 10x users, and your per-user cost drops because of economies of scale.

AI features break this pattern. LLM API costs scale linearly with usage. Every additional request costs roughly the same as the last one. There is no economy of scale on the model cost (though there are on the surrounding infrastructure).

This means:
- An AI feature that is unprofitable at 1,000 requests/day is unprofitable at 1,000,000 requests/day
- Volume does not fix bad unit economics for AI features
- You need to know your cost per request before you scale, not after

## The Full Cost Stack

Cost per request is not just the LLM API call. The full stack:

**1. Model cost (variable)**
The API charge per request. Calculate as:
```
(input_tokens x input_price_per_token) + (output_tokens x output_price_per_token)
```
Measure actual token distributions from production, not estimates. P50, P90, and P99 token counts matter because a few very long requests can dominate total cost.

**2. Infrastructure overhead (semi-variable)**
The backend that wraps the LLM call:
- API servers handling the request
- Queueing and retry logic
- Caching layer (if any)
- Database writes for conversation history

This scales with request volume but sublinearly. Allocate based on the percentage of infrastructure dedicated to AI features.

**3. Pre/post processing (variable)**
- Input validation, prompt construction, context retrieval (RAG)
- Output parsing, safety filters, formatting
- Embedding costs for retrieval (separate from generation costs)

RAG pipelines are sneaky expensive. The embedding model calls, vector database queries, and re-ranking steps add up. Measure them separately.

**4. Human review (variable, often forgotten)**
If outputs require human review (customer support, content moderation, legal), the labor cost per reviewed request often exceeds the model cost. Include it.

**5. Development and maintenance (fixed, amortized)**
Prompt engineering, evaluation datasets, model upgrades, monitoring. Amortize over expected request volume for a planning period.

**Total cost per request:**
```
Total = Model + Infra + Processing + Human Review + (Fixed / Expected Volume)
```

## Worked Example

Let us calculate for a hypothetical AI support chatbot:

**Assumptions:**
- 100,000 requests/month
- Average: 800 input tokens, 300 output tokens per request
- Model: mid-tier (say $3 per million input tokens, $15 per million output tokens)
- 5% of responses require human review (2 minutes each at $25/hour fully loaded)
- Infrastructure: $500/month allocated to the chatbot backend
- Development amortization: $2,000/month

**Model cost per request:**
```
Input:  800 tokens x $3/1M = $0.0024
Output: 300 tokens x $15/1M = $0.0045
Total model cost: $0.0069 per request
```

**Infrastructure per request:**
```
$500 / 100,000 = $0.005 per request
```

**Human review per request (amortized):**
```
5% x 2 minutes x ($25/60) = 0.05 x $0.833 = $0.0417 per request
```

**Development amortization:**
```
$2,000 / 100,000 = $0.02 per request
```

**Total cost per request: $0.0736**

At $0.074 per request, 100,000 requests cost $7,360/month. If this feature is included in a $20/month subscription with 5,000 users making 20 requests each, the revenue is $100,000 and the AI cost is 7.4% of revenue. Probably fine.

But if it is a free tier feature with no direct revenue, that $7,360 is pure cost. And if usage grows 10x without revenue growing proportionally, you have a problem.

Notice that human review ($0.042) dominates the model cost ($0.007). This is common and frequently overlooked.

## Margin Math

Once you have cost per request, the product questions become clear:

**Break-even analysis:**
```
Required revenue per request = Total cost per request / (1 - target margin)
```

If your cost is $0.074 and you want 70% gross margin:
```
Required: $0.074 / 0.30 = $0.247 per request
```

**Pricing implications:**
- Per-request pricing: charge at least $0.25 per request
- Per-user pricing: if average user makes 50 requests/month, the AI cost per user is $3.70. Price the tier accordingly.
- Freemium: cap free tier requests at a level where total free-tier cost is an acceptable acquisition expense.

**Feature viability:**
If the math does not work, options include:
- Reduce cost (cheaper model, caching, shorter outputs)
- Increase price (or move to a higher tier)
- Limit usage (rate limits, quotas)
- Accept the loss (strategic investment, but make it explicit)

What you cannot do is ignore the math and hope volume fixes it. For AI features, volume amplifies losses.

## Sensitivity Analysis and Scenario Modeling

A single cost-per-request number is a fragile basis for a pricing decision. The useful question is not "what does it cost" but "what moves the cost, and by how much."

Run a sensitivity sweep on the worked example: change each input by a fixed amount while holding the rest constant.

- Input tokens (800 to 400 or 1200): the total moves from about $0.0724 to $0.0748. Small effect, because input tokens are the cheapest component in this pricing.
- Output tokens (300 to 150 or 450): the total moves from about $0.0702 to $0.0771. Larger effect, since output tokens cost five times input tokens here.
- Human review rate (5% to 2.5% or 7.5%): the total moves from about $0.053 to $0.095. This one variable swings the total by four cents, more than the entire model cost.
- Model price (halved or doubled): moves the total by about $0.0035 either way. Barely visible next to human review.
- Cache hit rate (0% to 30%): model and processing costs drop on cache hits, saving roughly $0.0025 per request. Modest here, because model cost is a small slice. It becomes the dominant lever once human review is under control.

Rank inputs by their contribution to variance, not their contribution to the average. In this example, the human review rate is the variable that decides whether the feature is profitable. That tells you where the next engineering sprint goes: better guardrails and confidence thresholds that cut the review rate from 5% to 2% are worth more than any model price negotiation.

Then build scenarios. Never present a single forecast to finance. Present three.

**Optimistic:** semantic cache at 30% hit rate, small-model routing for 80% of requests at one-third the model cost, review rate down to 3% through better prompt guardrails. Cost per request lands around $0.052.

**Base:** the current numbers. $0.074.

**Pessimistic:** users learn to paste longer inputs (input tokens up 25%, output up 15%), the review rate creeps to 8% as the bot handles harder edge cases, and the cache was never built. Cost per request lands around $0.096.

The spread between optimistic and pessimistic is nearly 2x. If your pricing only works in the optimistic scenario, you do not have a viable feature. You have a hope. Set price floors against the base case and treat the pessimistic case as your early warning.

## Cost Reduction Levers

When unit economics do not work, here are the levers in order of impact:

**1. Model selection.** The biggest lever. A smaller model that handles 80% of cases, with fallback to a larger model for the rest, can cut costs 50-70%. Measure quality impact carefully.

**2. Caching.** Cache responses for repeated or similar queries. Semantic caching (matching on meaning, not exact text) can achieve 20-40% hit rates for support and FAQ use cases.

**3. Prompt optimization.** Shorter prompts, fewer examples, more efficient instructions. Every token in the prompt is paid for on every request.

**4. Output limits.** Cap max tokens. Most responses do not need 4,000 tokens. Set sensible defaults per use case.

**5. Batching.** Where latency allows, batch multiple items into one API call. The per-request overhead drops significantly.

**6. Self-hosted models.** At very high volume, hosting an open model can be cheaper than API calls. The crossover point depends on utilization; below 60% GPU utilization, APIs usually win.

Expected impact ranges, measured against the chatbot example above. Treat these as order-of-magnitude guides, not promises:

- Model routing (small model for 80% of traffic, fallback for the rest): 50 to 70% cut in model cost. In this example that is only $0.003 to $0.005 per request, because model cost is a small slice. When model cost dominates, this is the biggest lever you have.
- Semantic caching at 25 to 40% hit rates: 20 to 35% cut in model and processing cost combined.
- Prompt compression (strip redundant few-shot examples, tighten the system prompt): 10 to 25% fewer input tokens per request, with no quality impact if done carefully.
- Output caps: a 1,500 token cap instead of unbounded typically cuts P99 output length by 40 to 60%, and users rarely notice.
- Batching: 30 to 50% reduction in per-request API overhead where latency budgets allow it.
- Self-hosting: 60 to 80% lower per-token cost at high utilization, but a loss below the utilization crossover. See the Scalability section.

Stack these multiplicatively, not additively. Caching 30% off plus model routing 60% off does not equal 90% off. It equals 1 minus (0.7 times 0.4), which is 72% off the model cost slice.

## Cost Flow Architecture

Knowing cost per request in a spreadsheet is fine for planning. Knowing it in production requires a data pipeline that turns raw metered events into attributable, reportable numbers. Here is the shape of that pipeline:

```
         +------------------+
         |  Metered events  |
         |  API calls and   |
         |  tokens and GPUs |
         +--------+---------+
                  |
                  v
         +------------------+
         |  Ingestion and   |
         |  validation      |
         +--------+---------+
                  |
                  v
         +------------------+
         |  Normalization   |
         |  and enrichment  |
         +--------+---------+
                  |
                  v
+------------------+     +------------------+
|  Tag and         |---->|  Allocation      |
|  dimension       |     |  engine          |
|  catalog         |     |                  |
+------------------+     +--------+---------+
                                  |
                                  v
                         +------------------+
                         |  Aggregation     |
                         |  and rollups     |
                         +--------+---------+
                                  |
                                  v
                         +------------------+
                         |  Dashboards      |
                         |  reports + alerts|
                         +------------------+
```

Each stage has a job:

**Metered events.** Every cost-generating action emits an event: tokens in and out, GPU seconds, embedding calls, vector database queries, human review minutes. If it is not metered, it is not attributable. Instrument at the call site, not after the fact.

**Ingestion and validation.** A single intake point that validates events, dedupes retries (a retried API call must not be double-counted), and handles late-arriving data. Idempotency keys on every event.

**Normalization and enrichment.** Convert heterogeneous units (tokens, seconds, API calls) into a common currency. Enrich each event with dimensions: which feature, which team, which customer, which environment. Enrichment happens at ingest time, because joining later is how costs go unattributed.

**Tag and dimension catalog.** The source of truth for what tags exist and who owns them. Without this, you get tag sprawl: `team:payments`, `Team:Payments`, and `payments-team` as three separate dimensions.

**Allocation engine.** Splits shared costs (the GPU cluster, the vector database, the review queue) across the dimensions that consumed them. Allocation rules must be versioned and explainable. "The platform team said so" is not an allocation policy.

**Aggregation and rollups.** Precompute the views people actually query: cost per request per feature per day, per team per month, per customer per quarter. Raw events are too slow to query interactively at volume.

**Dashboards, reports, alerts.** The consumption layer: real-time dashboards for engineering, monthly chargeback reports for finance, alerts for anomalies. A 20% week-over-week spike in cost per request deserves a page, not a quarterly review.

Build this pipeline before you need it. Retrofitting attribution onto a system that never metered anything is a multi-quarter project.

## Tracking Over Time

Unit economics are not static. Track:

- **Cost per request trend.** Is it going up or down? Why?
- **Token distribution shifts.** Are users sending longer inputs over time?
- **Model mix changes.** Are you shifting to cheaper or more expensive models?
- **Cache hit rate.** Is your caching strategy working?
- **Margin per feature.** The ultimate metric.

Set up a dashboard that product, engineering, and finance can all read. When everyone sees the same numbers, cost discussions become collaborative instead of adversarial.

## Scalability

Unit economics are volume-dependent in ways that matter. Recompute the math at 10x and 100x, because the answer changes.

**At 10x volume (1M requests/month):**

Fixed costs amortize. The $2,000/month development amortization drops from $0.02 to $0.002 per request. Infrastructure at $500/month probably does not stay $500; the backend needs more instances, but sublinearly, maybe $2,000/month, which is still only $0.002 per request. Human review at 5% is now 50,000 reviews a month, which is a staffing problem, not a math problem: you either hire reviewers (a step-function cost) or invest in reducing the review rate. Semi-variable costs start behaving like fixed costs with steps.

Caching dynamics improve with volume. A semantic cache needs repeated queries to hit. At 100K requests/month with a long tail, you might see 10% hit rates. At 1M, popular queries concentrate and 30 to 40% becomes realistic. Cache hit rate is one of the few cost levers that gets better with scale, which is why it deserves investment early: the cache you build at low volume pays off disproportionately at high volume.

**At 100x volume (10M requests/month):**

Self-hosting enters the conversation seriously. The crossover math:

```
Monthly API model cost: 10M requests x $0.0069 = $69,000
Self-hosted: 8 GPUs at ~$3/hr x 730 hr = ~$17,500/month
```

But that assumes 70% or higher GPU utilization. At 30% utilization, your effective per-token cost triples and the API wins. The crossover is not a volume number; it is a utilization number. Estimate your steady-state tokens per second, size the fleet to that, and keep API fallback for spikes. Hybrid (self-hosted base load, API burst) beats pure either-or for spiky workloads.

Human review at 100x is 500,000 reviews a month. Nobody hires for that. At this scale, the review rate must drop below 1% through better models, guardrails, and confidence-based routing, or the feature's economics collapse regardless of model cost. This is the real scaling constraint for assisted AI features: labor does not scale sublinearly.

**Where each lever moves with scale:**

- Model selection: impact grows linearly with volume. Negotiate volume discounts with providers; most offer them above certain commit levels.
- Caching: hit rates improve with volume as queries concentrate.
- Prompt optimization: one-time effort, savings scale linearly. Do it early.
- Self-hosting: only viable above the utilization crossover; the crossover volume drops as your traffic gets steadier.
- Human review: becomes the dominant cost at scale. Reducing the review rate is the highest-leverage work at 10x and beyond.

## Security Considerations

Cost data is sensitive data. Treat the pipeline accordingly.

**Access control on cost data.** Cost per feature, per team, and per customer reveals business strategy: which features are expensive, which customers are unprofitable, where margins are thin. Restrict cost dashboards to people who need them. Engineers need their feature's numbers; they do not need every team's margins. Finance needs aggregates; they do not need per-request logs. Apply the same role-based access you would apply to revenue data, because cost data plus revenue data equals the whole P&L.

**PII in prompts and logs.** The cost pipeline logs prompts to compute token counts and to debug anomalies. Prompts contain whatever users typed, which includes names, emails, account numbers, and occasionally things users should never have typed. Decide explicitly: do you log full prompts, truncated prompts, or only token counts? Full prompts give the best debugging but create a PII store that needs retention policies, encryption at rest, and access controls. Token counts alone are usually enough for cost attribution. Keep full prompt logging to a sampled, short-retention debug tier.

**API key hygiene.** The cost pipeline touches provider billing APIs across the company, which makes its credentials high-value targets. Keys live in a secrets manager, never in config files or code. Use separate keys per environment and per major workload, so a leaked key has bounded blast radius. Rotate on a schedule. And audit who can read the keys: if your cost dashboard service account can read a provider key, anyone who compromises the dashboard compromises the key.

**Audit trails.** Log who viewed what cost data and who changed allocation rules. Allocation rules move money between teams on paper; changing them should require the same scrutiny as changing a billing rule.

## Operationalizing Unit Economics

A spreadsheet is a plan. Production is a practice. Here is the operating cadence that keeps unit economics honest.

**Dashboards.** One dashboard, three audiences. Engineering sees cost per request per feature, token distributions, cache hit rates, and model mix, refreshed hourly. Product sees cost per user per tier and margin per feature, refreshed daily. Finance sees monthly aggregates by team and the chargeback report. Same underlying data, different rollups. If the three audiences see different numbers, you have a trust problem, not a dashboard problem.

**Review cadence.** Monthly cost review, 30 minutes, with engineering, product, and finance in the room. Agenda: cost per request trend by feature, any feature whose margin dropped more than 5 points, new features approaching launch (do they have a cost model?), and the action items from last month. Quarterly, do a deeper pass: re-run the sensitivity analysis, revisit allocation rules, check whether the self-hosting crossover has moved.

**Alerts.** Page on anomalies, email on trends. Alert when cost per request for any feature jumps more than 20% week over week (usually a prompt change, a model swap, or a token distribution shift). Alert when a feature's daily cost exceeds its budget cap. Alert when cache hit rate drops 10 points (something changed in the query distribution). Do not alert on absolute spend; spend grows with a healthy business. Alert on unit costs and ratios.

**Ownership.** Every AI feature has a named cost owner, usually the feature's tech lead. The owner is responsible for the cost model, the dashboard, and explaining variances in the monthly review. Without a named owner, costs are everybody's problem, which means nobody's. The platform or cost engineering team owns the pipeline and the allocation rules; feature teams own their numbers.

**Launch gate.** No AI feature ships to general availability without a cost model reviewed in the design doc: expected cost per request, break-even volume, pricing or quota implications, and the alert thresholds. This is the single highest-leverage process change. It takes about an hour per feature and prevents the surprise-bill class of incident entirely.

## The Bottom Line

Calculate cost per request before you scale. Include all five cost categories, not just the API bill. Use the math to set pricing, quotas, and optimization priorities. And remember: for AI features, bad unit economics do not improve with volume. Fix them early or make the strategic decision to subsidize explicitly.
