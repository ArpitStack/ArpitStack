---
title: "Distributed Locking: Redis Redlock, Zookeeper, and When You Need Them"
date: "2026-12-03"
tags: ["Distributed Systems", "Redis", "Concurrency"]
description: "When distributed locks are necessary, how Redlock and Zookeeper work, fencing tokens, and the alternatives you should consider first."
readingTime: 12
---

Two instances of your service try to process the same job. Both check "is this job already being processed?" Both see "no." Both process it. Duplicate charges, duplicate emails, corrupted state. You need mutual exclusion across processes. You need a distributed lock.

But first: you probably do not need a distributed lock. This post covers when you do, how the main algorithms work, and what to use instead.

## Do You Actually Need a Lock?

Before reaching for distributed locking, consider:

1. **Can the operation be idempotent?** If yes, duplicates are harmless. No lock needed.
2. **Can you use a database constraint?** Unique indexes prevent duplicates without locks.
3. **Can you partition the work?** If each instance handles a disjoint subset (by hash of job ID), no coordination is needed.
4. **Can you use a queue?** Message queues (SQS, Kafka) provide at-least-once delivery with visibility timeouts. Often sufficient.

Use distributed locks when: the operation is not naturally idempotent, cannot use database constraints (cross-system coordination), and partitioning is not possible (leader election, singleton tasks).

## Redis Redlock

Redlock is the most common distributed lock algorithm using Redis. The idea: acquire the lock on a majority of independent Redis instances.

```go
func (r *Redlock) Acquire(resource string, ttl time.Duration) (*Lock, error) {
    // Generate unique lock value (prevents deleting someone else's lock)
    value := uuid.New().String()

    // Try to acquire on majority of Redis instances
    successes := 0
    for _, client := range r.clients {
        ok, err := client.SetNX(resource, value, ttl).Result()
        if err == nil && ok {
            successes++
        }
    }

    quorum := len(r.clients)/2 + 1
    if successes >= quorum {
        return &Lock{resource: resource, value: value}, nil
    }

    // Failed to get quorum, release partial acquisitions
    r.releasePartial(resource, value)
    return nil, errors.New("failed to acquire lock")
}
```

**Why multiple instances?** A single Redis is a single point of failure. If it goes down, either no one can acquire locks (system halts) or locks are lost (safety violated). Multiple independent instances mean the system tolerates minority failures.

**The controversy:** Martin Kleppmann famously critiqued Redlock, arguing it is not safe under certain timing assumptions (clock jumps, long GC pauses). The Redis author responded. The debate is nuanced, but the practical takeaway: Redlock is fine for efficiency (avoiding duplicate work) but not for correctness (preventing data corruption). If a lock failure means data loss, use something stronger.

## Fencing Tokens: Making Locks Safe

The core problem with any lock: what if the holder pauses (GC, network partition) past the TTL, the lock expires, someone else acquires it, then the original holder wakes up and acts as if it still holds the lock?

**Fencing tokens** solve this. Each lock acquisition returns a monotonically increasing token. The resource being protected rejects operations with stale tokens.

```go
// Lock acquisition returns a fencing token
lock, token, err := redlock.Acquire("payment-processor", 30*time.Second)
// token = 42

// When accessing the protected resource, include the token
// The resource tracks the highest token seen and rejects lower ones
func (s *Storage) WriteWithFence(token int64, data []byte) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    if token <= s.maxTokenSeen {
        return errors.New("stale fencing token, rejecting write")
    }
    s.maxTokenSeen = token
    return s.write(data)
}
```

Even if two processes both believe they hold the lock, only the one with the higher fencing token can write. The stale holder's writes are rejected.

This requires the protected resource to participate in fencing. For databases, use the token as part of a conditional write.

## System Architecture

A lock is rarely just a Redis call. In production it is four pieces working together: the clients competing for the lock, the quorum of lock servers, the fencing token store, and the protected resource. The token store is the piece teams skip, and it is the piece that saves you when timing assumptions break.

```
+----------------+     +----------------+     +----------------+
|  API Instance  |     |  API Instance  |     |  Cron Worker   |
|       A        |     |       B        |     |                |
+-------+--------+     +-------+--------+     +-------+--------+
        |                      |                      |
        |  SET resource NX     |  SET resource NX     |  acquire
        |  with unique value   |  with unique value   |  attempt
        v                      v                      v
+-------+--------+     +-------+--------+     +-------+--------+
|  Redis Node 1  |     |  Redis Node 2  |     |  Redis Node 3  |
|  (independent) |     |  (independent) |     |  (independent) |
+-------+--------+     +-------+--------+     +-------+--------+
        |                      |                      |
        +----------+-----------+-----------+----------+
                   |  quorum = 2 of 3
                   v
        +-----------------------+
        |  Fencing token store  |
        |  (per-resource        |
        |   monotonic counter)  |
        +-----------------------+
                   |
                   |  write only if token is newer
                   v
        +-----------------------+
        |  Protected resource   |
        |  (DB row, file, API)  |
        +-----------------------+
```

