---
title: "Kubernetes GPU Scheduling: ML and Microservices Together"
date: "2027-01-07"
tags: ["Kubernetes", "GPU", "Infrastructure", "Cost Optimization"]
description: "Running inference and microservices on shared Kubernetes clusters is becoming normal. GPU scheduling, tenant isolation, and idle-cost control decide whether it works."
readingTime: 15
---

The new normal in platform engineering is heterogeneous: generative model inference running next to payment microservices on the same Kubernetes clusters. The economics demand it. GPUs are too expensive to leave idle while the rest of the cluster hums along. The engineering is the hard part, because Kubernetes was designed around the idea that compute is fungible, and a GPU is anything but.

## The utilization problem

Start with the numbers, because they are brutal. Cast AI's 2026 State of Kubernetes Optimization Report measured utilization across 23,000 production clusters. Fleet-average GPU utilization: 5 percent. AKS clusters averaged 2 percent. EKS averaged 5 percent. GKE reached 6 percent. The best observed fleet, a 136-node H200 LLM inference cluster, sustained 49 percent. That gap between 5 and 49 has almost nothing to do with hardware. It is a scheduling and sharing problem.

An idle GPU is the most expensive idle hardware you will ever own. A single H100 costs more per hour than a rack of CPU nodes, and most teams are paying for that hour while using a twentieth of the card. The fix is not buying fewer GPUs. It is making the GPUs you have actually shared.

## Why scheduling is hard

Out of the box, Kubernetes treats a GPU the way it treats a light switch: on or off, whole or nothing. The default NVIDIA device plugin only knows how to hand out entire cards. There is no concept of "give me a third of a GPU." A notebook that needs 3 GB of memory locks up an entire 80 GB H100 while five other pods sit in Pending.

Two structural problems follow. First, jobs that cannot be placed: a pod requests a GPU, none is free in the right shape, and it waits forever. Second, jobs that hold more device than they use: a training job reserves whole cards for hours while actually saturating them in bursts. Both show up as low utilization, and both are scheduling failures, not workload failures.

Then there is gang scheduling. A distributed training job needs 15 pods that must start together or not at all. The default scheduler does not understand "all or nothing": it places 14, leaves them hanging indefinitely waiting for the 15th, and burns GPU-hours on pods doing nothing. This is the kind of failure that looks like a utilization problem in the dashboard and is really a coordination problem in the scheduler.

## The 2026 tooling

This is the area where 2026 genuinely changed the landscape. The primitives now exist; the work is assembling them correctly.

**Dynamic Resource Allocation (DRA)**, which went GA in Kubernetes 1.34, is the foundation. Instead of requesting an opaque integer GPU count, workloads describe their actual hardware requirements: minimum VRAM, compute capability, driver version. The scheduler matches against real device attributes. This sounds small and is not: it is the difference between "give me a GPU" and "give me a device with at least 40 GB of memory and compute capability 9.0," which is what sharing requires.

**Kueue** handles the queueing side. It is a quota-aware admission controller: GPU jobs wait in a queue until capacity and quota are confirmed available, which eliminates the zombie Pending pods that pollute dashboards and confuse autoscalers. Version 1.3.0 is the current stable release, with first-class JobSet and LeaderWorkerSet support for gang scheduling without a second scheduler binary.

For actually splitting cards, three mechanisms cover the realistic options:

- **MIG (Multi-Instance GPU)**: hardware partitioning on A100, H100, and L40 cards. Strong isolation with dedicated memory and cores per slice. Static: you define partition shapes up front. Best for inference multi-tenancy where tenants need predictable performance.
- **Time-slicing**: the NVIDIA device plugin's software sharing. Flexible and dynamic, works on nearly any GPU, good for bursty or low-utilization jobs. Weaker isolation: no memory partitioning, performance fluctuates under contention.
- **HAMi** (Heterogeneous AI Computing Virtualization Middleware, a CNCF sandbox project): slices physical GPUs into virtual ones bounded by memory and compute, so multiple pods share a card while big training jobs can still claim whole GPUs. Good when you need fractional scheduling without MIG-capable hardware.

On the serving side, the routing layer matured too. The Gateway API Inference Extension defines a standard InferencePool routing contract, and projects like llm-d and NVIDIA Dynamo build KV-cache-aware routing on top of it: requests go to the GPU that already holds the relevant prefix cache. Prefill/decode disaggregation, splitting the two phases of inference onto different hardware, is covered by the same projects. And for the multi-cluster case, Karmada 1.19 graduated in September 2026 with default support for multi-cluster scheduling tailored to AI training jobs.

