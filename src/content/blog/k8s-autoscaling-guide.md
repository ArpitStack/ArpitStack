---
title: "Kubernetes Autoscaling: HPA, KEDA, and Custom Metrics Compared"
date: "2026-12-28"
tags: ["Kubernetes", "Autoscaling", "DevOps"]
description: "HPA vs KEDA vs custom metrics: scaling signals, cooldown behavior, and when each approach makes sense."
readingTime: 11
---

Autoscaling is how Kubernetes handles variable load without human intervention. But "autoscaling" covers three different mechanisms that solve different problems. Using the wrong one leads to either over-provisioning (wasting money) or under-provisioning (dropping traffic).

## Horizontal Pod Autoscaler (HPA): The Baseline

HPA scales Deployments based on observed metrics. The most common is CPU utilization:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

HPA checks metrics every 15 seconds (configurable). If average CPU exceeds 70%, it adds pods. If it drops below, it removes pods after a stabilization window.

Map the full reaction timeline before trusting HPA with spiky traffic. Metrics-server scrapes kubelets on its own interval (60 seconds by default, often tuned lower), then HPA syncs every 15 seconds, then the new pod must schedule, pull its image, start, and pass readiness. End to end, expect 60 seconds at best and several minutes at worst. A traffic spike that doubles in 30 seconds will be over, or will have already caused timeouts, before new pods serve traffic. This is the fundamental limit of reactive autoscaling: it handles ramps, not cliffs. For cliffs you need headroom (over-provisioned minReplicas), faster signals (custom metrics with shorter scrape intervals), or proactive scaling (scheduled scaling ahead of known events, or KEDA with a queue that buffers the spike).

### Cooldown and Stabilization

HPA does not react instantly to every metric fluctuation. Two settings control this:

- **Scale-up stabilization**: How long to wait before scaling up again after a scale event. Default is 0 (scale up immediately if needed).
- **Scale-down stabilization**: How long to wait before scaling down. Default is 300 seconds (5 minutes). This prevents flapping where pods scale down then immediately back up.

```yaml
spec:
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
```

This configuration scales up aggressively (double pods every 30 seconds if needed) but scales down conservatively (halve pods at most every 60 seconds, after 5 minutes of low utilization).

### HPA Limitations

HPA works well for CPU and memory, but these are proxy metrics. High CPU does not always mean you need more pods. A garbage collection pause spikes CPU without increasing actual load. HPA scales on the spike, then scales back down.

For application-aware scaling (queue depth, request rate, custom business metrics), you need more than HPA's built-in resource metrics.

## KEDA: Event-Driven Autoscaling

KEDA (Kubernetes Event-Driven Autoscaling) extends HPA to scale on external metrics: message queue depth, database connections, Prometheus queries, cloud service metrics, and dozens more.

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-scaler
spec:
  scaleTargetRef:
    name: worker
  minReplicaCount: 0
  maxReplicaCount: 50
  triggers:
  - type: aws-sqs-queue
    metadata:
      queueURL: https://sqs.us-east-1.amazonaws.com/123456789/my-queue
      queueLength: "10"
```

This scales workers based on SQS queue depth. If the queue has 100 messages and the target is 10 per pod, KEDA creates 10 pods. When the queue empties, it scales to zero.

### Scale to Zero

KEDA's killer feature is scaling to zero. HPA cannot do this (minReplicas must be at least 1). For batch workers, event processors, or anything that is idle most of the time, scale-to-zero saves significant cost.

The tradeoff is cold start latency. When the first message arrives, KEDA must create pods from zero. If your pods take 30 seconds to start, the first messages wait. For latency-sensitive workloads, keep minReplicaCount at 1.

Two KEDA timings matter in practice. The pollingInterval (default 30s) is how often KEDA checks the trigger; combined with HPA's 15-second loop, scale-up decisions lag the queue by up to 45 seconds before a pod is even requested. The cooldownPeriod (default 300s) is how long KEDA waits after the last trigger activity before scaling to zero; set it too short and pods churn on bursty queues. Also remember KEDA itself is a deployment in your cluster: the operator and its metrics server are single points of failure for every ScaledObject. Run at least two operator replicas, monitor them, and alert on ScaledObject errors, because a dead KEDA operator means nothing scales, and the failure stays silent until load arrives.

### KEDA Scalers

KEDA has 60+ built-in scalers: Kafka lag, Redis list length, PostgreSQL query results, Prometheus metrics, AWS CloudWatch, Azure Service Bus, GCP Pub/Sub, and more. If your scaling signal exists somewhere queryable, KEDA probably supports it.

## Custom Metrics Pipeline

Both HPA (v2) and KEDA can scale on custom metrics, but the metrics need to get into Kubernetes first. The pipeline is:

1. **Application exposes metrics** (Prometheus format on `/metrics`)
2. **Prometheus scrapes** and stores them
3. **Prometheus Adapter** exposes them via the Kubernetes custom metrics API
4. **HPA queries** the API and makes scaling decisions

```yaml
# HPA with custom Prometheus metric
metrics:
- type: Pods
  pods:
    metric:
      name: http_requests_per_second
    target:
      type: AverageValue
      averageValue: 1000
