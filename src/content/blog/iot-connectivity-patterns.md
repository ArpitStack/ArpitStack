---
title: "Designing IoT Systems for Intermittent Connectivity"
date: "2026-12-24"
tags: ["IoT", "Distributed Systems", "MQTT", "Architecture"]
description: "Mining sites lose connectivity. Your IoT architecture needs offline buffering, store-and-forward, conflict resolution, and the right MQTT QoS levels to survive it."
readingTime: 13
---

Mining sites are not data centers. Connectivity drops when a truck drives behind a hill, when a dust storm rolls through, or when the site's backhaul link goes down for maintenance. If your IoT architecture assumes a stable connection, it will lose data exactly when you need it most.

We learned this with Symbots deployed across mining operations. This post covers the patterns that make IoT systems survive intermittent connectivity: offline buffering, store-and-forward, conflict resolution, and MQTT QoS levels.

## The Core Problem

A typical IoT data flow looks like this:

```
Device -> Network -> Ingestion -> Processing -> Storage -> Dashboard
```

Every arrow is a failure point. When the network drops, data generated on the device has three possible fates:

1. **Lost.** The device tried to send, failed, and discarded the reading.
2. **Buffered.** The device stored it locally and will retry later.
3. **Never generated.** The device was in a low-power state and skipped the reading.

Option 1 is unacceptable for anything operationally important. Option 3 requires careful design of what "important" means. Option 2 is where most of the engineering lives.

## Reference Architecture

This is the full path a reading takes, with a buffer at every hop that can fail independently.

```
+----------------+     +----------------+     +----------------+
| Device         |---->| Edge Gateway   |---->| Cloud Ingest   |
| sensors        |     | MQTT broker    |     | MQTT cluster   |
| RAM plus flash |     | disk queue     |     | auth plus route|
| local buffer   |     | local rules    |     +-------+--------+
+-------+--------+     +-------+--------+             |
        |                      |                      v
        | local link           | WAN link      +-------+--------+
        | reliable             | unreliable    | Stream Proc    |
        v                      v               | dedup plus win |
+----------------+     +----------------+     +-------+--------+
| Device Shadow  |     | Store Forward  |             |
| last known     |     | confirmed      |             v
| state cache    |     | receipt only   |     +-------+--------+
+----------------+     +----------------+     | TSDB Hot Store |
                                              | alerts live    |
                                              +-------+--------+
                                                      |
                                                      v
                                              +----------------+
                                              | Cold Archive   |
                                              | S3 Parquet     |
                                              +----------------+
```

The device keeps a RAM buffer for short drops and a flash ring buffer for long ones, with priority tiers deciding what survives when space runs out. The gateway runs a local MQTT broker with persistent queues, so devices only need a reliable local link; the gateway absorbs the unreliable WAN. Every hop follows store-and-forward: nothing is deleted until the next hop confirms durable receipt. The cloud ingest layer authenticates devices, routes topics, and hands off to stream processing that deduplicates (QoS 1 means duplicates will arrive), windows by event time, and writes to the hot store. A device shadow cache holds last-known state so dashboards and commands work even when a device is offline. Cold archive to S3 happens asynchronously and never blocks the hot path.

## Offline Buffering on the Device

The device needs local storage and a clear policy for what to buffer and for how long.

**Storage medium matters.** Flash wear is real. If your device writes every reading to flash and you have constrained NAND, you will kill the storage in months. Options:

- **RAM buffer** for short outages (minutes). Fast, no wear, but volatile. Good for transient drops.
- **Flash with wear leveling** for longer outages (hours to days). Use a ring buffer so writes are sequential and evenly distributed.
- **External SD or eMMC** if the device supports it. More capacity, but another failure point.

**Buffer sizing is a capacity planning exercise.** Calculate: readings per second x bytes per reading x maximum expected outage duration x safety factor. For a device emitting 10 readings/sec at 200 bytes each, a 24-hour outage needs about 170 MB. That determines your hardware requirements.

**What to buffer when storage is limited:**

Not all data is equal. Define priority tiers:

- **Critical:** Safety-related readings, fault codes, alarm states. Buffer indefinitely, transmit first on reconnect.
- **Operational:** Normal telemetry (temperatures, pressures, fuel levels). Buffer for the retention window, transmit in order.
- **Diagnostic:** Verbose logs, debug traces. Buffer briefly, drop first when storage is tight.

When the buffer fills, drop from the lowest priority tier first. Never silently drop critical data to make room for diagnostic logs.

## Store-and-Forward Architecture

Store-and-forward means each hop in the pipeline persists data before acknowledging receipt. The pattern:

```
Device buffers -> Gateway receives and persists -> Gateway forwards to cloud -> Cloud acknowledges -> Gateway deletes local copy
```

The key rule: **do not delete from the sender until the receiver confirms durable storage.** This sounds obvious but is violated constantly in naive implementations that treat a successful TCP send as delivery.

