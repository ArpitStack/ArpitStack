---
title: "From Sensor to Alert in Seconds: LLD of a Real-Time Pipeline"
date: "2027-02-08"
tags: ["Streaming", "IoT", "Architecture", "Python", "AWS"]
description: "Low-level design of a real-time alerting pipeline: stream processing, windowing, alert deduplication, and latency budgets from sensor to notification."
readingTime: 13
---

When a mining truck shows signs of failure, the difference between a 30-second alert and a 30-minute alert is the difference between preventive maintenance and a breakdown in the middle of a pit. This post covers the low-level design of a real-time pipeline that goes from sensor data to actionable alert in seconds.

## The Pipeline Stages

```
Sensors --> Ingestion --> Stream Processing --> Alert Engine --> Notification
  (trucks)   (Kinesis)      (windowing)         (rules)         (dashboard/API)
```

Each stage has a latency budget. Total end-to-end: under 10 seconds for critical alerts.

| Stage | Budget | What happens |
|-------|--------|--------------|
| Ingestion | <1s | Sensor to Kinesis |
| Processing | <3s | Window aggregation, feature extraction |
| Alert eval | <2s | Rule matching, deduplication |
| Notification | <2s | Push to dashboard, API, SMS |

## System Architecture

The stage diagram above hides the pieces that determine whether the pipeline survives production. Here is the fuller picture:

```
+----------+    +----------+            +----------+
|  Sensor  |    |  Sensor  |            |  Sensor  |
|  Truck 1 |    |  Truck 2 |   ...      |  Truck N |
+----+-----+    +----+-----+            +----+-----+
     |               |                       |
     +-------+-------+-----------------------+
             |
             v
     +----------------+      +----------------+
     |  Device        |----->|  Quarantine /  |
     |  Gateway       | bad  |  DLQ           |
     |  (auth, schema | msg  |  (poison recs) |
     |   validation)  |      +----------------+
     +-------+--------+
             |
             v
     +----------------+
     |  Ingestion     |
     |  (Kinesis /    |
     |   Kafka topic) |
     +-------+--------+
             |
             v
     +----------------+      +----------------+
     |  Stream        +----->|  State backend |
     |  Processor     |      |  (RocksDB /    |
     |  (windowing,   |      |   checkpoint   |
     |   features)    |      |   to S3)       |
     +-------+--------+      +----------------+
             |
             v
     +----------------+      +----------------+
     |  Alert Engine  +----->|  Baseline store|
     |  (rules +      |      |  (7-day device |
     |   scoring)     |      |   statistics)  |
     +-------+--------+      +----------------+
             |
             v
     +----------------+      +----------------+
     |  Deduplicator  +----->|  Rule config   |
     |  (cooldowns    |      |  service       |
     |   per severity)|      |  (versioned)   |
     +-------+--------+
             |
      +------+------+------+
      |             |      |
      v             v      v
+----------+  +--------+  +----------+
| Critical |  |Warning |  | Info     |
| SMS+push |  |Slack + |  | Dashboard|
|          |  | dash   |  | only     |
+----------+  +--------+  +----------+
```

Three pieces deserve emphasis:

**The device gateway** sits in front of ingestion and does authentication plus schema validation. Malformed or unauthorized payloads never reach the stream. Without it, one misconfigured device firmware can poison the pipeline for everyone.

**The rule config service** is versioned. Every threshold change is a versioned deploy with who, when, and why, and the alert engine hot-reloads it. Unversioned rule changes are how you get a threshold typo that pages the entire on-call rotation at 2am with no way to see what changed.

**The state backend** is what makes the stream processor recoverable. Window state checkpoints to durable storage (S3 for Flink) every minute. When a worker dies, a replacement restores from the last checkpoint and replays from the ingestion log. Without checkpoints, a worker restart loses window state and either drops alerts or double-fires them.

Note the dedup-before-notify ordering: deduplication happens after rule evaluation but before any notification channel. A second dedup check at the notification layer (keyed on device plus rule plus time bucket) protects against the alert engine itself double-firing during a failover.

## Ingestion: Kinesis Streams

Sensors emit readings every few seconds: temperature, vibration, fuel level, GPS coordinates, engine diagnostics. Each reading is a JSON payload of 1-2 KB.

Kinesis configuration:

- **Shards**: Partition by device ID. Each shard handles ~1 MB/s ingress. With 1,500 devices emitting 2 KB every 5 seconds, total ingress is about 600 KB/s. Start with 2 shards, scale as needed.
- **Retention**: 24 hours. Enough for replay during incidents, not so much that storage costs balloon.
- **Enhanced fan-out**: Each consumer gets dedicated 2 MB/s throughput. Without it, multiple consumers share the 2 MB/s per shard limit and throttle each other.

```python
# Producer: batch readings for efficiency
records = [
    {
        'Data': json.dumps(reading),
        'PartitionKey': reading['device_id']
    }
    for reading in batch
]
kinesis.put_records(StreamName='sensor-telemetry', Records=records)
```

