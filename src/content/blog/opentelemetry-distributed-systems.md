---
title: "OpenTelemetry in Practice: Distributed Systems Guide"
date: "2027-01-25"
tags: ["Observability", "OpenTelemetry", "Distributed Systems", "System Design"]
description: "HLD of an OpenTelemetry pipeline: instrumentation, collectors, backends. Traces vs metrics vs logs, sampling strategies, context propagation, and the real tradeoffs nobody warns you about."
readingTime: 16
---

Observability is not a product you buy. It is a pipeline you design: what to instrument, how to transport telemetry, where to store it, and what to do when the volume exceeds your budget. OpenTelemetry (OTel) is the standard for the instrumentation and transport layers. This post covers designing an OTel pipeline for distributed systems in production, including the tradeoffs that only show up at scale.

## The Three Pillars, Honestly

Everyone recites "traces, metrics, logs." Here is what each is actually for:

- **Traces** answer: what happened during this specific request, and where did the time go? They are for debugging individual requests and understanding service dependencies. High cardinality, high value per unit, expensive to store.
- **Metrics** answer: how is the system behaving in aggregate right now? Request rates, error rates, latencies, resource utilization. Low cardinality (if you are disciplined), cheap to store, the foundation of alerting.
- **Logs** answer: what did the application say happened? Structured events with context. Flexible but expensive at volume, and nearly useless without consistent schemas.

The mistake is treating them as interchangeable. They are not. Metrics drive alerts. Traces drive debugging. Logs fill the gaps. Design your pipeline around that division.

## High-Level Pipeline Architecture

```
+-----------+     +-----------+     +------------+     +-----------+
| Service A |     | Service B |     | Service C  |     |  IoT Edge |
| OTel SDK  |     | OTel SDK  |     | OTel SDK   |     | OTel SDK  |
+-----+-----+     +-----+-----+     +-----+------+     +-----+-----+
      |                 |                 |                  |
      +-----------------+-----------------+------------------+
                                        | OTLP (gRPC/HTTP)
                              +---------v---------+
                              |  OTel Collector   |
                              |  (agent/daemonset)|
                              |  - batching       |
                              |  - tail sampling  |
                              |  - filtering      |
                              +---------+---------+
                                        |
                              +---------v---------+
                              |  OTel Collector   |
                              |  (gateway tier)   |
                              |  - routing        |
                              |  - enrichment     |
                              |  - load balancing |
                              +----+----+----+----+
                                   |    |    |
                    +--------------+    |    +--------------+
                    |                   |                   |
            +-------v-------+   +-------v-------+   +-------v-------+
            | Trace Backend |   | Metrics       |   | Log Backend   |
            | (Tempo/Jaeger)|   | (Prometheus/  |   | (Loki/ES)     |
            +---------------+   |  Mimir)       |   +---------------+
                                +---------------+
```

Two collector tiers is the standard production pattern. Agent collectors run alongside workloads (as a DaemonSet on Kubernetes, or a sidecar) for batching and initial processing. Gateway collectors aggregate, enrich, route, and load-balance to backends. This separation keeps per-node overhead low while centralizing routing decisions.

## System Architecture

The tier diagram above shows where collectors sit. This section shows what happens inside one: the receiver, processor, exporter pipeline and the two mechanisms that keep it alive under pressure.

```
+--------------+     +----------------+     +---------------+     +-----------+
| Receivers    |---->| Processors     |---->| Exporters     |---->| Backends  |
| OTLP gRPC    |     | memory limiter |     | sending queue |     | Tempo     |
| OTLP HTTP    |     | batch          |     | retry with    |     | Mimir     |
| hostmetrics  |     | tail sampling  |     | backoff       |     | Loki      |
| prometheus   |     | filter and     |     +-------+-------+     +-----------+
+--------------+     | drop           |             |
                     +-------+--------+             |
                             |                      v
                             v              +---------------+
                     +----------------+     | Queue full    |
                     | Tail sampling  |     | drop early    |
                     | trace buffer   |     | never block   |
                     +----------------+     | the app       |
                                            +---------------+
```

Data flows left to right. Receivers accept OTLP over gRPC and HTTP, plus hostmetrics and Prometheus scrape targets. Processors transform: the memory limiter, batching, tail-based sampling, and filter or drop rules. Exporters ship to backends with a sending queue and retry with backoff.

Two components matter more than the rest. The memory limiter is the collector's first defense: when total memory crosses its limit, it refuses new data at the receivers, shedding load before the process OOMs. The exporter's sending queue is the shock absorber between a bursty pipeline and a slow backend: bounded size, a configurable number of concurrent senders, and exponential backoff with jitter on failures.

