---
title: "Batch vs Streaming Data Pipelines: Architecture and Tradeoffs"
date: "2026-11-16"
tags: ["Data Engineering", "Streaming", "Architecture", "Kafka"]
description: "Lambda vs kappa architecture, exactly-once semantics, late data handling, and backfill strategies. A practical guide to choosing between batch and streaming pipelines."
readingTime: 13
---

Every data team eventually faces the same question: do we process this data in batches or as a stream? The answer is less about the technology and more about your latency requirements, correctness needs, and operational budget. I have built both, and the tradeoffs are sharper than most tutorials suggest.

## The Fundamental Tradeoff

**Batch processing** reads a bounded dataset, processes it, and writes results. It runs on a schedule (hourly, daily) or on demand. Latency is measured in minutes to hours.

**Stream processing** reads an unbounded dataset continuously, processes each event as it arrives, and emits results incrementally. Latency is measured in milliseconds to seconds.

The tradeoff:

| Dimension | Batch | Streaming |
|-----------|-------|-----------|
| Latency | Minutes to hours | Milliseconds to seconds |
| Correctness | Easier (full dataset visible) | Harder (partial data, late arrivals) |
| Operational complexity | Lower | Higher |
| Cost at low volume | Lower | Higher (always-on infra) |
| Reprocessing | Trivial (rerun the job) | Complex (replay, state rebuild) |
| Debugging | Easier (inspect inputs) | Harder (distributed state) |

If your use case tolerates hourly latency, batch is almost always the right choice. Streaming is for when minutes matter: fraud detection, real-time alerting, live dashboards, anomaly detection on live equipment.

## Lambda Architecture

Lambda architecture runs both: a batch layer for correct, complete results and a speed layer for fast, approximate results. A serving layer merges them.

```
                    +--------------+
                    |  Batch Layer |
                    |  Spark       |
                    +------+-------+
                           |
Data Source ----------------+------------------ Serving Layer
                           |
                    +------+-------+
                    |  Speed Layer |
                    |  Flink       |
                    +--------------+
```

**The promise:** You get low latency from the speed layer and correctness from the batch layer. Queries hit the serving layer, which combines recent speed-layer results with older batch-layer results.

**The reality:** You maintain two codebases that must produce identical results. Every business logic change is implemented twice, in two different frameworks, with two different testing approaches. This is expensive and error-prone.

Lambda made sense when batch frameworks (Hadoop) and stream frameworks (Storm) were completely different worlds. Today, unified frameworks have mostly eliminated the need for it.

## Kappa Architecture

Kappa architecture says: just use streaming for everything. If you need to reprocess historical data, replay the log from the beginning.

```
Data Source -> Immutable Log -> Stream Processor -> Serving Store
                                     |
                                     +-- replay for reprocessing
```

**The promise:** One codebase, one framework. Reprocessing is just replaying the event log through updated logic.

**The reality:** This works well if your stream processor can handle both real-time and historical replay efficiently, and if your event log retains data long enough. Kafka retention becomes a critical configuration. You need enough retention to cover your maximum reprocessing window.

Kappa is simpler than Lambda but demands more from your streaming infrastructure. It is the right default for most new systems built today.

## Reference Architecture

A production pipeline that serves both real-time and analytical consumers without the dual-codebase pain of Lambda:

```
+----------------+     +----------------+     +----------------+
| Event Sources  |---->| Kafka          |---->| Flink Jobs     |
| apps devices   |     | immutable log  |     | alerting       |
| clickstream    |     | 30d retention  |     | live aggs      |
+-------+--------+     +-------+--------+     +-------+--------+
        |                      |                      |
        v                      v                      v
+----------------+     +----------------+     +-------+--------+
| Schema         |     | Batch Export   |     | Serving Stores |
| Registry       |     | hourly to S3   |     | Redis for live |
| compat checks  |     | Parquet        |     | Postgres OLAP  |
+----------------+     +-------+--------+     +-------+--------+
                               |                      |
                               v                      v
                       +----------------+     +----------------+
                       | Spark Batch    |---->| Dashboards API |
                       | daily correct  |     | merge live and |
                       | ML features    |     | batch views    |
                       +----------------+     +----------------+
```

Events land in Kafka, which is the system of record with retention long enough to cover your maximum reprocessing window (30 days is a common starting point). A schema registry enforces compatibility on every topic so producers cannot break consumers with a careless field rename. Flink jobs consume the log for anything latency-sensitive: alerting, live aggregations, anomaly detection, writing to Redis and Postgres serving stores. In parallel, an hourly export writes the same log to S3 as Parquet, where Spark batch jobs produce the correct daily aggregates and ML features. The API and dashboard layer merges live views with batch-corrected views, preferring batch numbers once they exist for a given window. Reprocessing is a Kafka offset reset, not a second pipeline.

## Exactly-Once Semantics

This is where streaming gets genuinely hard. Three delivery guarantees:

**At-most-once:** Events may be lost. Acceptable for metrics where individual data points do not matter.

