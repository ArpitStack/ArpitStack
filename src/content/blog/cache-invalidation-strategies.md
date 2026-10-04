---
title: "Cache Invalidation for Distributed Systems: Strategies That Work"
date: "2026-10-26"
tags: ["Caching", "Distributed Systems", "Redis", "Architecture"]
description: "Practical cache invalidation strategies for distributed systems: write-through, TTL, event-driven invalidation, and stampede protection."
readingTime: 11
---

"There are only two hard things in computer science: cache invalidation and naming things." Everyone quotes it. Few discuss what actually works in production when you have 20 services sharing cached data.

This post covers the strategies that hold up: when to use each, what breaks, and how to handle the failure modes.

## The Strategies

### Cache-Aside (Lazy Loading)

The application checks the cache first. On miss, it reads from the database, populates the cache, and returns.

```go
func (s *Service) GetUser(ctx context.Context, id string) (*User, error) {
    // Try cache first
    if user, err := s.cache.Get(ctx, "user:"+id); err == nil {
        return user, nil
    }
    // Cache miss: load from DB
    user, err := s.db.GetUser(ctx, id)
    if err != nil {
        return nil, err
    }
    // Populate cache for next time
    s.cache.Set(ctx, "user:"+id, user, 5*time.Minute)
    return user, nil
}
```

**Pros:** Simple, only caches what is actually requested.
**Cons:** First request after expiry is slow (cache miss penalty). Invalidation is manual.

This is the default for most applications. Start here.

### Write-Through

Writes go to cache and database simultaneously (or cache first, then database).

**Pros:** Cache is always fresh. No stale reads.
**Cons:** Every write pays the cache latency cost. If the cache is down, writes fail or need fallback logic.

Use when: read-after-write consistency is critical and write volume is moderate.

### Write-Behind (Write-Back)

Writes go to cache immediately, database is updated asynchronously.

**Pros:** Very fast writes.
**Cons:** Risk of data loss if cache fails before the database write completes. Complex to implement correctly.

Use when: write throughput matters more than durability guarantees (counters, session data). Never for financial data.

### TTL-Based Expiry

Set a time-to-live on every cache entry. Data becomes stale for at most the TTL duration.

```go
// Short TTL for frequently changing data
s.cache.Set(ctx, "stock-price:"+symbol, price, 30*time.Second)

// Long TTL for stable data
s.cache.Set(ctx, "user-profile:"+id, profile, 1*time.Hour)
```

**Pros:** Self-healing. No invalidation logic needed. Simple to reason about.
**Cons:** Serves stale data for up to TTL. Short TTLs reduce cache hit rates.

The pragmatic default: TTL for everything, with TTL duration matched to how stale the data can be. User profiles: 1 hour is fine. Stock prices: 30 seconds max. Feature flags: 1 minute.

## Event-Driven Invalidation

When data changes, publish an event. Cache holders subscribe and invalidate.

```
Order Service --(OrderUpdated event)--> [Event Bus] --> Cache Invalidator
                                                        --> DELETE cache:user:123
                                                        --> DELETE cache:orders:user:123
```

**Pros:** Near-real-time consistency. No stale reads beyond event propagation delay (usually milliseconds).
**Cons:** More infrastructure (event bus, invalidation service). Must handle event ordering and duplicates.

This is the right approach when: multiple services cache the same data, and stale reads cause real problems (pricing, inventory, permissions).

Implementation pattern:

```go
func (i *Invalidator) handleOrderUpdated(ctx context.Context, event OrderEvent) error {
    // Invalidate all cache keys related to this order
    keys := []string{
        "order:" + event.OrderID,
        "orders:user:" + event.UserID,
        "order-summary:" + event.OrderID,
    }
    return i.cache.Del(ctx, keys...)
}
```

Keep a mapping of event types to affected cache key patterns. This mapping is documentation that prevents stale cache bugs.

## Cache Stampede Protection

When a popular cache key expires, hundreds of requests miss simultaneously and hammer the database. This is a cache stampede (also called dogpiling).

**Probabilistic early expiry:** Refresh the cache before TTL expires, with some randomness to prevent synchronized refreshes.

