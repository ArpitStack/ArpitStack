---
title: "Designing Webhook Delivery Systems That Survive Failures"
date: "2027-03-18"
tags: ["Webhooks", "System Design", "Reliability", "APIs"]
description: "How to build webhook delivery that works: at-least-once semantics, retry with backoff, signature verification, and ordering guarantees."
readingTime: 13
---

Webhooks are how your system talks to the outside world. Stripe sends you payment events. GitHub sends you push notifications. Your system sends events to customer endpoints. It sounds simple: HTTP POST to a URL. In production, it is a distributed systems problem wearing a trench coat.

This post covers how to design webhook delivery that survives the failures you will definitely encounter.

## The Core Problem

You need to deliver an event to a URL controlled by someone else. That URL might be down, slow, or misconfigured. Your system must:

1. Deliver at least once (never silently drop)
2. Not deliver duplicates in ways that break the receiver (or make duplicates safe)
3. Retry intelligently (not hammer a struggling endpoint)
4. Prove the event came from you (not an attacker)

## System Architecture

Before the patterns, it helps to see the full set of components. A production webhook system looks like this:

```
+-----------------+     +------------------+     +-------------------+
| Event Producers |---->| Ingest API       |---->| Outbox Table      |
| (your services) |     | (auth, validate, |     | (delivery intents |
+-----------------+     |  fan out)        |     |  + retry state)   |
                        +------------------+     +--------+----------+
                                                            |
                            +---------------------------------------+
                            v
                    +-------+--------+     +------------------+
                    | Retry Scheduler|---->| Dead Letter Queue|
                    | (due attempts, |     | (attempts       |
                    |  backoff)      |     |  exhausted)      |
                    +-------+--------+     +--------+---------+
                            |                       |
                            v                       v
                    +------------------+    +------------------+
                    | Delivery Workers |    | Alerts +         |
                    | (sign, POST,     |    | Subscriber       |
                    |  record result)  |    | Dashboard        |
                    +--------+---------+    +------------------+
                             |
                             v
                    +------------------+
                    | Subscriber URLs  |
                    | (customer owned) |
                    +------------------+
```

The ingest API and delivery workers are separate for a reason. Producers should never block on delivery. Ingest validates the event, fans out one delivery intent per subscriber, writes them to the outbox in a single transaction, and returns in milliseconds. Delivery is someone else's problem after that.

Workers are stateless. Each one claims a batch of due deliveries with SELECT ... FOR UPDATE SKIP LOCKED, signs the payload, POSTs it, and records the outcome. Because workers hold no local state, you can run any number of them.

The retry scheduler is not a separate service at small scale. It is a query: deliveries where next_attempt_at is in the past. At large scale it becomes a dedicated partition scanner, but the logic does not change.

The subscriber dashboard reads from the same delivery-attempt records. This is why you store every attempt, not just the final outcome. When a customer asks what happened to their event, the answer is already in your database.

One tradeoff to internalize: this architecture optimizes for durability over latency. Events usually deliver within seconds, but the design accepts minutes during backlogs. If you need sub-second delivery guarantees, webhooks are the wrong primitive. Use a connection the client holds open instead, like server-sent events or a websocket.

## At-Least-Once Delivery

The foundation: persist the delivery intent before attempting.

```
Event occurs --> Save to outbox table --> Attempt delivery
                                          --> Success? Mark delivered
                                          --> Failure? Schedule retry
```

The outbox pattern ensures you never lose an event due to a crash between "decide to send" and "actually send." The event is in the database before the first HTTP attempt.

A background worker polls for pending deliveries:

```go
func (w *Worker) processPending(ctx context.Context) error {
    // Fetch deliveries due for attempt (including retries)
    pending, err := w.db.GetPendingDeliveries(ctx, 100)
    if err != nil {
        return err
    }

    for _, d := range pending {
        if err := w.attempt(ctx, d); err != nil {
            // Log, update retry count, schedule next attempt
            w.scheduleRetry(ctx, d, err)
        } else {
            w.markDelivered(ctx, d.ID)
        }
    }
    return nil
}
```

## Retry with Exponential Backoff

When delivery fails, do not retry immediately. The receiving endpoint is probably struggling. Hammering it makes things worse.

Standard schedule: 1 minute, 5 minutes, 30 minutes, 2 hours, 8 hours, 24 hours. After 24-48 hours of failures, move to a dead letter queue and alert.

```go
func nextRetryDelay(attempt int) time.Duration {
    // Exponential: 1m, 5m, 25m, 2h, 10h, capped at 24h
    base := time.Minute
    delay := base * time.Duration(math.Pow(5, float64(attempt)))
    max := 24 * time.Hour
    if delay > max {
        delay = max
    }
    // Add jitter to prevent synchronized retries
    jitter := time.Duration(rand.Float64() * float64(delay) * 0.2)
    return delay + jitter
}
```

**Jitter matters.** Without it, all failed deliveries retry at the same time, creating a thundering herd against the recovering endpoint.