**At-least-once:** Events will not be lost but may be duplicated. The most common choice. Requires idempotent consumers.

**Exactly-once:** Each event is processed exactly one time, with no loss and no duplication. Achievable in modern frameworks (Flink, Kafka Streams) through a combination of:

- Transactional writes to the output
- Checkpointing of consumer offsets atomically with output writes
- Idempotent producers

Exactly-once has real costs: transactional overhead, higher latency, more complex failure recovery. Do not default to it. Ask: what actually breaks if an event is processed twice?

For most telemetry pipelines, at-least-once with idempotent writes is sufficient and significantly simpler. Save exactly-once for financial transactions, inventory management, and other domains where duplicates cause real harm.

## Late Data

In batch processing, late data is simple: if it arrives before the job runs, it is included. If not, it waits for the next run.

In streaming, late data is a design problem. Define:

**Event time vs. processing time.** Event time is when something happened. Processing time is when your system saw it. All windowed aggregations should use event time.

**Watermarks.** A watermark is the system's estimate of "we have probably seen all events up to time T." Windows close when the watermark passes their end time. Events arriving after the watermark are late.

**Lateness policy.** Three options:

1. **Drop late events.** Simplest. Accept minor inaccuracy.
2. **Update results.** Allow late events to trigger recomputation of already-emitted windows. More correct, more state to manage.
3. **Side output.** Route late events to a separate stream for manual review or batch correction.

```python
# Flink-style watermark and lateness configuration
stream \
    .assign_timestamps_and_watermarks(
        WatermarkStrategy
            .for_bounded_out_of_orderness(Duration.of_minutes(5))
            .with_timestamp_assigner(lambda event: event.timestamp)
    ) \
    .window(TumblingEventTimeWindows.of(Time.minutes(15))) \
    .allowed_lateness(Time.minutes(30)) \
    .side_output_late_data(late_data_tag)
```

This says: expect events up to 5 minutes out of order, allow an additional 30 minutes of lateness with result updates, and route anything later than that to a side output.

## Backfill Strategies

Backfill means reprocessing historical data, usually because of a bug fix, a new feature, or a schema change. Plan for it before you need it.

**For batch pipelines:** Trivial. Rerun the job with corrected parameters over the desired date range. This is batch processing's superpower.

**For streaming pipelines:** Harder. Options:

1. **Replay from the log.** If using Kappa with sufficient Kafka retention, reset consumer offsets and replay. Works if retention covers the backfill window.
2. **Parallel batch job.** Write a one-off batch job that reads the same source data and writes to the same sink. Faster than replay for large windows, but now you have two code paths temporarily.
3. **Dual-write with cutover.** Run the corrected logic alongside the old logic, compare outputs, then cut over. Safest for critical pipelines.

**Backfill checklist:**
- How far back can you go? (Determined by source data retention)
- Will backfill overwhelm downstream systems? (Rate-limit the replay)
- How do you avoid double-counting during the transition?
- Who approves the backfill, and how do you verify correctness afterward?

## When to Choose What

**Choose batch when:**
- Latency tolerance is 15+ minutes
- Correctness matters more than speed (financial reporting, billing)
- Data volume is large but bursty
- Team is small and operational simplicity matters
- Reprocessing is frequent (ML feature engineering, experimentation)

**Choose streaming when:**
- Latency requirement is under 5 minutes
- The use case is inherently real-time (alerting, fraud, live personalization)
- Data arrives continuously and waiting for a batch boundary adds no value
- You have the operational capacity to run always-on infrastructure

**Choose both (tiered) when:**
- You need real-time alerts AND correct historical analysis
- Different consumers have different latency needs
- Budget allows the complexity

In our IoT platform, we use streaming for anomaly detection and alerting (seconds matter when equipment is failing) and batch for daily aggregates, cost calculations, and ML training data (correctness matters more than speed). The two pipelines share the same event schema but are otherwise independent. That separation has saved us from the worst complexity of trying to make one pipeline serve both needs.

## Scalability

**At 10x event volume:** Kafka handles this by adding partitions; the work is making sure your keys distribute evenly so no single partition becomes hot. Flink scales by increasing parallelism, but stateful operators need attention: keyed state grows with the number of distinct keys, and larger state means longer checkpoint times and slower recovery. The first thing to tune at 10x is checkpointing: shorter intervals give faster recovery but more overhead, and at high throughput the checkpoint itself can become the bottleneck. Consumer lag is your early warning metric; if it grows monotonically, you are under-provisioned.

**At 100x:** The architecture changes shape. A single Kafka cluster per region may still work, but you will be running tiered storage (hot segments on SSD, older segments on S3) to keep costs sane. Flink state at 100x often outgrows local disks, pushing you toward remote state backends with all their latency tradeoffs. Exactly-once semantics, affordable at 1x, become a serious tax at 100x: transactional overhead per record adds up, and many teams quietly downgrade to at-least-once with idempotent sinks at this scale. The serving stores split: Redis for live lookups, a columnar store for analytical queries, and you stop pretending one store serves both.

