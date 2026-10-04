---
title: "Zero-Downtime Deployments on Kubernetes: Rolling, Blue-Green, Canary"
date: "2027-03-25"
tags: ["Kubernetes", "DevOps", "Deployments"]
description: "Deployment strategies compared: rolling updates, blue-green, and canary. Traffic shifting, rollback, and readiness gates."
readingTime: 11
---

"Zero downtime" is a requirement, not a feature. Kubernetes provides the primitives, but the strategy you choose determines whether deployments are boring or terrifying. This post covers the three main approaches, when to use each, and what breaks in practice.

## Rolling Updates: The Default

Rolling updates replace pods incrementally. Kubernetes creates new pods, waits for them to become ready, then terminates old ones. The Deployment controller manages this with two parameters:

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # How many extra pods above desired count
      maxUnavailable: 0  # How many pods can be down (0 = zero downtime)
```

With `maxUnavailable: 0`, Kubernetes never terminates an old pod until a new one is ready. This is the zero-downtime configuration. It requires that your application handles two versions running simultaneously, which is true for most stateless services but needs verification for stateful ones.

Two subtleties catch teams here. First, PodDisruptionBudgets interact with rolling updates: a PDB that requires full availability can block the rollout entirely, because the controller cannot evict old pods and the deploy stalls with no obvious error beyond "waiting". Set PDBs to leave headroom (minAvailable below 100%, or maxUnavailable of at least 1). Second, maxSurge costs real capacity. With maxSurge of 1 on a 50-pod deployment you need room for one extra pod; with 50% you need room for 25. On a tightly packed cluster the surge pods stay Pending and the rollout hangs. Pre-flight deploys with a capacity check, or keep the cluster autoscaler responsive enough to add nodes during rollouts.

### What Breaks

**Readiness probes that lie.** The most common rolling update failure is a readiness probe that returns success before the application can actually serve traffic. The pod gets added to the Service endpoints, receives requests, and fails them.

A readiness probe must verify actual serving capability, not just process liveness:

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
```

The `/health/ready` endpoint should check database connectivity, cache availability, and any other dependency required to serve requests. A simple "process is running" check is a liveness probe, not a readiness probe.

**Database migrations.** If v2 requires a schema change that v1 cannot handle, a rolling update breaks. The fix is expand-contract migrations: first deploy a migration that is backward-compatible with v1, then deploy v2, then clean up. Never deploy breaking schema changes in the same release as the code that needs them.

**Long termination.** Pods get SIGTERM and have `terminationGracePeriodSeconds` (default 30s) to shut down. If your app ignores SIGTERM or takes longer than the grace period, Kubernetes SIGKILLs it, dropping in-flight requests. Implement graceful shutdown:

- Catch SIGTERM
- Stop accepting new connections
- Finish in-flight requests (with a timeout)
- Close database connections
- Exit

## Blue-Green: Two Full Environments

Blue-green runs two complete copies of the application. Blue is live, green is the new version. You deploy to green, test it, then switch traffic all at once.

On Kubernetes, this is typically implemented with two Deployments and a Service that you repoint:

```yaml
# Service initially points to blue
apiVersion: v1
kind: Service
metadata:
  name: app
spec:
  selector:
    app: myapp
    version: blue
---
# After green is verified, update selector to version: green
```

Or use Argo Rollouts, which automates this with analysis templates.

### When Blue-Green Makes Sense

- **Database-heavy changes** where rolling updates risk version skew
- **Major version upgrades** where you want instant rollback (just repoint the Service)
- **Regulated environments** where you need a fully tested artifact before any production traffic

### Tradeoffs

Blue-green doubles resource usage during deployment. For large applications, this is expensive. It also requires that your data layer handles the cutover. If green writes data in a new format, blue cannot read it after rollback.

Instant rollback is the main advantage. If green has a problem, you switch the Service back to blue in seconds. No waiting for pods to roll.

## Canary: Gradual Traffic Shifting

Canary deployments shift a small percentage of traffic to the new version, monitor metrics, then gradually increase. If error rates spike, traffic shifts back automatically.