The honest assessment: the primitives are crowded now. Building another fractional-GPU scheduler or another inference router means competing with serious, well-funded projects. The open work is in assembly and operations: quotas, chargeback, and the unglamorous policy of who gets what.

## System Architecture

The tooling above only works as an assembled pipeline. Here is how the pieces fit on a production cluster.

```
+------------------+     +------------------+     +------------------+
| Workload submit  |---->| Kueue admission  |---->| DRA scheduler    |
| (jobs, deploys)  |     | (quota + gang)   |     | (device attrs)   |
+------------------+     +------------------+     +--------+---------+
                                                              |
                       +--------------------------------------+
                       v
+------------------+     +------------------+     +------------------+
| Inference pool   |     | Training pool    |     | Bursty pool      |
| (MIG slices)     |     | (whole cards,    |     | (time-slice /    |
|                  |     |  NCCL topology)  |     |  HAMi)           |
+--------+---------+     +------------------+     +------------------+
         |
         v
+------------------+     +------------------+     +------------------+
| InferencePool    |---->| GPU metrics      |---->| GPU-hour         |
| routing (KV-cache|     | (DCGM exporter)  |     | chargeback       |
| aware)           |     |                  |     |                  |
+------------------+     +------------------+     +------------------+
```

Data flows in one direction with two feedback loops. The forward path: a workload enters Kueue, which checks quota and gang requirements before the job is even admitted; DRA matches the job's hardware description (minimum VRAM, compute capability) against real device attributes and binds it to a slice, a time-shared card, or whole cards in the right pool; inference traffic then routes through the InferencePool, which sends each request to the GPU already holding the relevant KV cache.

The feedback loops are where operations live. The metrics loop (DCGM exporters on every GPU node) drives pool autoscaling on GPU-native signals: queue depth, token throughput, SM activity. The money loop attributes GPU-hours per namespace and workload, which is what makes quotas and sharing policies enforceable instead of aspirational.

Two latency budgets matter here and nowhere else. Queue admission time (how long a job waits in Kueue) dominates total time-to-start for training jobs. For multi-node training, NCCL initialization and collective bandwidth dominate runtime, which is why placement into the training pool must be topology-aware: the wrong rack placement shows up as slower training, not as a scheduling error.

## Isolation on shared clusters

Sharing hardware does not mean sharing fate. The microservices on the cluster have latency SLOs; the training jobs do not care about your p99. Keep them apart with the standard Kubernetes mechanisms, applied deliberately:

```yaml
# GPU nodes: tainted so only GPU workloads land here
taints:
  - key: "nvidia.com/gpu"
    value: "true"
    effect: "NoSchedule"
```

```yaml
# Inference pods: tolerate the taint, request a fractional device
tolerations:
  - key: "nvidia.com/gpu"
    operator: "Exists"
    effect: "NoSchedule"
resources:
  limits:
    nvidia.com/gpu: 1
```

Node pools per workload class are the practical unit: a pool for inference with MIG slices, a pool for training with whole cards, and the CPU microservices nowhere near either. Taints and tolerations keep the scheduling honest. Namespaces with resource quotas per team keep the politics honest: every team gets a GPU budget, and the queue (Kueue) enforces it.

Topology awareness matters more than most teams expect. Place inference pods close to the data they serve and close to each other; cross-NUMA or cross-node chatter shows up directly in tail latency. The scheduler plugins for topology exist. Use them for anything latency-sensitive.

## Autoscaling and cost control

Scale GPU pools on the right signals. CPU utilization is meaningless for a GPU pool. What works: queue depth (how many jobs are waiting), token throughput for inference, or custom metrics exported from the workload itself. Scale to zero where the workload allows it. A GPU pool sitting at zero costs nothing, which is the correct price for idle.

Spot and preemptible instances are the other large lever. Batch inference, offline evals, and fault-tolerant training with checkpointing can run on spare capacity at a fraction of the price. Do not put latency-sensitive serving on preemptible nodes unless you enjoy incident reviews.

And then the part platform teams avoid: chargeback. GPU-hours are the most legible cost unit in the cluster. Attribute them per team, per namespace, per workload, and publish the numbers. Nothing focuses a team's mind on utilization like seeing its own GPU bill. This is the same attribution problem I work on with CostReveal for AI and cloud spend generally: you cannot manage what you cannot attribute.

