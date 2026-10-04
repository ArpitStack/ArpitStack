---
title: "Background Job Architecture: Queues, Workers, and Retry Strategies"
date: "2026-10-22"
tags: ["Architecture", "Distributed Systems", "Backend"]
description: "Job queue HLD, at-least-once delivery, dead letter handling, scheduling, and priority queues for reliable background processing."
readingTime: 15
---

Every backend system eventually needs background jobs: sending emails, processing uploads, syncing data, generating reports. Doing this reliably at scale requires more thought than "throw it in a queue." Here is the architecture I use and the tradeoffs involved.

## Why Not Just Do It Synchronously?

Background jobs exist to decouple slow work from the request path. If processing an upload takes 30 seconds, you cannot block the HTTP request for that long. Instead:

1. Request arrives, validated quickly
2. Job enqueued (milliseconds)
3. HTTP response returned immediately
4. Worker picks up job and processes it asynchronously

This gives you better latency, better resilience (jobs survive restarts), and better resource utilization (workers scale independently).

## System Architecture

```
+----------------+     +------------------+     +------------------+
|  API Server    |---->|  Broker (Queue)  |---->|  Workers         |
|  (Producer)    |     |  (Redis/SQS)     |     |  (Consumers)     |
+----------------+     +------------------+     +------------------+
                                |                        |
                                v                        v
                       +------------------+     +------------------+
                       |  Scheduler       |     |  Result Store    |
                       |  (Cron/Delayed)  |     |  (DB/Object)     |
                       +------------------+     +------------------+
                                |
                                v
                       +------------------+
                       |  DLQ + Alerting  |
                       +------------------+
```

Components:

- **Job Queue.** Durable message broker (SQS, RabbitMQ, Redis, Kafka). Must persist jobs across restarts.
- **Workers.** Stateless processes that poll the queue, execute jobs, and acknowledge completion.
- **Dead Letter Queue (DLQ).** Where jobs go after exhausting retries. For manual inspection.
- **Scheduler.** For delayed or recurring jobs (cron-like functionality).
- **Monitoring.** Job throughput, failure rates, queue depth, worker health.

## At-Least-Once Delivery (And Why It Matters)

Most job queues guarantee at-least-once delivery: a job will be processed one or more times, but never zero times (assuming the queue is durable). This means your job handlers must be **idempotent**: processing the same job twice should have the same effect as processing it once.

```python
# Not idempotent: sends email twice if job retried
def send_welcome_email(user_id):
    user = get_user(user_id)
    email_service.send(user.email, "Welcome!")

# Idempotent: checks if already sent
def send_welcome_email(user_id, job_id):
    if already_processed(job_id):
        return  # Skip duplicate
    user = get_user(user_id)
    email_service.send(user.email, "Welcome!")
    mark_processed(job_id)
```

Idempotency strategies:

- **Job ID deduplication.** Store processed job IDs, skip duplicates. Works for any job type.
- **Natural idempotency.** Some operations are inherently idempotent (setting a value, upserting a record).
- **Database constraints.** Unique indexes prevent duplicate inserts even if the job runs twice.

Design every job handler to be idempotent from day one. Retrofitting idempotency after a duplicate-processing incident is painful.

## Retry Strategies

Jobs fail. Networks blip, downstream services have outages, bugs happen. A good retry strategy distinguishes transient failures from permanent ones.

**Exponential backoff with jitter:**

```python
def calculate_delay(attempt: int, base: float = 1.0, max_delay: float = 300.0) -> float:
    delay = min(base * (2 ** attempt), max_delay)
    # Add jitter to prevent thundering herd
    return delay * random.uniform(0.8, 1.2)

# Attempt 0: ~1s, Attempt 1: ~2s, Attempt 2: ~4s, Attempt 3: ~8s...
```

Why exponential: gives transient issues time to resolve without hammering a struggling downstream service.

Why jitter: if 1000 jobs fail simultaneously and all retry after exactly 60 seconds, you create a thundering herd. Jitter spreads the retries.

**The math of backoff.** With base=1.0, max_delay=300, and 5 attempts, the delays are roughly 1, 2, 4, 8, 16 seconds: about 31 seconds of waiting before a job lands in the DLQ. That is cheap. With 10 attempts and max_delay=900, the tail is 1, 2, 4, ... 512, 900, 900: over 40 minutes of retrying one job. Choose max attempts and max delay by asking how long a downstream outage you want to ride out automatically. For a dependency with a typical 5-minute recovery, configure the retry schedule to span 10-15 minutes, then let the DLQ and alerting take over. Retrying for hours hides the failure instead of handling it.