Kubernetes does not do this natively. You need a service mesh (Istio, Linkerd) or a progressive delivery tool (Argo Rollouts, Flagger).

```yaml
# Argo Rollouts canary example (simplified)
spec:
  strategy:
    canary:
      steps:
      - setWeight: 10
      - pause: {duration: 5m}
      - analysis:
          templates:
          - templateName: error-rate
      - setWeight: 50
      - pause: {duration: 10m}
      - setWeight: 100
```

The analysis template defines success criteria. If error rate exceeds the threshold during the 10% phase, the rollout aborts and traffic returns to the stable version.

### What to Measure During Canary

- Error rate (5xx responses as a percentage of total)
- Latency (p95 and p99, not just average)
- Business metrics (conversion rate, if applicable)
- Resource usage (does the new version use more CPU/memory?)

Canary without automated analysis is just a slow rolling update. The value is in the automatic rollback when metrics degrade.

### When Canary Makes Sense

- **High-traffic services** where even a brief full outage is unacceptable
- **Risky changes** (new algorithms, major refactors) where you want production validation
- **Services with good observability** (you need reliable metrics for the analysis to work)

Canary is overkill for low-risk changes or services with poor monitoring. If you cannot define what "healthy" means in metrics, canary analysis cannot help you.

The canary failure mode that burns teams is stateful traffic. If the service relies on sticky sessions or in-memory session state, shifting 10% of traffic to canary pods breaks affinity for those users: their next request may land on a stable pod that has never seen their session. Fix it before canarying: externalize sessions (Redis is the usual answer) or pin canary traffic by a stable key such as a user id hash instead of a random percentage. The other classic is the canary that passes every technical metric but fails business metrics: a new ranking algorithm with identical latency and error rates but 5% lower conversion. This is why the analysis template must include business signals, not just 5xx rates.

## Readiness Gates: The Missing Piece

All three strategies depend on knowing when a new version is actually ready. Kubernetes readiness probes handle pod-level readiness. But application-level readiness (database migrated, cache warmed, feature flags configured) needs more.

Options:

- **Init containers** that block pod startup until dependencies are ready
- **Readiness gates** (custom conditions on pods) that external controllers can set
- **Argo Rollouts analysis** that checks business metrics before promoting

## Rollback Strategy

Every deployment strategy needs a rollback plan:

- **Rolling**: `kubectl rollout undo` reverts to the previous ReplicaSet. Fast if the old pods are still available.
- **Blue-green**: Repoint the Service. Instant.
- **Canary**: Automatic if analysis fails. Manual promotion if you want to proceed despite warnings.

Test your rollback procedure. A rollback you have never practiced is not a rollback plan.

## Choosing a Strategy

| Factor | Rolling | Blue-Green | Canary |
|--------|---------|------------|--------|
| Resource overhead | Low | 2x during deploy | Low to moderate |
| Rollback speed | Minutes | Seconds | Automatic |
| Complexity | Low | Medium | High |
| Best for | Standard deploys | Risky/major changes | High-traffic, metric-rich |

Default to rolling updates. Add blue-green for major releases. Add canary when you have the observability to support it and the traffic to justify it.

## System Architecture

A deployment pipeline moves an artifact through stages with verification gates between them. The rollout controller, not kubectl, owns the traffic shift.

```
+----------------+     +------------------+
|  Git and CI    |---->|  Image Registry  |
|  build + test  |     |  immutable tags  |
+----------------+     +------------------+
                                |
                                v
                     +------------------+
                     |  Rollout         |
                     |  Controller      |
                     +------------------+
                      |                |
                      v                v
             +----------------+ +---------------+
             |  Stable        | |  Canary       |
             |  ReplicaSet    | |  ReplicaSet   |
             +----------------+ +---------------+
                      |                |
                      +-------+--------+
                              |
                              v
                     +------------------+
                     |  Service and     |
                     |  Ingress         |
                     +------------------+
```