**What breaks first:** Checkpointing, then downstream sinks, then Kafka itself. Flink checkpoint timeouts are the classic first symptom: state grew, checkpoints take longer than the interval, and the job spends all its time checkpointing instead of processing. Next, sinks fall over: the database you write results to was sized for 1x and melts at 100x. Kafka is usually last because it was designed for this, but watch disk throughput on brokers during heavy replay. Mitigations in order: bound your keyed state (TTL everything), load-test sinks at 3x expected peak, and keep broker disks well under 70 percent.

**Horizontal scaling strategy:** Partition everything by the same key (usually entity ID or device ID) from Kafka topic through Flink operator to serving store shard. Consistent partitioning means each parallel unit owns its slice end to end, with no cross-talk. Scale by adding partitions and parallelism together; scaling one without the other just moves the bottleneck.

## Security Considerations

**Authentication and authorization.** Kafka brokers authenticate clients with SASL (SCRAM or mutual TLS) and authorize per-topic with ACLs. A producer for the clickstream topic should not be able to read the payments topic. Flink jobs get their own service identities with least-privilege access to exactly the topics and state backends they need.

**Encryption.** TLS for all client-to-broker and broker-to-broker traffic. Encryption at rest for Kafka log segments and Flink state snapshots. If you run tiered storage to S3, those segments are encrypted with your keys, not just the default.

**PII and sensitive data.** Event streams accumulate everything, and "we will filter PII later" is how breaches happen. Decide at the source: either do not put PII in events, or encrypt sensitive fields at the producer with keys the stream processor does not hold, decrypting only in the specific consumer that needs them. Schema registry access controls matter here too: who can register a schema that adds a new PII field should be a deliberate decision.

**Attack vectors.** Poisoned events are the streaming equivalent of SQL injection: a malicious or compromised producer sends malformed events designed to crash deserializers or corrupt state. Validate and sanitize at the edge of the pipeline, before events reach stateful operators. Also consider topic flooding: a compromised producer publishing at 100x normal rate can starve legitimate traffic, so per-client quotas on the broker are not optional.

**Secrets handling.** Broker credentials, schema registry API keys, and state backend credentials live in a secrets manager and are injected at deploy time. Rotate on a schedule. Never commit them to the pipeline repo, and audit which jobs accessed which secrets.

## Production Checklist

**Metrics to monitor:**
- End-to-end latency: event time to serving store, p50 and p99
- Consumer lag per topic partition (in messages and in time)
- Flink checkpoint duration, size, and failure count
- Records in vs records out per job (the gap is your drop detector)
- Dead letter queue depth and oldest entry age
- Sink write latency and error rate
- Kafka broker disk usage, under-replicated partitions, offline partitions
- Schema registry compatibility violations rejected

**Alert thresholds:**
- Consumer lag above 5 minutes for any critical topic: page. Lag that grows is a pipeline falling behind; lag that is flat but high is a pipeline that never caught up.
- Checkpoint failures 3 in a row: page. Two in a row: ticket. A job that cannot checkpoint cannot recover.
- Dead letter queue growing for more than 30 minutes: ticket. A spike is normal; a trend means a producer changed something.
- Under-replicated partitions greater than zero for more than 10 minutes: page.
- End-to-end p99 latency above your SLA (ours was 60 seconds for alerting paths) for 10 minutes: ticket.

**Failure modes and runbooks:**
- *Flink job crash loop:* runbook covers checking the last successful checkpoint, restoring from it, identifying the poison event from the dead letter queue, and the decision tree for skip vs fix-and-replay.
- *Kafka broker loss:* runbook covers verifying replication caught up before replacing the broker, and the consumer behavior to expect during leader elections.
- *Schema incompatibility blocking producers:* runbook covers identifying the offending schema version, rolling back the producer, and the approval needed to evolve the schema.
- *Sink database down:* runbook covers enabling the spillover buffer, estimated time to fill it, and replay procedure once the sink recovers.

**Capacity planning:** Size Kafka for peak plus replay headroom: retention times peak throughput, plus 50 percent. Size Flink task managers so that CPU stays under 60 percent at peak, because checkpointing needs the slack. Review partition counts quarterly; you cannot easily reduce them later, but too few partitions caps your parallelism forever. Load-test the full pipeline at 3x expected peak annually, including a broker failure mid-test.

## Operational Realities

Whichever you choose, plan for:

- **Monitoring the pipeline itself.** Lag metrics, error rates, throughput. A silent pipeline failure is worse than a loud one.
- **Schema evolution.** Events change shape over time. Have a schema registry and a compatibility policy (backward compatible by default).
- **Dead letter queues.** Events that fail processing need somewhere to go besides being dropped silently.
- **Capacity planning.** Streaming pipelines need headroom for traffic spikes. Batch pipelines need to finish before the next run starts.

The architecture diagram is the easy part. Operating the pipeline at 3 AM when something breaks is where the real engineering lives.