**Retry budgets.** Exponential backoff controls one job's retry pattern. A retry budget controls the aggregate: cap the fraction of traffic that can be retries at any time (commonly 10-20% of normal throughput). During a downstream outage, every job fails and every job wants to retry. Without a budget, retries alone can keep the struggling service pinned at 100% load, turning a 5-minute outage into a 50-minute one. Implementation is simple: count retry attempts per rolling window, and when the budget is exhausted, send failing jobs straight to the DLQ (with alerting) instead of scheduling another retry. The downstream service recovers faster, and the DLQ replay path recovers the work later.

**Retry classification:**

```python
def handle_job(job):
    try:
        process(job)
    except TransientError as e:
        # Network timeout, rate limit, temporary outage: retry
        retry_with_backoff(job)
    except PermanentError as e:
        # Invalid data, business rule violation: do not retry
        send_to_dlq(job, reason=str(e))
    except Exception as e:
        # Unknown: retry with limit, then DLQ
        if job.attempts < MAX_ATTEMPTS:
            retry_with_backoff(job)
        else:
            send_to_dlq(job, reason=str(e))
```

Distinguish error types explicitly. Retrying a job with invalid data 10 times wastes resources and delays the DLQ alert that would have caught the bug sooner.

## Dead Letter Queues

After exhausting retries, jobs go to the DLQ. This is not a trash can. It is a signal that something needs human attention.

DLQ best practices:

- **Alert on DLQ depth.** Any job in the DLQ is a job that failed permanently. Alert immediately, not when the queue fills up.
- **Preserve context.** Store the original job payload, all error messages, attempt history, and timestamps. Debugging without context is guessing.
- **Enable replay.** Provide a way to requeue DLQ jobs after fixing the underlying issue. Manual replay is fine for low volumes; build tooling if DLQ volume is high.
- **Set retention.** DLQ jobs should not accumulate forever. Set a retention period (e.g., 30 days) and archive old ones.

## Priority Queues

Not all jobs are equal. A password reset email is more urgent than a weekly analytics report. Priority queues ensure important work is not stuck behind bulk processing.

Implementation approaches:

**Separate queues by priority:**
```
high-priority-queue -> dedicated workers (always available)
normal-queue -> standard workers
low-priority-queue -> workers that also handle normal when idle
```

**Weighted polling:** Workers check high-priority queue first, then normal. Simple but can starve low-priority work if high-priority is constantly full.

**Separate worker pools:** Most predictable. High-priority workers only process high-priority jobs. No starvation, but less efficient resource utilization.

I prefer separate queues with dedicated workers for the critical path (user-facing jobs) and shared workers for everything else. The operational simplicity outweighs the minor efficiency loss.

## Scheduling and Delayed Jobs

For recurring jobs (hourly reports, daily cleanup) or delayed execution (send reminder in 24 hours):

**Option 1: External scheduler (cron + queue).** A cron job enqueues work at the scheduled time. Simple, works well. The scheduler itself must be highly available (or jobs get missed).

**Option 2: Delayed message delivery.** SQS, RabbitMQ, and others support message delay. Enqueue a job with a 24-hour delay. The queue handles the timing.

**Option 3: Database-backed scheduler.** Store scheduled jobs in a database with a `run_at` timestamp. Workers poll for due jobs. More control, more code to maintain.

For most cases, Option 1 or 2 is sufficient. Option 3 is for complex scheduling requirements (dynamic schedules, per-tenant schedules, schedule management UI).

**Distributed cron problem:** If you have multiple scheduler instances, ensure only one triggers each job. Use distributed locks (Redis, database advisory locks) or a leader election mechanism.

**Cron vs distributed scheduler tradeoffs.** Plain cron is simple and predictable, but it is a single point of failure and it cannot see your queue: if the queue is already backed up, cron happily enqueues another batch and makes it worse. A distributed scheduler (a leader-elected process or a managed service) can check queue depth before enqueuing, skip or defer work during incidents, and spread recurring jobs across tenants. The cost is operational: leader election, failover semantics, and schedule storage all become your problem. Rule of thumb: cron is fine for low-stakes recurring work (nightly cleanup, weekly digests). Business-critical schedules (billing runs, SLA-bound reports) deserve a distributed scheduler with alerting on missed runs, not just successful ones.

## Multi-Step Jobs: Choreography and Sagas

Real workflows are rarely one job. An order flow might be: charge payment, reserve inventory, send confirmation. Each step is its own job, and steps can fail independently. Two patterns handle this.