## Scalability

GPU scheduling has scaling failure modes that CPU scheduling does not, because the resource is scarce, stateful, and topology-sensitive.

**Scheduling at scale.** The default scheduler binds a few hundred pods per second in practice; scheduler plugins for topology and DRA add per-pod latency on top. At fleet scale this is rarely the bottleneck. The queue is. Kueue admission throughput and queue wait time dominate, and when quotas are tight, most jobs spend more time waiting than binding. Size your quotas from measured wait-time SLOs, not from guesswork: if training jobs routinely wait hours, the quota is wrong or the pool is too small.

**Bin-packing and fragmentation.** Fractional GPUs fragment. MIG slice shapes are static per card, so a card configured for small slices cannot serve a job that needs a larger slice, and mixed shapes across a fleet leave unusable slivers. DRA matches precisely but does not defragment; operators periodically drain cards and reconfigure MIG profiles to match the actual workload mix. Time-slicing avoids this class of problem entirely (any pod fits anywhere) at the cost of isolation, which is one reason bursty pools stay time-sliced even at scale.

**Multi-node training topology.** Within a node, GPUs talk over NVLink or NVSwitch at terabytes per second. Across nodes, they talk over InfiniBand or RoCE at an order of magnitude less. NCCL collectives (all-reduce for gradient sync) run at the speed of the slowest link in the group, so placement is performance: training pods must land on nodes sharing the same fabric, ideally the same rack or IB switch. Label nodes with their fabric topology and use topology constraints to keep jobs together. At 100x scale, the network becomes the bottleneck before the GPUs do, and the fix is procurement (fabric capacity) plus placement, not more cards.

**Time-slicing vs MPS vs MIG at fleet scale.** These three answer different questions:

- **Time-slicing** is the simplest: the device plugin multiplexes whole GPUs across pods in software. Zero configuration, works on any card, fits bursty and heterogeneous workloads. No memory isolation, noisy neighbors, performance varies with contention. At fleet scale it is the right default for dev, notebooks, and batch inference where SLOs are soft.
- **MPS (Multi-Process Service)** shares a single CUDA context across processes on one card, cutting context-switch overhead. Throughput is better than time-slicing for many small kernels, which suits inference servers packing many small models onto one GPU. The cost is fate-sharing: one MPS server process mediates every client, so a crash or a misbehaving client affects all of them, and isolation is weaker than MIG. Use it where you control the whole stack on the card, not for mutually untrusted tenants.
- **MIG** is hardware partitioning with dedicated streaming multiprocessors and memory per slice. Strong isolation, predictable performance, the right choice for multi-tenant serving with latency SLOs. Static: profiles are set per card, reconfiguration requires draining, and it only exists on datacenter cards (A100, H100, L40 and their successors).

The fleet pattern that survives contact with production: MIG slices for the production inference tiers, time-slicing for dev and bursty pools, whole cards for training, MPS selectively where a single team owns the card and needs throughput. Revisit the mix quarterly; workload shapes drift and static partitions do not.

**Queueing and backpressure.** Kueue ClusterQueues carry nominal quotas per resource flavor, with borrowing across cohorts and preemption policies. Give inference serving a higher priority class than batch training so preemption flows the right way: training yields, serving does not. Publish queue wait time per team; it is the backpressure signal that tells you whether to buy more GPUs or fix quotas.

```yaml
apiVersion: kueue.x-k8s.io/v1beta1
kind: ClusterQueue
metadata:
  name: gpu-training
spec:
  namespaceSelector: {}
  resourceGroups:
  - coveredResources: ["nvidia.com/gpu"]
    flavors:
    - name: h100-flavor
      resources:
      - name: "nvidia.com/gpu"
        nominalQuota: 32
  preemption:
    reclaimWithinCohort: Any
    withinClusterQueue: LowerPriority
```

## Security Considerations

Shared GPUs have a threat model that shared CPUs do not, because GPU memory behaves differently.

