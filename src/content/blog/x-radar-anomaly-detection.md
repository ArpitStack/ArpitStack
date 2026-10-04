---
title: "Cutting Customer Escalations 89% with IoT Anomaly Detection"
date: "2027-03-22"
tags: ["IoT", "Anomaly Detection", "Python", "AWS", "Streamlit"]
description: "Inside X-Radar: the real architecture of a Streamlit observability platform processing data from 1,500+ mining truck devices across Athena, DynamoDB, and PostgreSQL."
readingTime: 15
---

Mining trucks are expensive. When one goes down unexpectedly, it costs real money every hour it sits idle. At SYMX.AI, we build Symbots, devices that plug into mining truck diagnostic ports and stream telemetry to the cloud. The problem: customers found out about issues before we did.

## The Problem

We had data flowing from 1,500+ Symbots across multiple mining sites. But the data lived in different places and nobody had a unified view. Device telemetry in one store, trip data in another, customer metadata somewhere else. When a truck started showing early warning signs, the signal got lost in the noise. Customers called us. That is backwards.

## What We Built: X-Radar

X-Radar is a unified Streamlit platform I built from scratch to monitor, analyze, and act on issues across devices, assets, and customers. The tagline in the codebase says it plainly: Monitor, Analyze, Act.

### Application Architecture

The app follows a modular Streamlit architecture:

```
app.py
+-- components/       # login, sidebar, auth, pipeline, health
+-- features/
|   +-- monitoring/   # 14 modules: dashboard, fleet, device,
|   |                 # trips_validator, iot_delay, pipeline,
|   |                 # dags, lambdas, control_room, etc.
|   +-- anomalies/    # anomaly detection
|   +-- visibility/   # customer-level views
|   +-- x_parts/      # parts-specific diagnostics
+-- data_fetchers/    # athena, dynamodb, postgres, sqs
+-- scheduler/        # background jobs
+-- utils/            # aws_client, slack, time, auth
+-- config/           # constants, mappings
```

The entry point uses Streamlit's `st.navigation` for multi-page routing, with a login flow gating access. A background scheduler thread initializes on startup for periodic jobs like data refreshes and alert checks.

### The Data Layer

This is where the real complexity lives. X-Radar queries four different stores depending on the question:

- **Athena** for analytical queries over curated datasets (trip cycles, trip stats, utilization events). Queries join across `curated.master_algo_trip_cycles` and asset tables with customer filters.
- **DynamoDB** for operational lookups and device state.
- **PostgreSQL** for relational data and configuration.
- **SQS** for async job coordination.

A typical dashboard query looks like this: pull the latest utilization event per customer from Athena, join against the asset table for device mapping, filter by customer code, and exclude shutdown states. The `data_fetchers` module abstracts each store behind a consistent executor interface.

Results are cached with `st.cache_data(ttl=3600)` to avoid hammering Athena on every page interaction. That one decorator probably saves more money than any other line in the codebase.

## System Architecture: The Data Flow

The module tree above shows how the code is organized. This is how data actually moves through the system, from a truck in a mine to an alert in Slack.

```
+-----------+     +------------------+     +------------------------+
|  Symbots  |---->| Ingestion        |---->| Curated Stores         |
| (1,500+)  |     | (Airflow DAGs,   |     | Athena (curated.*)     |
| telemetry |     |  Lambda funcs)   |     | DynamoDB (device state)|
+-----------+     +------------------+     | PostgreSQL (config)    |
                                           | SQS (job coordination)|
                                           +-----------+------------+
                                                       |
                                                       v
                              +------------------------------------+
                              | X-Radar (Streamlit)                |
                              | login -> st.navigation -> features |
                              | monitoring (14) / anomalies /      |
                              | visibility / x_parts               |
                              +------+-----------------------------+
                                     |
                    +----------------+------------------+
                    |                                   |
                    v                                   v
          +-------------------+               +--------------------+
          | st.cache_data     |               | Scheduler thread   |
          | (ttl=3600)        |               | (daemon: refreshes |
          | cost control on   |               |  + alert checks)   |
          | Athena queries    |               +---------+----------+
          +-------------------+                         |
                                                        v
                                              +--------------------+
                                              | Slack alerts       |
                                              | (slack_utils.py,   |
                                              |  with attachments)|
                                              +--------------------+
```

A few things this diagram makes explicit.

