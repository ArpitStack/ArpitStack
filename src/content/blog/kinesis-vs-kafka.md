---
title: "Kinesis vs Kafka for Streaming: A Decision Framework"
date: "2026-12-31"
tags: ["Streaming", "AWS", "Kafka", "Architecture"]
description: "Throughput, ordering, retention, operational burden, and cost: a practical framework for choosing between Kinesis and Kafka."
readingTime: 12
---

Every streaming architecture discussion eventually lands on the same question: Kinesis or Kafka? The answer is not "it depends" as a dodge. It depends on specific, measurable factors. This post gives you the framework to decide.

## The Core Difference

Kinesis is a managed AWS service. Kafka is a distributed system you operate (or pay someone to operate via MSK or Confluent). That single distinction drives almost every other tradeoff.

Kinesis handles provisioning, replication, patching, and scaling the control plane. You pay per shard-hour and per PUT payload unit. Kafka gives you complete control over partitioning, retention, and client behavior. You pay in operational effort and infrastructure.

## Throughput

A single Kinesis shard supports 1 MB/s writes and 2 MB/s reads, up to 1,000 records per second for writes. Need more? Add shards. Resharding is the scaling operation, and it requires planning because splitting and merging shards affects ordering guarantees.

Kafka throughput is bounded by broker disk I/O and network. A well-tuned three-broker cluster handles hundreds of MB/s. There is no shard equivalent to manage. You add partitions to a topic, and throughput scales roughly linearly with partition count, limited by broker resources.

For most workloads under 50 MB/s, both handle it comfortably. Above that, Kafka's ceiling is higher, but you are managing the brokers that provide it.

The failure mode interviewers probe here is the hot shard. Kinesis maps partition keys to shards by hash, and nothing stops a skewed key distribution from pinning most traffic on one shard. Adding shards does not help a hot key: the shard holding it still throttles at 1 MB/s in and 2 MB/s out while the others sit idle. The fix is key design. Use high-cardinality keys (user id, device id) or append a random suffix to spread load, accepting that ordering then applies per suffix bucket rather than per entity. Kafka has the same hazard at the partition level, but you can reassign partitions across brokers to spread disk I/O, an option Kinesis does not give you.

## Ordering

Kinesis guarantees ordering within a shard. Records with the same partition key land on the same shard, in order. Across shards, there is no ordering.

Kafka guarantees ordering within a partition. Same concept, different name. A partition is the unit of parallelism and ordering, just like a shard.

The practical difference: Kinesis partition keys hash to shards, and you cannot control the mapping beyond the key. Kafka lets you assign partitions explicitly and control exactly which consumer reads what. If you need fine-grained control over partition assignment, Kafka wins.

## Retention

Kinesis retains data for 24 hours by default, extendable to 365 days. You pay for extended retention per shard-hour. It is designed as a transport, not a store.

Kafka retains data based on time, size, or both, configurable per topic. Retention of weeks or months is normal. Kafka is routinely used as a durable event log that consumers replay.

If your architecture needs event replay beyond a day or two, or if you treat the stream as a source of truth, Kafka's retention model is more natural. If you process and forget, Kinesis is simpler.

## Operational Burden

This is where the decision usually gets made.

Kinesis: no brokers to patch, no ZooKeeper or KRaft to manage, no disk capacity planning, no leader elections to debug at 3 AM. AWS handles it. Your operational surface is IAM policies, CloudWatch alarms, and resharding logic.

Kafka: you manage brokers, storage, replication, partition rebalancing, consumer group coordination, and version upgrades. MSK reduces this but does not eliminate it. You still think about broker sizing, storage scaling, and ZooKeeper/KRaft health.

For a team without dedicated streaming infrastructure expertise, Kinesis saves months of operational learning. For a team that already runs Kafka well, the managed-service advantage shrinks.

## Cost Comparison

Kinesis pricing: per shard-hour (roughly $0.015), per million PUT units ($0.014), plus extended retention and enhanced fan-out if used. A moderate workload (10 shards, 50M records/day) runs roughly $200-400/month before data transfer.

Kafka on EC2: three m5.large brokers with EBS, roughly $250-400/month in compute and storage, before engineering time. MSK: similar or higher, depending on broker size and storage.

The honest cost comparison must include engineering time. If Kafka requires even 10 hours/month of operational attention from a senior engineer, that dwarfs the infrastructure cost difference. Kinesis wins on total cost for most teams that are not already Kafka-fluent.

## Consumer Model