**Respect Retry-After headers.** If the receiver returns 429 with a `Retry-After` header, honor it. Do not retry before the specified time.

## Idempotency: Making Duplicates Safe

At-least-once means duplicates will happen. The receiver must handle them. Your job: make it easy.

1. **Include a unique event ID** in every webhook payload. Receivers can deduplicate on this ID.
2. **Include a timestamp** so receivers can detect stale replays.
3. **Document the retry behavior** so receivers know what to expect.

```json
{
  "id": "evt_abc123",
  "type": "order.completed",
  "created_at": "2026-09-05T14:30:00Z",
  "data": {
    "order_id": "ord_xyz789",
    "amount": 99.99
  }
}
```

The `id` field is the contract. Receivers store processed IDs and skip duplicates.

## Signature Verification

Anyone can POST to a webhook URL. Receivers need to verify the event actually came from you.

HMAC-SHA256 is the standard:

```go
func signPayload(payload []byte, secret string) string {
    h := hmac.New(sha256.New, []byte(secret))
    h.Write(payload)
    return hex.EncodeToString(h.Sum(nil))
}

// Sender: include signature in header
// X-Webhook-Signature: <hmac-sha256 hex>

// Receiver verifies:
func verifySignature(payload []byte, signature, secret string) bool {
    expected := signPayload(payload, secret)
    return hmac.Equal([]byte(expected), []byte(signature))
}
```

**Key rotation:** Support multiple active secrets. When rotating, accept both old and new for a transition period. Include a key ID in the header so receivers know which secret to use.

**Timestamp validation:** Include a timestamp in the signature input. Receivers reject events older than 5 minutes to prevent replay attacks.

## Ordering Guarantees

Most webhook systems do not guarantee ordering. If ordering matters for your use case (state transitions, for example), you need to design for it.

Options:

1. **Per-endpoint serial delivery**: Deliver events to each subscriber URL one at a time, in order. Simple but slow (one slow event blocks all subsequent ones for that subscriber).
2. **Sequence numbers**: Include a sequence number per subscriber. Receivers buffer out-of-order events and process in sequence.
3. **No ordering, idempotent state**: Design events as state snapshots, not deltas. `order.status = "shipped"` is safe out of order. `order.status changed from X to Y` is not.

Option 3 is usually the right choice. State-based events are naturally idempotent and order-independent.

## Monitoring and Debugging

Webhook systems fail silently without good observability:

- **Delivery rate**: Percentage of events delivered on first attempt. Should be >99%.
- **Retry queue depth**: Growing queue means a subscriber is down or your system has a bug.
- **Per-subscriber dashboards**: Each subscriber URL gets its own success rate, latency p99, and error breakdown.
- **Payload logging**: Log the full payload for failed deliveries (with PII redaction). Debugging without the payload is guessing.

Provide subscribers with a dashboard showing their own delivery history. When they complain "we didn't get the webhook," the dashboard answers the question before it becomes a support ticket.

## Scalability

How this design behaves as volume grows.

At 10x (tens of thousands of deliveries per day), the single-database design holds up. The outbox table needs an index on (next_attempt_at, status) and a job that archives delivered rows. Workers scale horizontally because they are stateless; autoscale on retry queue depth, not CPU. The first bottleneck is usually database connections as workers multiply, so put a connection pooler (PgBouncer) in front of Postgres early.

At 100x (millions of deliveries per day), polling the outbox becomes the bottleneck. Every worker's SELECT ... FOR UPDATE SKIP LOCKED contends on the same index. The standard evolution has three steps:

1. Partition the outbox by subscriber hash into N logical queues. Workers own partitions, which removes cross-worker contention.
2. Move the hot path to a real queue. A Kafka topic keyed by subscriber ID gives you per-subscriber ordering for free and lets you scale consumers per partition.
3. Separate the write path from the read path. Delivery attempt records go to cheap append-only storage (object storage or a time-series database), not the transactional database.

The polling versus change-data-capture question comes up here. Instead of workers polling the outbox, you can stream row changes with Debezium into Kafka. CDC removes polling load from the database entirely. The cost is operational: you now run Kafka Connect, manage schema evolution, and handle the lag between commit and capture. Polling is simpler and correct up to surprising scale. Switch to CDC when polling queries show up in your slow-query log, not before.

The hot subscriber problem deserves special attention. One subscriber with a slow endpoint and a million pending events can starve everyone else if workers are shared. Per-subscriber concurrency caps plus partition isolation solve this. Monitor per-subscriber queue depth, not just the global number. A global queue depth of zero with one subscriber at a million pending is a very different situation than a global depth of a million spread evenly.

Capacity planning math: worker throughput equals concurrent deliveries per worker divided by average subscriber response time. If a worker runs 50 concurrent deliveries and subscribers respond in 500ms on average, one worker sustains roughly 100 deliveries per second. Size for peak plus backlog drain, not steady state. If a subscriber outage creates a six-hour backlog, how fast must you drain it when they recover? That number sets your worker count.