**Choreography:** each job emits an event when it finishes, and the next job listens for that event. No central controller. This is simple and scales, but the workflow is implicit: to understand the flow you must trace event subscriptions across services. Debugging a stuck order means hunting through multiple queues. It also makes rollback hard, because no single place knows the workflow state.

**Saga (orchestration):** a coordinator job drives the steps explicitly and records state after each step. If step 3 fails, the saga runs compensating actions for steps 1 and 2 (refund the charge, release the reservation). Each step still runs as a separate queued job, but the saga record tracks status, so a crash mid-workflow can resume or roll back deterministically.

```python
# Saga record: one row per workflow, updated after each step
saga = SagaRecord(workflow_id, steps=["charge", "reserve", "notify"])
saga.mark_done("charge")
enqueue_step(saga, "reserve")  # next job carries the saga id

# On failure, run compensations in reverse order
def handle_step_failure(saga, failed_step):
    for step in reversed(saga.completed_steps):
        enqueue_compensation(saga, step)  # e.g. refund, release
```

For two or three steps, choreography is usually fine. Once workflows grow (conditional branches, human approvals, long waits between steps), the explicit saga record pays for itself in debuggability. Compensating actions must be idempotent too, because the saga itself runs on at-least-once delivery.

## Monitoring: What to Track

- **Queue depth.** Growing queue = workers cannot keep up. Alert on sustained growth.
- **Job latency.** Time from enqueue to completion. Alert on p99 degradation.
- **Failure rate.** Percentage of jobs that exhaust retries. Alert on spikes.
- **Worker health.** Are workers alive and processing? Dead workers with a growing queue is an outage.
- **DLQ depth.** Should be zero. Any non-zero value needs investigation.
- **Retry rate.** High retry rates indicate downstream issues or buggy jobs.

## Observability: Trace Propagation Through Queues

Metrics tell you the queue is slow. Traces tell you which job, which step, and where the time went. The catch: a job crosses a process boundary, and the trace context must cross with it.

Inject the trace context into the job payload (or message headers) at enqueue time, and extract it in the worker before processing:

```python
# Producer
headers = propagate_trace_context()  # traceparent, tracestate
enqueue(job, headers={"traceparent": headers["traceparent"]})

# Worker
with start_span("process_job", parent=extract(headers)):
    process(job)
```

Now a single trace spans the API request, the enqueue, the worker processing, and any downstream calls the worker makes. Without this, you are correlating by timestamp across services, which works until it does not. Keep the trace context small and sanitized: it travels in every message, so strip baggage that is not needed and never put secrets in trace headers. For saga workflows, link each step's trace to the saga's root trace so the whole workflow renders as one graph.

## Scaling Workers

Workers should scale based on queue depth, not CPU. A worker blocked on I/O shows low CPU but cannot process more jobs.

```yaml
# Kubernetes HPA based on queue depth (using KEDA)
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-scaler
spec:
  scaleTargetRef:
    name: worker-deployment
  triggers:
  - type: aws-sqs-queue
    metadata:
      queueURL: https://sqs.us-east-1.amazonaws.com/123456789/my-queue
      queueLength: "10"  # Scale up when 10+ messages per replica
  minReplicaCount: 2
  maxReplicaCount: 50
```

KEDA (Kubernetes Event-Driven Autoscaling) is the standard tool for this. It supports SQS, RabbitMQ, Kafka, Redis, and many other queue systems.

## Scalability

**At 10x load**, most well-designed job systems hold up: queue depth absorbs bursts, workers autoscale, the broker handles the message rate. The first thing that moves is latency: jobs wait longer before a worker picks them up. Watch the p99 enqueue-to-start time; it is your earliest signal that worker capacity is falling behind.

**At 100x load**, the bottlenecks shift:

- **Broker throughput.** Redis is fast (tens of thousands of messages/sec on one node) but persistence and replication get tricky. SQS scales effectively without limit but with per-queue throughput characteristics and higher per-message latency to plan around. Kafka handles massive throughput with partitioning, at the cost of operational complexity. Pick the broker for the load you expect in 18 months, not the load you have today; migrating brokers under pressure is painful.
- **Worker churn.** At high scale, workers are constantly starting and stopping. Cold starts, connection pool warmup, and in-flight job draining on shutdown all consume capacity. Keep worker startup under a few seconds and make shutdown drain bounded.
- **The result store and dedup store.** Every job writes status somewhere. That store becomes a hotspot: connection limits, write throughput, and index growth on the processed-job-ids table. Partition by time, set TTLs, and keep the hot path lean.