The data_fetchers layer is the only code that talks to the stores. Features never import boto3 or psycopg2 directly; they call an executor and get a DataFrame back. That boundary is what made it possible to tune Athena queries in one place instead of fourteen.

The cache sits between the fetchers and the features. With a one-hour TTL, a dashboard that gets opened fifty times an hour costs one Athena query instead of fifty. Athena charges per terabyte scanned, so the cache is not a performance optimization. It is a cost control with performance side effects.

The scheduler is a daemon thread inside the Streamlit process, running periodic refreshes and alert checks. Pragmatic, and the single biggest architectural risk in the system, which the scalability section takes apart.

### The Monitoring Modules

The `features/monitoring/` directory is where the operational value lives. Fourteen modules, each focused on a specific question:

- **dashboard.py**: Customer-level health overview. Latest events per customer, utilization and productivity signals.
- **fleet.py / device.py**: Drill from fleet to individual device diagnostics.
- **trips_validator.py** (856 lines): Validates trip data integrity. Catches sensor gaps, impossible sequences, missing events.
- **iot_delay.py**: Tracks data pipeline latency. If telemetry stops flowing, this is where you see it first.
- **pipeline.py / dags.py / lambdas.py**: Visibility into the data pipeline itself. Are the Airflow DAGs running? Are Lambda functions erroring?
- **control_room.py**: The customer-facing live view. Fleet movements, tonnage, fuel, production, utilization.
- **screenwise.py** (823 lines): Detailed screen-level diagnostics.

Each module follows the same pattern: fetch from the appropriate store, process with pandas, render with Streamlit and Plotly. Consistent, boring, maintainable.

### Anomaly Detection

The `features/anomalies/` module handles preemptive detection. The approach avoids static thresholds (which generate alert fatigue) in favor of per-device baselines. A truck in a dusty open-pit mine has a different normal than one on cleaner roads.

When the system flags something, the alert carries context: which device, what metric deviated, how far from baseline, what the recent trend looks like. Slack integration (`utils/slack_utils.py`) pushes alerts with file attachments for the on-call engineer.

### How the baselines actually work

Per-device baselines mean the system learns what normal looks like for each Symbot instead of comparing every truck to one global threshold. A truck in a dusty open-pit mine vibrates differently, idles differently, and reports different temperature curves than one on a paved haul road. A static threshold set for the average truck pages constantly for the dusty one and stays silent for the clean one until something catastrophic happens.

The baseline is a rolling window over that device's own history: recent behavior weighted more heavily, with enough history to absorb shift changes and weather. A deviation score measures how far the current reading sits from the device's own normal, and the alert fires on sustained deviation, not single spikes. Single spikes are sensor noise; sustained deviation is a failing component.

Two hard problems hide inside this simplicity. The cold start problem: a new device has no history, so it inherits a fleet-level prior until it accumulates enough of its own data. During that window, sensitivity is deliberately lower, because a false positive on a brand-new installation teaches the customer to ignore the system. The second is baseline drift after maintenance: a serviced truck behaves differently than a worn one, and the baseline has to re-learn without flagging the improvement as an anomaly. Both are handled by treating the baseline as a living estimate, not a fixed number.

Alert fatigue is the metric that matters more than detection rate. An anomaly detector that pages for everything gets muted, and a muted detector detects nothing. Per-device baselines, sustained-deviation triggering, and context-rich alerts (which device, which metric, how far from baseline, what the trend looks like) are all fatigue controls. The 89 percent escalation reduction came as much from trust in the alerts as from the detection itself.

## Engineering Decisions Worth Noting

**Why Streamlit, not a React SPA.** Speed of iteration. The team needed operational dashboards yesterday, not in six sprints. Streamlit's Python-native approach meant data engineers could contribute directly. The tradeoff is less UI polish, but for internal tooling that is the right call.

**Why four data stores.** Each serves a different access pattern. Athena for analytical scans, DynamoDB for key lookups, PostgreSQL for relational config, SQS for async coordination. A single store would have been simpler but slower for at least one critical path.

**Background scheduler in-process.** The `SchedulerInitializer` runs in a daemon thread within the Streamlit app. This is pragmatic but fragile: if the Streamlit process restarts, scheduled jobs reset. For the current scale it works. At 10x, this moves to a dedicated scheduler.

**Caching as a cost control.** Athena charges per query. Without `st.cache_data`, every dashboard interaction would trigger fresh Athena scans. The one-hour TTL balances freshness against cost.

