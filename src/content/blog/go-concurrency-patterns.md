---
title: "Go Concurrency Patterns for Backend Engineers: Beyond Goroutines 101"
date: "2026-12-10"
tags: ["Go", "Concurrency", "Backend"]
description: "Worker pools, fan-in/fan-out, context cancellation, errgroup, and pipeline patterns you will actually use in production Go services."
readingTime: 15
---

Most Go tutorials stop at "goroutines are lightweight threads" and a `sync.WaitGroup` example. That gets you through a coding exercise. It does not get you through a production service that processes thousands of requests per minute without leaking goroutines or deadlocking at 3 AM.

This post covers the concurrency patterns I reach for in real backend services. Each one solves a specific problem. Each one has failure modes you should know about before you ship.

## System Architecture

Most of the patterns below share one shape: producers feed a bounded channel, a fixed pool of workers consumes it, and results flow back through another channel. Here is the generic form.

```
+-------------------+      +--------------------+
|  Producers        +----->|  Job Channel       |
|  (HTTP handlers,  | jobs |  (buffered; this   |
|   queue consumers)|      |   is backpressure) |
+-------------------+      +--------------------+
                                    |
                                    v
                         +--------------------+
                         |  Worker Pool       |
                         |  N goroutines,    |
                         |  ctx-aware,       |
                         |  panic-guarded    |
                         +--------------------+
                                    |
                           results  v
                         +--------------------+
                         |  Result Channel    |
                         |  (fan-in merger   |
                         |   or collector)    |
                         +--------------------+
                                    |
                                    v
                         +--------------------+
                         |  Consumer          |
                         |  (DB writer,       |
                         |   response path)   |
                         +--------------------+
```

Two things to notice. First, the job channel is the only shared state between producers and workers, and channels make the synchronization explicit. Second, every box has a defined exit path: producers stop on ctx.Done, workers stop on channel close or ctx.Done, the consumer stops when the result channel closes. If you cannot point at the exit path for every goroutine in your diagram, you have a leak waiting to happen.

## Worker Pools: Bounded Concurrency

The most common concurrency bug in Go services is unbounded goroutine spawning. A handler that launches a goroutine per incoming item works fine at 10 requests per second and melts at 10,000.

A worker pool bounds the concurrency. You create N workers, feed them through a channel, and the pool absorbs bursts without spawning new goroutines.

```go
func workerPool(ctx context.Context, jobs <-chan Job, numWorkers int) {
    var wg sync.WaitGroup
    for i := 0; i < numWorkers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case job, ok := <-jobs:
                    if !ok {
                        return
                    }
                    process(job)
                }
            }
        }()
    }
    wg.Wait()
}
```

Key details that matter:

- **Size the pool based on the bottleneck.** If workers are CPU-bound, use roughly the number of cores. If they are I/O-bound (database calls, HTTP), you can go much higher, often 10 to 50 per core depending on latency.
- **Always wire context cancellation.** Without it, a deploy or shutdown leaves workers hanging on blocked channel reads.
- **Close the jobs channel when done.** Workers exit cleanly on channel close. Forgetting this is the number one goroutine leak I see in code reviews.

The failure mode people miss: if `process(job)` panics, the worker dies silently and your pool shrinks. Wrap it in a recover, log the panic, and keep the worker alive. Or let it crash and rely on the process supervisor. Pick one deliberately, do not leave it accidental.

One more sizing decision: whether the jobs channel is buffered. An unbuffered channel gives the tightest backpressure (producers block until a worker is free) but couples producer latency directly to worker speed. A small buffer, say 2 to 10 times the worker count, smooths out bursty arrivals without hiding sustained overload. A large buffer just delays the failure and makes the queue-depth metric lie to you right up until it does not. Size for smoothing, not for absorbing overload.

## Fan-In/Fan-Out: Parallelize Then Merge

Fan-out distributes work across multiple goroutines. Fan-in merges multiple result channels into one. Together they form the standard pattern for parallel processing with a single output.