**Gateway as a buffer.** In many deployments, devices talk to a local gateway (on-site server or edge device) over a reliable local link, and the gateway handles the unreliable WAN connection. The gateway runs a message broker (Mosquitto, or a lightweight queue) with persistent storage. This gives you:

- Devices stay simple. They only need to reach the local gateway.
- The gateway has more storage and compute for buffering, batching, and retry logic.
- You can run local processing (alerting, aggregation) even when the cloud is unreachable.

**Backpressure.** When the downstream is slow or down, the system needs backpressure, not unbounded queue growth. Define:

- Maximum queue depth per priority tier
- Behavior when full (drop lowest priority, or block producers with a clear signal)
- Alerts when queues exceed thresholds (so you know before data loss happens)

## MQTT QoS Levels

If you use MQTT (and for IoT telemetry, you probably should), QoS levels control delivery guarantees:

**QoS 0: At most once.** Fire and forget. The broker does not acknowledge. Fastest, but messages can be lost. Use for high-frequency data where losing individual points is acceptable (e.g., a temperature reading every second where the next one arrives in a second anyway).

**QoS 1: At least once.** The broker acknowledges receipt. The publisher retries until acknowledged. Messages can be duplicated if the acknowledgment is lost. Use for data where loss is unacceptable but duplicates are tolerable (most operational telemetry). Your consumer must be idempotent.

**QoS 2: Exactly once.** Four-way handshake guarantees no loss and no duplication. Slowest, most overhead. Use sparingly, only for critical messages where duplicates would cause real problems (e.g., a command to shut down equipment, not a temperature reading).

**Practical guidance:**

- Telemetry (sensor readings): QoS 1 with idempotent consumers. The duplication risk is manageable and the throughput is reasonable.
- Commands (cloud to device): QoS 1 or 2 depending on the danger of duplicate execution. A "restart device" command executed twice is annoying. A "discharge capacitor bank" command executed twice could be dangerous.
- Use QoS 0 only when you have explicitly decided that data loss is acceptable for that specific stream.

**Persistent sessions.** Configure the MQTT client with `clean_session=false` (or the v5 equivalent) so the broker queues messages for disconnected clients. Without this, messages published while the device is offline are lost even with QoS 1. Set a reasonable session expiry so the broker does not accumulate infinite queues for dead devices.

## Conflict Resolution

When connectivity returns and buffered data flows in, you get conflicts:

**Late data vs. real-time aggregations.** Your pipeline already computed hourly aggregates without the missing data. When the late data arrives, do you recompute? Options:

- **Ignore it for aggregates.** Accept that historical aggregates are slightly incomplete. Simplest, often fine for operational dashboards.
- **Recompute affected windows.** Trigger reprocessing for the time ranges that received late data. More correct, more complex.
- **Versioned aggregates.** Store aggregate version numbers and mark windows as "provisional" until a completeness deadline passes.

**Out-of-order timestamps.** Device clocks drift. A reading timestamped 10:05 might arrive after one timestamped 10:06. Your pipeline needs to handle this:

- Use event time (when the reading was taken) not processing time (when it arrived) for all time-window logic.
- Define a watermark: how late you are willing to wait for data before closing a window.
- Document the tradeoff explicitly. Tighter watermarks mean fresher results but more late-data misses.

**Duplicate delivery.** QoS 1 guarantees at-least-once, which means duplicates. Every consumer must be idempotent. The standard approach is a deduplication key (device ID + timestamp + sequence number) checked against a recent-seen cache. Size the cache for your maximum expected duplicate window.

## Testing for Disconnection

You cannot just hope this works. Test it:

1. **Chaos testing.** Randomly drop the network connection for varying durations during integration tests. Verify no data loss for critical tiers.
2. **Buffer overflow testing.** Fill the device buffer faster than it can drain. Verify priority-based dropping works.
3. **Clock skew testing.** Run devices with clocks offset by minutes. Verify timestamp handling.
4. **Reconnect storms.** Bring 1,500 devices back online simultaneously after an outage. Verify the ingestion pipeline does not collapse under the burst.

That last one is critical. A site-wide outage followed by mass reconnect creates a thundering herd. Your ingestion needs rate limiting, backpressure, and prioritized processing (critical data first, backfill second).

## Scalability

**At 10x (15,000 devices):** The MQTT broker becomes the first scaling question. A single Mosquitto or EMQX node handles tens of thousands of concurrent connections, but connection churn during flaky-network periods is what hurts: every reconnect triggers authentication, session restore, and subscription replay. At 10x you want broker clustering with sticky sessions, and you must load-test the reconnect storm, not just steady state. Gateway hardware needs revisiting too: disk queues sized for a 24-hour WAN outage at 10x device count means terabytes, not gigabytes, and that changes the gateway bill of materials.