```go
func (s *Service) GetWithStampedeProtection(ctx context.Context, key string) (*Data, error) {
    data, ttl, err := s.cache.GetWithTTL(ctx, key)
    if err == nil {
        // If TTL is almost expired, refresh in background (probabilistically)
        if ttl < 10*time.Second && rand.Float64() < 0.1 {
            go s.refreshCache(key) // background refresh, don't block
        }
        return data, nil
    }
    // Cache miss: use singleflight to prevent stampede
    return s.singleflight.Do(key, func() (*Data, error) {
        return s.loadAndCache(ctx, key)
    })
}
```

**Singleflight** (Go's `golang.org/x/sync/singleflight`): When 100 requests miss the cache simultaneously, only one actually queries the database. The other 99 wait for the result. This is the single most effective stampede protection.

```go
var group singleflight.Group

func (s *Service) GetUser(ctx context.Context, id string) (*User, error) {
    v, err, _ := group.Do("user:"+id, func() (interface{}, error) {
        // Only one goroutine executes this for a given key
        // Others wait and share the result
        return s.loadUserFromDB(ctx, id)
    })
    if err != nil {
        return nil, err
    }
    return v.(*User), nil
}
```

## Distributed Cache Coherence

With multiple application instances each having local caches, invalidation gets harder. Options:

1. **No local cache, only shared** (Redis): Simpler coherence (one source of truth), but every cache access is a network call.
2. **Local + shared with pub/sub invalidation**: Local cache for speed, Redis pub/sub to broadcast invalidations. More complex but lower latency.
3. **Short TTL on local, longer on shared**: Local cache expires quickly (10s), shared cache holds longer (5min). Bounded staleness with good performance.

For most systems: start with shared Redis only. Add local caching only when Redis latency becomes measurable in your p99.

## What Breaks in Production

**Cold start:** After a deploy or cache flush, every request is a miss. Warm the cache gradually (canary deploys help) or accept the initial latency spike.

**Cache key collisions:** Two different data types using the same key format. Namespace your keys: `user:123`, `order:123`, never just `123`.

**Unbounded growth:** Cache without TTL or eviction policy grows until the instance runs out of memory. Always set maxmemory and an eviction policy (allkeys-lru is usually right) in Redis.

**Silent inconsistency:** The hardest bug. Cache says X, database says Y, and no one notices for hours. Mitigation: periodic reconciliation jobs that compare cache against source of truth for critical data.

## Cache Warming Strategies

After a deploy, cache flush, or cold start, the cache is empty. Every request hits the database until the cache repopulates. Warming strategies reduce this pain.

**Lazy warming (default):** Let the cache populate organically as requests arrive. Simple, but the first users after a deploy experience slow responses. Acceptable for most applications.

**Proactive warming:** After deploy, a background job pre-populates the cache with the most frequently accessed keys. Identify hot keys from access logs (top 1000 keys by request count). Warm them before routing traffic to the new instances.

```go
func warmCache(ctx context.Context, cache Cache, db Database) error {
    // Get most accessed keys from last 24h
    hotKeys := analytics.TopKeys(ctx, 1000, 24*time.Hour)
    for _, key := range hotKeys {
        data, err := db.Get(ctx, key)
        if err != nil {
            continue // skip failures, lazy loading will handle
        }
        cache.Set(ctx, key, data, defaultTTL)
    }
    return nil
}
```

**Canary warming:** Deploy to 10% of instances first. Let them warm their caches from real traffic. Then roll out to the rest. This spreads the cold-start penalty and validates the new version before full rollout.

**Stale-while-revalidate:** Serve slightly stale data while refreshing in the background. The user gets a fast response (even if 30 seconds old), and the cache updates for the next request. This pattern eliminates the cache miss penalty entirely for read-heavy workloads.

## System Architecture

```
+----------+     +------------------+     +----------+
| App      +---->| Redis Cluster    +---->| Database |
| instance |     | 3 masters,       |     | (source  |
| 1..N     |     | hash slots       |     |  of      |
| (opt.    |     | 0-16383,         |     |  truth)  |
|  local   |     | replicas each)   |     +----------+
|  LRU)    |     +--------+---------+
+----+-----+              ^  (a) cache-aside / read-through
     |                    |
     |  (b) pub/sub       |
     v  invalidations     |
+-----------------------------------------+
| Event bus: OrderUpdated -> DEL          |
| order:{id}, orders:user:{uid},           |
| order-summary:{id}                      |
+-----------------------------------------+
```

Two paths, kept separate on purpose. Path (a): reads go to Redis first (or a local LRU, then Redis); misses fall through to the database and repopulate. Path (b): writes publish domain events; an invalidator subscribes and deletes the affected key patterns. The read path never waits on the write path, which is why event-driven invalidation adds no latency to writes. The mapping of event types to key patterns is the critical documentation: it is the only thing standing between you and silent inconsistency.

## Scalability

Redis Cluster scales throughput by adding masters (hash slots redistribute); reads scale by adding replicas per master. One caveat: command execution is effectively single-threaded per instance (version 6 added threaded I/O for networking, not for command processing), so a hot key pins one core. More masters do not fix a hot key; key splitting, client-side local caching, or read replicas do.

Hot keys deserve their own monitoring: track operations per key prefix. A single key at 100k ops/s will bottleneck long before the cluster does. Mitigations: a local LRU with a 5 to 10 second TTL in each app instance, key replication (`key:1`, `key:2`, pick randomly), or a CDN for truly hot read-mostly data.

At 10x: cluster mode, replicas per master, `maxmemory` at roughly 75 percent of instance RAM, and an eviction policy that matches your access pattern (allkeys-lru for cache-aside).

At 100x: multi-region. Active-passive with async replication means cross-region reads are stale by the replication lag; active-active (CRDT-based) resolves conflicts but adds real complexity. Most teams overestimate the need: start with region-local caches and accept cross-region misses, and only pay for active-active when the latency math demands it.

Capacity planning: memory equals working set times 1.5 (fragmentation and overhead are real); network equals hit traffic, not just database traffic (cache hits still cost bandwidth, so size NICs for it); connections equal app instances times pool size.

Stampede at scale: singleflight per instance is not enough when 50 instances miss together (that is 50 database queries, not one). Layer probabilistic early refresh with a shared refresh lock in Redis (SET NX with a short TTL) so exactly one instance rebuilds the key.

Staff-level questions: why is TTL usually enough? (Because bounded staleness is a business decision, and most data has a natural staleness budget; event-driven invalidation is for the data where stale reads cause real damage.) Do you cache misses? (Negative caching: cache the miss with a short TTL, or repeated lookups of nonexistent keys become a database DoS. Keep the TTL short so resurrected data appears quickly.)

## Security Considerations

Never expose Redis to the internet. Unauthenticated Redis on port 6379 is one of the oldest breach patterns in the industry and it still happens. Bind to the VPC, security group to the app tier only, AUTH plus TLS.

Redis 6 and later support ACLs: give each service a user restricted to its key patterns (`user:*` for the user service). A compromised service then poisons only its own namespace instead of the whole cache.

Encrypt sensitive values before caching (session tokens, PII); the TTL doubles as a retention bound, which is worth documenting for privacy reviews. If cache keys derive from user input, sanitize them and namespace per tenant: an attacker who can write arbitrary keys can poison reads for other tenants.

Do not log cache values in debug logs. The cache holds the same PII as the database, with fewer access controls around it.

## Production Checklist

Monitor: hit rate per key prefix (a sudden drop means an invalidation bug or an upstream format change), evictions per second (sustained evictions mean undersized memory), memory usage, command latency p99, replication lag, connected clients.

Alerts: hit rate down more than 10 points for 15 minutes; memory over 80 percent; sustained evictions; master failover events; replication lag over 5 seconds.

Runbooks: Redis master down means a replica promotes; test quarterly. Memory full: verify the eviction policy is actually set, then add memory or shorten TTLs. Accidental full flush: warm via canary, accept elevated database load, enable singleflight plus refresh locks, and temporarily raise database connection limits. Key format changes: version your keys (`v2:user:{id}`) so a deploy that changes serialization does not poison the cache with unreadable entries.

What breaks at 3am: failover during a write-heavy period (seconds of errors; clients must retry with backoff, which is why every cache client needs retry logic); cold start after a deploy flushes the cache (warm gradually, do not flip all traffic at once); a deploy that changes key formats without versioning, so old and new entries coexist and half your reads deserialize garbage.