```go
func fanOut(ctx context.Context, in <-chan int, workers int) []<-chan int {
    outs := make([]<-chan int, workers)
    for i := 0; i < workers; i++ {
        out := make(chan int)
        outs[i] = out
        go func() {
            defer close(out)
            for n := range in {
                select {
                case <-ctx.Done():
                    return
                case out <- n * 2:
                }
            }
        }()
    }
    return outs
}

func fanIn(ctx context.Context, chans ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, ch := range chans {
        wg.Add(1)
        go func(c <-chan int) {
            defer wg.Done()
            for n := range c {
                select {
                case <-ctx.Done():
                    return
                case out <- n:
                }
            }
        }(ch)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

The subtle part is channel ownership. Each stage closes its own output channel. The fan-in stage waits for all inputs to close before closing the merged output. If you get the close semantics wrong, you get either a panic (close of closed channel) or a deadlock (consumer waiting on a channel that never closes).

Rule of thumb: the goroutine that creates a channel is responsible for closing it. Never close a channel from the consumer side.

## Context Cancellation: The Escape Hatch

`context.Context` is Go's standard mechanism for cancellation, deadlines, and request-scoped values. In concurrent code, it is the difference between a clean shutdown and a hung process.

```go
func fetchWithTimeout(url string, timeout time.Duration) ([]byte, error) {
    ctx, cancel := context.WithTimeout(context.Background(), timeout)
    defer cancel()

    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return nil, err
    }
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```

Three rules I enforce in reviews:

1. **Always call cancel.** Even if the context times out on its own, `defer cancel()` releases resources. Linters like `lostcancel` catch this.
2. **Pass context as the first argument.** This is convention, not law, but consistency matters in a large codebase.
3. **Do not store context in structs.** Pass it through function arguments. Storing it leads to stale contexts and subtle bugs.

The deeper point: context cancellation only works if your code checks it. A tight CPU loop that never selects on `ctx.Done()` will ignore cancellation completely. For long-running computations, check the context periodically.

## Errgroup: Structured Error Handling

`golang.org/x/sync/errgroup` is the standard library's answer to "run these things in parallel and give me the first error." It is small, well-tested, and should be in every Go backend's toolkit.

```go
import "golang.org/x/sync/errgroup"

