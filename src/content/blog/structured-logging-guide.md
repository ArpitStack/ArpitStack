---
title: "Structured Logging for Microservices: What to Log and What to Skip"
date: "2027-02-25"
tags: ["Observability", "Microservices", "Backend"]
description: "JSON logging, correlation IDs, log levels, cardinality control, and cost management for production microservice logging."
readingTime: 14
---

Logs are the first thing you reach for when something breaks and the last thing anyone designs properly. In microservices, bad logging means drowning in noise across 20 services. Good logging means finding the root cause in minutes.

Here is what I have learned about logging in production microservice environments.

## Structured Logging: JSON, Always

Unstructured logs are for humans reading a terminal. Structured logs are for machines parsing, filtering, and alerting. In production, always use structured (JSON) logging.

```
// Bad: unstructured, hard to parse
2026-09-28 10:15:30 INFO User alice logged in from 192.168.1.1

// Good: structured, machine-readable
{"timestamp":"2026-09-28T10:15:30Z","level":"info","msg":"user login","user_id":"alice","ip":"192.168.1.1","service":"auth","version":"1.2.3"}
```

Why JSON:

- **Queryable.** Log aggregation systems (ELK, Datadog, CloudWatch) can filter and aggregate on fields.
- **Consistent.** Every log line has the same structure. No regex parsing.
- **Extensible.** Add fields without breaking parsers.

Every log line should include these base fields:
- `timestamp` (ISO 8601, UTC)
- `level` (debug, info, warn, error)
- `msg` (human-readable description)
- `service` (which service emitted this)
- `version` (which deployment version)

## System Architecture

A production logging pipeline has four stages, and each one can lose, delay, or corrupt your logs.

```
+-----------+     +------------+     +----------------+
| Service A |     | Shipper    |     | Ingest queue   |
| Service B |---->| agent or   |---->| buffer parse   |
| Service C |     | sidecar    |     | route sample   |
+-----------+     +-----+------+     +-------+--------+
                        |                    |
                        v                    v
                  +------------+      +--------------+
                  | Hot store  |      | Warm cold    |
                  | indexed    |----->| object store |
                  | recent 7d  |      | older than   |
                  +------------+      | 90d          |
                                      +--------------+
```

Services write JSON to stdout or a file. A shipper (Fluent Bit, Vector, or the platform agent) tails it and forwards. The ingestion layer buffers (this is where backpressure lives), parses, routes, and samples. Hot storage is indexed and fast for recent logs; warm and cold tiers are cheaper object storage for older logs.

The key design decision is what happens when a stage falls behind. The shipper can block the application (safe for logs, dangerous for latency), drop logs (safe for latency, dangerous for debugging), or spool to disk (bounded by disk space). Pick one deliberately per service tier. For payment or audit paths, block or spool. For high-volume debug telemetry, drop.

## Correlation IDs: Tracing Requests Across Services

In microservices, a single user request touches multiple services. Without correlation, you cannot connect the logs.

```python
# Middleware: generate or propagate correlation ID
async def correlation_middleware(request, call_next):
    correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
    # Set in context for all downstream logging
    set_correlation_id(correlation_id)
    response = await call_next(request)
    response.headers["X-Correlation-ID"] = correlation_id
    return response

# Logger includes correlation ID automatically
logger.info("processing payment", extra={
    "correlation_id": get_correlation_id(),
    "user_id": user_id,
    "amount": amount,
})
```

Rules:

- **Generate at the edge.** The API gateway or first service creates the correlation ID if not present.
- **Propagate everywhere.** Pass it in HTTP headers, message metadata, and gRPC metadata to downstream services.
- **Include in every log line.** Use a logging adapter or context variable to inject it automatically. Do not rely on developers remembering.

**Propagating to downstream calls.** Generating the ID at the edge is only half the job. Every outbound call must carry it:

```python
# Propagate the correlation ID on every downstream HTTP call
async def call_inventory(order):
    headers = {"X-Correlation-ID": get_correlation_id()}
    async with httpx.AsyncClient() as client:
        resp = await client.post(INVENTORY_URL, json=order, headers=headers)
        return resp.json()
```

