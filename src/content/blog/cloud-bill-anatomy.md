---
title: "Why Your AWS Bill Cannot Tell You What Each Feature Costs"
date: "2026-11-05"
tags: ["AWS", "Cost Attribution", "Cloud", "Architecture"]
description: "AWS bills show services and accounts, not features or teams. Here is why the bill structure makes attribution hard, and how to build a pipeline that fixes it."
readingTime: 12
---

Open your AWS bill. You will see EC2, S3, RDS, data transfer, broken down by account and region. What you will not see: how much the checkout feature cost versus the search feature. How much Team A spent versus Team B. Whether that new recommendation engine is worth its infrastructure cost.

The bill answers "what did we buy from AWS?" It does not answer "what did our product cost to run?" This post explains why, and how to build an attribution pipeline that bridges the gap.

## How AWS Structures Billing

AWS billing has a specific hierarchy:

```
Organization
  |
  +-- Accounts
  |     production staging dev
  |
  +-- Services
  |     EC2 S3 RDS Lambda
  |
  +-- Usage types
  |     BoxUsage DataTransfer Storage
  |
  +-- Line items
        hourly charges with dimensions
```

Each line item has dimensions: region, instance type, usage type, and any tags you applied. The Cost and Usage Report (CUR) gives you the most granular data, down to hourly line items with resource IDs.

**What the bill knows:**
- Which AWS service incurred the charge
- Which account and region
- Which specific resource (instance ID, bucket name)
- Any tags you applied to the resource
- Hour-by-hour usage quantities

**What the bill does not know:**
- Which product feature used the resource
- Which team owns the workload
- Which customer triggered the usage
- Whether the spend was justified

That mapping from infrastructure to business is entirely your responsibility.

## The Shared Cost Problem

The hardest part of attribution is shared infrastructure. Consider a typical setup:

- An EKS cluster runs microservices for five different product features
- An RDS database serves three applications
- A NAT gateway handles traffic for the entire VPC
- S3 stores assets for all features in one bucket

The bill shows one EKS cluster charge, one RDS charge, one NAT gateway charge. But five features share the cluster. How do you split it?

**Options for shared cost allocation:**

1. **Proportional to direct usage.** If Feature A uses 60% of the cluster's CPU/memory (measured via Kubernetes metrics), it gets 60% of the cluster cost. This is the most defensible approach for compute.

2. **Equal split.** Divide evenly among sharing features. Simple but unfair when usage is uneven. Only appropriate for truly shared overhead (like the NAT gateway, arguably).

3. **Weighted by business priority.** Finance or product leadership assigns weights. Less technically pure, but sometimes reflects reality better (the flagship product absorbs more shared cost).

4. **Do not allocate.** Keep shared costs in an "infrastructure overhead" bucket. This is honest but less useful for per-feature profitability analysis.

There is no universally correct answer. The right approach depends on what decisions the attribution data will drive. For engineering optimization, proportional allocation is best. For product P&L, leadership may prefer weighted.

## Tagging Strategies

Tags are the primary mechanism AWS gives you for attribution. A tagging strategy is not optional; it is the foundation.

**Minimum viable tags:**

- `Team`: owning team (e.g., `platform`, `checkout`, `search`)
- `Service`: microservice or application name
- `Environment`: production, staging, development
- `CostCenter`: finance cost center code

**Tagging for feature attribution:**

Infrastructure tags get you to the service level. Feature-level attribution needs more:

- `Feature`: for resources dedicated to a specific feature
- For shared resources, tags alone are insufficient. You need usage-based allocation (see below).

**Enforcement:**

Tags are useless if they are inconsistent. Enforce via:

- **AWS Tag Policies** in Organizations: define allowed tags and values, flag non-compliant resources.
- **CloudFormation/Terraform defaults:** every resource provisioned through IaC gets standard tags automatically.
- **CI checks:** fail the pipeline if a Terraform plan creates untagged resources.
- **Regular audits:** a scheduled job that reports untagged resources by team.

Untagged resources should be someone's problem. Assign them to a default bucket and make the owning team explain why their resources are not tagged. Social pressure works.

Prevention on the left, detection on the right:

```
+----------------+     +----------------+     +----------------+
| Terraform      |---->| CI Check       |---->| AWS APIs       |
| default tags   |     | fail on missing|     | Tag Policies   |
| every module   |     | tags in plan   |     | flag violations|
+-------+--------+     +-------+--------+     +-------+--------+
        |                      |                      |
        v                      v                      v
+----------------+     +----------------+     +----------------+
| Untagged       |---->| Audit Job      |---->| Notification   |
| Bucket         |     | weekly scan    |     | to owning team |
| social pressure|     | report by team |     | fix or explain |
+----------------+     +----------------+     +----------------+
```