**At 100x (150,000 devices):** You are running a regional broker fleet behind a load balancer, partitioned by site or device cohort, with each partition independently deployable. Authentication becomes a bottleneck if every connect hits a central database; move to token-based auth with local validation or short-lived certificates verified at the edge. The stream processing layer must scale horizontally by topic partition, and the deduplication cache (device ID plus timestamp plus sequence) needs to be sharded because a single in-memory seen-cache will not hold the duplicate window at this volume. Backfill after a multi-day outage is now a planned operation with rate limits, not something you just let rip.

**What breaks first:** Almost always the reconnect storm path. Steady-state telemetry at 100x is a solved problem; 150,000 devices reconnecting within the same minute after a backhaul outage is not. The failure cascade looks like this: broker CPU spikes on auth, legitimate publishes time out, devices retry harder, queues fill, backpressure drops low-priority data, and operators lose visibility exactly when they need it most. Mitigations in order: exponential backoff with jitter on the device (non-negotiable), connection rate limiting at the broker, prioritized processing where critical topics jump the queue, and a big red button that sheds diagnostic traffic first.

**Horizontal scaling strategy:** Partition by site or gateway, never by time. Each site's devices talk to their assigned broker partition, and partitions can be added without rebalancing the world. Keep device-to-partition mapping in the provisioning system so a new site comes online pointing at fresh capacity.

## Security Considerations

**Device identity and provisioning.** Every device gets a unique identity at manufacturing or provisioning time: a client certificate burned in at the factory, or a bootstrap credential that is exchanged for a real certificate on first connect and then destroyed. Shared passwords across a fleet mean one extracted secret compromises everything. Plan for revocation from day one: a stolen or decommissioned device must be excludable without touching the rest of the fleet.

**Mutual TLS everywhere.** Devices authenticate to the broker, and the broker authenticates to devices. Without the second half, a rogue access point can impersonate your infrastructure and harvest credentials or feed devices malicious commands. Pin the broker certificate on the device where feasible.

**Topic-level authorization.** A device should only publish to its own topics and subscribe to its own command topics. A compromised temperature sensor must not be able to publish to the topic that carries shutdown commands for heavy equipment. Enforce this with ACLs on the broker, tested as part of CI, not as documentation.

**Firmware integrity.** Sign firmware images and verify signatures in the bootloader. An attacker who can push unsigned firmware to field devices owns the fleet. Keep the signing keys offline in an HSM, and maintain a rollback path to the last known good image.

**Physical access.** Field devices get stolen, opened, and probed. Assume secrets stored on the device will be extracted: that is why per-device credentials with limited scope and short lifetimes matter more than trying to make extraction impossible. Tamper-evident enclosures and secure elements raise the cost of attack; they do not eliminate it.

**Data in transit and at rest.** TLS 1.2 or better on every hop. Encrypt gateway disk queues, because a stolen gateway with a plaintext queue hands over days of operational data. Encrypt cloud storage with customer-managed keys where contracts require it.

## Production Checklist

**Metrics to monitor:**
- Devices connected vs expected per site (the gap is your outage detector)
- Reconnect rate and reconnect storm events
- Per-gateway disk queue depth and oldest queued message age
- Publish latency end to end, device to dashboard
- Duplicate delivery rate at the stream processor
- Dropped messages by priority tier and reason
- Authentication failure rate (spikes mean misconfigured firmware or an attack)
- Certificate expiry dates across the fleet

**Alert thresholds:**
- Connected devices drop more than 5 percent at a site for 10 minutes: page. Either the site lost backhaul or your broker did.
- Gateway queue depth above 70 percent of capacity: ticket. Above 90 percent: page, and start shedding diagnostic traffic.
- Oldest queued message older than your completeness SLA (we used 4 hours for operational data): ticket.
- Auth failures spike 10x over baseline: page. Could be a bad firmware push or credential stuffing.
- Any device certificate expiring within 30 days: ticket, with the owning team assigned.

**Failure modes and runbooks:**
- *Site-wide backhaul outage:* runbook covers confirming gateway buffering is healthy, estimating time-to-full at current publish rates, and the priority order for manual intervention.
- *Reconnect storm after outage:* runbook covers enabling aggressive rate limiting, shedding diagnostic topics, and the dashboard queries that distinguish "devices reconnecting" from "devices lost."
- *Broker node failure:* runbook covers draining connections to surviving nodes, verifying persistent sessions transferred, and checking for message gaps via sequence numbers.
- *Bad firmware push:* runbook covers halting the rollout, identifying affected device cohorts from version metadata, and the rollback procedure.

**Capacity planning:** Model per site: devices times publish rate times message size times maximum expected outage, plus 50 percent margin. Review gateway hardware annually against device growth. Review broker cluster capacity quarterly against connection churn metrics, not just steady-state connections.

## Summary

Design for disconnection from day one:

- Buffer on the device with priority tiers
- Store-and-forward at every hop, delete only on confirmed receipt
- Choose MQTT QoS deliberately per message type
- Make consumers idempotent to handle duplicates
- Plan for late data, out-of-order timestamps, and reconnect storms
- Test all of it with chaos, not hope

The network will fail. The question is whether your architecture notices.