Batching matters. Individual `put_record` calls have ~10ms overhead each. Batching 500 records per call reduces API overhead by 500x.

## Stream Processing: Windowing

Raw sensor readings are noisy. A single temperature spike might be a sensor glitch. Sustained elevation over 5 minutes indicates a real problem. Windowing aggregates readings over time periods.

**Tumbling windows**: Fixed, non-overlapping. Every 1 minute, compute the average temperature across all readings in that minute.

**Sliding windows**: Overlapping. Every 30 seconds, compute the average over the last 5 minutes. More responsive, more computation.

For anomaly detection, sliding windows work better because they catch trends faster. For dashboard metrics, tumbling windows are sufficient and cheaper.

```python
# Simplified sliding window aggregation
class SlidingWindow:
    def __init__(self, window_seconds=300, slide_seconds=30):
        self.window = window_seconds
        self.slide = slide_seconds
        self.buckets = defaultdict(list)  # device_id -> [(timestamp, value)]

    def add(self, device_id, timestamp, value):
        self.buckets[device_id].append((timestamp, value))
        # Evict old data
        cutoff = timestamp - self.window
        self.buckets[device_id] = [
            (t, v) for t, v in self.buckets[device_id] if t > cutoff
        ]

    def average(self, device_id):
        values = [v for _, v in self.buckets[device_id]]
        return sum(values) / len(values) if values else 0
```

In production, use a stream processor (Flink, Kafka Streams, or Kinesis Data Analytics) rather than hand-rolling. The above illustrates the concept. Real implementations handle out-of-order events, late data, and state checkpointing.

## Alert Engine: Rules and Deduplication

Not every anomaly deserves an alert. The alert engine applies rules to decide what is actionable.

**Rule types:**

1. **Threshold**: Temperature > 95C for 5 consecutive minutes. Simple, effective for known failure modes.
2. **Deviation**: Current value > 3 standard deviations from the device's 7-day baseline. Catches novel failures.
3. **Rate of change**: Temperature rising > 2C per minute. Catches rapid deterioration.

**Deduplication** is critical. Without it, a sustained anomaly generates an alert every evaluation cycle (every 30 seconds = 120 alerts per hour for one truck).

```python
class AlertDeduplicator:
    def __init__(self, cooldown_seconds=3600):
        self.cooldown = cooldown_seconds
        self.last_alert = {}  # (device_id, rule_id) -> timestamp

    def should_alert(self, device_id, rule_id, timestamp):
        key = (device_id, rule_id)
        last = self.last_alert.get(key, 0)
        if timestamp - last < self.cooldown:
            return False  # already alerted recently, suppress
        self.last_alert[key] = timestamp
        return True
```

Cooldown periods by severity: critical (15 min), warning (1 hour), info (4 hours). A critical alert re-fires every 15 minutes until resolved. This balances awareness against alert fatigue.

**Alert enrichment**: Raw alerts are not actionable. Enrich with context before notifying:

- Device metadata (truck ID, location, operator)
- Recent trend (sparkline data for the last hour)
- Similar past incidents (did this device alert last week?)
- Suggested action (based on runbook mapping)

**Delivery semantics tradeoff.** Stream processors offer at-least-once, at-most-once, and exactly-once processing, and the choice lands differently in alerting than in analytics. At-most-once risks a dropped critical alert, which is unacceptable. Exactly-once (Flink checkpoints plus transactional sinks) prevents duplicate alerts but adds latency and operational complexity. Most teams land on at-least-once processing with idempotent notification: the dedup layer keyed on (device, rule, time bucket) makes a duplicate evaluation harmless, because the second one is suppressed before any channel fires. The interview-grade answer: you do not need exactly-once end to end; you need exactly-once *effect*, and dedup at the notification boundary gives you that at a fraction of the cost.

## Notification: Getting It to Humans

Different severities, different channels:

- **Critical**: SMS + push notification + dashboard banner. Wake someone up.
- **Warning**: Dashboard + Slack channel. Visible during work hours.
- **Info**: Dashboard only. For trend analysis, not immediate action.

The notification payload should contain everything needed to act, not just "alert fired." Include the device, the metric, the current value vs threshold, the trend, and a link to the detailed dashboard view.

## Late Data and Out-of-Order Events

Sensors do not always deliver in order. Network delays, device clock skew, and batch uploads cause events to arrive late or out of sequence.

**Watermarks**: Track the maximum event time seen. Allow a lateness threshold (e.g., 2 minutes). Events arriving later than the watermark + threshold are either dropped or processed in a separate late-data path.

**Event time vs processing time**: Always use event time (when the sensor reading was taken) for windowing, not processing time (when your system received it). Processing time windows give wrong results when data is delayed.

## What Breaks

**Hot partitions**: If one device emits 100x more data than others (misconfigured sensor), its Kinesis partition throttles. Monitor per-partition throughput and alert on imbalance.

**State size**: Sliding windows hold state in memory. With 1,500 devices and 5-minute windows, state is manageable. With 1 million devices, you need RocksDB-backed state (Flink) or external state stores.