```

This scales when each pod averages more than 1,000 requests per second. It is more accurate than CPU because it measures actual load, not resource consumption.

### The Cardinality Problem

Custom metrics increase Prometheus cardinality. Each unique label combination creates a new time series. If you add a `user_id` label to a request metric, you get one series per user. At scale, this overwhelms Prometheus.

Keep custom scaling metrics low-cardinality: aggregate by service, endpoint, or queue, not by user or request ID.

## Choosing Between Them

**Use HPA with CPU/memory when:**
- Your workload is request-driven and CPU correlates with load
- You want the simplest configuration
- Scale-to-zero is not needed

**Use HPA with custom metrics when:**
- CPU does not correlate with load (I/O-bound, event-driven)
- You have Prometheus and the adapter already running
- You need application-aware scaling signals

**Use KEDA when:**
- Scaling signal comes from an external system (queue, database, cloud service)
- You need scale-to-zero
- You want to avoid running the Prometheus adapter

In practice, many teams use both: HPA for web services (CPU-based) and KEDA for workers (queue-based).

## Common Mistakes

**Scaling on memory.** Memory is not a good scaling signal because it does not decrease when load drops (unless the app releases it). Pods get OOMKilled before HPA reacts. Scale on CPU or custom metrics, set memory limits to prevent noisy neighbors, but do not autoscale on memory.

**Too aggressive scale-down.** The default 5-minute stabilization exists for a reason. Reducing it causes flapping, which is worse than slight over-provisioning. Flapping creates cascading failures as pods churn.

**No maxReplicas limit.** Always set maxReplicas. Without it, a metric spike (or a broken metric) can create hundreds of pods, exhausting cluster resources and cloud budget. The limit is your safety net.

**Ignoring pod startup time.** If pods take 2 minutes to become ready, autoscaling cannot handle traffic spikes faster than that. Either reduce startup time (smaller images, lazy initialization) or over-provision slightly to absorb spikes.

## A Practical Starting Point

For a typical microservice:

```yaml
# HPA: CPU-based, conservative scale-down
minReplicas: 2
maxReplicas: 20
target CPU: 70%
scaleDown stabilization: 300s
```

For a queue worker:

```yaml
# KEDA: queue-depth based, scale to zero
minReplicaCount: 0
maxReplicaCount: 50
queueLength target: 10 messages per pod
```

Monitor actual behavior for a week, then tune. Autoscaling is not set-and-forget. It needs periodic review as traffic patterns change.

## System Architecture

Autoscaling is a control loop: observe a signal, compare against a target, adjust replica count, repeat. The signal path differs between HPA and KEDA, but both end at the Deployment.

```
+----------------+     +------------------+
|  App           |---->|  Prometheus      |
|  metrics       |     |  scrape + store  |
|  endpoint      |     |                  |
+----------------+     +------------------+
                                |
              +-----------------+-----------------+
              |                                   |
              v                                   v
+------------------+                   +------------------+
|  Metrics Adapter |                   |  KEDA Operator   |
|  custom metrics  |                   |  polls triggers  |
|  API             |                   |                  |
+------------------+                   +------------------+
              |                                   |
              +-----------------+-----------------+
                                |
                                v
                     +------------------+
                     |  HPA or          |
                     |  ScaledObject    |
                     +------------------+
                                |
                                v
                     +------------------+
                     |  Deployment      |
                     |  pods scale      |
                     +------------------+