## Scalability: From 1,500 to 150,000 Devices

### 10x: 15,000 devices

At 10x, nothing architecturally breaks, but every cost and latency curve gets steeper.

Athena is the first pressure point. Ten times the devices means roughly ten times the scanned data per query, and Athena charges per terabyte scanned. The defenses are query hygiene enforced in the data_fetchers layer: select only needed columns, partition prune on every query (the curated datasets are partitioned, and a query without a partition filter is a full scan), and push aggregation into the query instead of pulling raw rows into pandas. The one-hour cache TTL becomes a cost lever: expensive, slow-moving queries (fleet utilization) can tolerate longer TTLs than fast-moving ones (device alerts), so TTLs should be per query, not global.

Streamlit is the second pressure point. Every open session holds Python objects in memory, and fourteen modules each fetching into pandas adds up. At 10x concurrent users, watch per-session memory and the rerun cost of every widget interaction. The mitigations are boring: paginate tables, lazy-load heavy modules behind the navigation (st.navigation already helps here, since unvisited pages do no work), and keep cached DataFrames shared across sessions where the cache allows.

The scheduler is the third. A daemon thread doing periodic refreshes and alert checks works when the job list is short. At 10x the jobs, thread contention and missed runs appear, and every Streamlit restart still wipes the schedule. This is the point where the scheduler moves out of the process.

### 100x: 150,000 devices

At 100x, the architecture changes shape.

The scheduler becomes a dedicated service. Jobs go through SQS with idempotency keys, workers run separately from the Streamlit process, and a missed run pages someone instead of silently not happening. The in-process thread was the right call at 1,500 devices; keeping it at 150,000 would be negligence.

Athena query patterns shift from interactive to precomputed. Dashboards stop scanning raw curated tables and read aggregate tables refreshed on a schedule. The curated datasets remain the source of truth for ad-hoc analysis, but the hot path serves precomputed rollups. This is also where Athena concurrency limits start to bite, so query queuing and prioritization (alerts before dashboards) matter.

DynamoDB needs partition key design. At 1,500 devices, almost any key scheme works. At 150,000, a hot partition on a popular device_id or a time-bucketed key throttles reads. Design keys for uniform distribution early; migrating key schemes under load is miserable.

The alerting path needs aggregation. Slack alerts per anomaly work at 1,500 devices. At 150,000, the on-call channel becomes a firehose. Alerts roll up by site, by failure mode, and by severity, with digests for low-severity items and immediate pages only for sustained, high-confidence deviations.

Per-device baselines keep working at 100x because they are embarrassingly parallel: each device's baseline is independent. The compute moves from ad-hoc pandas to a scheduled batch job, but the math does not change. That is the payoff of choosing an architecture where the unit of work is the device.

## Security Considerations

X-Radar is internal tooling, but it sits on top of customer operational data: which trucks are running, where they are, how productive each site is. Internal does not mean low-stakes.

### Authentication and access

Access is gated by the login flow in components/login and components/auth. Streamlit sessions are per browser session, so session handling has to be deliberate: who gets an account, what happens on logout, and how session state is invalidated. The visibility feature serves customer-level views, which means the access model has to answer a harder question than "employee or not": which customers can this user see. Customer scoping must be enforced in the data_fetchers layer, not just hidden in the UI, because a UI-only restriction is a URL manipulation away from a data leak.

### Query-level isolation

Every Athena query carries a customer filter. This is the same invariant as tenant_id in multi-tenant SaaS: one missing filter and one customer's operational data renders in another customer's view. The data_fetchers executors are the right place to enforce it, since every feature goes through them. Parameterize customer filters; never interpolate them into query strings.

### Secrets and credentials

AWS credentials, the Slack webhook URL, database connection strings: all live in config and environment, never in code, never in logs. The Slack webhook URL deserves special care: anyone holding it can post to the alerts channel, which is both a spam vector and a social engineering surface.

### Encryption and PII

TLS in transit everywhere; encryption at rest on S3 (Athena query results land there), DynamoDB, and PostgreSQL. Telemetry can carry PII-adjacent data: site locations, shift patterns, operator identifiers. Know what is in the streams, set retention policies per store, and make sure the visibility views do not expose more granularity than the customer relationship allows.

### Attack surface

