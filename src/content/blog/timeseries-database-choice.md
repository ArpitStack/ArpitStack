---
title: "Time-Series Databases Compared: InfluxDB, TimescaleDB, and S3"
date: "2027-03-11"
tags: ["Databases", "Time-Series", "IoT", "Architecture"]
description: "InfluxDB, TimescaleDB, or plain S3 for time-series data? A practical comparison of write throughput, query patterns, retention, and cost at scale, with a decision framework."
readingTime: 15
---

When we started ingesting telemetry from 1,500+ mining devices, each emitting multiple metrics every few seconds, the first question was where to put it all. Time-series data has specific characteristics: high write volume, append-only, queried mostly by time range, and old data becomes less valuable over time. A general-purpose database can handle it up to a point, but eventually you need to make a deliberate choice.

This post compares the three options I evaluated seriously: InfluxDB, TimescaleDB, and S3 with a query layer. I will cover write throughput, query patterns, retention handling, and cost at scale, then give you a decision framework.

## What Makes Time-Series Data Different

Before comparing tools, it helps to be precise about the workload:

- **Write-heavy.** Reads are a fraction of writes. A fleet of devices might generate millions of points per day while dashboards query aggregates a few hundred times.
- **Append-only.** You almost never update a historical point. Deletes happen in bulk (retention expiry), not one row at a time.
- **Time-range queries dominate.** "Show me fuel consumption for truck 47 over the last 6 hours" is the canonical query. Point lookups by ID are rare.
- **Recent data matters most.** Operators stare at the last hour. Analysts look at the last week. Nobody queries last year's raw points except for occasional investigations.
- **High cardinality is the killer.** The number of unique series (device x metric combinations) determines whether your database survives. This is where most time-series databases die.

That last point deserves emphasis. Ten devices with ten metrics is 100 series. Easy. But 1,500 devices with 50 metrics each is 75,000 series, and if you add per-site or per-shift dimensions, you can hit millions. Cardinality is the number one thing to model before choosing.

Put numbers on it before you sign anything. Take a concrete fleet: 1,500 devices, 20 metrics each, one reading every 5 seconds. That is 30,000 series and 6,000 points per second, roughly 518 million points per day. At typical compressed sizes of 10 to 20 bytes per point, you are writing 5 to 10 GB per day of raw telemetry, before indexes, replicas, and downsampled copies. Now add the failure mode nobody models: a firmware bug that makes every device emit at 10x its normal rate at 3 AM. Your Tuesday average is 6,000 points per second. Your worst hour is 60,000. If your database falls over at 20,000, you lose the exact data you needed to diagnose the bug. Size for the worst day, then add headroom.

## InfluxDB

InfluxDB is purpose-built for time-series. Its storage engine (TSM) compresses well and handles high write throughput.

**Strengths:**

- Excellent write throughput. A single node can ingest hundreds of thousands of points per second.
- Built-in retention policies. You define "keep raw data 7 days, downsampled data 90 days" and it handles expiry automatically.
- Flux (or InfluxQL in older versions) is designed for time-range aggregations: `mean()`, `derivative()`, `aggregateWindow()`.
- Downsampling via continuous queries or tasks is first-class.

**Weaknesses:**

- High cardinality has historically been InfluxDB's pain point. Older versions (pre-2.x with TSI) struggled badly. It is better now, but you still need to model carefully.
- Clustering and high availability were commercial features for a long time. The open-source story for HA has improved with InfluxDB 3.x, but verify the current state before committing.
- Flux has a learning curve and the query language has changed across major versions, which burned teams that invested heavily in 1.x.

**Best for:** Teams that want a dedicated time-series engine, have moderate cardinality (under a few million series), and value built-in retention and downsampling.

## TimescaleDB

TimescaleDB is PostgreSQL with time-series superpowers. It partitions regular Postgres tables into chunks by time (hypertables) and adds compression, continuous aggregates, and retention policies.

**Strengths:**