```

The application exposes metrics on its metrics endpoint. Prometheus scrapes and stores them. For HPA with custom metrics, the Prometheus adapter serves them through the Kubernetes custom metrics API. KEDA takes a different path: its operator polls external triggers (SQS queue depth, Kafka lag, CloudWatch) on its own interval and writes the desired replica count through the same scale subresource HPA uses. The HPA controller (or KEDA's ScaledObject) then adjusts the Deployment, and the scheduler places the new pods.

## Scalability

At 10x pod count, the metrics pipeline is the first bottleneck. Metrics-server must scrape every kubelet and pod; on large clusters it needs more CPU and memory than the defaults provide, and an OOMKilled metrics-server means HPA goes blind (it holds the last known replica count, which is safe but frozen). The Prometheus adapter faces the same pressure from the other direction: every HPA querying custom metrics adds query load to Prometheus, so adapter query volume grows with the number of HPAs. Give the adapter its own Prometheus with recording rules that pre-aggregate scaling metrics, keeping per-HPA queries cheap.

At 100x, two new constraints appear. First, API server and etcd churn: every scale event writes to etcd, and hundreds of HPAs scaling simultaneously during a traffic wave create a write burst. HPA behavior policies with rate limits (the scaleUp policies in the example above) are not just cost control; they bound control-plane write rate. Second, node provisioning becomes the true ceiling. Pods can only scale as fast as the cluster autoscaler adds nodes, and node startup takes minutes. At this scale, over-provision with pause pods (low-priority placeholder pods that are evicted instantly when real workloads need the room) so capacity is warm before the spike. The horizontal strategy: metrics pipeline sized ahead of the cluster, HPA rate limits as control-plane protection, and warm node headroom via over-provisioning so pod scale-up never waits on node scale-up.

## Security Considerations

Autoscaling components need cloud and cluster permissions, so scope them tightly. KEDA's service account needs read access to the external systems it polls (SQS, CloudWatch, Kafka); use IRSA to give it an IAM role limited to the specific queues and metrics it reads, not broad cloud read access. The metrics-server and Prometheus adapter need cluster-wide metric read permissions by design, but nothing more.

Protect the metrics endpoints themselves. An application's /metrics endpoint often exposes internal counters, request paths, and sometimes labels with sensitive values. Do not expose it on the public ingress; bind it to the pod IP and let Prometheus scrape it inside the cluster, or put it behind authentication.

The realistic attack vector is metric-driven cost amplification. If an attacker can influence a scaling signal (spoofed requests driving up request-rate metrics, or junk messages flooding a queue), autoscaling obediently scales to maxReplicas and the cloud bill follows. Mitigations: always set maxReplicas as a hard ceiling, alert when any workload sits at maxReplicas for more than 10 minutes, and rate-limit the ingress paths that feed scaling signals. Store KEDA trigger credentials (connection strings, cloud keys) in a secret manager with rotation, never in ScaledObject YAML.

## Production Checklist

Monitoring signals:

- **Desired vs actual replicas** per HPA/ScaledObject. A persistent gap means pods are Pending (capacity) or failing readiness (bad deploy), and autoscaling cannot fix either.
- **HPA metric availability**: events like "unable to get metrics" mean the pipeline is broken. Alert if HPA cannot fetch metrics for more than 5 minutes.
- **KEDA operator health**: operator pod restarts and ScaledObject error conditions. A silent KEDA failure is discovered at the worst possible time.
- **Scale velocity**: how fast replicas change. Sudden jumps to maxReplicas indicate either a real spike or a broken metric; both deserve investigation.
- **Pod startup time**: histogram of time from pod creation to ready. If this drifts upward (bigger images, slower init), your effective reaction time degrades silently.

Failure modes seen in production: metrics-server OOMKilled on a growing cluster, freezing all HPA decisions; Prometheus adapter query timeouts under load, causing HPA to hold stale replica counts; flapping from aggressive scale-down settings, churning pods and cascading into readiness failures; thundering herd on scale-from-zero when a burst of queued messages arrives and dozens of cold pods start simultaneously, spiking the database they all connect to (mitigate with max surge limits or warm connection pools).

Runbook notes: `kubectl describe hpa` shows current vs target metrics and recent events; it is the first command. For KEDA, check the ScaledObject status conditions and the operator logs. If autoscaling misbehaves during an incident, the safe manual override is to set the Deployment's replicas explicitly and temporarily raise HPA minReplicas to match, rather than deleting the HPA (deleting it loses the configuration you will want back). Document the metric names and queries behind each custom-metric HPA so the on-call engineer is not reverse-engineering them at 3 AM.

---

*Autoscaling does not fix capacity planning. It automates the response to load changes you already understand.*
