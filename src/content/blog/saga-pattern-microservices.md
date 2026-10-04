---
title: "Saga Pattern for Distributed Transactions: Choreography vs Orchestration"
date: "2027-02-18"
tags: ["Microservices", "Distributed Systems", "Architecture"]
description: "How to handle transactions across microservices: saga pattern HLD, choreography vs orchestration, compensation logic, and isolation challenges."
readingTime: 12
---

In a monolith, transactions are easy. Begin, do work across tables, commit or rollback. ACID guarantees handle the rest. In microservices, each service owns its database. There is no shared transaction. When an order involves the order service, payment service, and inventory service, and the payment fails after the order is created, who cleans up?

The saga pattern is the standard answer. This post covers how it works, the two main approaches, and the sharp edges.

## The Problem

A distributed transaction spans multiple services, each with its own database:

1. Order service: create order (status: pending)
2. Payment service: charge credit card
3. Inventory service: reserve items
4. Order service: mark order confirmed

If step 3 fails, steps 1 and 2 must be undone. There is no distributed `ROLLBACK`. Each service must explicitly reverse its action.

## Saga Basics

A saga is a sequence of local transactions. Each step has a corresponding **compensating transaction** that undoes it.

| Step | Action | Compensation |
|------|--------|--------------|
| 1 | Create order | Cancel order |
| 2 | Charge card | Refund card |
| 3 | Reserve inventory | Release reservation |
| 4 | Confirm order | (No compensation needed, final step) |

If step 3 fails, the saga executes compensations for steps 2 and 1 in reverse order: refund the card, then cancel the order.

Key insight: compensations are not rollbacks. A rollback restores the exact prior state. A compensation is a new business operation that semantically undoes the original. Refunding a card is not the same as never charging it (the customer sees both transactions on their statement).

## Choreography: Events Drive the Saga

In choreography, there is no central coordinator. Each service publishes events. Other services react.

```
Order Service --(OrderCreated)--> Payment Service --(PaymentCharged)--> Inventory Service
      ^                                                                              |
      |                                                                              v
      +-------------------(InventoryReserved)----------------------------------------+
```

Flow:
1. Order service creates order, publishes `OrderCreated`
2. Payment service hears `OrderCreated`, charges card, publishes `PaymentCharged`
3. Inventory service hears `PaymentCharged`, reserves items, publishes `InventoryReserved`
4. Order service hears `InventoryReserved`, marks order confirmed

If inventory reservation fails, inventory service publishes `InventoryFailed`. Payment service hears it, refunds, publishes `PaymentRefunded`. Order service hears it, cancels the order.

**Pros:**
- No single point of failure or bottleneck
- Services are loosely coupled (only depend on events, not on each other directly)
- Natural fit for event-driven architectures

**Cons:**
- Hard to understand the full flow (logic scattered across services)
- Difficult to debug ("why is this order stuck?" requires tracing events across services)
- Cyclic dependencies possible (A waits for B waits for A)
- Adding a new step requires modifying multiple services

Choreography works well for: simple sagas (3-4 steps), teams that own the full event flow, systems already built on events.

## Orchestration: Central Coordinator

In orchestration, a dedicated saga orchestrator tells each service what to do.

```
                    +--> Order Service: create order
                    |
Saga Orchestrator --+--> Payment Service: charge card
                    |
                    +--> Inventory Service: reserve items
```

The orchestrator maintains the saga state machine:

```go
type SagaState string
const (
    StateStarted           SagaState = "started"
    StateOrderCreated      SagaState = "order_created"
    StatePaymentCharged    SagaState = "payment_charged"
    StateInventoryReserved SagaState = "inventory_reserved"
    StateCompleted         SagaState = "completed"
    StateCompensating      SagaState = "compensating"
)

func (o *Orchestrator) executeSaga(ctx context.Context, sagaID string) error {
    // Step 1: Create order
    if err := o.orderService.Create(ctx, sagaID); err != nil {
        return o.compensate(ctx, sagaID, StateStarted)
    }
    o.updateState(sagaID, StateOrderCreated)

    // Step 2: Charge payment
    if err := o.paymentService.Charge(ctx, sagaID); err != nil {
        return o.compensate(ctx, sagaID, StateOrderCreated)
    }
    o.updateState(sagaID, StatePaymentCharged)

    // Step 3: Reserve inventory
    if err := o.inventoryService.Reserve(ctx, sagaID); err != nil {
        return o.compensate(ctx, sagaID, StatePaymentCharged)
    }
    o.updateState(sagaID, StateCompleted)
    return nil
}

func (o *Orchestrator) compensate(ctx context.Context, sagaID string, failedAt SagaState) error {
    o.updateState(sagaID, StateCompensating)
    // Compensate in reverse order
    switch failedAt {
    case StatePaymentCharged:
        o.paymentService.Refund(ctx, sagaID) // ignore error, retry later
        fallthrough
    case StateOrderCreated:
        o.orderService.Cancel(ctx, sagaID)
    }
    return nil
}
```

