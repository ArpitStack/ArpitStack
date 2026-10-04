---
title: "Kubernetes Cost Optimization That Actually Works"
date: "2027-01-04"
tags: ["Kubernetes", "Cost Optimization", "DevOps", "Cloud Infrastructure"]
description: "A practical guide to cutting Kubernetes spend: right-sizing workloads, autoscaling that responds to real demand, spot instances without the pain, and placement strategies that bin-pack efficiently."
readingTime: 15
---

Kubernetes makes it easy to spend money. The defaults are generous, the abstractions hide the cost, and nobody notices until the bill arrives with an extra zero.

This post is the practical guide I wish existed: right-sizing, autoscaling, spot instances, and workload placement, with real tradeoffs and real numbers. No theory. Just what works.

## Why Kubernetes Wastes Money by Default

Three mechanisms, all working against you:

1. **Requests drive scheduling and cost.** The scheduler places pods based on requests, and on most clouds you pay for the node regardless of utilization. A pod requesting 2 CPUs but using 0.2 wastes 1.8 CPUs of capacity you are paying for.
2. **Static sizing for dynamic workloads.** Teams set requests once at deploy time, usually by guessing, usually generously. Workloads change; requests do not.
3. **No default autoscaling.** Out of the box, nothing scales. You must configure HPA, the cluster autoscaler, or both, and most teams configure them late or wrong.

The fix is systematic: measure actual usage, right-size, automate scaling, use cheaper capacity, and place workloads intelligently.

## System Architecture

Every technique in this post is one loop in a shared control plane. The loops interact, so it helps to see them together before tuning any one of them.

```
+------------------+     +------------------+     +------------------+
| Metrics pipeline |---->| VPA (recommend)  |---->| Right-sized      |
| (actual usage)   |     | (p95 sizing)     |     | requests         |
+--------+---------+     +------------------+     +------------------+
         |
         v
+------------------+     +------------------+     +------------------+
| HPA (business    |---->| Cluster          |---->| Node pools       |
| metric) + KEDA   |     | Autoscaler       |     | (on-demand/spot) |
+------------------+     +------------------+     +--------+---------+
                                                            |
         +--------------------------------------------------+
         v
+------------------+     +------------------+
| OpenCost         |---->| Per-team         |
| cost attribution |     | dashboards       |
+------------------+     +------------------+
```

Each loop runs at a different speed, and the speed determines what it is good for:

- **Sizing loop (days).** VPA observes usage and recommends requests. Slowest loop, biggest payoff: it decides how much capacity the scheduler thinks each pod needs.
- **Pod loop (tens of seconds).** HPA and KEDA react to business metrics and queue depth. Fast enough to track demand, slow enough that pod startup time dominates the reaction.
- **Node loop (minutes).** The cluster autoscaler adds nodes in a few minutes and removes them conservatively after roughly ten minutes of underutilization. This asymmetry is deliberate: scale-up must be fast, scale-down must not flap.
- **Money loop (hours).** OpenCost attributes node cost to namespaces and pods, feeding dashboards and budget alerts.

The loops couple in ways that bite. Aggressive scale-down plus slow pod startup causes oscillation: nodes leave, traffic returns, pods wait on new nodes. Stale VPA recommendations after a quiet week suggest lower requests right before a traffic spike. And everything downstream of the metrics pipeline freezes if that pipeline lags, so treat metrics as critical infrastructure, not as an observability nice-to-have.

## Right-Sizing: Requests vs Limits

Get this wrong and everything else is wasted effort.

**Requests** are what the scheduler uses for placement and what you effectively pay for. **Limits** are the ceiling before throttling (CPU) or OOM-kill (memory). The most common mistake is setting requests equal to limits at a generous value, which guarantees waste.

The workflow:

1. Run the Vertical Pod Autoscaler (VPA) in recommendation mode for two weeks. Do not enable auto mode yet. VPA observes actual usage and recommends request values.
2. Compare recommendations against current requests. Teams routinely over-request CPU by 2x to 4x and memory by 1.5x to 3x. A service requesting 1000m CPU and using 250m is typical, not exceptional.
3. Set requests near the p95 of actual usage, not the peak. Peaks are what limits and HPA are for.
4. Set memory limits with a buffer above requests (20 to 30 percent) to absorb spikes without OOM-kills. Set CPU limits higher, or leave them unset for burstable workloads, since CPU throttling degrades gracefully while memory exhaustion kills the pod.

