---
title: "Designing Idempotent APIs: Handling Retries Without Duplication"
date: "2026-12-21"
tags: ["APIs", "System Design", "Reliability"]
description: "How to design APIs that safely handle retries: idempotency keys, exactly-once myths, and implementation patterns that work."
readingTime: 13
---

Networks are unreliable. Clients retry. Load balancers retry. Your own code retries. If your API creates a new order every time it receives a request, retries become duplicate charges, duplicate shipments, and angry customers.

Idempotent APIs handle the same request multiple times without side effects. This post covers how to design them.

## What Idempotent Means

An operation is idempotent if applying it multiple times has the same effect as applying it once.

- `DELETE /users/123` is idempotent. Deleting twice is the same as deleting once.
- `GET /users/123` is idempotent. Reading does not change state.
- `POST /orders` is NOT idempotent by default. Each POST creates a new order.
- `PUT /users/123` with full state is idempotent. Setting the same values twice is harmless.

The challenge is making non-idempotent operations (usually POSTs that create resources) safe to retry.

## System Architecture

The idempotency check sits in front of your business logic, backed by two layers:

```
+----------+     +------------------+     +-------------------+
| Client   |---->| API Server       |---->| Idempotency Store |
| (sends   |     | 1. Validate key  |     | (Redis: key ->    |
|  key)    |     | 2. Check store   |     |  status + result) |
+----------+     | 3. Acquire lock  |     +--------+----------+
                 | 4. Execute       |              |
                 | 5. Store result  |              v
                 +--------+---------+     +-------------------+
                          |               | Primary Database  |
                          +-------------->| (UNIQUE on       |
                                          |  idempotency_key)|
                                          +-------------------+
```

Two layers, because each covers the other's failure mode. The idempotency store (Redis) is the fast path: a key lookup on every request, typically under a millisecond. The database unique constraint is the backstop: if the store is unavailable or a key expired early, the constraint still prevents a duplicate row. Neither layer alone is sufficient. The store alone loses keys on failover. The constraint alone turns every duplicate into an exception-path database hit and cannot return the original response body.

The lock only needs to cover the check-and-execute window for a single key. A distributed lock (Redis with a short TTL, or a database advisory lock) scoped to the key serializes concurrent duplicates. Keep the lock TTL short (a few seconds) and the critical section small: check, execute, store, release. If the lock cannot be acquired, the request should wait briefly and re-check the store rather than failing, because the most likely explanation is that another request with the same key is mid-execution.

## Idempotency Keys: The Standard Pattern

The client generates a unique key for each logical operation and sends it with the request. The server stores the key with the result. If the same key arrives again, the server returns the stored result instead of re-executing.

```http
POST /api/orders
Idempotency-Key: abc-123-def-456

{"product_id": "prod_789", "quantity": 2}
```

Server logic:

```go
func (h *Handler) CreateOrder(w http.ResponseWriter, r *http.Request) {
    key := r.Header.Get("Idempotency-Key")
    if key == "" {
        http.Error(w, "Idempotency-Key required", 400)
        return
    }

    // Check if we have seen this key
    if result, found := h.store.Get(key); found {
        // Return the stored result, do not re-execute
        w.Header().Set("Idempotent-Replayed", "true")
        json.NewEncoder(w).Encode(result)
        return
    }

    // Lock to prevent concurrent execution with same key
    lock := h.locker.Acquire(key)
    defer lock.Release()

    // Double-check after acquiring lock
    if result, found := h.store.Get(key); found {
        json.NewEncoder(w).Encode(result)
        return
    }

    // Execute the operation
    order, err := h.createOrder(r)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }

    // Store result with key (with TTL, e.g., 24 hours)
    h.store.Set(key, order, 24*time.Hour)
    json.NewEncoder(w).Encode(order)
}
```

Key points:

1. **Client generates the key.** Usually a UUID. The client must reuse the same key across retries of the same logical operation.
2. **Lock before executing.** Two concurrent requests with the same key must not both execute. The lock ensures only one proceeds.
3. **Store the result, not just the key.** On replay, return the original response (same status code, same body).
4. **TTL on keys.** Store for 24 hours, not forever. After TTL, a retry with the same key is treated as new. This bounds storage growth.

## The Exactly-Once Myth

People ask for exactly-once delivery. It does not exist in distributed systems. You get:

- **At-most-once**: Might not deliver. (No retries.)
- **At-least-once**: Will deliver, might duplicate. (With retries.)
- **Effectively-once**: At-least-once delivery plus idempotent processing. This is what you actually build.