func fetchAll(ctx context.Context, urls []string) ([]Result, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([]Result, len(urls))

    for i, url := range urls {
        i, url := i, url // capture loop variables
        g.Go(func() error {
            data, err := fetchWithContext(ctx, url)
            if err != nil {
                return err
            }
            results[i] = data
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

What errgroup gives you over manual WaitGroup plus error channel:

- **First error wins.** When one goroutine fails, the derived context is cancelled, signalling the others to stop.
- **Wait returns the error.** No separate error channel plumbing.
- **Limit with SetLimit.** `g.SetLimit(10)` bounds concurrency, giving you a worker pool with error propagation built in.

The `SetLimit` method is underused. It turns errgroup into a bounded worker pool with proper error handling, which covers 80 percent of backend concurrency needs.

## Semaphores: Bounding Without a Pool

errgroup's SetLimit works when all your tasks are born in one place. Sometimes you need to bound concurrency across scattered call sites, for example limiting concurrent outbound HTTP calls from many different handlers. A buffered channel used as a semaphore is the standard tool.

```go
// sem allows at most maxConcurrent operations at once.
var sem = make(chan struct{}, 50)

func fetchWithSlot(ctx context.Context, url string) ([]byte, error) {
    select {
    case <-ctx.Done():
        return nil, ctx.Err()
    case sem <- struct{}{}: // acquire
    }
    defer func() { <-sem }() // release

    return doFetch(ctx, url)
}
```

Tradeoffs versus a worker pool:

- **Simpler to retrofit.** You can wrap any existing call without restructuring code into jobs and workers.
- **No queue semantics.** When the semaphore is full, the acquire blocks the caller goroutine. That is fine if the caller can block, but in an HTTP handler it ties up a server goroutine per waiting request. With enough contention you have just moved the unbounded growth from workers to waiters.
- **Fairness is roughly FIFO.** Channel sends unblock in roughly FIFO order, which is usually good enough.

If waiters pile up, add a timeout on the acquire or shed load explicitly (return 503) instead of blocking forever. A semaphore that blocks indefinitely under overload is a queue with no bound and no visibility.

## Pipeline Pattern: Staged Processing

Pipelines chain stages where each stage is a group of goroutines reading from an input channel and writing to an output channel. This is the natural pattern for ETL, request processing chains, and data transformation.

```go
func pipeline(ctx context.Context, input []int) <-chan int {
    stage1 := make(chan int)
    stage2 := make(chan int)

    // Stage 1: generate
    go func() {
        defer close(stage1)
        for _, n := range input {
            select {
            case <-ctx.Done():
                return
            case stage1 <- n:
            }
        }
    }()

    // Stage 2: transform (3 workers)
    var wg sync.WaitGroup
    for i := 0; i < 3; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for n := range stage1 {
                select {
                case <-ctx.Done():
                    return
                case stage2 <- n * 10:
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(stage2)
    }()

    return stage2
}
```

Pipeline gotchas:

- **Backpressure is automatic** with unbuffered channels. A slow stage blocks the upstream stage. This is usually what you want, but be aware it can propagate slowness across the entire pipeline.
- **Buffered channels decouple stages** but hide backpressure. Use them for smoothing bursty traffic, not as a default.
- **One slow consumer blocks everything** if you have a single output channel. Monitor per-stage throughput to find bottlenecks.

## Backpressure: What Happens When Downstream Is Slow

Every bounded system needs an answer to "what happens when the buffer fills." The options, in order of preference:

1. **Block the producer (natural backpressure).** With unbuffered or full buffered channels, the producer goroutine blocks until a worker frees up. This pushes pressure upstream automatically and is the correct default for pipelines inside one process.

2. **Drop with metrics.** For telemetry, logs, or anything loss-tolerant, use a non-blocking send and increment a dropped counter.

```go
select {
case jobs <- job:
default:
    dropped.Inc() // buffer full; shed load
}
```

3. **Shed at the edge.** For request-driven work, return 429 or 503 fast instead of queueing. A queue that grows without bound is just a slower, less visible way to fail.

4. **Spill to durable storage.** For work that cannot be lost (billing events, audit logs), spill to disk or a message queue when memory buffers fill. This is the only option that preserves both durability and boundedness, and it is also the most code.

The mistake I see most: a buffered channel with a large capacity treated as "handling bursts." A 10,000-slot buffer does not handle bursts. It delays the failure by 10,000 items and makes the eventual failure harder to diagnose because the queue depth metric looked fine right up until it did not. Size buffers for smoothing, not for absorbing sustained overload, and alert on sustained high buffer occupancy.

## Goroutine Leak Detection

Leaks are silent. A goroutine blocked forever on a channel read costs a few KB of stack and, worse, often holds references that keep much larger objects alive. Two tools catch them.

**pprof in production.** Expose `net/http/pprof` on a localhost-only admin port (never on the public listener) and watch the goroutine count as a first-class metric. A count that grows monotonically across deploys is a leak. When you suspect one, pull a goroutine profile and look for large groups of goroutines blocked in the same place.

```go
import _ "net/http/pprof" // registers /debug/pprof/* on DefaultServeMux

// Serve DefaultServeMux on a localhost-only admin port.
go func() {
    log.Println(http.ListenAndServe("127.0.0.1:6060", nil))
}()
```

**goleak in tests.** `go.uber.org/goleak` fails a test if goroutines leak. Add `defer goleak.VerifyNone(t)` to tests that exercise concurrent code. It catches the "test passed but left 40 goroutines behind" case that pprof only finds in production.

Both tools share a limitation: they tell you where goroutines are stuck, not why the exit path failed. Pair the profile with a review of the channel-close and context-cancellation paths.

## What I Check in Reviews

When I review concurrent Go code, I look for these specific things:

1. Every goroutine has a clear exit path (context cancellation or channel close).
2. No goroutine is spawned per request without a bound.
3. Channel ownership is clear: who creates, who closes.
4. Shared state is either protected by a mutex or confined to one goroutine.
5. `defer cancel()` is present wherever a context is created.

Concurrency bugs are the hardest to reproduce and the easiest to prevent with discipline. The patterns above are not clever. They are boring, well-understood, and they work. That is exactly what you want in production.

## Scalability

These patterns scale well horizontally, but the bottleneck moves as load grows.

**10x load:** The worker pool still works. What usually breaks first is whatever the workers call: database connection limits, downstream API rate limits, or lock contention on a shared map you forgot about. Size the pool against the downstream limit, not against CPU. A pool of 200 workers hammering a database with 50 max connections just creates 150 goroutines waiting on pool checkout, which shows up as latency, not errors.

**100x load:** A single process stops being the unit of scaling. The in-memory job channel cannot span machines, so the architecture shifts: the channel becomes a real queue (Kafka, SQS, NATS), workers become separate deployments, and exactly-once semantics become at-least-once with idempotent handlers. The patterns transfer directly (bounded consumers, backpressure via consumer lag, fan-in via partitioned topics), but the failure modes change: now you deal with rebalances, poison messages, and offset management instead of channel deadlocks.

**What breaks first and why:** Shared mutable state. At every scale, the first thing to fall over is the mutex-protected map, the single database row everyone updates, or the in-memory cache with no eviction. Concurrency patterns control how work flows; they do not fix contention on shared state. When scaling, look at the state first and the goroutines second.

## Security Considerations

Concurrency bugs are a denial-of-service vector. Treat unbounded resource use as a security issue, not just a performance one.

- **Unbounded goroutines as DoS.** Any endpoint that spawns goroutines proportional to attacker-controlled input (query params, request body size, fan-out over user-supplied lists) is a resource exhaustion vulnerability. Bound it with a pool or semaphore, and bound the input size first.
- **Slowloris-style stalls.** A worker blocked forever on a maliciously slow upstream holds a pool slot. Timeouts on every I/O operation are a security control, not just good hygiene. Prefer an `http.Client` with explicit timeouts over `http.DefaultClient`, which has none.
- **Cross-tenant starvation.** A shared channel or pool used across tenants without partitioning lets one tenant's load starve another's. For multi-tenant services, partition pools or add per-tenant rate limits before the shared resource.
- **Panic as availability risk.** An unrecovered panic in one worker kills that goroutine; a panic in the main goroutine kills the process. Decide deliberately which panics should crash (fail fast on programmer errors at startup) and which should be recovered (per-request or per-job panics in workers). Log recovered panics with stack traces; a silent recover hides bugs.
- **pprof exposure.** If you expose pprof for leak detection, keep it off the public listener. Goroutine dumps and heap profiles leak internal structure. Localhost-only admin port or mutual TLS.

Defense in depth here means: validate and bound input at the edge, bound concurrency in the middle, and set timeouts on everything that touches the network.

## Production Checklist

Before a concurrent Go service goes live, verify these:

- **Metrics:** goroutine count (alert on monotonic growth), channel queue depth and time-in-queue, worker pool utilization, per-stage throughput for pipelines, dropped or shed counters for backpressure paths.
- **Alerting:** goroutine count rising across two consecutive deploys; queue depth above 80% of capacity for more than 5 minutes; any sustained increase in dropped-item counters.
- **Failure modes:** worker panic (pool shrinks; ensure recover or supervisor restart), downstream timeout (pool slots held; ensure timeouts and bulkheads), channel deadlock (add deadlock detection in tests with timeouts, not just in production).
- **Load testing:** run at 2x expected peak and watch goroutine count and queue depth, not just latency percentiles. Latency hides queueing until the buffer fills; then it falls off a cliff.
- **Runbook:** document the expected worker pool size and why, the queue capacity and what full means, and the exact steps to drain and restart (send SIGTERM, verify goroutine count returns to baseline, check for stuck in-flight work).
- **Code review gates:** every new goroutine needs a named exit path in the PR description; every new channel needs documented ownership (who closes).