```yaml
# Before: guessed, wasteful
resources:
  requests:
    cpu: "1000m"
    memory: "2Gi"
  limits:
    cpu: "1000m"
    memory: "2Gi"

# After: based on VPA recommendations (p95 usage: 280m CPU, 900Mi memory)
resources:
  requests:
    cpu: "350m"
    memory: "1Gi"
  limits:
    cpu: "1000m"
    memory: "1.5Gi"
```

That one change cuts the schedulable footprint by roughly 60 percent. Multiply across a fleet and the savings are immediate.

VPA in auto mode is the next step, but be careful: VPA restarts pods to apply new sizes, which causes disruption. Use auto mode for stateless workloads with proper PodDisruptionBudgets; keep recommendation mode for stateful or sensitive services.

## Autoscaling: Four Layers

**1. Horizontal Pod Autoscaler: CPU and memory.**

The baseline. HPA watches metrics and adjusts replica counts. It works, but understand its limits: the metrics pipeline has a 15 to 30 second delay, scale-up takes time (pod startup plus readiness), and CPU-based scaling reacts to symptoms, not causes. A pod at 90 percent CPU might be handling a traffic spike or might have a goroutine leak. HPA cannot tell the difference.

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
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

Set minReplicas to handle baseline plus buffer. Set maxReplicas to a number your cluster and downstream dependencies can actually support. An HPA that scales your API to 50 pods against a database with 100 max connections just moves the bottleneck. Check the database connection limit before you celebrate the autoscaling.

**2. KEDA: event-driven autoscaling.**

For workers consuming queues or Kafka topics, CPU is the wrong signal. Queue depth is the right signal. KEDA (Kubernetes Event-Driven Autoscaling) scales on external metrics and, critically, scales to zero when there is no work.

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-scaler
spec:
  scaleTargetRef:
    name: worker
  minReplicaCount: 0
  maxReplicaCount: 30
  triggers:
  - type: kafka
    metadata:
      bootstrapServers: kafka:9092
      consumerGroup: workers
      topic: jobs
      lagThreshold: "100"   # scale up when lag exceeds 100 messages
```

Scaling to zero is where the real money is for batch and async workloads. A worker pool sitting at 5 replicas overnight processing nothing is pure waste. KEDA eliminates it.

**3. Cluster Autoscaler: node-level scaling.**

Pod autoscaling is useless if there are no nodes to schedule onto. The cluster autoscaler adds and removes nodes based on unschedulable pods and utilization.

The sharp edges:
- Scale-down is conservative by default (10 minutes of underutilization before a node is considered). Tune the scale-down delays if you want aggressive savings, but understand the tradeoff: faster scale-down means slower scale-up when traffic returns.
- PodDisruptionBudgets control how aggressively nodes drain. Overly strict PDBs block scale-down entirely. Audit them.
- The autoscaler cannot help if pods have anti-affinity rules or volume constraints that prevent consolidation. Design workloads for packability.

**4. Custom metrics: scaling on what matters.**

For APIs, requests per second per pod is often a better signal than CPU. For ML inference, GPU utilization or queue depth. The custom metrics API (via the Prometheus Adapter) lets HPA target these directly.

The pattern worth adopting: HPA on CPU as a safety net, plus a primary scaler on the business metric (requests per second, queue depth, p99 latency). Two signals, one scaling decision.

## Spot Instances: Cheap Capacity with Conditions

Spot instances (AWS), Spot VMs (GCP), and Spot (Azure) offer 60 to 90 percent discounts for capacity that can be reclaimed with short notice. On AWS you get a 2-minute interruption warning. That is enough for graceful handling if you design for it.

What works on spot:
- Stateless API servers behind a load balancer, with PodDisruptionBudgets set
- Batch workers and CI runners that checkpoint progress and resume on restart
- Development and staging environments

What does not:
- Stateful workloads with local data, unless you enjoy data loss
- Single-replica critical services, where an interruption means an outage
- Workloads that cannot drain within the notice window

The setup:
- Mixed instance types in your node groups. Do not pin to one instance type; spot availability varies by type and zone. Diversify across families.
- Node labels for workload targeting: `workload-class: spot-tolerant` versus `workload-class: on-demand`. Critical pods get node affinity for on-demand; everything else tolerates spot.
- Interruption handling: install the AWS Node Termination Handler or equivalent. It watches for spot interruption notices and cordons and drains the node gracefully.

```yaml
# Spot-tolerant workload: prefers spot, tolerates interruption
affinity:
  nodeAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      preference:
        matchExpressions:
        - key: workload-class
          operator: In
          values: ["spot"]
