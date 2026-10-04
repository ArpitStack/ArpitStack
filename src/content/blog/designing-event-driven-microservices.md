---
title: "Designing Event-Driven Microservices in Go: HLD of a Production System"
date: "2026-11-30"
tags: ["Go", "Microservices", "Event-Driven", "Architecture"]
description: "High-level design of an event-driven microservices platform in Go: event bus architecture, schema evolution, dead letter queues, and ordering guarantees."
readingTime: 12
---

Event-driven architecture sounds simple on a whiteboard. Services publish events, other services consume them, everyone is decoupled. In production, the whiteboard version lasts about two weeks before reality arrives: a consumer falls behind, a schema change breaks a downstream service at 2 AM, and someone asks why the same order was processed three times.

This post covers the high-level design of an event-driven microservices platform in Go, based on patterns that hold up in production. Not the textbook version. The version with dead letter queues, schema registries, and opinions about ordering.

## The Core Architecture

At a high level, the system has four layers:

1. **Producers**: Services that emit domain events (order created, payment completed, user signed up)
2. **Event bus**: The transport layer (Kafka, NATS, or AWS SNS/SQS depending on scale and team familiarity)
3. **Consumers**: Services that react to events, each owning its own offset/position
4. **Schema registry**: The contract layer that prevents 2 AM pages

The key design decision is what the event bus guarantees and what it does not. Kafka gives you ordering within a partition, at-least-once delivery, and durable retention. It does not give you exactly-once processing, cross-partition ordering, or schema compatibility. Those are your problems to solve.

```
Producer --> [Event Bus] --> Consumer A
                         --> Consumer B
                         --> Consumer C (new, added last month)
```

Each consumer tracks its own position independently. Consumer C can start from the beginning of the log and replay six months of events to build its state. This is the superpower of the log-based design: new consumers bootstrap without asking producers for anything.

## Choosing the Event Bus

The choice usually comes down to Kafka, NATS JetStream, or a managed service like AWS EventBridge.

**Kafka** when you need: high throughput (millions of events per second), long retention (replay capability), and strong ordering within partitions. The operational cost is real. Running Kafka well requires understanding partition assignment, consumer group rebalancing, and ISR (in-sync replica) behavior.

**NATS JetStream** when you want: simpler operations, lower latency, and moderate throughput. Easier to reason about than Kafka. Less mature ecosystem.

**EventBridge/SNS** when you want: zero operations, pay per event, and are comfortable with AWS lock-in. Fine for moderate volumes. Gets expensive at very high throughput.

For a Go shop building a platform that needs to last years, Kafka is usually the right default. The ecosystem (schema registry, Kafka Connect, ksqlDB) compounds over time.

## Schema Evolution: The Contract That Matters

Events are API contracts. The difference from REST APIs is that you cannot version an event by deploying a new endpoint. Old events sit in the log for months. Consumers read them whenever they catch up.

Rules that work:

1. **Only add optional fields.** Never rename, never remove, never change types. If you need a breaking change, create a new event type (OrderCreatedV2) and run both during migration.
2. **Use a schema registry.** Confluent Schema Registry or AWS Glue Schema Registry. Producers validate before publishing. Consumers validate on receipt. A bad schema never reaches the bus.
3. **Design for unknown fields.** Consumers should ignore fields they do not understand. This is what allows V2 producers to coexist with V1 consumers.

In Go, this maps to struct design:

```go
// V1 event
type OrderCreated struct {
    OrderID   string    `json:"order_id"`
    Amount    float64   `json:"amount"`
    CreatedAt time.Time `json:"created_at"`
}

// V2: only additive changes
type OrderCreatedV2 struct {
    OrderID   string    `json:"order_id"`
    Amount    float64   `json:"amount"`
    Currency  string    `json:"currency,omitempty"` // new, optional
    CreatedAt time.Time `json:"created_at"`
}
```

The `omitempty` tag matters. V1 consumers unmarshalling V2 events will ignore the currency field. V2 consumers reading old V1 events get an empty currency and handle the default.

## Ordering Guarantees: What You Can Actually Promise

This is where most designs go wrong. Teams assume global ordering, build on that assumption, then discover partitions.

**What Kafka guarantees:** ordering within a single partition, for a single producer. That is it.

**What you need to design for:** most business processes only need ordering per entity. All events for order-123 must be processed in sequence. Events for order-123 and order-456 can interleave freely.

The standard approach: partition key = entity ID.

```go
// Partition by order ID so all events for one order land in the same partition
key := []byte(event.OrderID)
producer.Publish(ctx, "orders", key, eventPayload)
```