IaC modules stamp default tags on every resource, CI fails plans that create untagged resources, and AWS Tag Policies flag violations at the API level. What slips through lands in the untagged bucket, a weekly audit reports it by team, and the owning team gets a notification to fix or explain. The untagged bucket is deliberately visible: social pressure closes the last mile that automation misses.

## The Attribution Pipeline HLD

Here is the architecture for a cost attribution pipeline:

```
+------------------+
| AWS CUR from S3  |
| hourly line items|
+--------+---------+
         |
         v
+------------------+
| Ingestion        |
| daily batch job  |
| parse plus norm  |
+--------+---------+
         |
         v
+------------------+     +------------------+
| Tag Attribution  |---->| Resource Metadata|
| map tags to team |     | CMDB IaC state   |
+--------+---------+     +------------------+
         |
         v
+------------------+     +------------------+
| Usage Allocation |---->| Usage Metrics    |
| split shared cost|     | K8s CloudWatch   |
| by actual usage  |     | VPC flow logs    |
+--------+---------+     +------------------+
         |
         v
+------------------+
| Attribution DB   |
| Postgres         |
| cost per team day|
+--------+---------+
         |
         v
+------------------+
| Dashboards       |
| Alerts plus API  |
| anomaly monthly  |
+------------------+
```

**Stage 1: Ingestion.** The CUR lands in S3 daily (hourly granularity). Parse it, normalize the schema (AWS changes CUR columns occasionally), and store in your data warehouse or attribution database.

**Stage 2: Tag-based attribution.** For each line item, look up tags and map directly to team/service/feature. This handles dedicated resources cleanly.

**Stage 3: Usage-based allocation.** For shared resources, pull usage metrics:
- EKS cluster cost -> split by namespace CPU/memory requests (from Prometheus)
- RDS shared database -> split by query volume per application (from Performance Insights or query logs)
- NAT gateway -> split by bytes per subnet (from VPC Flow Logs)
- S3 shared bucket -> split by bytes stored per prefix (from S3 inventory)

**Stage 4: Storage.** Write attributed costs to a database keyed by (date, team, service, feature, cost_type). Keep the allocation rules versioned so historical data can be re-explained.

**Stage 5: Presentation.** Dashboards per team, anomaly detection on spend changes, monthly rollups for finance.

## Handling Edge Cases

**Untagged resources.** Allocate to an "unattributed" bucket. Report it prominently. The goal is to drive this to zero through enforcement, not to silently absorb it.

**Credits and discounts.** Reserved Instance and Savings Plan discounts apply at the billing level, not per resource. Allocate the discount proportionally to the usage that earned it. This is fiddly but important; without it, teams that use RIs look artificially expensive.

**Data transfer.** Cross-AZ and internet egress are notoriously hard to attribute. VPC Flow Logs can map traffic to source, but it is approximate. Many teams allocate data transfer as shared overhead rather than trying for precision.

**Marketplace and third-party charges.** These appear in the bill but are not AWS services. Attribute them like any other line item based on which team procured them.

## Scalability

**At 10x cloud spend:** The CUR itself gets big. At 10x the resources, the daily CUR files grow to gigabytes, and the ingestion job that parsed them in minutes now takes an hour. The fix is incremental processing: parse only new files, partition the staging tables by day, and never reprocess the full history unless the schema changed. Tag-based attribution scales linearly and stays cheap. Usage-based allocation gets expensive first: pulling K8s metrics per namespace per hour for a 10x cluster fleet means your Prometheus queries need their own optimization, and VPC Flow Logs at 10x traffic become a significant S3 and Athena cost on their own.

**At 100x:** You are processing billions of line items per month, and the attribution pipeline is now a data platform in its own right. The Postgres attribution DB from the HLD needs partitioning by month and aggressive aggregation: raw line-item attribution kept for 90 days, daily rollups kept for years. The usage-metrics side is the real scaling challenge: per-pod CPU metrics across hundreds of clusters is a firehose, so you sample and aggregate at the source (per namespace per hour, not per pod per minute) before it reaches the allocation engine. Reconciliation with the invoice at 100x cannot be a spreadsheet exercise; it is an automated job with its own alerting.

**What breaks first:** The usage-metrics collection, then CUR ingestion, then the dashboard. Flow logs and Prometheus queries built for 1x silently start sampling or timing out at 10x, and your allocation numbers drift without anyone noticing because the pipeline still runs green. Next, CUR ingestion slows as files grow, and attribution lands later each day until teams stop trusting the dashboards. Mitigations in order: monitor the freshness and completeness of every usage-metrics input (not just the pipeline output), keep CUR ingestion incremental with a lag alert, and define an SLA for attribution freshness that someone owns.