```

```yaml
# Critical workload: on-demand only, no exceptions
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
      - matchExpressions:
        - key: workload-class
          operator: In
          values: ["on-demand"]
```

Realistic expectation: 40 to 60 percent of a typical stateless fleet can run on spot. The discount on that portion is around 70 percent. Blended across the fleet, expect 25 to 40 percent total compute savings. Significant, not magical.

## Workload Placement: Bin Packing That Works

The scheduler bin-packs based on requests. If your requests are accurate (see right-sizing above), the default scheduler does a reasonable job. These refinements matter:

**Topology Spread Constraints.** Without them, the scheduler may stack all replicas on one node (fast to schedule, terrible for resilience) or scatter them in ways that waste capacity. Spread across zones for resilience, but keep the constraint soft so pods still schedule when perfect spreading is impossible.

```yaml
topologySpreadConstraints:
- maxSkew: 1
  topologyKey: topology.kubernetes.io/zone
  whenUnsatisfiable: ScheduleAnyway
  labelSelector:
    matchLabels:
      app: api
```

`ScheduleAnyway` is usually the right call: prefer spreading, but do not leave pods unscheduled over it.

**Pod affinity for co-location.** If service A calls service B on every request, scheduling them on the same node or zone reduces latency and cross-AZ data transfer costs. Cross-AZ traffic is not free. On AWS it runs about $0.01 per GB each way, which adds up fast for chatty services.

**Separate node pools by workload class.** System pods, spot-tolerant workloads, GPU workloads, and memory-intensive workloads each get their own pool with appropriate instance types. Mixing a memory-hungry search pod with CPU-hungry API pods on the same nodes guarantees that one resource is always wasted.

## Cost Allocation: Know Who Spends What

Optimization without allocation is flying blind. Before cutting, know where the money goes.

- Label every namespace with team and cost center: `team: platform`, `cost-center: engineering`.
- Deploy OpenCost (open source). It allocates node costs to namespaces and pods based on resource usage. The numbers are approximate for shared resources, but directionally correct.
- Build per-team dashboards. Show each team their spend trend. Most cost reduction comes from visibility, not from platform team heroics. When a team sees they spend $8k per month on an idle staging namespace, they fix it themselves.
- Start with showback (visibility). Move to chargeback (accountability) only when the data is trusted. Nothing kills a cost program faster than disputed numbers.

## Putting It Together: A Realistic Sequence

If I inherited an expensive cluster tomorrow, this is the order:

1. **Week 1: visibility.** Deploy OpenCost, label namespaces, build the dashboard. Find the top five spending namespaces. There is always a surprise.
2. **Week 2: right-size the top offenders.** VPA recommendations, adjust requests, watch for a week. This alone typically cuts 20 to 30 percent.
3. **Week 3: autoscaling.** HPA on the right metrics, KEDA for workers, verify the cluster autoscaler is enabled and tuned.
4. **Week 4: spot.** Move stateless workloads to mixed spot and on-demand node groups. Another 15 to 25 percent on compute.
5. **Ongoing: placement and hygiene.** Topology constraints, idle namespace cleanup, regular right-sizing reviews.

Total realistic savings for a typical over-provisioned cluster: 40 to 60 percent. Not through heroics, but through the unglamorous work of measuring, sizing correctly, and automating what should have been automated from the start.

## Scalability

These techniques work on a ten-node cluster. What changes at ten or a hundred times the scale is which component becomes the bottleneck.

**At 10x**, the first thing to degrade is usually the metrics pipeline, not the scheduler. Per-pod metric cardinality grows with the pod count, Prometheus queries slow down, and HPA starts making decisions on stale data. The second is the cluster autoscaler: its scale-up simulation runs against every node group, and decision latency grows with the fleet. Watch scale-up latency (pending pod to running node) as your early warning.

**At 100x**, you hit hard platform limits: a single Kubernetes cluster tops out around five thousand nodes and a hundred and fifty thousand pods. Past that, the strategy is sharding: multiple clusters split by team, region, or failure domain, with cost allocation aggregated above them. Each cluster keeps its own autoscaling loops; what you centralize is policy (quotas, budget alerts, approved instance families) and the money loop.

Cross-AZ data transfer deserves special mention at scale because it grows linearly with traffic and nobody budgets for it. At small scale it is noise. At a hundred times the traffic, chatty services across zones become a line item. This is where placement stops being a nicety.

**Horizontal scaling strategy.** Separate node pools by workload class so scaling decisions stay independent: bursty APIs scale on one pool while batch workers scale on another, and neither fights the other for nodes. For predictable peaks, scheduled scaling beats reactive scaling: pre-warm capacity before the known traffic window instead of letting the autoscaler discover it. For unpredictable peaks, keep headroom on the critical pools and accept the cost; the alternative is throttling revenue traffic to save pennies.

**Queueing and backpressure.** The queue is the shock absorber. Scale workers on queue depth or lag, not CPU, and let the queue absorb spikes that would otherwise require overprovisioned API capacity. But queues need bounds: cap maxReplicas so a poison message or a traffic flood scales you into a billing event, and know the real ceiling downstream. Most APIs are not limited by pods; they are limited by database connections, and scaling pods past that limit just moves the queue to the database while spending more. Load shedding (fast 503s at the edge) is a cost control: it is cheaper to reject excess load cleanly than to autoscale into it.

## Security Considerations

Cost controls touch privileged components, so they deserve a security review, not just a performance one.

- **Cluster autoscaler IAM.** It can create and terminate cloud instances, which is about as powerful as it gets. Scope it with dedicated instance profiles, restrict allowed instance families, and require resource tags so stray nodes are identifiable. Review these permissions the way you would review admin access, because that is what they are.
- **VPA RBAC.** The VPA updater patches pod resources and evicts pods. Run it in recommendation mode for sensitive namespaces, and restrict its RBAC to the namespaces it is allowed to resize.
- **Admission webhooks.** KEDA, VPA, and mutating webhooks in general sit in the critical path of every pod creation. Require TLS, set sane failure policies (failing closed on a broken webhook can halt all scheduling), and pin their images.
- **Metrics and spend data.** Per-team spend dashboards are sensitive: they reveal headcount-adjacent information and project activity. Put them behind auth with team-scoped access, and apply the same RBAC discipline to the metrics endpoints themselves.
- **Quota as a security boundary.** ResourceQuotas per namespace are not just cost guardrails; they cap the blast radius of a compromised workload. A hijacked pod that can scale to a thousand replicas is a billing attack. Combine quotas with maxReplicas on every autoscaler and budget alerts as a tripwire: unexpected spend spikes are often the first sign of crypto mining, which shows up in the bill before it shows up in any security tool.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-quota
  namespace: team-a
spec:
  hard:
    requests.cpu: "40"
    requests.memory: "160Gi"
    pods: "100"
```