The design point that matters most is where drops happen. Backpressure flows right to left: a slow backend fills the exporter queue, processors block, the memory limiter refuses at the receivers, and the SDKs fail open and drop telemetry client-side. Drops should happen at the edge, early and cheap, before you pay memory and CPU to process data you will discard. A pipeline that drops in the middle, after buffering expensive tail-sampling state, pays for telemetry it throws away. Size the memory limiter below the container's memory limit with headroom, and size exporter queues for the backend's p99 latency rather than its average.

## Instrumentation: What to Actually Emit

The OTel SDKs auto-instrument common frameworks (HTTP servers, database clients, message queues). Auto-instrumentation gets you 70 percent of the value with minimal effort. The remaining 30 percent is manual instrumentation of business logic, and that is where the real debugging value lives.

**Instrument these manually:**

- Domain operations with business context: `order.process`, `payment.authorize`, `device.telemetry.ingest`. Include business identifiers (order ID, device ID) as span attributes.
- External calls not covered by auto-instrumentation: custom protocols, legacy clients, third-party SDKs.
- Background jobs and async workers: these have no incoming HTTP request, so trace context must be propagated manually through job payloads.

**Span attribute discipline:**

Attributes are the most common source of cardinality explosion. Rules:

1. Low-cardinality values only on metrics labels (status codes, regions, service names).
2. High-cardinality values (user IDs, request IDs, device IDs) go on spans and logs, never on metric labels.
3. Define an attribute naming convention up front (follow OTel semantic conventions) and enforce it in code review.

## Context Propagation Across Services

Distributed tracing only works if trace context flows across service boundaries. OTel uses the W3C Trace Context standard: `traceparent` and `tracestate` headers on HTTP, and equivalent metadata on gRPC and message queues.

**Where propagation breaks:**

- **Async boundaries.** A message published to Kafka or SQS does not automatically carry trace headers. You must inject context into message headers (or the message payload) at publish time and extract it at consume time. Every queue consumer needs explicit instrumentation.
- **Background jobs.** Cron jobs, scheduled tasks, and event-driven workers start new traces. Link them to the originating trace with span links when the causal relationship matters.
- **Third-party services.** External APIs will not propagate your trace context. The span ends at your boundary. Document this so nobody expects end-to-end traces through vendors.

For IoT systems like the ones I work with, context propagation extends to the edge: device telemetry ingested through Kinesis or MQTT needs a trace or correlation ID assigned at ingestion, so downstream processing (streaming, batch, alerting) can be correlated back to the originating device event.

## Sampling: The Highest-Leverage Decision

You cannot store every trace at scale. Sampling decides what to keep.

**Head sampling** decides at trace start (usually by a fixed probability). Simple, cheap, but blind: it keeps a random 1 percent, which means it keeps 1 percent of your errors too. At low error rates, you may keep zero traces of the incident you are debugging.

**Tail sampling** decides after the trace completes, based on its content. The collector buffers spans, then keeps traces matching criteria: errors, high latency, specific services, or policy flags. This is strictly better for debugging because you keep the traces that matter.

**Practical strategy:**

- Tail-sample 100 percent of errors and traces exceeding latency thresholds.
- Tail-sample a baseline percentage (1 to 5 percent) of successful traces for capacity planning and dependency mapping.
- Head-sample aggressively (0.1 percent) for extremely high-volume, low-value endpoints like health checks.
- Never sample metrics. Metrics are aggregated, not stored per-request, so sampling them gains nothing.

The tradeoff is collector memory. Tail sampling requires buffering complete traces before deciding, which means the collector holds spans in memory. Size collector memory for peak trace throughput times the maximum trace duration. Undersize it and the collector drops spans under load, which is exactly when you need them most.

Sizing the buffer is arithmetic, not guesswork. Spans held in memory at any moment equal throughput times the longest trace duration you wait for: 50,000 spans per second with a 30-second decision window means 1.5 million spans in flight, and at roughly a kilobyte per span that is on the order of 1.5 GB per gateway replica before sharding. That is why tail sampling is sharded by trace ID across gateway replicas. Consistent-hash routing (the loadbalancing exporter) sends every span of a trace to the same decision-maker, so no replica needs the full buffer and no trace is split across deciders. Get the shard key wrong and traces assemble incompletely, which silently degrades tail sampling into expensive head sampling. And plan the degradation: if the buffer fills during a traffic spike, fall back to head-sampling decisions for new traces while it drains. Alert on buffer saturation, because a saturated buffer during an incident is the pipeline failing exactly when traces matter most.

## Metrics: Cardinality Is the Enemy

A Prometheus-style metrics backend stores one time series per unique label combination. Ten services times five regions times twenty endpoints times ten status codes is 10,000 series before you add anything interesting. Add a `user_id` label and you have millions.

**Cardinality rules:**