**Exactly-once vs at-least-once at scale.** Exactly-once is effectively impossible across a broker and a worker; what people mean is "effectively once," achieved through idempotency. At scale this means your deduplication store must handle the same write rate as your job throughput. A unique constraint on the jobs table works until it becomes the write bottleneck; then you move dedup checks to something like Redis with TTLs, accepting that a crashed job whose dedup key expired may run twice. Design for that: idempotency through natural operations (upserts, state-machine transitions) is more scalable than a dedup table you must consult on every job.

**Job deduplication.** Beyond retries, duplicates arrive from double-enqueues (a client retries the enqueue call). Use a deterministic job key (e.g., `invoice:123:generate-pdf`) and check-and-set on enqueue. The enqueue path then has the same dedup semantics as the worker path.

## Security Considerations

Background jobs are a trust boundary that teams under-invest in. The queue accepts work from your services, but anything that can enqueue a job can execute code on your workers.

- **Job payload injection.** Never let job arguments contain executable content. A job arg like `{"template": user_input}` is fine if the template is rendered by a sandboxed engine; it is a vulnerability if it ends up in `eval()` or a shell command. Validate and schema-check payloads at enqueue time, and treat worker-side deserialization as untrusted input.
- **Poison messages.** A message that crashes every worker that touches it (malformed payload, a job that triggers an unhandled exception before ack) creates a crash loop: worker picks it up, dies, the message is redelivered, the next worker dies. Defend with attempt-count limits that route to the DLQ quickly, and process messages with a supervisor that isolates crashes to one job, not one worker.
- **Tenant isolation in shared queues.** If multiple tenants share one queue, a noisy tenant's bulk jobs delay another tenant's urgent jobs, and a bug in tenant A's handler can leak data into tenant B's context. Options: separate queues per tier (or per large tenant), tenant-scoped credentials for downstream calls, and always passing the tenant id explicitly in the payload rather than relying on worker-local state.
- **Secret handling in job args.** Job payloads get logged, stored in the DLQ, and retained for weeks. Never put API keys, tokens, or PII in job arguments. Pass references (a credential id, a database row id) and let the worker fetch secrets from the vault at runtime with least-privilege access.
- **Signed job payloads.** For high-stakes jobs (payouts, data exports, account changes), sign the payload at enqueue time and verify the signature in the worker. This closes the hole where a compromised broker or a leaked queue URL lets an attacker forge jobs. The signing key lives in your secret store, never in the payload.

## Deployment Safety: Draining Workers Before Deploy

Deploying workers is not like deploying a stateless API. A worker killed mid-job leaves the job in limbo: the broker redelivers it (at-least-once saves you), but the partial work may have side effects, and the redelivery lands on a worker running new code with a different handler version.

The safe sequence:

1. Stop the autoscaler from adding replicas during the deploy.
2. Send SIGTERM: the worker stops polling for new jobs but finishes the current one (with a bounded drain timeout, e.g., 60-120 seconds).
3. Jobs still in flight past the timeout get redelivered to new-version workers. Make sure handler changes are backward-compatible with in-flight payloads, or use a blue-green approach with separate queues per version.
4. Verify the new workers are processing (queue depth decreasing, no DLQ growth) before tearing down the old set.

Never roll a handler change and a payload schema change in the same deploy. Version the payload, support both versions in the handler, then remove the old version a deploy later.

## Production Checklist

- Job handlers are idempotent (dedupe keys, natural idempotency, or DB constraints)
- Retry with exponential backoff and jitter; retry budget caps aggregate retry load
- Distinguish transient from permanent errors; route permanent failures to the DLQ fast
- DLQ with alerting, full context preservation, replay tooling, and retention policy
- Priority queues for user-facing work (separate queues, dedicated workers for the critical path)
- Monitoring on queue depth, enqueue-to-start latency, failure rate, DLQ depth, retry rate
- Trace context propagated through queue messages; saga workflows linked to a root trace
- Workers scale on queue depth (KEDA or equivalent), not CPU
- Scheduler is highly available; alert on missed runs, not just failures
- Signed payloads for high-stakes jobs; no secrets or raw PII in job arguments
- Tenant isolation strategy for shared queues
- Graceful shutdown with bounded drain; handler and schema changes deployed in separate releases

Background jobs are the unglamorous backbone of backend systems. When they work, nobody notices. When they break, everything breaks. Design them with the same rigor as your API.