**GPU memory is not zeroed between workloads.** When a pod exits, its VRAM contents (model weights, prompts, embeddings, intermediate activations) can persist, and the next pod scheduled onto that card can read them. This is documented behavior, not a bug, and there is published research demonstrating cross-tenant reads on shared GPUs. The mitigations, in order of strength: MIG slices give hardware memory isolation per slice, so this class of leak does not cross slice boundaries; on time-sliced or HAMi-shared cards, require a memory scrub between tenants (driver reset hooks or explicit clearing before the next pod binds); for high-sensitivity tenants, use dedicated cards and reboot the node between tenants. If your threat model includes mutually untrusted tenants, time-slicing alone is not sufficient.

**MPS sharing risks.** The MPS server is a single userspace process mediating all client processes on the card. A crash takes down every client, and a malicious or buggy client can degrade the shared CUDA context. MPS is a throughput optimization for workloads you control, not an isolation boundary. Do not place untrusted tenants on the same MPS server.

**Tenant isolation.** Apply the standard Kubernetes mechanisms deliberately: namespaces with GPU quotas per team, taints and tolerations keeping workload classes on their pools, NetworkPolicies so training jobs cannot reach inference serving endpoints they have no business calling, Pod Security Standards enforced, and secrets (model weights, API keys) delivered through an external secret store rather than baked into images.

**The device plugin and GPU operator.** The NVIDIA device plugin runs as a privileged DaemonSet with host access; the GPU Operator manages drivers, the plugin, and DCGM exporters across the fleet. A compromise here is node compromise, fleet-wide if the DaemonSet is. Pin versions, review updates, and restrict the RBAC around these components to platform administrators.

**Side channels.** Timing and power side channels are stronger on time-sliced sharing and weaker on MIG. This rarely matters between trusted internal teams; it matters the moment you host external or mutually untrusted tenants on shared cards, in which case the answer is MIG or dedicated hardware.

## Production Checklist

GPU fleets fail in GPU-specific ways. Monitor for them specifically.

**Monitoring.** Per-GPU DCGM metrics on every node: SM utilization, memory used versus total, temperature, power draw, and Xid errors. NVLink error counters on multi-GPU nodes. Device plugin health: GPUs visible per node should match the hardware inventory. Kueue queue wait time per queue and preemption rate. Pending GPU pods and why they are pending (quota, gang, or device mismatch are different problems). Inference p99 latency correlated with GPU saturation, so you can tell serving pain from scheduling pain.

**Alerting.** GPU Xid errors (hardware or driver faults). GPU count mismatch on a node (device plugin crash). NVLink down. Queue wait time breaching the SLO you promised teams. Preemption storms after quota changes. Chargeback anomalies: a tenant's GPU-hours spiking unexpectedly is either a runaway job or a compromised one.

**Runbooks.** GPU node failure mid-training: cordon the node, confirm checkpoint state, reschedule, replace the node. MIG reconfiguration: cordon, drain, reconfigure profiles, uncordon, verify slice inventory. Driver or CUDA mismatch after a node image upgrade: pin driver versions in the GPU Operator and roll back the image. Mass preemption after a quota change: communicate first, then change, and keep a rollback for the quota.

**Failure modes.** Device plugin DaemonSet crash means GPUs silently vanish from scheduling while pods pile up in Pending. Scheduler plugin misconfiguration can lock whole cards for fractional requests. Preemptible or spot reclaim during training without checkpointing means the run restarts from zero.

**Graceful degradation.** Priority-based preemption with batch training yielding to serving. Checkpoint-on-preemption hooks so interrupted training resumes instead of restarting. Under contention, degrade gracefully: smaller batch sizes, a smaller model variant, or queued batch inference instead of failed real-time inference.

## Where to start

In order, because sequence matters:

1. Audit utilization first. Measure per-GPU, per-namespace, per-workload. You cannot fix what you have not measured, and the numbers will surprise you.
2. Pick the sharing mechanism by workload. MIG slices for multi-tenant inference on capable hardware. Time-slicing or HAMi for bursty and heterogeneous fleets. Whole cards reserved for training that actually needs them.
3. Add DRA and Kueue if you are on Kubernetes 1.34 or later. Precise hardware requests plus quota-aware queueing fix the two structural causes of idle GPUs.
4. Separate the pools, set the quotas, publish the chargeback. The technical work is done; the rest is policy.

Heterogeneous clusters are not a temporary awkward phase. Inference and microservices are going to share hardware for the foreseeable future, because the economics insist on it. The teams that treat GPU scheduling as a first-class platform concern, with real quotas and real attribution, will run the same workloads on half the hardware. Everyone else will keep paying for 5 percent.