- It is PostgreSQL. Your team already knows SQL. Your existing tooling, ORMs, backup strategies, and access controls work.
- Joins between time-series data and relational data (device metadata, user tables, configuration) are trivial. In InfluxDB this requires awkward workarounds.
- Compression is excellent, often 90%+ reduction for regular telemetry.
- Continuous aggregates give you materialized rollups that stay fresh automatically.
- You can run it as a managed service or self-hosted, and scaling reads with replicas is standard Postgres.

**Weaknesses:**

- Write throughput per node is lower than InfluxDB. For extreme ingest rates (millions of points per second), you need to scale out or batch aggressively.
- Very high cardinality still hurts, though differently than InfluxDB. Millions of series means millions of rows, and index size grows.
- You are operating PostgreSQL. That is a strength for familiarity but it means you inherit Postgres operational concerns: vacuuming, connection management, WAL sizing.

**Best for:** Teams already on Postgres, workloads where time-series data needs to join with relational data, and moderate-to-high write volumes where SQL familiarity outweighs raw ingest speed.

## S3 with a Query Layer

The third option is to skip the database entirely for raw storage: write Parquet files to S3 partitioned by time, and query with Athena, Trino, or a purpose-built engine.

**Strengths:**

- Storage cost is an order of magnitude cheaper than any database. S3 is roughly $23/TB/month. A managed time-series database can cost 10-50x more for the same data.
- Infinite retention. Keep everything forever for compliance or future analysis.
- Separation of storage and compute. Scale queries independently of ingest.
- Parquet with time partitioning compresses well and Athena/Trino can scan it efficiently for analytical queries.

**Weaknesses:**

- Query latency is seconds to minutes, not milliseconds. You cannot power a real-time dashboard off Athena.
- No built-in retention or downsampling. You build lifecycle policies and aggregation jobs yourself.
- Late-arriving data is painful. Rewriting Parquet partitions for corrections is expensive.
- You need a separate system for hot data (recent hours) anyway, which means you are running two systems.

The cost gap is worth making concrete. Take the 518 million points per day from the example above: about 15.5 billion points per month. A managed time-series service charging per million points ingested can turn that into thousands of dollars per month before you store a single byte long term. The same data as compressed Parquet is roughly 250 GB per month, which on S3 costs under $6 per month in storage. Querying it with Athena costs per TB scanned, so a monthly compliance report scanning 250 GB costs about $1.25. The database is not 2x more expensive. It is 100x more expensive for data nobody looks at. That is the entire economic argument for tiering: pay database prices only for data that earns it through query frequency.

**Best for:** Cold storage, compliance archives, and analytical workloads where query latency of seconds is acceptable. Almost always paired with a hot store for recent data.

## The Hot/Warm/Cold Pattern

In practice, most serious IoT deployments end up with a tiered approach:

1. **Hot (last 1-24 hours):** In-memory or fast SSD store for real-time dashboards and alerting. This can be the time-series database itself, or Redis for the very latest values.
2. **Warm (days to weeks):** The time-series database (InfluxDB or TimescaleDB) with full query capability.
3. **Cold (months to years):** S3 Parquet for compliance, batch analytics, and ML training data.

The boundaries depend on your query patterns. If operators only look at the last 4 hours in real time and everything else is analytical, your hot tier can be tiny.

## Reference Architecture: Tiered Time-Series Platform

Here is the full system, with each tier doing exactly one job. Data flows one direction, hot to cold, and every arrow is a place where backpressure and buffering live.

```
+----------------+     +----------------+     +----------------+
| Devices        |---->| Edge Gateway   |---->| Stream Proc    |
| 1500 Symbots   |     | MQTT broker    |     | alerting       |
| sensors        |     | local buffer   |     | live aggs      |
+----------------+     +-------+--------+     +-------+--------+
                               |                      |
                               v                      v
                       +----------------+     +-------+--------+
                       | Cold Path      |     | Hot Store      |
                       | batch archive  |     | Redis plus TSDB|
                       | to S3 Parquet  |     | last 24 hours  |
                       +-------+--------+     +-------+--------+
                               |                      |
                               v                      v
                       +----------------+     +-------+--------+
                       | Cold Store     |     | Warm Store     |
                       | S3 Parquet     |     | TimescaleDB    |
                       | years          |---->| days to weeks  |
                       +----------------+     +-------+--------+
                                                      |
                                                      v
                                              +----------------+
                                              | Dashboards     |
                                              | Grafana alerts |
                                              +----------------+
```