Do not promise exactly-once. Design for at-least-once with idempotent handlers. The combination is indistinguishable from exactly-once from the client's perspective.

## Database-Level Idempotency

For operations that must be idempotent at the storage layer:

**Unique constraints:** The database rejects duplicates.

```sql
CREATE TABLE orders (
    id UUID PRIMARY KEY,
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    -- other fields
);
```

If two requests try to insert with the same idempotency key, the second gets a unique violation. Catch it and return the existing record.

**Conditional writes:** Only apply if the current state allows it.

```sql
-- Only transition from pending to confirmed, not from already-confirmed
UPDATE orders
SET status = 'confirmed'
WHERE id = $1 AND status = 'pending';
```

If the row was already confirmed, zero rows are updated. The operation is safe to retry.

## Handling Partial Failures

The tricky case: the operation partially completes, then fails. Example: charge the credit card succeeds, but saving the order to the database fails.

Strategies:

1. **Saga pattern**: Each step has a compensating action. If step 3 fails, undo steps 1 and 2.
2. **Transactional outbox**: Write the business data and the "to-do" record in the same database transaction. A background worker processes the outbox.
3. **State machine**: Model the operation as explicit states (pending, charging, charged, saving, saved). On retry, resume from the last completed state instead of starting over.

The state machine approach is the most robust for complex multi-step operations:

```go
type OrderState string
const (
    StatePending  OrderState = "pending"
    StateCharged  OrderState = "charged"
    StateSaved    OrderState = "saved"
    StateFailed   OrderState = "failed"
)

func (s *Service) processOrder(ctx context.Context, orderID string) error {
    order := s.getOrder(ctx, orderID)

    switch order.State {
    case StatePending:
        if err := s.chargeCard(ctx, order); err != nil {
            return s.transitionTo(orderID, StateFailed)
        }
        s.transitionTo(orderID, StateCharged)
        fallthrough
    case StateCharged:
        if err := s.saveOrder(ctx, order); err != nil {
            return err // will retry from StateCharged
        }
        s.transitionTo(orderID, StateSaved)
    case StateSaved:
        return nil // already done
    }
    return nil
}
```

Each step is idempotent on its own. The state machine ensures forward progress without repeating completed steps.

## Client Responsibilities

Idempotency is a contract between client and server:

- **Client must**: Generate unique keys per logical operation. Reuse the same key on retry. Not reuse keys across different operations.
- **Server must**: Honor the key. Return consistent results. Handle concurrent duplicate requests.

Document this clearly. The most common bug is clients generating a new key on each retry, which defeats the entire mechanism.

## Scalability

At 10x traffic, a single Redis instance handles the idempotency store without complaint. Key lookups are O(1), lock contention is negligible, and a 24-hour TTL bounds storage growth. The thing to watch is latency: the idempotency check adds a network round trip to every request, so keep the store in the same region and availability zone as the API servers.

At 100x, four problems appear.

Hot keys: a misbehaving client retrying aggressively with the same key hammers one Redis key and its lock. Mitigate with short lock TTLs and backoff on lock acquisition failure, and alert on per-key request rates so you can contact the client.

Memory growth: at 10 million operations per day with 2KB stored responses, the store churns 20GB per day. Redis handles this with a volatile-ttl eviction policy, but size the instance for peak plus headroom, and consider storing only a status plus the response in object storage for large payloads.

Cluster topology: Redis Cluster hashes keys across slots, which works fine because lookups are always by exact key. There is no cross-slot operation in the hot path. Avoid Lua scripts that touch multiple keys.

Cross-region keys: the store must be visible wherever the request lands. Three options, from simplest to hardest. Pin requests by key hash so the same key always routes to the same region. Replicate the store asynchronously and accept a small duplicate window during failover. Run a global active-active store and handle write conflicts. Most teams should pick option one; consistent hashing on the key at the load balancer is straightforward and eliminates the consistency problem entirely.

The database backstop scales differently. A unique index on idempotency_key grows with the table; use a partial index on recent rows or partition by time so the hot index stays small. At very high write rates the constraint check itself becomes load, which is exactly why the Redis layer absorbs duplicates first.

One more scaling tradeoff: you can drop the Redis layer entirely and rely on the database (insert the key row with status in_progress first; a unique violation means duplicate). Fewer moving parts, slightly higher database load, and every duplicate becomes an exception-path write. This is a reasonable choice up to moderate scale and a meaningful simplification for small teams.

TTL choice is itself a scaling and correctness tradeoff. A 24-hour TTL bounds storage and keeps replayed responses fresh, but a client retrying after 25 hours creates a duplicate. Money-movement endpoints often use longer TTLs (72 hours or more) with archival to cold storage, because the cost of a duplicate charge dwarfs the cost of storage. Shorter TTLs suit high-volume, low-stakes operations. Tier the TTL by endpoint criticality rather than using one value everywhere.