Git triggers CI, which builds and tests, then pushes an immutable tagged image to the registry. The rollout controller (Argo Rollouts, Flagger, or the native Deployment controller) creates the new ReplicaSet and shifts traffic according to the strategy: incrementally for rolling, a Service selector flip for blue-green, weighted steps with analysis for canary. The Service or ingress (often via a service mesh for fine-grained weights) directs user traffic. Analysis templates query Prometheus during canary steps and abort the rollout if error rates or latency breach thresholds.

## Scalability

At 10x deploy frequency or service count, the bottleneck is usually CI, not Kubernetes. Build queues grow, runners saturate, and a pipeline that took 5 minutes now takes 40 because 30 services deploy at once. Scale runners horizontally (autoscaled runner pools) and cache aggressively (layer caching, dependency caching); the deploy pipeline is the first thing that must scale because every other improvement waits behind it. The second bottleneck is image pulls: hundreds of nodes pulling a new image simultaneously can hit registry rate limits or saturate NAT gateway bandwidth. Use a pull-through cache or registry mirror, and consider image pre-warming on nodes for large images.

At 100x, the Kubernetes control plane feels the rollout churn. Every deploy writes ReplicaSet, pod, and endpoint updates to etcd; hundreds of concurrent rollouts increase API server and etcd load measurably. Progressive delivery controllers (Argo Rollouts, Flagger) become control-plane hotspots themselves and may need sharding or dedicated instances. Rollback at this scale is a traffic operation, not a kubectl command: keep previous ReplicaSets (revisionHistoryLimit of 5 or more), keep the old image immutable in the registry, and make the rollback path a tested runbook rather than an improvisation. The horizontal strategy: CI runners and registry caching scale first, rollout controllers get dedicated capacity, and deploys are batched into waves so the control plane never sees the full fleet change at once.

## Security Considerations

The deploy pipeline is a privileged path to production, so treat it like one. Sign images (Sigstore/cosign) and enforce signature verification with an admission controller: only signed images from trusted builders run in production namespaces. This is the mitigation for the most damaging supply chain attack, a compromised CI job or stolen registry credential pushing a malicious image. Pin images by digest, not by mutable tag; `latest` in production is an unaudited deploy.

Apply least privilege to deploy identities. The CI service account that pushes images should not be the account that deploys them, and neither should be cluster-admin. Scope deploy RBAC per namespace and per environment. Keep secrets out of images entirely: bake no credentials into layers (they persist in layer history even if deleted in a later layer), and inject at runtime via external-secrets or the platform's secret store.

During canary and blue-green, the new version's pods need identical network policies and security posture to the stable version; a canary that accidentally runs without the default-deny policy is a brief but real exposure window. Audit who can promote or abort a rollout: the ability to shift 100% of traffic is production power, and it should require the same approval path as a production deploy.

## Production Checklist

Monitoring signals:

- **Rollout progress**: time since deploy started vs expected duration. Alert if a rollout is stuck (no new ready pods) for more than 15 minutes.
- **New ReplicaSet health**: CrashLoopBackOff or ImagePullBackOff on the new ReplicaSet within minutes of deploy start. These should page; they never fix themselves.
- **Error budget during rollout**: 5xx rate and p99 latency compared against the pre-deploy baseline. A canary or rolling update that degrades these should auto-pause or roll back.
- **HPA interaction**: watch for HPA scaling the new ReplicaSet mid-rollout. HPA scales whatever is current, which can mask a broken new version by adding more broken pods. Consider pausing aggressive HPA behavior during rollouts or setting conservative scale-up policies.

Failure modes seen in production: readiness probes that pass before the app can serve (the classic); PDBs blocking eviction and stalling the rollout silently; ConfigMap changes applied without pod restarts, so the new code runs against old config; database migrations deployed in the same release as the code that needs them, breaking the old version mid-roll.

Runbook notes: `kubectl rollout status` first, then describe the new ReplicaSet for events. Know the abort path for your strategy: `kubectl rollout undo` for rolling, Service selector flip for blue-green, abort with automatic traffic return for canary. Test the rollback quarterly; a rollback you have never practiced is a hope, not a plan. Keep revisionHistoryLimit at 3 or higher so there is always something to roll back to.

---

*The best deployment strategy is the one your team understands well enough to debug at 2 AM.*