**Horizontal scaling strategy:** Partition everything by time (day or month) from the start, because every query is time-ranged. Shard the allocation engine by account or cost center so one giant account's processing does not delay everyone else's. Keep allocation rules versioned and deterministic so any day can be recomputed independently on any worker.

## Security Considerations

**Least privilege on billing data.** The CUR contains your entire infrastructure footprint: every instance type, every region, every dollar. Restrict the S3 bucket holding CUR files to the attribution pipeline's role and a break-glass admin. Nobody needs direct bucket access for daily work; they use the dashboards.

**The attribution database is sensitive.** Cost per team per feature reveals margins, headcount efficiency, and strategic bets. Apply role-based access: teams see their own data in detail, aggregates for others, finance sees everything. Audit who queries what; cost data has a way of appearing in contexts it should not.

**Tag values can leak.** Tags like `Customer: acme-corp` on shared resources expose your customer list to anyone who can read tags. Establish a policy: no customer names, no project codenames, no PII in tag values. Audit tag values the same way you audit the resources.

**Attack vectors.** A compromised CI pipeline can strip tags from IaC, silently degrading attribution until the untagged bucket overflows. Protect the tagging enforcement path like production code: signed commits, required reviews on the tagging modules, and an alert when the untagged rate spikes (which is both a hygiene signal and a tampering signal). Also consider cost shifting in multi-account setups: if a team can move resources between accounts, they can move costs. Account boundaries need change control, not just tags.

**Secrets handling.** The pipeline touches cloud credentials for CUR access, database passwords, and dashboard API keys. All in the secrets manager, rotated on schedule, with the pipeline's IAM role scoped to exactly the buckets and tables it needs. The reconciliation job that reads the invoice needs read access to billing, which is effectively read access to everything financial: scope it tightly and log its access.

## Production Checklist

**Metrics to monitor:**
- CUR ingestion lag: time from file landing to parsed rows (should be under 2 hours)
- Attribution freshness: age of the latest fully attributed day
- Untagged spend percentage and trend
- Metered total vs invoice total, per account
- Allocation rule version in effect per day
- Usage-metrics input freshness per source (K8s, flow logs, CloudWatch)
- Dashboard query latency p99
- Anomaly alerts fired per week per team

**Alert thresholds:**
- CUR not ingested within 6 hours of landing: ticket. Within 24 hours: page. Stale CUR means stale everything downstream.
- Untagged spend above 5 percent: ticket to the top offending teams. Above 10 percent: page the platform team; something systemic broke.
- Invoice reconciliation divergence above 1 percent: ticket. Above 3 percent: page. At scale, small percentages are large dollars.
- Any usage-metrics input stale beyond its expected interval: ticket. Silent staleness corrupts allocation silently.
- Attribution freshness SLA breach (we used 24 hours): ticket to the pipeline owners.

**Failure modes and runbooks:**
- *CUR schema change breaks parsing:* runbook covers the schema diff procedure, the staging table migration, and backfill of affected days. AWS changes CUR columns occasionally; assume it will happen.
- *Untagged spike after a migration:* runbook covers identifying the source (which account, which IaC change), emergency tagging, and whether to restate the affected days.
- *Allocation inputs stale:* runbook covers falling back to last-known-good allocation ratios vs holding the day unattributed, and who makes that call.
- *Invoice does not reconcile:* runbook covers the drill-down order (credits and discounts first, then data transfer, then untracked accounts) and the escalation path to finance.

**Capacity planning:** CUR volume grows with resource count, not just spend: more small resources means more line items. Project line-item counts 12 months out and size ingestion workers accordingly. Pre-create database partitions a year ahead so a partition-creation failure never blocks ingestion. Review allocation rule performance annually; rules that join against full metric tables need indexes or pre-aggregation as data grows.

## What Good Looks Like

A mature attribution system gives you:

- Every team can see their daily cloud spend broken down by service and feature
- Anomalies trigger alerts within 24 hours ("your spend doubled yesterday")
- Monthly finance reports reconcile with the AWS invoice
- Product managers can answer "is this feature profitable?" with infrastructure costs included
- Unattributed spend is under 5% and trending down

You do not get there in one sprint. Start with tag-based attribution for dedicated resources (covers 60-70% of spend), then tackle shared cost allocation for the big shared systems (EKS, RDS, networking). The last 10% of precision costs more than it is worth; know when to stop.

The bill will never tell you what each feature costs. But with tagging discipline and a usage-based allocation pipeline, you can build a system that does.
