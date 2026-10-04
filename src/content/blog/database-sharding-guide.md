---
title: "Database Sharding vs Read Replicas: When to Use Which"
date: "2026-11-19"
tags: ["Databases", "System Design", "Scalability", "PostgreSQL"]
description: "A practical decision framework for database scaling: sharding strategies, shard key selection, read replica lag, and when each approach makes sense."
readingTime: 10
---

Your database is slowing down. Queries that took 10ms now take 200ms. The disk is at 80%. Someone suggests sharding. Someone else suggests read replicas. Both are scaling strategies, but they solve different problems. Choosing wrong wastes months.

This post gives you a decision framework, then goes deep on each approach.

## The Decision Framework

**Use read replicas when:** your bottleneck is read throughput. Writes are fine, but SELECT queries are overwhelming the primary. This is the most common case.

**Use sharding when:** your bottleneck is write throughput, dataset size exceeds what one machine handles comfortably, or a single primary cannot keep up even with replicas offloading reads.

**Use both when:** you are at serious scale. Sharded clusters where each shard has its own read replicas.

The key question: is your problem reads or writes? Check your database metrics. If `SELECT` queries dominate and replication lag is manageable, start with replicas. If writes are queuing, the WAL is growing unbounded, or a single table is hundreds of GB, you need sharding.

## Read Replicas: The Easy Win

Read replicas are copies of your primary database that handle read traffic. The primary handles writes, replicas handle reads. Replication is usually asynchronous (a few milliseconds of lag).

**What you get:**
- Horizontal read scaling: add replicas to handle more SELECT queries
- Read isolation: analytical queries do not slow down transactional queries
- Disaster recovery: promote a replica if the primary fails

**What you do not get:**
- Write scaling: all writes still go to one primary
- Strong consistency on reads: replicas lag by milliseconds to seconds

**Handling replication lag in application code:**

```go
// After a write, read from primary to avoid stale reads
func (s *Service) CreateOrder(ctx context.Context, order Order) (*Order, error) {
    if err := s.primary.InsertOrder(ctx, order); err != nil {
        return nil, err
    }
    // Read-your-write: use primary for immediate follow-up read
    return s.primary.GetOrder(ctx, order.ID)
}

func (s *Service) ListOrders(ctx context.Context, userID string) ([]Order, error) {
    // Eventual consistency is fine here, use replica
    return s.replica.ListOrdersByUser(ctx, userID)
}
```

The pattern: use the primary for read-after-write (user creates something, then immediately views it). Use replicas for everything else. Most ORMs and database libraries support this split with minimal code changes.

**Replica lag monitoring:** Alert if lag exceeds your SLA (usually 1-5 seconds). Lag spikes during heavy writes or long-running queries on the replica. If lag is consistently high, you need more replicas or need to move heavy analytical queries elsewhere.

## Sharding: The Hard Win

Sharding splits your data across multiple database instances. Each instance (shard) holds a subset of the data. A sharding key determines which shard holds which row.

**Choosing a shard key** is the most important decision. Good shard keys:

1. **High cardinality**: Many distinct values (user ID, not country code)
2. **Even distribution**: Values spread uniformly (UUIDs are great, sequential IDs cause hotspots on the latest shard)
3. **Query-aligned**: Most queries filter by the shard key (if you shard by user ID, queries like "get all orders for user X" hit one shard)

Bad shard keys cause hotspots. Sharding by `created_at` month means all writes go to the current month's shard. Sharding by a low-cardinality field like `status` means three shards hold all the data.

```sql
-- Good: shard by user_id, queries filter by user_id
SELECT * FROM orders WHERE user_id = 'usr_123';  -- hits one shard

-- Bad: cross-shard query
SELECT * FROM orders WHERE status = 'pending';  -- hits ALL shards, slow
```

**Sharding strategies:**

**Hash sharding**: `shard = hash(shard_key) % num_shards`. Even distribution, but adding shards requires rehashing everything (consistent hashing mitigates this).

**Range sharding**: Shard 1 holds IDs 1-1M, shard 2 holds 1M-2M. Simple, but the latest range gets all writes (hotspot).

**Directory-based**: A lookup service maps keys to shards. Most flexible, but adds a lookup hop to every query.

For most applications, hash sharding with consistent hashing is the right default.

**Cross-shard queries** are the painful part. Joins across shards do not work natively. Options:

1. **Denormalize**: Store redundant data to avoid joins
2. **Application-level joins**: Query each shard, merge in code (slow but works)
3. **Scatter-gather**: Fan out to all shards, aggregate results (only for analytical queries, never in the request path)

Design your schema to minimize cross-shard queries. If a query pattern constantly hits multiple shards, your shard key is wrong.

## Rebalancing: Adding Shards Later

You will need more shards eventually. The process:

1. Provision new shard instances
2. Migrate a subset of data (by hash range) to new shards
3. Update routing (via consistent hashing or directory)
4. Verify, then decommission old shard space

This is operationally complex. Tools like Vitess (for MySQL) or Citus (for PostgreSQL) automate it. If you are sharding PostgreSQL, evaluate Citus before building custom sharding. It handles the routing, rebalancing, and query planning.

## The Middle Path: Partitioning

Before full sharding, consider table partitioning. PostgreSQL native partitioning splits a large table into smaller physical tables (by range or list) while presenting a single logical table.

```sql
CREATE TABLE orders (
    id UUID,
    user_id UUID,
    created_at TIMESTAMPTZ,
    amount DECIMAL
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2026_q1 PARTITION OF orders
    FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
```