The same applies to message queues (put it in message headers or the envelope), gRPC (metadata), and background jobs (store it with the job payload). A common gap: the web request has a correlation ID, but the async worker that processes it ten minutes later logs without one. Pass the ID into the job at enqueue time and set it in the worker context at dequeue time.

Also log the correlation ID at trust boundaries: when a request enters your system, when it crosses to another team's service, and when it leaves to a third party. Those are the seams where debugging gets hard.

With correlation IDs, debugging a failed request becomes: find the ID from the user report, filter logs by that ID across all services, see the complete request path.

## Log Levels: Use Them Correctly

Most codebases misuse log levels. Here is the discipline:

**DEBUG:** Detailed information for developers. Disabled in production by default. Examples: function entry/exit, variable dumps, verbose flow tracking.

**INFO:** Normal operational events. Enabled in production. Examples: server started, request completed, job finished. Should be low volume (a few lines per request maximum).

**WARN:** Unexpected but handled situations. Examples: retry attempted, deprecated API used, fallback triggered. These deserve attention but not pages.

**ERROR:** Failures that need investigation. Examples: unhandled exceptions, downstream service failures, data corruption. These should trigger alerts.

Common mistakes:

- **Logging everything at INFO.** If you log 50 lines per request at INFO, your log volume is unmanageable and important signals drown.
- **Using ERROR for expected failures.** A validation error from user input is not an ERROR. It is INFO or DEBUG. ERROR should mean "something is wrong with the system."
- **No WARN level.** Teams that only use INFO and ERROR miss the middle ground where early warnings live.

**Structured error logging.** An error log without context is a dead end. Log the error with everything needed to reproduce and diagnose:

```python
try:
    charge_customer(order)
except PaymentError as e:
    logger.error("payment charge failed", extra={
        "correlation_id": get_correlation_id(),
        "order_id": order.id,
        "user_id": order.user_id,
        "amount_cents": order.amount_cents,
        "error_type": type(e).__name__,
        "error": str(e),
    }, exc_info=True)
```

`exc_info=True` attaches the stack trace. In a JSON formatter it lands in a structured field, not smeared across the message. Rules: log the error once, at the layer that handles it, with the business identifiers (order, user) alongside the technical ones. Do not log-and-rethrow at every layer; that produces five copies of the same error and buries the real signal. And never include the full request body in an error log by default; log the identifiers needed to fetch it from the request store if you need it.

## What to Log (And What to Skip)

**Always log:**
- Service startup/shutdown with version and config summary
- Incoming requests (at DEBUG, or sampled at INFO): method, path, status code, duration
- Outgoing calls to dependencies: target, duration, success/failure
- Errors with full context: stack trace, correlation ID, relevant IDs
- Business-significant events: payment processed, user created, job completed

**Never log:**
- **Secrets.** Passwords, API keys, tokens, private keys. This seems obvious but happens constantly. Sanitize before logging.
- **PII unnecessarily.** Log user IDs, not emails or names, unless specifically needed for debugging.
- **Large payloads.** Do not log entire request/response bodies in production. Log sizes and hashes instead.
- **High-frequency debug data.** Logging every cache hit or database query at INFO will bankrupt your logging budget.

**Log sparingly:**
- Successful operations. One line per significant operation, not per sub-step.
- Health checks. Do not log every `/health` probe. Filter them out or log at DEBUG.

## Cardinality: The Hidden Cost Driver

Log aggregation systems charge by volume. High-cardinality fields (user IDs, request IDs, timestamps in messages) explode volume.

```python
# Bad: high cardinality, each log line is unique
logger.info(f"Processing request {request_id} for user {user_id}")

# Good: structured fields, aggregatable
logger.info("processing request", extra={
    "request_id": request_id,  # OK as a field, not in message
    "user_id": user_id,
})
```

The message field should be a static template. Dynamic values go in structured fields. This allows the logging system to group and count by message.

Monitor log volume per service. Set alerts for sudden spikes. A bug that logs in a tight loop can generate terabytes overnight and a five-figure bill.