- **Supply chain.** The autoscaler, VPA, KEDA, the termination handler, and OpenCost all run with elevated privileges. Pin their image versions, scan them, and update them deliberately. A compromised DaemonSet on every node is a cluster-wide compromise.

## Production Checklist

Optimization that is not monitored rots. These are the signals worth alerting on.

**Monitoring.** Track requests versus actual usage per namespace (the core efficiency ratio), idle CPU and memory hours per node pool, spot interruption rate, HPA desired versus actual replicas (divergence means the autoscaler is fighting something), scale-up latency from pending pod to running node, VPA recommendation age, and the count of unschedulable pods.

**Alerting.** Budget thresholds at 50, 80, and 100 percent of monthly forecast. Spend deviation against the trailing seven-day baseline. Cluster autoscaler errors. Pods stuck pending longer than ten minutes. OOM-kill rate increases in the week after a right-sizing change (the canary that your new requests are too tight). Stale metrics from the pipeline HPA depends on.

**Runbooks.** Write these before you need them: a spot interruption storm (shift critical workloads to on-demand, relax disruption budgets temporarily), HPA flapping (widen the stabilization window, check whether the metric itself is noisy), VPA recommending too-low requests after a quiet week (pin minimum requests, require two weeks of history before applying), cluster autoscaler refusing to scale down (audit PodDisruptionBudgets and anti-affinity rules first; they are the usual suspects).

**Failure modes.** If the metrics pipeline goes down, HPA holds the last replica count: safe, but blind, so alert on metric staleness. If the termination handler dies, spot interruptions become hard kills with no drain. If OpenCost goes down, you are flying blind on spend; keep a fallback budget alert at the cloud billing level.

**Graceful degradation.** Set minReplicas floors on critical services so no autoscaler can scale them to zero. During known peak events, temporarily disable aggressive scale-down rather than trusting the loops under unusual load. And during incidents, pause the autoscalers: the last thing a responder needs is the platform fighting their manual changes.

The throughline to cost attribution: every optimization above is more powerful when you can attribute the savings. "We cut cluster spend 45 percent" is good. "We cut the API team's spend 45 percent by right-sizing their 12 services" is what changes behavior. Measure per team, per namespace, per workload. The engineering and the economics are the same problem.