**Clock skew**: Device clocks drift. If a sensor's clock is 10 minutes fast, its events appear to be from the future. Implement clock synchronization (NTP) on devices and validate timestamps on ingestion (reject events more than 5 minutes in the future).

## Scalability

Do the arithmetic before you need it. The baseline in this post is 1,500 devices at 2 KB every 5 seconds: about 600 KB/s ingress, 2 Kinesis shards. At 10x (15,000 devices), that is 6 MB/s and roughly 6 shards, and the stream processor state grows 10x. The first thing to break is usually not throughput but the baseline store: computing 7-day rolling statistics for 15,000 devices needs either pre-aggregation or a real time-series database, not a hand-rolled table.

At 100x (150,000 devices, 60 MB/s), Kinesis gets expensive and operationally awkward; this is where teams move to Kafka with Flink or Kafka Streams on Kubernetes. The state backend moves to RocksDB with S3 checkpoints. Key the stream by device_id so each worker owns a disjoint set of devices; scaling out is then a partition rebalance, not a redesign.

Backpressure is the scaling failure mode. When the stream processor falls behind, ingestion keeps flowing and consumer lag grows. Design for it: bounded internal queues, shed load in priority order (drop info-severity evaluation first, never drop critical), and autoscale workers on consumer lag, not CPU. CPU looks fine while lag grows because the bottleneck is usually downstream (the baseline store or the notification API).

Watch the cost curve, not just the throughput curve. Enhanced fan-out is priced per shard-hour per consumer; with three consumers it triples that line item. At 100x, the notification bill (SMS per critical alert) can exceed the infrastructure bill if cooldowns are misconfigured. Model cost per device per month at each order of magnitude and make sure the unit economics still work.

Capacity planning inputs: events per second per device, average payload size, consumer lag p99, checkpoint duration, baseline store query latency. Load test with 2x expected peak, including a simulated device firmware bug that multiplies one partition's traffic by 10. Hot partitions do not appear in average-based capacity plans.

## Security Considerations

Devices authenticate individually. Per-device certificates with mutual TLS, or at minimum per-device tokens that rotate. A single shared API key across the fleet means one compromised device compromises ingestion for all of them, and you cannot revoke one device without rotating the key everywhere.

Validate at the gateway: schema conformance, value ranges (a temperature reading of 9,999 C is a broken sensor, not a fire), and timestamp bounds (reject events more than 5 minutes in the future). Validation is a security control as much as a data quality control; it bounds what a compromised device can inject.

Alert injection is the attack to think about. An attacker with a stolen device key can trigger fake critical alerts, which page humans and, via SMS, cost real money per message. Defenses: rate-limit alerts per device (no device should fire more than a handful of criticals per hour), require multi-signal rules for the most expensive channels (temperature AND vibration, not temperature alone), and monitor alert volume per device for anomalies.

Notification credentials (SMS provider API keys, push service certs) live in a secrets manager, never in config files or environment dumps. Rotate them on a schedule.

Location data is PII. GPS coordinates in alerts and dashboards need access controls, retention limits, and ideally aggregation (site-level rather than exact coordinates) for anyone who does not need precision. Mining sites cross borders more often than people expect, so check what each jurisdiction requires.

Audit rule changes. Every threshold modification records who, when, and why. A malicious or mistaken rule change can silence real alerts (set the critical threshold to an unreachable value), which is worse than a noisy one. Versioned config plus a review step for production rule changes closes this.

## Production Checklist

SLOs first: p99 sensor-to-notification latency under 10 seconds for critical, under 60 seconds for warning. Measure it end to end with event timestamps, not with stage-level timers that each look fine while the total slips.

Run a synthetic canary: a fake device that emits a known-bad reading every 5 minutes and expects a critical alert within the SLO. If the canary stops alerting, the pipeline is broken even if every health check is green. This is the single highest-value monitor in the system.

Poison records must never block the stream. After a few failed parse attempts, route the record to the DLQ and move on. Alert on DLQ growth, and have a replay tool that can reprocess DLQ records after a schema fix.

Track alert fatigue as a metric: alerts per device per day, broken down by severity. Set a target (for example, fewer than 2 criticals per device per week) and treat sustained breaches as a pipeline bug, not an operations problem. Fatigue is how real alerts get ignored.

Runbooks: pipeline lag (check consumer lag, hot partitions, scale workers; if lag comes from a poison record storm, check the DLQ first); notification provider outage (fail over to a secondary channel, queue criticals for retry); baseline store slowness (alert engine degrades to threshold-only rules, log the degradation).

Chaos tests: kill a stream worker and verify checkpoint recovery completes in under 60 seconds with no duplicate criticals. Simulate clock skew on a batch of devices and verify watermark handling drops or quarantines them instead of corrupting windows.

The 3am scenario: Kinesis throttles writes from a hot partition because one device's firmware started emitting at 100x rate. You want: a page on throttled writes with the partition key in the alert, a runbook step to identify the device, and a quarantine action at the gateway that drops that device's traffic until the firmware is fixed. Everyone else's alerts keep flowing.