## Sampling: For High-Volume Services

At very high throughput, logging every request is impractical. Sampling reduces volume while preserving visibility.

```python
# Sample 1% of successful requests, 100% of errors
def should_log_sample():
    return random.random() < 0.01

if response.status_code >= 500 or should_log_sample():
    logger.info("request completed", extra={...})
```

Always log errors (100% sample rate). Sample successful requests. Adjust the sample rate based on traffic volume and cost constraints.

## Cost Management

Logging costs are real and often surprising. A service doing 10,000 requests per second, logging 1KB per request, generates 864GB per day. At typical cloud logging prices, that is thousands of dollars per month per service.

Control costs by:

- **Set retention policies.** Keep detailed logs for 7 days, aggregated metrics for 90 days.
- **Filter before ingest.** Drop DEBUG logs, health checks, and known noise at the collector level.
- **Monitor volume.** Alert on unexpected increases. A 10x spike usually means a bug.
- **Right-size verbosity.** Start minimal, add logging when debugging specific issues, remove it after.

**What not to log** (the fastest cost lever):

- Health check and readiness probes. These can be the majority of request volume.
- Static asset requests and favicon hits.
- Successful cache hits at INFO. A counter metric replaces thousands of log lines.
- Full request and response bodies. Log sizes, status codes, and hashes.
- Per-iteration debug inside loops. Log the summary after the loop.

## Scalability

Log volume scales with traffic, and the math is unforgiving. A service doing 10,000 requests per second at 1KB per request generates about 864GB per day. At 100,000 requests per second, that is 8.6TB per day, per service. Multiply by 20 services and you are negotiating enterprise contracts with your logging vendor.

**Ingestion backpressure.** When the pipeline cannot keep up, something has to give. Bounded queues with an explicit overflow policy are the answer: block, drop, or spool to disk. Blocking protects log completeness but adds latency to the request path, which can turn a logging slowdown into an application slowdown. Dropping protects the application but loses the logs you need most during an incident. Spooling to disk is the middle ground, bounded by disk space. Whatever you choose, make it explicit and monitor the overflow counter. Silent log loss during an outage is how incidents become mysteries.

**Sampling strategies.** Head-based sampling decides at request start (keep 1 percent of traces). It is cheap and simple but blind: the 1 percent you kept probably does not include the failing request. Tail-based sampling buffers the full trace and decides at request end (keep 100 percent of errors, 1 percent of successes). It costs more memory but keeps exactly the traces you need. For most teams, the practical version is simpler: log 100 percent of errors and warnings, sample info-level request logs at a rate that fits the budget, and re-evaluate the rate quarterly as traffic grows.

**Hot, warm, and cold storage.** Not all logs need the same speed. Keep 7 days in hot indexed storage for incident debugging, 30 to 90 days in warm storage for investigations and audits, and a year or more in cold object storage for compliance. Queries against cold storage are slow; that is fine, because you almost never query it. The expensive mistake is keeping a year of logs in the hot tier because nobody set up lifecycle policies.

**Cardinality explosion in indexed fields.** Every unique value in an indexed field costs memory in the index. A field like user_id with millions of unique values across billions of log lines will bloat the index and slow every query. Keep indexed fields low-cardinality (service, level, region, error_type). High-cardinality values (user_id, request_id, correlation_id) belong in the log line as searchable fields, not in the index. If your logging platform lets you choose indexed vs non-indexed fields, choose deliberately. If it indexes everything, that is a cost conversation to have early.

## Security Considerations

**PII and secret redaction.** Logs are read by more people than you think: on-call engineers, support staff, contractors, and whatever systems index them. Assume every log line is visible to a broad audience and redact accordingly.

Redact in code, at the point of logging:

```python
import re

REDACTED = "[REDACTED]"
PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{20,}"),          # API keys
    re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+"),  # auth tokens
    re.compile(r"\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b"),  # card numbers
]

def redact(text):
    for pattern in PATTERNS:
        text = pattern.sub(REDACTED, text)
    return text

logger.info("payment processed", extra={
    "user_id": user_id,
    "last_four": card_last_four,   # safe: only the last four digits
    "auth_method": "card",          # safe: the method, never the token
})
```