## Testing Idempotency

Idempotency is easy to claim and hard to verify. Build tests that prove it.

**Duplicate request test:** Send the same request (same idempotency key) twice concurrently. Assert only one resource was created and both responses are identical.

```go
func TestIdempotentCreate(t *testing.T) {
    key := uuid.New().String()
    var wg sync.WaitGroup
    results := make([]*Order, 2)

    for i := 0; i < 2; i++ {
        wg.Add(1)
        go func(idx int) {
            defer wg.Done()
            results[idx] = createOrderWithKey(t, key)
        }(i)
    }
    wg.Wait()

    // Both should succeed with the same order ID
    assert.Equal(t, results[0].ID, results[1].ID)
    // Only one order in database
    assert.Equal(t, 1, countOrders(t))
}
```

**Chaos test:** Kill the server mid-request (after the operation but before the response). Retry with the same key. The retry should return the original result, not create a duplicate.

**Key collision test:** Verify that different keys produce different resources, and that expired keys (after TTL) are treated as new operations.

Run these in CI. Idempotency regressions are silent and expensive.

**Load test with duplicates:** Under realistic traffic, inject 5% duplicate requests (same keys replayed). Measure that the duplicate rate in the database stays at zero and p99 latency does not degrade. This catches lock contention issues in the idempotency check path.

**Cross-region test:** If you run in multiple regions, verify that an idempotency key created in one region is honored in another. This requires the idempotency store to be globally consistent or replicated with low lag. Test the failover scenario explicitly.

## Security Considerations

Idempotency keys are not an authentication mechanism. Anyone holding a valid key can replay it and receive the original response, which may contain payment details or personal data. Scope keys to the authenticated account: a key created by account A must never return account B's data, and ideally must not be accepted on account B's requests at all.

Key entropy matters. Require client-generated UUIDs (version 4). Predictable keys let attackers probe for existence: replaying a guessed key and observing whether they get a stored response versus an error is an oracle. For sensitive flows, make the replay response indistinguishable from a fresh not-found error to unauthenticated callers.

Stored responses inherit the sensitivity of the original data. Encrypt the idempotency store at rest, and make sure data deletion requests cascade to it. A deletion request that removes the order but leaves the full order JSON in the idempotency store is a compliance incident.

One subtle risk: never let the idempotency mechanism change error semantics. If the original request failed with a 500 and no result was stored, a retry must re-execute, not return the error. Only store and replay successful results, plus a small set of deterministic client errors (like 422 validation failures) if you are certain re-execution would produce the identical response.

## Production Checklist

**Metrics:**

- Replay rate: replays divided by total requests. Healthy systems sit at 1 to 5 percent. A sudden spike means client retry bugs or network trouble; a rate near zero with duplicate complaints means clients are generating new keys per retry.
- Duplicate creation rate: must be zero. Alert on any nonzero value; it means the mechanism failed.
- Idempotency store latency p99 (target under 5ms) and lock wait time
- Store memory usage and eviction rate
- Key TTL expiry distribution (confirms TTLs are actually applied)

**Alerts:**

- Any duplicate resource created with an existing key: page. This is the one failure the whole design exists to prevent.
- Store latency p99 above 100ms for 5 minutes: warn. Every request pays this tax.
- Store memory above 80 percent: warn. Evictions will start dropping keys early.
- Replay rate spike above 20 percent: warn. A client is misbehaving or a network event is underway.

**Runbooks:**

- Client generating a new key per retry: detectable via near-zero replay rate plus duplicate complaints. The fix is on the client side; the runbook covers how to confirm from your logs and what to tell the client team.
- Response schema drift: you deploy a new response shape, but replays return the old stored shape for up to the TTL. Version the stored payload, or store only the resource ID and re-fetch on replay. Pick one and document it.
- Store outage: decide in advance whether to fail open (process without deduplication, accept duplicate risk, alert loudly) or fail closed (reject requests). Money-movement endpoints usually fail closed; analytics ingestion usually fails open. This decision must be per endpoint, made calmly, not at 3am.

**What breaks at 3am:** Redis fails over during a traffic spike and drops a few seconds of keys. Retries in that window find no stored result and re-execute. The database unique constraint catches the ones that would duplicate, returning the existing row. You get paged for the failover, not for duplicate charges, which is exactly why the backstop exists. The incident review the next day focuses on why the failover dropped writes, not on customer impact, because there was none.