How a request flows:

1. The client generates a unique value (a UUID) and attempts `SET resource value NX PX ttl` on each Redis node. The unique value matters: only the holder can release or renew its own lock, which stops one client from deleting another client's lock.
2. If a majority acknowledges, the client computes **validity time**: the TTL minus the time the acquisition took, minus a clock-drift margin. If validity time is near zero, it releases the partial locks and retries. This detail comes straight from the Redlock spec, and most hand-rolled implementations skip it. Skipping it means a slow acquire can hand you a lock that is already expired.
3. Before touching the protected resource, the client fetches the next fencing token and includes it in every write. The resource rejects stale tokens, so even a zombie holder that outlives its TTL cannot corrupt state.
4. A watchdog goroutine renews the TTL at one-third intervals while work continues. If renewal fails twice in a row, the client aborts the operation instead of working unlocked. Continuing without the lock is how duplicates happen.

A monitoring sidecar records every acquire, release, and renewal failure with the resource name as a label. You will want this the first time a job runs twice at 3am and nobody can explain why.

Interview note: if someone asks why not just use one Redis with persistence, the answer is failover. If the primary dies after granting a lock but before replicating it, the promoted replica grants the same lock to someone else. Two holders, no fencing, corrupted state. The quorum exists so that scenario requires a majority failure, not a single one.

## Zookeeper/etcd: Stronger Guarantees

Zookeeper and etcd provide consensus-based coordination with stronger safety guarantees than Redlock.

**How it works:** Create an ephemeral sequential node under a lock path. The client with the lowest sequence number holds the lock. Others watch the preceding node. When the holder disconnects (session expires), its ephemeral node is deleted, and the next client acquires the lock.

**Advantages over Redlock:**
- Session-based: if the client disconnects, the lock is automatically released (no TTL timing issues)
- Stronger consistency: ZAB (Zookeeper) and Raft (etcd) provide linearizable operations
- Built-in watch mechanism: efficient notification when the lock becomes available

**Disadvantages:**
- More operational complexity (running a Zookeeper/etcd cluster)
- Lower throughput than Redis (consensus is expensive)
- Session timeout tuning is critical (too short causes false lock loss, too long delays failover)

**When to choose:** Leader election, configuration management, service discovery. Anywhere correctness matters more than raw speed.

```go
// etcd leader election (simplified)
// The etcd client library handles sessions and watches
session, _ := concurrency.NewSession(etcdClient, concurrency.WithTTL(10))
election := concurrency.NewElection(session, "/my-lock/")

// Campaign blocks until this instance becomes leader
if err := election.Campaign(ctx, "instance-id"); err != nil {
    log.Fatal(err)
}
// Now holding the lock. Do protected work.
defer election.Resign(ctx)
```

## Lease Renewal: The Devil in the Details

Locks have TTLs. If your operation takes longer than the TTL, the lock expires mid-operation. Solutions:

1. **Set TTL generously.** If operations take 10 seconds, set TTL to 60 seconds. Simple but wastes time on failure detection.
2. **Background renewal.** A goroutine extends the TTL while the operation runs. If the process crashes, renewal stops and the lock expires.

```go
func (l *Lock) startRenewal(ctx context.Context) {
    ticker := time.NewTicker(l.ttl / 3) // renew at 1/3 TTL intervals
    defer ticker.Stop()
    for {
        select {
        case <-ticker.C:
            l.redis.Expire(l.resource, l.ttl)
        case <-ctx.Done():
            return
        }
    }
}
```

Renew at 1/3 of TTL. This gives two renewal attempts before expiry even if one fails.

**Critical:** Stop renewal when the operation completes. And handle the case where renewal fails (network partition): abort the operation rather than continuing without the lock.

## Scalability

Redis is single-threaded per node and `SET NX` is O(1), so one node handles tens of thousands of lock operations per second without trying. At 10x load, the lock server is rarely the bottleneck. Contention on the same key is.