Redact in the pipeline too, as a second layer. A regex filter at the collector catches what developers miss. Two layers, because one will fail.

**Never log tokens or passwords.** Not in debug, not temporarily, not "just this once to see what is happening." Log the identifiers around the secret (user_id, token fingerprint, auth method) instead of the secret itself. If a secret does end up in logs, rotate the secret and treat the log storage as compromised until retention expires.

**Log integrity and tamper evidence.** For audit and security logs, append-only storage matters. Use object-lock or WORM semantics so logs cannot be modified or deleted before retention expires. If tamper evidence is a requirement, hash-chaining (each batch includes the hash of the previous batch) lets you detect gaps. This is overkill for application debug logs and appropriate for access and audit logs.

**Access control on log storage.** Production logs contain customer data. Gate them behind RBAC: engineers see what they need, support sees a redacted subset, and every query is itself logged. Separate duties: the team that writes the payment service should not be the only team that can read the payment logs without oversight.

**Retention and GDPR.** Set retention policies per data category, not one global value. Debug logs: days. Operational logs: weeks. Audit logs: years. GDPR's right to erasure conflicts with immutable log storage, so plan for it: either keep PII out of logs (preferred), or have a documented process for crypto-shredding or field-level deletion. "We cannot delete it" is not an acceptable answer to a regulator.

## Operational Concerns

**Monitoring.** The metrics that matter:

- Ingestion lag: time from log emission to searchable. This is your earliest sign the pipeline is struggling.
- Dropped log count: logs lost to overflow, sampling, or shipper errors. Any unexpected increase needs investigation.
- Error rate by service: derived from logs, but treat it as a signal to verify against metrics.
- Volume per service per hour: sudden spikes usually mean a bug (a log line in a tight loop) or an attack.

**Alerting thresholds (starting points):**

- Ingestion lag above 60 seconds for 5 minutes: warning. Above 5 minutes: page.
- Dropped logs above zero outside of known sampling: warning.
- Error rate 5x the 1-hour baseline: page.
- Log volume 3x the daily baseline: warning (usually a runaway log statement, occasionally a real traffic spike).

**Failure modes.**

Disk full from logs: a service that logs to disk without rotation will fill it. Always run log rotation, cap total log disk usage, and put logs on a separate partition or volume so a full log disk does not take down the application disk.

Shipper backpressure crashing the app: a synchronous logging call that blocks when the shipper is behind turns a logging problem into an availability problem. Use async, non-blocking appenders with bounded queues and a defined overflow policy (see the architecture section). Test what happens when the logging backend is down; the application should degrade, not hang.

Cardinality explosion slowing queries: a new field with millions of unique values gets indexed, queries slow to a crawl, and dashboards time out. Review new indexed fields the way you review schema migrations.

**Log-based alerting vs metrics.** Logs are for diagnosis, metrics are for alerting. Alerting on log patterns is slow (ingestion lag), expensive (every alert query scans data), and brittle (message formats change). The right pattern: emit a metric alongside the log line (a counter incremented in code, or derived at ingest time), alert on the metric, and use the logs to investigate once the alert fires. If you find yourself writing an alert on a log message regex, stop and add a metric instead.

**Runbook pointers.** Document the three queries your team runs most: find all logs for a correlation ID, error rate by service over the last hour, and volume by service over the last day. When an incident starts, nobody should be composing query syntax from scratch. Keep a short runbook with copy-paste queries, the retention windows for each tier, and who to contact when the pipeline itself is down.

## The Checklist

- JSON structured logging in production
- Correlation IDs generated at edge, propagated everywhere, in every log line
- Correct log levels (DEBUG/INFO/WARN/ERROR used properly)
- No secrets, PII, or large payloads in logs
- Static message templates, dynamic values in fields
- Sampling for high-volume success paths, 100% for errors
- Retention policies and volume monitoring
- Cost alerts on log ingestion spikes

Good logging is not about logging more. It is about logging the right things in a format that lets you find answers quickly when it matters.