**Pros:**
- Centralized logic: the full saga flow is in one place, easy to understand and debug
- Easier to add steps (modify orchestrator, not every service)
- Clear state machine for monitoring ("saga X is stuck at payment step")

**Cons:**
- Orchestrator is a potential bottleneck and single point of failure (mitigate with clustering)
- Services become more coupled to the orchestrator's commands
- More infrastructure (orchestrator service, state storage)

Orchestration works well for: complex sagas (5+ steps), when you need visibility into saga progress, teams that prefer explicit workflows.

## System Architecture

The orchestrator is only one box in the real system. Around it sit the state store, the command transport, and the safety nets that make compensation survivable.

```
+------------------+        +--------------------+
|  Client / API    |        |  Saga              |
|  Gateway         +------->|  Orchestrator      |
+------------------+  start +--------------------+
                       saga        |
                                   |  commands (via outbox + broker)
          +------------------------+------------------------+
          |                        |                        |
          v                        v                        v
   +------+------+          +------+------+          +------+------+
   |  Order      |          |  Payment    |          |  Inventory  |
   |  Service    |          |  Service    |          |  Service    |
   +------+------+          +------+------+          +------+------+
          |                        |                        |
          v                        v                        v
   +-------------+          +-------------+          +-------------+
   |  Order DB   |          |  Payment DB |          |  Stock DB   |
   +-------------+          +-------------+          +-------------+
                                   |
                                   v
                          +-------------------+
                          |  Saga State Store |
                          |  (Postgres:       |
                          |   saga_id, state, |
                          |   payload, version)|
                          +-------------------+
                                   |
                          +-------------------+
                          |  DLQ + Admin      |
                          |  Console (manual  |
                          |  intervention)    |
                          +-------------------+
```

Two details carry most of the reliability:

**Transactional outbox.** The orchestrator must update saga state and publish the next command atomically. Writing state to Postgres and then publishing to the broker in two separate steps creates a window where the state says "payment charged" but the command never went out, or where the command went out twice. The outbox pattern fixes this: the orchestrator writes the state change and the outgoing command into the same Postgres transaction, and a relay process publishes outbox rows to the broker. At-least-once delivery with idempotent consumers covers the rest.

**Idempotency keys on every command.** Each saga step carries a deterministic idempotency key (saga_id plus step name). If the orchestrator retries a command after a timeout, the payment service sees the same key and returns the previous result instead of charging twice. Without this, every retry is a potential double charge, and timeouts are guaranteed to happen.

The DLQ and admin console are not optional extras. Poison messages (a command that fails validation every time) must go somewhere other than blocking the saga forever, and a human needs a way to inspect a stuck saga, retry a compensation, or force-complete with approval.

## The Isolation Problem

Sagas do not provide isolation like ACID transactions. Between step 1 (order created) and step 4 (order confirmed), other transactions see the intermediate state.

Example problem: Order is created (step 1). Before payment completes (step 2), another service reads the order and sees status "pending." Is that correct? Depends on your domain.

Strategies:

1. **Semantic locking**: Mark the entity as "in progress" so other operations know not to touch it. The order status "pending_payment" signals that a saga is in flight.
2. **Commutative updates**: Design operations so order does not matter. Incrementing a counter is commutative. Setting a status field is not.
3. **Accept and handle**: For many domains, brief inconsistency is acceptable. The saga completes in seconds. Design readers to handle transitional states gracefully.

There is no perfect solution. This is the fundamental tradeoff of sagas: you give up isolation for availability and partition tolerance.

## Compensation Challenges

**Non-reversible actions:** Some actions cannot be undone. Sending an email, charging a non-refundable fee, triggering a physical shipment. For these, the "compensation" is a business process (send a correction email, issue a credit, initiate a return), not a technical rollback. Involve domain experts in designing compensations.

**Partial compensation failure:** What if the refund API is down when you try to compensate? The saga is stuck in "compensating" state. Design:
- Retry compensations with backoff (they are idempotent, so safe to retry)
- Alert on stuck sagas (a saga in "compensating" for >1 hour needs human attention)
- Manual intervention tools (an admin dashboard to force-complete or force-compensate)

**Compensation ordering:** Always compensate in reverse order of execution. If you created the order then charged the card, refund the card then cancel the order. Reversing this order can leave the system in an inconsistent state.