- An exposed Streamlit port is an exposed application. Bind to localhost or run inside the VPC; do not rely on the login page as the only barrier.
- Athena SQL construction: customer filters and dashboard parameters must be parameterized. String-built queries are injection surface.
- Dependency supply chain: Streamlit, pandas, Plotly, and the AWS SDKs are a large dependency surface. Pin versions, review updates, and keep the lockfile in version control.
- Insider access: audit who queries what. The data_fetchers layer is a natural place to log query access per user, which turns "who saw customer X's data" from a forensic mystery into a log search.

## Production Checklist

### Monitoring

- Pipeline health is product health. The dags.py, lambdas.py, and iot_delay.py modules are not just features; they are the monitoring. If telemetry stops flowing, iot_delay fires before any anomaly detector can, because a detector with no data detects nothing.
- Scheduler heartbeat: the in-process scheduler's biggest failure mode is silent death. Emit a heartbeat (a timestamp written somewhere observable) on every run, and alert when the heartbeat goes stale. A scheduler you cannot observe is a scheduler you cannot trust.
- Athena cost dashboard: track scanned bytes and query count per module. Cost spikes are usually a missing partition filter or a cache regression, and both are cheaper to catch on day one.
- Streamlit resource usage: memory per session, restart frequency. A process that restarts daily is a scheduler that resets daily.

### Alerting

- Slack alerts carry context: device, metric, deviation from baseline, recent trend, and a file attachment for the on-call engineer. An alert without context is a notification to go look at a dashboard; an alert with context is actionable.
- Escalation path: who gets paged when an anomaly is high-confidence and sustained, versus a digest for low-severity items. Define this before the first 3am page.
- Alert fatigue controls: per-device baselines and sustained-deviation triggering are already in place. Revisit thresholds when the fleet changes (new mine, new truck model, firmware update), because the definition of normal moved.

### Runbooks

- Pipeline stall (iot_delay fires): check DAG run status, check Lambda error rates, verify the ingestion path, then check whether the devices themselves stopped reporting (a site network outage looks identical to a pipeline bug from inside the platform).
- Athena cost spike: identify the module and query, check for partition filter regressions, consider a longer TTL for that query.
- Streamlit OOM or crash loop: reduce per-session memory (pagination, smaller cached frames), check for a cache regression loading full tables.
- Scheduler thread death: detect via stale heartbeat, restart the process, and verify missed jobs are idempotent before replay.
- Stale baselines after firmware updates: device behavior changes, baselines re-learn, expect a transient rise in deviations and resist the urge to widen thresholds permanently.

### Failure modes

- Cache stampede: every cached query shares a one-hour TTL, so a restart or a synchronized expiry can fire dozens of Athena queries at once. Stagger TTLs per query or add jitter.
- Athena throttling under concurrent load: back off and retry with jitter in the executor; surface a degraded state in the UI rather than a traceback.
- DynamoDB throttling on hot keys: on-demand capacity or a key redesign, depending on whether the hotspot is structural.
- SQS poison messages: a malformed job that fails forever blocks nothing if the queue has a dead-letter queue and the worker has a retry budget. Without those, one bad message wedges the pipeline.
- Streamlit restart wiping scheduler state: until the scheduler is extracted, treat every deploy as a scheduler reset and verify jobs resume.

### Graceful degradation

- If Athena is unreachable, serve the last cached data with a visible staleness banner. A slightly old dashboard beats a stack trace.
- If the anomaly pipeline is down, fall back to last-known baselines and mark alerts as degraded-confidence.
- If the scheduler dies, the UI keeps working off cache while alerting pages. Reading and alerting degrade independently, because they fail independently.

## The Result

Customer escalations dropped by 89 percent. Not because we fixed trucks faster. We caught issues while they were still small, often before the customer noticed anything wrong. The trips validator catches data integrity problems, the IoT delay monitor catches pipeline stalls, and the anomaly detection catches behavioral deviations. Three different failure modes, one platform.

## What I Would Do Differently

If I were building X-Radar again, I would invest earlier in the data model. We iterated on the Athena schema several times as we learned which queries mattered operationally. Getting the partitioning and column selection right upfront would have saved weeks of query tuning.

I would also extract the scheduler into a separate service sooner. The in-process thread works, but it couples background job reliability to Streamlit process uptime.

---

*X-Radar is the kind of platform engineering work I do at SYMX.AI. The repo structure above reflects real architectural decisions: modular features, abstracted data fetchers, pragmatic tooling choices. If you are building IoT observability, I am happy to compare notes.*