This gives you per-entity ordering. If you need cross-entity ordering (rare, and usually a sign of a design smell), you need a single partition, which kills throughput. Push back on that requirement.

## Dead Letter Queues: Planning for Failure

Some events will fail processing. A downstream API is down, a message is malformed, a bug in the consumer code throws on a specific payload shape. Without a dead letter queue (DLQ), these events block the partition or get silently dropped.

Design:

1. **Retry with backoff first.** 3 attempts with exponential backoff (1s, 5s, 25s) handles transient failures.
2. **After retries exhausted, route to DLQ.** A separate Kafka topic (orders.DLQ) that preserves the original event plus failure metadata.
3. **Alert on DLQ growth.** A DLQ with 10 messages is normal. A DLQ growing by 1000/hour means something is broken upstream.
4. **Replay capability.** Build a tool to replay DLQ events back to the main topic after fixing the root cause.

```go
func (c *Consumer) processWithRetry(ctx context.Context, msg Message) error {
    var lastErr error
    for attempt := 0; attempt < 3; attempt++ {
        if err := c.handle(ctx, msg); err == nil {
            return nil
        } else {
            lastErr = err
        }
        backoff := time.Duration(math.Pow(5, float64(attempt))) * time.Second
        time.Sleep(backoff)
    }
    // All retries failed, send to DLQ
    return c.dlq.Publish(ctx, DeadLetter{
        Original: msg,
        Error:    lastErr.Error(),
        Attempts: 3,
    })
}
```

## Idempotency: Because At-Least-Once Means Duplicates

The event bus guarantees at-least-once delivery. Your consumers will see duplicates. Network partitions, consumer rebalances, and producer retries all cause redelivery.

Every consumer must be idempotent. The standard pattern: track processed event IDs.

```go
func (c *Consumer) handle(ctx context.Context, event OrderEvent) error {
    // Check if already processed
    exists, err := c.store.Exists(ctx, event.EventID)
    if err != nil {
        return err
    }
    if exists {
        return nil // already processed, skip
    }

    // Process in a transaction with the idempotency record
    return c.store.Transaction(ctx, func(tx Tx) error {
        if err := tx.MarkProcessed(event.EventID); err != nil {
            return err
        }
        return tx.ApplyBusinessLogic(event)
    })
}
```

The idempotency record and the business logic must commit atomically. If you mark processed but crash before applying logic, you lose the event. If you apply logic but crash before marking, you process twice.

## Go-Specific Patterns

**Consumer groups:** Use a library like `franz-go` or `confluent-kafka-go`. `franz-go` is pure Go (no CGO), which simplifies builds and cross-compilation. It handles rebalancing well.

**Graceful shutdown:** On SIGTERM, stop fetching new messages, finish processing in-flight ones, commit offsets, then exit. Kubernetes gives you 30 seconds by default. Use them.

```go
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
    defer stop()

    go consumer.Run(ctx)

    <-ctx.Done()
    // consumer.Run respects ctx cancellation:
    // stops polling, drains in-flight, commits offsets
    log.Println("shutdown complete")
}
```

**Backpressure:** If a consumer falls behind (lag growing), do not just add more consumers. First check: is the bottleneck in processing logic or in the bus? Adding consumers to a CPU-bound handler helps. Adding consumers to a downstream API bottleneck just moves the queue.

## System Architecture

The full picture, with the pieces the whiteboard version leaves out:

```
+----------------+      +------------------+
| Order Service  |----->| Schema Registry  |
| (producer)     |      | (validate before |
+-------+--------+      |  publish)        |
        |               +--------+---------+
        |                        |
        v                        v
+-------+-------------------------------+
| Kafka cluster: 3 brokers, RF=3        |
| topic "orders": 12 partitions,        |
| 7-day retention                       |
+-------+------------------+------------+
        |                  |
        v                  v
+---------------+  +-------------------+
| Consumer A    |  | Consumer B        |
| (payments,    |  | (analytics,       |
|  live)        |  |  replaying old)   |
+-------+-------+  +-------------------+
        |
        v  (retries exhausted)
+---------------+
| orders.DLQ    |
| + alerting    |
+---------------+
```

Data flow: the producer validates its payload against the schema registry before publishing (fail fast, never put a bad event on the bus). Kafka persists to the replicated log. Each consumer group tracks its own offsets, so the payments consumer and the analytics consumer move independently. Failures route to the DLQ topic with error metadata, and a separate alerter watches DLQ growth. A new consumer group can attach and replay from the start of retention without any producer changes.

The pieces people forget: the schema registry sits on the publish path (it must be highly available, or clients must cache schemas aggressively), and offset storage (`__consumer_offsets`) is itself a Kafka topic that needs the same replication and monitoring as your data topics.