## Choosing Between Choreography and Orchestration

| Factor | Choreography | Orchestration |
|--------|--------------|---------------|
| Complexity | Better for simple (3-4 steps) | Better for complex (5+ steps) |
| Debuggability | Hard (distributed) | Easy (centralized) |
| Coupling | Loose (events only) | Tighter (orchestrator commands) |
| Single point of failure | No | Yes (mitigate with HA) |
| Team structure | Works with autonomous teams | Works with platform team owning orchestrator |

When in doubt, start with orchestration. It is easier to understand, debug, and modify. Move to choreography only when the orchestrator becomes a genuine bottleneck (rare) or when team autonomy demands it.

## Scalability

The orchestrator itself scales horizontally: keep workers stateless, pull saga steps from a queue, and partition work by hashing saga_id. The bottleneck is the state store. Every state transition is a row write, so saga throughput maps directly to database write throughput.

At 10x, Postgres handles this comfortably with an index on (status, updated_at) for the stuck-saga scanner. Watch connection counts: each orchestrator worker holding a connection adds up, so use a pooler (PgBouncer) once workers exceed a few dozen.

At 100x, partition the state store. Options: partition by time (completed sagas age out), shard by saga_id hash, or both. Archive completed sagas older than N days to cold storage. Nobody queries a completed saga from six months ago at request time, and keeping them in the hot table slows the stuck-saga scans that actually matter.

The failure mode that bites at scale is the **compensation storm**. When a downstream dependency (say, the payment provider) goes down, every in-flight saga starts compensating at once. Thousands of refund calls hit an already struggling provider, and the retry load can exceed normal traffic. Mitigate with a separate worker pool and rate limiter for compensations, so the storm cannot starve forward progress of healthy sagas, and cap retry concurrency per downstream.

For choreography at scale, partition the event bus by saga_id so all events for one saga land in order on the same partition. Ordering across different sagas does not matter; ordering within a saga does.

Capacity inputs: saga completion p50/p99, compensation rate as a fraction of starts, stuck-saga count, state store write latency. If the compensation rate climbs above a few percent, something upstream is unhealthy; treat it as a leading indicator, not just a saga metric.

## Security Considerations

Saga IDs must be unguessable (UUID v4). A predictable saga_id lets an attacker probe another customer's saga state or inject commands into it. Treat saga_id with the same care as a session token.

Authenticate orchestrator-to-service calls with mutual TLS or signed service tokens. A forged "refund this payment" command is a money printer. Every command should carry the saga_id, the step, and a signature the service can verify.

Compensations are privileged operations. Refund and cancel endpoints must require stronger authentication than normal read paths and must write to an immutable audit trail: who triggered the compensation, which saga, what amount, when. Payment auditors care about this, and reconstructing it after the fact is painful.

Lock down the event bus. Services should subscribe only to the topics they need, and publishing rights should be narrow: a compromised inventory service must not be able to publish `PaymentCharged`. Most message brokers support per-topic ACLs; use them.

Replay protection matters because at-least-once delivery is the norm. Idempotency keys (from the architecture section) mean a replayed `OrderCreated` returns the existing result instead of double-charging. Test this explicitly: replay every event type in staging and confirm no duplicate side effects.

The admin console needs its own authorization. Force-complete and force-compensate are break-glass operations: require a separate role, require a reason string, and log every action with operator identity. If someone force-completes a saga that should have compensated, you need to know who and why.

## Production Checklist

Dashboards: saga count by state (the state machine from the orchestration section becomes a stacked graph), completion latency p50/p99, compensation rate, and stuck sagas (in a non-terminal state longer than the SLA). The stuck-saga panel is the one you will stare at during incidents.

Alerts: a saga in compensating state for more than 30 minutes; any single compensation retried more than 5 times; DLQ depth growing over 15 minutes. Each of these means a human needs to look.

Runbooks: the stuck-saga playbook (inspect state, check downstream health, retry the compensation manually, force-complete with approval if the business side is already resolved). Write it before the first incident, not during.

Chaos tests: kill an orchestrator worker mid-saga and verify another worker picks it up with no duplicate commands (this validates the outbox plus idempotency pairing). Take down the payment service during a compensation wave and verify retries with backoff, no duplicate refunds, and exactly one alert instead of hundreds.

The 3am scenario: the refund API returns 500s for an hour. Sagas pile up in compensating state. What you want: automatic retries with backoff, zero duplicate refunds, one alert (not four hundred), and a morning reconciliation report listing every saga that needs a human decision. If your system cannot produce that report, add it before the outage teaches you why.