Kinesis consumers use the KCL (Kinesis Client Library) or Lambda event source mappings. Enhanced fan-out gives each consumer dedicated 2 MB/s throughput per shard, at additional cost. Without it, consumers share the 2 MB/s read limit.

Kafka consumers join consumer groups. Partitions distribute across group members automatically. Rebalancing handles member joins and failures. The model is more flexible but requires understanding consumer group semantics.

Lambda integrates natively with both. Kinesis has a slight edge in AWS-native architectures because of IAM integration and the simplicity of event source mappings.

Exactly-once is where the comparison gets sharp. Kafka supports transactions end to end: a transactional producer writes records and offsets atomically, so a consumer never sees a partial write. Kinesis has no equivalent. The KCL checkpoints processed sequence numbers to DynamoDB, but checkpointing is at-least-once by default. If a worker dies between processing a record and checkpointing it, the replacement replays from the last checkpoint and reprocesses. Idempotent consumers are not optional on Kinesis; they are the correctness model. Poison-pill records deserve attention too. A malformed record that crashes every consumer during deserialization creates a crash loop that blocks the whole shard or partition. The standard defense is a dead-letter pattern: route failures to a DLQ topic or S3 prefix after N retries, and alert on DLQ growth instead of letting the main pipeline stall.

## When to Pick Kinesis

- Your team is AWS-centric and wants minimal operational overhead
- Throughput needs are moderate and predictable
- Retention beyond a few days is not required
- You want Lambda-triggered processing without managing consumer infrastructure
- Time to production matters more than per-unit cost optimization

## When to Pick Kafka

- You need long retention or event replay as a core pattern
- Throughput requirements exceed what you want to manage via sharding
- You need exactly-once semantics with transactional producers and consumers
- Your team already has Kafka expertise
- You run multi-cloud or need to avoid AWS lock-in
- You need Kafka ecosystem tools (Kafka Streams, ksqlDB, Schema Registry)

## The Decision Framework

Ask these in order:

1. **Do we have Kafka expertise on the team?** No: default to Kinesis unless another answer overrides.
2. **Do we need retention beyond 7 days?** Yes: lean Kafka.
3. **Is this multi-cloud or must it avoid AWS lock-in?** Yes: Kafka.
4. **Is throughput bursty and unpredictable?** Kinesis handles bursts by adding shards, but resharding is not instant. Kafka handles bursts better if brokers have headroom.
5. **What is the total cost including engineering time?** Be honest about this one.

Most AWS-native teams building their first streaming pipeline should start with Kinesis. Migrate to Kafka when you hit a concrete limitation, not a hypothetical one. The reverse migration is harder because Kafka architectures tend to depend on Kafka-specific features (long retention, transactions, ecosystem).

## What I Would Avoid

Do not run self-managed Kafka because it seems cheaper on paper. The infrastructure savings vanish the moment you factor in the first production incident. If you choose Kafka, use MSK or Confluent Cloud unless you have a dedicated streaming platform team.

Do not use Kinesis for event sourcing with long replay windows. The retention pricing and 365-day cap make it the wrong tool. Use Kafka, or store events in S3 and replay from there.

## System Architecture

A streaming pipeline has the same shape regardless of platform: producers write to an ordered, partitioned log, consumers read in parallel, and progress state lives in a separate store so consumers can fail over.

```
+----------------+     +------------------+
|  Producers     |---->|  Stream Layer    |
|  apps and CDC  |     |  shards or       |
+----------------+     |  topic partitions|
                       +------------------+
                                |
               +----------------+----------------+
               |                                 |
               v                                 v
      +------------------+            +------------------+
      |  Stream          |            |  S3 Sink         |
      |  Consumers       |            |  replay and      |
      +------------------+            |  archive         |
               |                      +------------------+
               v
      +------------------+
      |  Checkpoints     |
      |  offsets store   |
      +------------------+
```

Producers (application services, CDC connectors) write records with a partition key. The stream layer (Kinesis shards or Kafka topic partitions) stores them durably and replicates across availability zones. Consumers (KCL workers, Lambda event source mappings, or Kafka consumer groups) read in parallel, one active reader per shard or partition at a time. Checkpoints (a DynamoDB lease table for KCL, the internal offsets topic for Kafka) track progress so a failed consumer resumes where it stopped. A sink (Kinesis Firehose or Kafka Connect to S3) archives raw events for replay and analytics. A schema registry sits beside producers to enforce compatibility before bad records reach the log.

## Scalability

