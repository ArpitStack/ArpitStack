---
title: "Graceful Shutdown in Go: Handling SIGTERM Properly"
date: "2026-12-14"
tags: ["Go", "Kubernetes", "DevOps"]
description: "Signal handling, draining in-flight requests, shutdown ordering, and Kubernetes termination lifecycle for Go services."
readingTime: 12
---

When Kubernetes wants to stop your pod, it sends SIGTERM, waits (default 30 seconds), then sends SIGKILL. What your Go service does between those two signals determines whether in-flight requests complete cleanly or get killed mid-processing.

Most Go services I review handle this wrong. Here is how to do it right.

## The Problem

The default Go HTTP server does not handle SIGTERM gracefully. When the process receives SIGTERM, it terminates immediately. In-flight requests are dropped. Database transactions are interrupted. The client sees a connection reset.

In Kubernetes, this manifests as:
- 502 errors during deployments
- Failed requests during pod evictions
- Inconsistent state from interrupted writes

The fix is straightforward but has several parts that all need to work together.

## System Architecture

Here is the shutdown timeline as a single picture. Everything your service does between SIGTERM and SIGKILL has to fit inside the grace period budget.

```
Time ------------------------------------------------------------------>

+------------+   +----------+   +----------------+   +----------+
| Pod marked |-->| preStop  |-->| SIGTERM        |-->| SIGKILL  |
| terminating|   | hook     |   | (drain starts) |   | (forced) |
+------------+   +----------+   +----------------+   +----------+
                                    |  budget: grace period
                                    |  minus preStop time
                                    v
                     +----------------------------------+
                     | 1. readiness -> 503 (stop new    |
                     |    traffic fast)                 |
                     | 2. srv.Shutdown (drain in-flight |
                     |    requests)                     |
                     | 3. stop consumers and background  |
                     |    workers                       |
                     | 4. close DB pools, flush metrics  |
                     |    and logs                      |
                     +----------------------------------+
```

The key constraint: steps 1 through 4 share one fixed budget. If the drain in step 2 eats the whole budget, steps 3 and 4 never run and you lose buffered metrics and clean pool closes. Allocate the budget deliberately (for example, 25 of 30 seconds for request drain, 5 for everything after) instead of letting the first step consume whatever it wants.

## Basic Signal Handling

```go
func main() {
    srv := &http.Server{Addr: ":8080", Handler: router()}

    // Channel to listen for OS signals
    stop := make(chan os.Signal, 1)
    signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

    go func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatalf("server error: %v", err)
        }
    }()

    // Block until signal received
    <-stop
    log.Println("shutting down...")

    ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
    defer cancel()

    if err := srv.Shutdown(ctx); err != nil {
        log.Printf("forced shutdown: %v", err)
    }
    log.Println("server stopped")
}
```

`srv.Shutdown(ctx)` is the key. It stops accepting new connections, waits for in-flight requests to complete, then closes. The context timeout is your backstop: if requests do not finish in time, the shutdown is forced.

Set the timeout shorter than your Kubernetes `terminationGracePeriodSeconds` (default 30s). I use 25 seconds to leave 5 seconds of buffer for cleanup after the server stops.

## Shutdown Ordering

A real service has more than an HTTP server. Database connections, message consumers, background workers, and caches all need to shut down in the right order.

The correct order is generally:

1. **Stop accepting new work.** Close the HTTP listener, stop consuming from queues.
2. **Drain in-flight work.** Let current requests and jobs finish.
3. **Close downstream connections.** Database pools, Redis clients, etc.
4. **Flush buffers.** Metrics, logs, any buffered writes.
5. **Exit.**

```go
func shutdown(ctx context.Context, components ...Shutdownable) error {
    // Shut down in reverse order of initialization
    for i := len(components) - 1; i >= 0; i-- {
        if err := components[i].Shutdown(ctx); err != nil {
            log.Printf("shutdown error: %v", err)
            // Continue shutting down other components
        }
    }
    return nil
}

type Shutdownable interface {
    Shutdown(ctx context.Context) error
}
```

Shut down in reverse initialization order. If you started the database pool first and the HTTP server last, shut down the HTTP server first and the database pool last. This ensures no component tries to use a dependency that is already closed.

## Kubernetes Termination Lifecycle

Understanding what Kubernetes does helps you configure this correctly:

1. Pod is marked for termination (removed from Service endpoints, no new traffic)
2. `preStop` hook executes (if defined)
3. SIGTERM is sent to the main process
4. `terminationGracePeriodSeconds` countdown starts (default 30s)
5. If the process is still running after the grace period, SIGKILL is sent

Important details:

- **The pod is removed from endpoints before SIGTERM.** In-flight requests continue, but no new ones arrive via the Service. However, there is a propagation delay. Some requests may still arrive for a few seconds after SIGTERM.
- **`preStop` hooks run before SIGTERM.** Use this for a sleep if you need extra drain time for endpoint propagation. A common pattern is `preStop: { exec: { command: ["sleep", "5"] } }`.
- **Set `terminationGracePeriodSeconds` appropriately.** If your longest request takes 60 seconds, 30 seconds is not enough. But do not set it absurdly high either; it delays rollouts.

One subtlety people get wrong: the `preStop` hook runs *inside* the grace period window, not before it. A 10-second `preStop` sleep on a 30-second grace period leaves 20 seconds for your actual drain. Budget the hook time against the same total, or your service will learn about the shortfall when SIGKILL arrives mid-drain.

```yaml
spec:
  terminationGracePeriodSeconds: 60
  containers:
  - name: myservice
    lifecycle:
      preStop:
        exec:
          command: ["/bin/sh", "-c", "sleep 10"]
```

## Database Connection Draining

When shutting down, close database connection pools after the HTTP server has drained. This ensures in-flight requests can still complete their database operations.

```go
// Good order
srv.Shutdown(ctx)  // 1. Stop HTTP, drain requests
db.Close()         // 2. Close DB pool after requests finish
```

If you close the database pool first, in-flight requests will fail with connection errors even though the HTTP server is still trying to serve them.

For connection pools, also consider setting `SetConnMaxLifetime` to ensure connections are recycled. Stale connections that the database has already closed will cause errors on first use after idle periods.

## Database Transactions During Shutdown

Closing the pool after the HTTP server drains handles new queries, but in-flight transactions need more care. A transaction that started before SIGTERM should be allowed to commit or roll back cleanly. A transaction that starts after shutdown begins should never start at all.

Practical approach:

- **Guard transaction starts with the shutdown flag.** The same `atomic.Bool` used for readiness can gate `db.BeginTx`. After shutdown starts, new transactions fail fast instead of racing the pool close.
- **Use context timeouts on transactions.** Pass the shutdown context (or a derived context with a deadline) into `BeginTx` and query calls. If the drain budget expires, in-flight transactions get cancelled instead of blocking until SIGKILL.
- **Prefer short transactions.** Long-running transactions are the most common reason a service cannot drain in time. If a request holds a transaction open across multiple network calls, refactor it before relying on graceful shutdown to save you.
- **Design for retried writes.** Even with perfect draining, SIGKILL can interrupt a commit. Make writes safe to retry: unique constraints, idempotency keys, or compare-and-swap updates.

The ordering rule extends here: stop starting new transactions first, drain in-flight ones second, close the pool last.

## Draining Load Balancer Connections

In Kubernetes, removing the pod from Service endpoints stops new traffic through kube-proxy, but it does not close existing keep-alive connections. An HTTP client with a persistent connection to your pod will keep sending requests on it until the connection closes or idles out.

What this means in practice:

- **`srv.Shutdown` closes idle connections** but waits for in-flight requests on active ones. A client that pipelines requests on one keep-alive connection can keep a pod draining indefinitely within the grace period. The shutdown timeout is your backstop.
- **Set server timeouts.** `ReadTimeout`, `WriteTimeout`, and `IdleTimeout` on `http.Server` bound how long any single connection can hold the drain open. Without `IdleTimeout`, idle keep-alive connections linger until the client closes them.
- **Cloud load balancers have their own drain.** If an ALB or NLB fronts your pods, its deregistration delay is independent of your pod's grace period. Make sure it exceeds your in-flight drain time, or the load balancer will cut connections your pod was still draining.
- **HTTP/2 and gRPC multiplex many streams over one connection**, which makes this worse: one connection can carry continuous new streams. For gRPC, use `GracefulStop` on the server, which stops accepting new streams while letting existing RPCs finish, mirroring `srv.Shutdown` semantics.

## Health Checks During Shutdown

Kubernetes uses readiness probes to determine if a pod should receive traffic. During shutdown, your readiness probe should start failing immediately on SIGTERM. This accelerates the removal from endpoints.

```go
var shuttingDown atomic.Bool

http.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
    if shuttingDown.Load() {
        w.WriteHeader(http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
})

// In shutdown handler:
shuttingDown.Store(true)
```

This is a small optimization, but it reduces the window where the pod receives new traffic after SIGTERM.

## Liveness vs Readiness During Shutdown

Readiness and liveness answer different questions, and shutdown is where confusing them hurts.

- **Readiness: "should this pod get traffic?"** During shutdown the answer becomes no immediately. Fail the readiness probe on SIGTERM, as shown above. Kubernetes removes the pod from endpoints and stops routing new requests.
- **Liveness: "is this pod deadlocked?"** During shutdown the answer should stay yes (alive) until the process actually exits. If your liveness probe fails during a slow drain, the kubelet restarts the container mid-shutdown, which defeats the entire graceful path. Keep liveness checks trivial (process is responsive) and never gate them on the shutdown flag.