Contention is a queueing problem, not a hardware problem. If 50 workers fight for one lock with a 30-second TTL, the 50th worker waits roughly 25 minutes. No amount of Redis scaling fixes that. The fixes are: shorten the critical section, split the resource into finer-grained locks, or redesign so workers do not compete at all (partitioning, from the first section of this post).

At 100x, shard locks across multiple independent Redis clusters by resource prefix (`locks:payments:*` on one cluster, `locks:jobs:*` on another). This keeps the quorum math simple per cluster and isolates failures: a payments lock outage does not freeze background jobs.

For Zookeeper and etcd, know the ceiling. Raft-based writes top out around 10k operations per second for the whole cluster, and every lock acquire is a write. That is fine for leader election (a few operations per minute) and terrible for per-request locking. Choose etcd for correctness-critical, low-frequency coordination, not for hot paths.

Renewal traffic is the hidden load. With 10,000 concurrent locks, a 30-second TTL, and renewal at one-third intervals, holders issue about 1,000 renewal writes per second in the background. Budget for it in capacity planning, and make sure renewal failures are visible in metrics instead of silent.

Capacity planning inputs: acquire latency p99, failed-acquire rate (your contention signal), hold-time distribution. Size TTL from p99 operation time multiplied by 3, not from the average. Alert when failed acquires exceed 5% of attempts over 10 minutes. That threshold catches both contention spikes and partial outages early.

## Security Considerations

Lock servers belong on a private subnet with no public exposure. A lock server that anyone on the internet can reach is a lock server anyone can manipulate. Use Redis AUTH and TLS in transit.

Namespace your keys. Prefix every lock key (`lock:v1:{resource}`) so a bug in one service cannot collide with another service's keys. Key collisions across teams are a real incident category.

Release must be value-checked. The release script should be a Lua script that deletes the key only if the stored value matches the caller's value. Without the value check, any client, compromised or buggy, can delete any lock. The unique value from acquisition is not just a nicety; it is the authorization mechanism.

Denial of service by lock hoarding: a misbehaving client that acquires locks and never releases them starves every other client until TTL expiry. Mitigate with maximum TTL caps and per-client lock quotas, and make lock hold time a monitored metric so hoarders show up on a dashboard before they cause an outage.

For etcd, enable RBAC and mutual TLS. Lock paths should be writable only by the services that legitimately compete for them. A service that only reads configuration has no business writing to `/locks/`.

Fencing tokens double as defense in depth. Even if an attacker somehow acquires a lock they should not hold, their writes carry a stale token and the protected resource rejects them. The token check at the resource is the last line of defense, and it does not depend on the lock server being trustworthy.

## Production Checklist

Metrics to export from day one: lock acquire latency (histogram), acquire failures, hold duration, renewal failures, stale token rejections. The last one is the most interesting: a spike in stale token rejections means zombies are waking up and fencing is doing its job. Silence there either means health or means fencing is not wired up. Verify which.

Alerts: renewal failures above zero for five minutes (a holder is about to lose its lock mid-operation); hold time p99 above half the TTL (the TTL is too tight for the workload); acquire failure rate spiking (contention or partial outage).

Runbook for a stuck lock: never delete the key blindly. First confirm the holder is actually dead (health endpoint, process list, recent heartbeats). Only then delete, and record who did it and why. A manual lock deletion without verification is how you create the exact duplicate-processing incident the lock was supposed to prevent.

Test the failure modes, not just the happy path. Run a chaos experiment that skews a holder's clock forward by twice the TTL and verify that fencing tokens prevent corruption. Pause a holder with SIGSTOP past TTL expiry, resume it, and verify its writes are rejected. If either test corrupts state, your fencing is not actually enforced.

The 3am scenario: a Redis node dies during a deploy. With a quorum of three, locking keeps working. Your pager should fire on the node failure, not on lock failures. If lock failures page you first, your quorum math or your client retry logic is wrong, and that is worth knowing at 3pm instead.

## Alternatives Worth Considering

**Database advisory locks** (PostgreSQL): `SELECT pg_advisory_lock(key)`. Simple, no extra infrastructure if you already use Postgres. Not suitable for high-contention scenarios but fine for low-frequency coordination.

**SQS FIFO with message deduplication**: For job processing, SQS FIFO queues with content-based deduplication prevent duplicate processing without explicit locks.

**Optimistic concurrency**: Instead of locking, use version numbers. Read version, modify, write with `WHERE version = <read_version>`. If the write affects zero rows, someone else modified it first. Retry.

The best distributed lock is the one you do not need. Design it away first. Reach for Redlock or Zookeeper only when the alternatives do not fit.