At 10x load, the Kinesis design holds up if you planned shard count with headroom, because adding shards is a roughly linear operation. The bottlenecks appear at the edges. Resharding is not instant: a split takes minutes, and during that window the parent shard stops accepting writes at full rate while child shards warm up. If a 10x spike arrives faster than resharding completes, producers get ProvisionedThroughputExceeded and must retry with backoff. Enhanced fan-out consumers each add cost linearly, so ten consumers on a hundred shards with enhanced fan-out becomes a line item that surprises people.

At 100x, shard management becomes a full-time concern. The default soft limit is 500 shards per stream per region, and raising it takes planning. Teams at this scale automate resharding with functions that watch CloudWatch metrics and split or merge on schedule, plus a partition-key review process, because hot keys at 100x are catastrophic. The horizontal strategy for Kinesis is therefore: shard count as code, automated resharding, and key design reviews.

Kafka at 10x usually means adding partitions and brokers. The bottleneck is rebalance time: reassigning partitions copies data between brokers, bounded by disk and network throughput. A rebalance that took minutes at small scale takes hours at 10x, during which the cluster runs degraded. At 100x, constraints shift to the control plane. The KRaft controller must track tens of thousands of partitions; metadata operations slow down, and consumer group rebalances take longer because every member re-fetches assignments. Too many partitions is its own failure mode: each partition is a directory with open file handles, and brokers holding tens of thousands see longer startup and recovery times. The horizontal strategy for Kafka: size partitions for target consumer parallelism (roughly one partition per consumer thread at peak), add brokers before disks pass 70%, and keep partition counts in the low thousands per broker.

## Security Considerations

Kinesis security is IAM-centric. Apply least privilege per stream: producers get PutRecord and PutRecords only, consumers get GetRecords, GetShardIterator, and DescribeStream only, and nobody gets kinesis:* in production. Enable server-side encryption with a customer-managed KMS key rather than the AWS-managed key if you need rotation control or CloudTrail visibility into key usage. Traffic between producers and Kinesis is TLS by default. The realistic attack vector is over-permissioned IAM: a compromised producer credential with broad stream access can enumerate shard iterators and read the entire stream. Scope credentials per stream and per action, and alert on GetShardIterator calls from unexpected principals.

Kafka security depends on how you run it. MSK supports IAM authentication, SASL/SCRAM, and mutual TLS; use one of them, because Kafka's historical default was no authentication at all, and self-managed clusters with open listeners are still found in the wild. Apply ACLs per topic and consumer group so a compromised service account cannot subscribe to unrelated topics. Encrypt broker EBS volumes for data at rest and enforce TLS for client and inter-broker traffic. The poison-pill record is the most common availability attack: a single malformed message that crashes the deserializer takes down every consumer in the group in a loop. Mitigate with a dead-letter topic, schema validation at the producer (a registry with compatibility checks), and consumer error handling that quarantines rather than crashes.

## Production Checklist

Monitoring signals that matter:

- **Kinesis**: IteratorAgeMilliseconds per shard (the lag signal; alert if it exceeds your SLA, e.g. 60 seconds for near-real-time), WriteProvisionedThroughputExceeded and ReadProvisionedThroughputExceeded (throttling), and throttling on the KCL DynamoDB lease table (a sign of too many workers or hot leases).
- **Kafka**: consumer group lag per partition (alert on sustained lag growth, not absolute lag), under-replicated partitions (any sustained value above zero is a broker or disk problem), offline partitions (page immediately), and broker disk usage (alert at 70%, act before 85%).

Failure modes seen in production: Kinesis resharding during a traffic spike causing write throttling on parent shards; KCL workers failing to checkpoint because the DynamoDB lease table was provisioned too small, leading to mass reprocessing after a deploy; Kafka consumer group rebalance storms when a rolling restart is too aggressive (stagger restarts and raise session timeouts during upgrades); brokers running out of disk because retention was set by time but traffic grew, so size-based retention never became the binding constraint.

Runbook notes: keep the shard split and merge procedure scripted and tested against a non-production stream; document the KCL checkpoint reset procedure (clearing lease table entries forces a fresh start from TRIM_HORIZON or LATEST, and you must know which one your pipeline needs); for Kafka, keep partition reassignment templates ready and practice consumer group offset resets in staging. Rollback for streaming changes is rarely a version rollback; it is a traffic shift, so keep the old consumer group deployable and the old shard count restorable.

---

*The right streaming platform is the one your team can operate reliably at 3 AM. Everything else is secondary.*