A common misconfiguration: using the same handler for both probes and failing it on shutdown. The pod then gets killed while it is still draining. Separate the endpoints or at least the logic: `/ready` fails fast on shutdown, `/live` keeps returning 200 until the process is gone.

## Testing It

Do not just deploy and hope. Test graceful shutdown locally:

```bash
# Start the service
./myservice &

# Send some traffic
while true; do curl -s http://localhost:8080/slow-endpoint & sleep 0.1; done

# Send SIGTERM
kill -TERM %1

# Verify: no connection resets, all in-flight requests complete
```

In Kubernetes, test with a rolling deployment while sending continuous traffic. Monitor for 502s, connection resets, and failed requests. Zero errors during a deploy is the goal.

## Scalability

Graceful shutdown gets harder as you scale, because the drain budget is fixed while the work in flight grows.

**10x pods:** Rolling deploys now overlap more terminations with more traffic. The endpoint propagation delay matters more: with 10x the pods, the window where a terminating pod still receives traffic hits 10x the requests. The preStop sleep and fail-fast readiness become load-bearing, not optional. Also watch `maxUnavailable` and `maxSurge`: if too many pods terminate at once, the remaining pods absorb the shifted load plus their own, and their drains get slower exactly when you need them fast.

**100x pods:** Draining stops being a per-pod concern and becomes a fleet operation. Connection churn during a full rollout can overwhelm downstream dependencies (database connection storms as new pods open pools while old pods still hold theirs). Mitigate with staggered rollouts, pool size math that accounts for surge pods, and readiness gates that only mark new pods ready after warmup. At this scale, also reconsider the grace period: a 30-second default multiplied across thousands of pods serializes your deploy time. Long drains and fast rollouts are in tension. Pick the drain time your longest request actually needs and not a second more.

**What breaks first:** The assumption that drain time is constant. P99 latency rises under load, so the time needed to drain in-flight requests grows exactly when the most requests are in flight. Size the grace period against loaded P99, not idle P99.

## Security Considerations

Shutdown handling is a small but real attack surface.

- **SIGTERM as a disruption vector.** Anyone who can send signals to your process (a compromised sidecar, an overly broad RBAC role allowed to exec into pods) can trigger drains at will. Restrict pod exec and signal-sending capabilities. Treat `kill` inside the cluster as a privileged operation.
- **Drain abuse.** A client that holds requests open (slow reads, slow writes) can stretch your drain to the full grace period on every deploy. Server timeouts (`ReadTimeout`, `WriteTimeout`) bound this. Without them, one malicious client can pin a pod through its entire termination window.
- **Secrets during shutdown.** If your service rotates credentials (database passwords, API tokens), make sure rotation does not land mid-drain in a way that invalidates in-flight work. Either complete the drain on the old credentials or make credential refresh atomic and retry-safe. A secret rotation between SIGTERM and pool close is a classic source of mysterious deploy-time errors.
- **Data integrity.** Interrupted writes are the core risk. Prefer transactional boundaries and idempotent operations so a SIGKILL mid-write is recoverable, not corrupting. Log what was in flight when a forced shutdown happens. That log is your forensic trail.
- **Health endpoint information.** Keep `/ready` and `/live` responses minimal. They should return status codes, not version strings, build metadata, or anything that helps fingerprint the service.

## Production Checklist

- Handle SIGTERM and SIGINT with `signal.Notify`
- Use `srv.Shutdown(ctx)` with a timeout shorter than the grace period
- Shut down components in reverse initialization order
- Configure `terminationGracePeriodSeconds` to match your longest request under load
- Add a `preStop` sleep to cover endpoint propagation delay (budgeted inside the grace period)
- Fail readiness fast on SIGTERM; keep liveness passing until exit
- Set `ReadTimeout`, `WriteTimeout`, and `IdleTimeout` on the HTTP server
- Guard new transaction starts after shutdown begins
- Test with real traffic during a rolling deploy

**Metrics to watch:** 502/503 rate during deploys (should be zero), drain duration per pod (alert if it approaches the grace period), forced-shutdown count (any occurrence deserves investigation), connection count at SIGTERM versus at exit.

**Alerting:** any 5xx spike correlated with a rollout; drain duration P99 above 80% of `terminationGracePeriodSeconds`; pods killed by SIGKILL (exit code 137) during deploys.

**Runbook pointer:** on deploy-time 502s, check in order: readiness fail-fast present, preStop sleep configured, grace period versus longest request under load, downstream pool exhaustion during the rollout.

Graceful shutdown is not glamorous, but it is the difference between deployments your users never notice and deployments that page you at 2 AM.