1. Never put unbounded values (user IDs, request IDs, device IDs, URLs with IDs) in metric labels.
2. Aggregate at the edge: the collector or SDK should pre-aggregate histograms, not ship raw values.
3. Use exemplars to link metrics to traces: a histogram bucket can carry a trace ID, giving you the aggregate view and the drill-down path without cardinality explosion.

For high-cardinality needs (per-device metrics in IoT, per-tenant metrics in SaaS), use a backend designed for it (ClickHouse, or a metrics backend with label limits and downsampling), or push that data to logs/traces instead of metrics.

## Logs: Structure or Suffer

Unstructured logs are write-only. Enforce structured (JSON) logging with a consistent schema:

```json
{
  "timestamp": "2026-09-22T10:15:30.123Z",
  "level": "error",
  "service": "telemetry-ingest",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "device_id": "symbot-1482",
  "message": "Kinesis put failed after 3 retries",
  "error_code": "ProvisionedThroughputExceededException"
}
```

The `trace_id` and `span_id` fields are the bridge between logs and traces. When every log line carries trace context, jumping from a metric alert to the relevant traces to the relevant logs is one click, not a forensic exercise.

Log volume is the cost driver. Set levels aggressively: `info` for business-significant events only, `debug` off in production by default (enable per-service temporarily during incidents). Ship `warn` and above always.

## Storage Costs: The Conversation Nobody Wants

Observability has a real bill. At scale, telemetry storage often exceeds the cost of the systems being observed. Manage it:

- **Retention tiers.** Hot storage (fast queries) for 3 to 7 days. Warm storage for 30 days. Cold storage (object storage) for compliance retention. Most debugging happens within 48 hours; size hot storage accordingly.
- **Downsampling.** Keep raw metrics for 7 days, downsampled aggregates (5-minute, 1-hour) for 90 days. You lose granularity but keep trends.
- **Drop rules.** Filter known-noisy spans and logs at the collector before they reach backends. Health check traces, static asset requests, and successful readiness probes are the usual candidates.

Track observability cost per service. When a team sees their telemetry bill, instrumentation discipline improves rapidly.

## Scalability

At 10x load the tiers scale differently. The agent tier scales with your nodes: a DaemonSet grows on its own, and per-node overhead stays flat as long as batching is configured sensibly. The gateway tier is where the real work lives. Scale it on telemetry throughput, not CPU: autoscale gateway replicas on exporter queue depth or receiver accepted spans per second. CPU-based autoscaling reacts too late, because a collector can be memory-bound or queue-bound while CPU looks healthy.

Tail sampling is the stateful piece, and stateful pieces need sharding. Route by trace ID with consistent hashing so every span of a trace lands on the same gateway replica, and each replica holds only its share of the trace buffer. Adding replicas then shrinks the buffer per replica, which is the practical answer to the memory math above. The sharp edge: changing the shard count mid-incident splits in-flight traces across old and new rings, and they assemble incompletely. Roll gateway changes carefully and keep the hash ring stable.

Exporter queues are the other scaling knob, tuned per backend. A fast local backend wants a small queue with many concurrent senders; a slow remote backend wants a bounded queue and bounded retries, because unbounded retry against a struggling backend is a retry storm that turns a slowdown into an outage. Every exporter gets exponential backoff with jitter and a maximum elapsed time after which data is dropped instead of retried forever. Dropping telemetry is always preferable to amplifying a backend incident.

At 100x the backend becomes the binding constraint: object storage throughput for trace backends, index and series counts for metrics. The moves turn structural: regional gateway tiers so cross-region traffic is aggregated before it traverses links, per-signal pipelines so a log flood cannot starve trace exports, per-tenant pipelines for noisy-neighbor isolation, and stricter baseline sampling while the error and latency policies stay intact. Egress between tiers becomes a real cost line too; compress OTLP payloads and keep agent-to-gateway traffic in the same zone where possible.

The backpressure contract is the same at every scale: each stage has a bound, and when a bound is hit the stage sheds load toward the edge. The memory limiter refuses at receivers, exporter queues drop instead of growing, SDKs fail open. The pipeline degrades to less telemetry, never to a broken application.

## Security Considerations

Telemetry is sensitive data that most teams treat as exhaust. Span attributes and log bodies routinely capture emails, auth tokens, device identifiers, and request payloads. Design like you believe that.

PII handling needs two layers. The rule is SDK-side: never emit what you should not store, which makes attribute discipline a security control rather than just a cost control. The backstop is collector-side: processors that delete, hash, or redact attributes matching blocklist patterns (authorization headers, tokens, anything shaped like a secret) before data reaches a backend. Backstop, not primary: by the time the collector sees the data it has already crossed the network. Put attribute additions on the code review checklist next to the cardinality rules.

OTLP receivers must authenticate. Agent receivers should bind to localhost or require mTLS; gateway receivers should require bearer tokens or mTLS. An unauthenticated OTLP endpoint on the network is an invitation: anyone can inject fabricated spans that mislead traces during an incident, or flood high-cardinality attributes in a storage denial-of-service that arrives as a bill. This is the same class of mistake as an open database port, one layer up the stack.