Reading the diagram: devices publish to a local edge gateway running an MQTT broker with persistent buffering, so a WAN outage does not lose data. The gateway forwards to a stream processor that does two things at once: it evaluates alerting rules on live data and writes recent points to the hot store. The hot store (Redis for latest values plus the time-series database itself) serves real-time dashboards looking at the last 24 hours. A batch job continuously downsamples and archives: raw points age out of the hot store into the warm TimescaleDB instance that serves ad hoc queries over days to weeks, and everything lands in S3 as Parquet for years of retention, compliance, and ML training.

Why this shape works: each tier fails independently. If the warm database goes down for maintenance, alerting and real-time dashboards keep working off the hot store. If the WAN link drops, the gateway buffers and the site keeps running locally. The expensive fast storage only holds data people actually query every day, which is a small fraction of the total.

## Decision Framework

Here is how I think about the choice:

**Choose InfluxDB if:**
- Write throughput is your primary constraint (500K+ points/sec)
- Your queries are pure time-series aggregations with minimal joins
- Cardinality is under a few million series
- You want built-in retention and downsampling without building it yourself

**Choose TimescaleDB if:**
- Your team knows PostgreSQL and you want to leverage that
- Time-series data needs to join with relational data (device registry, user accounts, configs)
- Write volume is high but not extreme (under 100K points/sec per node)
- You want one database to operate instead of adding a new system

**Choose S3 + query layer if:**
- Retention requirements exceed what is economical in a database (years of data)
- Queries are analytical (aggregations over large time ranges) not operational (real-time dashboards)
- Cost per TB is the dominant concern
- You already have a hot store and need a cold tier

**Choose a tiered combination if:**
- You have both real-time and analytical needs (most production IoT systems)
- Budget allows operating two systems
- Data volume justifies the complexity

## What We Did

For X-Radar, we went with a tiered approach. Kinesis streams feed real-time processing for alerting (hot path, seconds of latency). Aggregated data lands in a time-series store for dashboards covering days to weeks. Raw events archive to S3 in Parquet for long-term analysis and model training.

The key lesson: model your cardinality first, measure your actual query patterns for a week before committing, and do not underestimate how much data you will generate at 3 AM when a firmware bug causes a device to emit at 10x its normal rate. Your storage choice needs headroom for the worst day, not the average day.

## Scalability

**At 10x (15,000 devices, ~60,000 points/sec):** A single well-tuned TimescaleDB node starts to strain here. Write throughput is usually fine with batched inserts, but concurrent analytical queries over growing tables slow down as indexes bloat. InfluxDB on a single node handles 60K points/sec comfortably, but cardinality climbs toward 750,000 series, and query planning on high-cardinality group-bys gets expensive. The first bottleneck is rarely ingest. It is queries competing with writes for the same disk and memory. The standard move at 10x is to split ingest from query: dedicated write nodes, read replicas for dashboards, and aggressive continuous aggregates so dashboards never touch raw tables.

**At 100x (150,000 devices, ~600,000 points/sec, ~7.5M series):** Single-node anything is off the table. You need a buffer in front of the database (Kafka or Kinesis) so ingest bursts do not hit the database directly, partitioning by device ID hash so each shard owns a slice of the series space, and a distributed engine. Options that survive this: clustered InfluxDB, Timescale multi-node, or ClickHouse with a time-series schema. At this scale S3 stops being the cold tier and becomes the system of record; the hot and warm tiers are caches over it. Compaction and downsampling jobs become first-class citizens with their own monitoring, because a stalled downsample job means the warm tier grows unbounded.

**What breaks first:** In practice, the order is predictable. First, dashboard queries slow down as cardinality grows and someone writes a group-by over an unindexed tag. Second, disk fills faster than retention policies delete, because deletes lag under write load. Third, a traffic spike (firmware bug, reconnect storm) overwhelms ingest and you start dropping points at the edge. Design mitigations in that order: query guardrails and aggregate-first dashboards, retention automation with disk headroom alerts, and edge buffering sized for the worst spike you have seen plus margin.