## Scalability

Partition math first. A single partition sustains low single-digit MB/s of throughput in practice. Total topic throughput is roughly partitions times per-partition throughput. Size your partition count for 2 to 4x current need, and keep it under a few hundred per topic: more partitions mean slower leader elections, longer rebalances, and more open file handles on every broker.

At 10x load: you add consumers, but only up to the partition count (one consumer per partition per group is the useful maximum). If you need more partitions, know the trap: increasing the partition count reassigns some keys under the default hash partitioner, which silently breaks per-key ordering for the keys that move. If strict per-entity ordering matters, over-provision partitions on day one. You cannot fix this later without pain.

At 100x: one cluster stops being enough. Split by workload (a dedicated cluster for critical payment events, another for analytics), add tiered storage so retention is bounded by cheap object-store cost instead of broker disk, and mirror between regions with MirrorMaker 2 if you need cross-region consumers.

Bottlenecks, in the order you will hit them: hot partitions (one key with 10x the traffic of the others; fix the key design, not the cluster), consumer lag caused by a slow downstream (adding consumers to a downstream-API bottleneck just moves the queue), rebalance storms (rolling deploys with default session timeouts cause every deploy to reshuffle partitions; use static group membership and stagger rollouts), and the schema registry as a publish-path dependency (cache schemas in the producer; a registry outage should degrade to cached validation, not halt publishing).

Capacity planning: events per second times average bytes times retention seconds times replication factor equals broker storage. Network: replication traffic is roughly write traffic times (RF minus 1), plus consumer fetch traffic. Keep broker disks under 70 percent; log segment cleanup needs headroom to do its job.

Staff-level questions this design must answer: how do you get exactly-once? (You do not, end to end. Kafka transactions give you atomic consume-transform-produce within the cluster, and the idempotent producer dedups broker-side retries, but your consumer's side effects still need idempotency records.) How does the producer publish atomically with its database write? (Transactional outbox: write the business row and the outbox row in one DB transaction, then a relay publishes the outbox to Kafka. Dual writes, DB then Kafka, fail in both directions on crash. The outbox is the standard fix.)

## Security Considerations

Client-to-broker auth with SASL/SCRAM or mTLS; broker-to-broker mTLS as well. ACLs per principal: producers get write on their topics only, consumers get read on theirs, and nobody except the brokers touches `__consumer_offsets` or `__transaction_state`.

Encryption in transit via TLS, at rest via disk encryption on the brokers. PII deserves its own paragraph: prefer not putting raw PII in events at all. If you must, use field-level encryption with envelope keys, and remember that retention is a privacy timer. A 7-day retention means every PII field lives at least 7 days; deletion requests map to compacted topics or crypto-shredding (delete the key and the ciphertext becomes garbage).

The schema registry is a supply-chain chokepoint: authenticate publishers, because a malicious schema change propagates to every consumer. Set per-client produce quotas so one rogue producer cannot starve the cluster, and cap `max.message.bytes` to block poison-pill messages. The DLQ contains raw failed payloads, often including the PII you tried to keep out of the bus; restrict who can read and replay it.

## Operational Concerns

Monitor: consumer lag per group per partition (the single most important metric), under-replicated partitions (ISR shrink), broker disk usage, request latency p99, DLQ publish rate, and schema registry availability.

Alert on: lag growing for more than 10 minutes (a flat high lag is a backlog; a growing lag is a fire), any under-replicated partition lasting more than 5 minutes, DLQ rate spikes, and any broker offline.

Runbooks you need before the first incident: (1) Lag growing: check consumer error logs and downstream latency first. Scale consumers only if consumers are fewer than partitions; if the downstream API is the bottleneck, more consumers make it worse. (2) Broker down with RF=3: do nothing until it returns, but watch ISR; do not restart the whole cluster at once. (3) Rebalance storm after a deploy: static membership, longer session timeouts, staggered rollouts.

What breaks at 3am: the schema registry goes down and blocks deploys that publish new schemas (cached schemas keep old producers running, which is why you cache); a broker disk fills and stops writes to its partitions; a poison-pill message wedges one consumer thread on one partition; offset commit failures after a rebalance cause reprocessing, which your idempotency records absorb.

Chaos practice: kill a broker monthly, run the DLQ replay tool quarterly, and rehearse partition reassignment on staging before you ever need it in production.

## What I Would Do Differently

If starting over: invest in the schema registry on day one, not month six. Every schema-related incident we had would have been caught by registry validation. It is boring infrastructure that prevents exciting pages.