Encrypt in transit everywhere, including agent-to-gateway traffic inside the cluster: TLS on all OTLP endpoints. Encrypt at rest in the backends, object storage included. Keep ingestion tokens and backend API keys in a secret manager with rotation, prefer per-tenant tokens so a leak is scoped, and restrict which workloads can reach gateway receivers with network policies. Log pipeline config changes and alert on drift: a quietly widened receiver or a disabled redaction processor is a security event.

## Alerting on Top of the Pipeline

Metrics drive alerts. The hierarchy:

1. **Symptom-based alerts** (what users feel): error rate, p99 latency, availability. Alert on these.
2. **Cause-based dashboards** (what engineers investigate): CPU, memory, queue depth, GC pauses. Dashboard these, alert selectively.
3. **Traces and logs** are for investigation, not alerting. Alerting on log patterns is brittle and noisy.

Define SLOs (service-level objectives) on symptom metrics, and alert on burn rate, not absolute thresholds. A 1 percent error rate is fine for a batch job and catastrophic for a payment API. Burn-rate alerting handles this without per-service threshold tuning.

## Failure Modes of the Pipeline Itself

The observability pipeline is infrastructure, and it fails:

- **Collector overload.** Backpressure from backends causes collectors to queue, then drop. Monitor collector queue depth and drop counters. Scale collectors independently of application workloads.
- **Backend outage.** If the trace backend goes down, do not let telemetry take down the application. OTel SDKs are designed to fail open (drop telemetry, keep serving), but verify this under load. Set SDK export timeouts aggressively.
- **Cardinality incidents.** A bad deployment adds a high-cardinality label, and metric storage explodes overnight. Alert on series count growth rate, and have a runbook for identifying and removing the offending label.

## Production Checklist

- **Monitoring.** The collector exposes its own telemetry, so scrape it: receiver accepted versus refused spans, processor dropped counts, exporter queue size and send failures, and end-to-end freshness (the newest span actually queryable in the backend versus now). Add per-service volume with cost attribution, and active series counts for cardinality. If you cannot see the pipeline, you cannot trust it.
- **Alerting.** Sustained exporter error rate, queue depth above threshold for several minutes, refused or dropped span spikes, series growth rate anomalies, mTLS certificate expiry, backend write latency. Alert on the pipeline's health, not only the application's.
- **Runbooks.** Write them before you need them. Cardinality incident: find the offending label with top-k series queries, deploy a filter processor rule at the gateway, coordinate with the backend team on dropping the label. Collector OOM loop: check memory limiter headroom against the container limit, scale the gateway tier, tighten sampling. Backend outage: verify SDK fail-open behavior under load, enable aggressive drop rules for low-value signals, decide whether queued data is replayable or should be discarded. Sampling misconfiguration: a storage spike means checking what the tail policies actually keep before touching retention.
- **Failure modes.** Retry storms (backoff with jitter, maximum elapsed time, circuit breaking on the exporter). Clock skew across services breaking trace assembly (NTP hygiene is an observability dependency). SDK and collector version skew silently dropping context propagation (pin and upgrade together). Head-of-line blocking when one slow backend shares a pipeline with healthy ones (per-signal pipelines). Config pushes taking down every gateway at once (canary collector config rollouts, like any other deploy).
- **Graceful degradation.** Shed at the receivers first through the memory limiter. Degrade tail sampling to head sampling when the trace buffer is under pressure. Serve dashboards from downsampled aggregates when the hot path is degraded. The invariant holds: the application never blocks on telemetry, and the pipeline never OOMs itself trying to be lossless. Lossless telemetry is not the goal; useful telemetry during incidents is.

## The Real Tradeoff

Every observability decision is a tradeoff between visibility and cost, between signal and noise. The teams that get this right share one trait: they treat telemetry as a designed system, not an afterthought. They decide what to instrument, what to sample, what to store, and for how long, with the same rigor they apply to their application architecture.

Start with metrics for alerting, add tracing for debugging, structure your logs, and sample intelligently. The pipeline does not need to be perfect on day one. It needs to answer two questions reliably: is the system healthy, and when it is not, where do I look first.

Two decisions deserve explicit tradeoff framing. First, tail sampling buys debuggability with memory and operational complexity; if your team will not operate the gateway tier properly, honest head sampling with generous error-biased rates beats a misconfigured tail sampler that drops spans exactly during incidents. Second, backends are a build-versus-buy decision with a real middle option: managed backends remove the scaling burden but charge per unit of telemetry, which makes your sampling and retention policy a direct cost lever. Either way, the pipeline design above stays the same; what changes is who gets paged when the backend is slow.