**Horizontal scaling strategy:** Shard by device, not by time. Time-based sharding creates hot partitions (everyone writes to the current partition). Device-hash sharding spreads writes evenly and makes it trivial to add shards. Keep a routing layer that maps device ID to shard, and make shard assignment part of device provisioning so new devices land on the emptiest shard.

## Security Considerations

**Device authentication.** Every device gets its own identity: a unique client certificate or token, issued at provisioning and rotated on a schedule. Never share one credential across the fleet. When a single device is compromised or decommissioned, you revoke one certificate, not the fleet key. Use mutual TLS between devices and the gateway so both sides prove who they are.

**Encryption.** TLS 1.2 or better for everything in transit: device to gateway, gateway to cloud, database replication, dashboard access. At rest, encrypt database volumes and S3 buckets (SSE with customer-managed keys if compliance requires it). Telemetry often contains location and operational data that is commercially sensitive even when it is not formally classified.

**Network segmentation.** The MQTT broker and ingestion endpoints should not be reachable from the public internet. Devices connect over VPN, private APN, or site-to-site links. Dashboards sit behind SSO. The database accepts connections only from the application tier.

**Attack vectors specific to telemetry.** Spoofed sensor data is the one people miss. If an attacker (or a misconfigured device) publishes plausible but wrong readings, your alerting fires on fiction and your aggregates lie. Mitigate with payload signing or at least per-device rate and range validation at ingest: reject a temperature reading of 900 degrees from a sensor whose valid range tops out at 120. Also watch for credential theft from physically accessible devices: assume any secret stored on a device in the field will eventually be extracted, which is why per-device credentials and short lifetimes matter.

**Secrets handling.** Certificates, API keys, and database passwords live in a secrets manager (Vault, AWS Secrets Manager), never in firmware images or config files checked into git. Automate rotation. Audit who accessed what secret and when.

## Production Checklist

**Metrics to monitor:**
- Ingest rate (points/sec) per gateway and per database node
- Dropped or rejected points, with reason codes
- Write latency p50 and p99
- Query latency p50 and p99, broken down by dashboard
- Disk usage percentage on every database node
- Series cardinality, tracked daily as a growth trend
- Compaction and downsampling job lag
- Replication lag between nodes
- Edge buffer utilization per gateway

**Alert thresholds (tune to your baseline):**
- Ingest rate drops more than 15 percent for 5 minutes: page. Something is wrong upstream.
- Disk usage above 75 percent: ticket. Above 85 percent: page. Retention deletes lag under load, so 85 percent can become 100 percent fast.
- Query p99 above your dashboard SLA (we used 2 seconds) for 10 minutes: ticket.
- Cardinality growing faster than 5 percent per day: ticket. This is how you catch a misbehaving firmware release before it becomes a storage crisis.
- Any downsampling or archive job lagging more than 2x its scheduled interval: ticket.

**Failure modes and runbooks:**
- *Gateway disk full during extended outage:* runbook covers manual buffer triage (which priority tiers to purge), emergency upload over constrained link, and the order to restart services.
- *Database node down:* runbook covers promoting a replica, verifying no data gap by comparing edge buffer drains against database ingest counts, and rebalancing shards.
- *Firmware bug causing 10x emit rate:* runbook covers identifying the firmware version from device metadata, rate-limiting at the gateway by device cohort, and rolling back.
- *Clock skew across devices:* runbook covers detecting it (ingest timestamps vs device timestamps diverging), quarantining affected series, and re-syncing via NTP.

**Capacity planning:** Revisit quarterly. Inputs: device count growth, metrics per device, sampling interval changes, and the worst spike seen since the last review. Keep 3x headroom on ingest throughput and 2x on storage after retention. The cheapest capacity review is the one that happens before the disk fills.

## A Note on Retention

Whatever you choose, define retention policies on day one. "Keep everything forever" is not a strategy, it is a deferred cost crisis. Decide:

- Raw resolution retention (hours or days)
- Downsampled retention (weeks or months)
- Archive retention (years, in cheap storage)

Write these down, automate them, and review them quarterly as data volume grows. The cheapest byte is the one you never store.