Database growth is the silent killer. Every attempt is a row. At one million events per day with 1.2 attempts on average, that is 1.2 million rows per day. Archive delivered attempts older than seven days to cold storage and keep the hot table small, because the polling query must stay fast.

## Security Considerations

- **Do not send sensitive data** in webhook payloads unless necessary. Send IDs and let receivers fetch details via authenticated API.
- **Allowlist IPs** if subscribers need it (publish your egress IP ranges).
- **TLS only.** Never deliver webhooks over plain HTTP in production.
- **Timeout aggressively.** 10 seconds max per attempt. A hanging connection holds a worker.
- **SSRF protection.** Subscriber URLs are attacker-controlled input. A malicious subscriber could point their webhook URL at your internal services. Validate aggressively: allow only https, resolve the hostname yourself, and reject private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, and 169.254.169.254). Re-resolve DNS on every attempt, because DNS rebinding can swap a safe answer for an internal one between validation and delivery. Block redirects, or re-validate the redirect target with the same rules.
- **Secret storage.** Signing secrets live in a KMS or secrets manager, never in the database next to the payloads. Workers fetch them at startup and cache in memory with a short TTL so rotation propagates.
- **Payload encryption at rest.** The outbox holds every payload you have not delivered yet. Encrypt sensitive fields or the full payload column. Your database backups contain customer data; treat them accordingly.
- **Dashboard authentication.** The subscriber dashboard exposes delivery history, which leaks business activity (order volumes, event types). Put it behind the same auth as the rest of your customer portal, and scope each subscriber to their own data.

## Subscriber Onboarding and Testing

The best webhook system fails if subscribers cannot integrate easily. Invest in onboarding.

**Test endpoint:** Provide a way for subscribers to trigger test events. A "Send test webhook" button in your dashboard that fires a sample event to their URL. This catches configuration errors (wrong URL, firewall blocks, signature verification bugs) before production traffic.

**Event catalog:** Document every event type with example payloads, JSON schemas, and descriptions of when each event fires. Version the catalog. When you add a new event type, announce it in advance.

**Delivery dashboard for subscribers:** Each subscriber should see their own delivery history: timestamps, HTTP status codes, response times, retry attempts. When they report missing events, this dashboard is the first debugging tool.

**IP allowlisting:** Some enterprise subscribers only accept webhooks from known IPs. Publish your egress IP ranges and commit to advance notice before changing them. This is a common enterprise requirement that is easy to overlook.

**Graceful degradation for subscribers:** If a subscriber's endpoint is down for days, do not queue events indefinitely. Set a maximum retention (7 days is common), then drop with notification. Document this policy so subscribers know to fix their endpoints promptly.

## Handling Subscriber Scale

As your webhook system grows to thousands of subscribers, new challenges emerge.

**Per-subscriber rate limits:** A single subscriber with a slow endpoint should not consume all your delivery workers. Implement per-subscriber concurrency limits (e.g., max 10 concurrent deliveries per subscriber URL). Queue excess deliveries.

**Priority tiers:** Not all events are equal. Payment confirmations are more urgent than analytics events. Implement priority queues so critical events jump ahead of bulk notifications during backlogs.

**Subscriber health scoring:** Track each subscriber's success rate over time. Automatically reduce delivery frequency for consistently failing endpoints (circuit breaker per subscriber). Notify the subscriber when their health score drops below a threshold.

## Production Checklist

What to have in place before this system carries real traffic.

**Metrics (all per subscriber, not just global):**

- First-attempt delivery rate (target above 99 percent)
- Delivery latency p50 and p99, measured from event creation to successful POST
- Retry queue depth and age of oldest pending delivery
- Dead letter queue growth rate
- Worker saturation: concurrent deliveries versus configured cap
- Signature verification failures on the subscriber dashboard (usually their bug, but you want to see it)

**Alerts:**

- Dead letter queue growing: page. Events are being permanently dropped.
- Oldest pending delivery older than 30 minutes: warn. Something is stuck.
- Per-subscriber success rate drops below 95 percent over 15 minutes: notify the subscriber automatically, not just your team.
- Worker crash loop or zero successful deliveries across all subscribers: page. The problem is on your side.

**Runbooks:**

- Subscriber down for days: pause their deliveries after the retention window, notify them, and document the resume procedure. Do not let one dead endpoint grow the outbox forever.
- Poison event: one malformed event crashing a worker on every attempt. Quarantine by event ID, fix the serializer, replay from quarantine.
- Outbox table bloat: archive job fell behind. Symptoms are slow polling queries. Runbook covers manual archive steps and how to verify the polling query plan.
- Signing key compromise: rotate keys, keep the old key accepted for 24 hours, notify subscribers to update.

**What breaks at 3am:** a subscriber deploys a change that makes their endpoint return 500 for every event. Your retry queue for that subscriber grows. Per-subscriber caps contain it, the subscriber health score drops, and the automatic notification goes out. You sleep. Without per-subscriber isolation, the same incident consumes all workers and delays every other customer's events, and that is the page you actually get.