Partitioning helps with: query performance (partition pruning skips irrelevant data), maintenance (drop old partitions instead of DELETE), and manageability. It does not help with write throughput (still one primary) or total dataset size limits.

Use partitioning when: tables are large but a single instance still handles the load. It is significantly simpler than sharding.

## System Architecture

```
+--------+     +----------------------+
| App    +---->| Shard Router         |
+--------+     | (Vitess / Citus /    |
               |  app-level routing)  |
               +----+----+----+-------+
                    |    |    |
          +---------+    |    +---------+
          v              v              v
   +------------+ +------------+ +------------+
   | Shard 0    | | Shard 1    | | Shard 2    |
   | primary    | | primary    | | primary    |
   | + 2 repl.  | | + 2 repl.  | | + 2 repl.  |
   +------------+ +------------+ +------------+
        shard = hash(shard_key) % num_shards
```

Write path: the router hashes the shard key and sends the write to exactly one shard's primary. Read path: reads fan out to that shard's replicas (or the primary for read-after-write). The router is the only component that knows the sharding topology; the app just sends queries with the shard key attached. With Vitess, the router is the vtgate proxy; with Citus, the coordinator node; hand-rolled, it is a library in your app (which means every app reimplements it, which is why the proxies exist).

## Scalability

Read scaling first: replicas add read throughput roughly linearly, until the primary's WAL-sending capacity or network becomes the limit (each replica costs the primary). Past roughly 5 to 10 replicas, switch to cascading replicas (a replica streaming from another replica) instead of hanging everything off the primary.

Write scaling is what sharding buys: total write throughput is roughly shards times per-shard throughput. At 10x write growth on a single primary, check vertical scaling first; a bigger machine is cheaper than a sharding project until it is not. The honest trigger for sharding is sustained write pressure that vertical scaling cannot absorb at a sane price, or a dataset that no longer fits comfortably on one machine.

The connection explosion is the scaling problem nobody forecasts: app instances times pool size times shard count. Fifty app instances with a 20-connection pool against 16 shards is 16,000 connections. Run PgBouncer in transaction-pooling mode in front of every shard once you pass a handful of shards; without it, connection overhead eats the primary.

At 100x: resharding. With consistent hashing, splitting a shard moves roughly half its data; plan for online resharding (dual-write during migration, verify, cutover). Vitess and Citus automate the mechanics; you still own the cutover runbook and the rollback plan.

Hotspots: monitor write distribution per shard continuously. A hot shard means the shard key is wrong for the access pattern (sequential IDs piling onto the newest shard, one tenant 100x bigger than the rest). Fixes: hash the key, carve the huge tenant onto its own shard, or accept the hotspot and over-provision that shard. There is no fix that avoids touching the key design.

Capacity planning per shard: IOPS (writes times write amplification from indexes), disk (data plus indexes, keep under 70 percent), connections, and replica lag headroom. A shard is a database; plan it like one.

Staff-level questions: why not just buy a bigger machine forever? (The cost curve goes vertical, failover gets slower as data grows, and one machine is still one blast radius.) Why not hand-roll sharding? (Query planning across shards, resharding, and connection pooling are each a project; Vitess and Citus already solved them, and their edge cases will surprise you at 3am.) How do you handle transactions across shards? (You do not. Design so each transaction's writes share one shard key; the shard key is your transaction boundary. Anything needing two-phase commit across shards is a schema design failure.)

## Security Considerations

Per-shard credentials with least privilege: the app role gets DML, not DDL; separate roles for migrations, backups, and humans. Shards live in private subnets with no public IPs; security groups allow only the router and app tier.

Encryption at rest on every instance, TLS for client and replication connections. Backups are per shard, which makes cross-shard point-in-time recovery approximate: shards snapshot at slightly different moments. Document the real RPO instead of claiming a consistency you do not have; auditors prefer honesty, and restores will test the claim.

Sharding by region doubles as a data-residency story (EU users on EU shards), but cross-region replicas for DR need legal review before you create them, not after.

PII: the shard key is often the user ID, which makes every shard a PII store. Protect access logs per shard, and map deletion requests across all shards, their replicas, and backups (backups usually age out with retention; say so in the privacy docs rather than promising instant deletion).

## Operational Concerns

Monitor per shard, not just per cluster: replication lag, disk usage, slow query log, connection count, write distribution across shards (hotspot detection), and deadlocks.

Alerts: lag over 5 seconds, disk over 75 percent, connections over 80 percent of max, any shard's write share more than 2x the mean (hotspot forming), failed backups.

Runbooks: primary down means promote a replica; test failover quarterly, because a failover that has never been tested is a hope, not a plan. Disk full on one shard is the emergency: drop old partitions, expand the volume, or move the shard, in that order. Connection storm: check for pooler bypasses and kill idle-in-transaction sessions before adding capacity.

What breaks at 3am: failover during a deploy (the two interact badly; freeze deploys during failover), replica lag cascading into stale reads right after writes (users notice immediately), and a runaway analytical query on a replica blocking replication apply (replicas are not free analytics machines; fence them off or move the analytics out).

Drills: restore one shard from backup to staging monthly, and rehearse the reshard cutover on a staging cluster before ever doing it in production.

## Decision Summary

| Signal | Action |
|--------|--------|
| Slow reads, writes fine | Read replicas |
| Slow writes, WAL growing | Sharding |
| Table > 500GB, queries slow | Partitioning first, then sharding |
| Need both read and write scale | Sharded cluster with per-shard replicas |
| Cross-shard joins in hot path | Rethink shard key before anything else |

Start with the simplest option that solves your actual bottleneck. Most teams never need sharding. Those that do usually know it well in advance from their growth trajectory.
