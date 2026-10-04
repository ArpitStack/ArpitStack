---
title: "Circuit Breakers and Retries: Resilient Services"
date: "2026-11-02"
tags: ["Microservices", "Resilience", "Go", "System Design"]
description: "How to prevent cascading failures: circuit breaker states, retry budgets, timeout design, bulkheads, and hedging."
readingTime: 12
---

In a microservices architecture, services call each other constantly. When one service slows down, its callers slow down. Their callers slow down. Within seconds, a single struggling service can take down your entire system. This is a cascading failure, and the patterns to prevent it are well understood but often implemented poorly.

This post covers the three fundamental patterns: timeouts, retries, and circuit breakers. Plus the advanced techniques that separate robust systems from fragile ones.

## System Architecture

Here is how the patterns fit together in a service client:

```
+------------------+     +---------------------+     +------------------+
| Your Service     |---->| Resilience Layer   |---->| Downstream       |
| (business logic) |     | (per dependency)  |     | Services         |
+------------------+     +---------------------+     +------------------+
                                   |
              +--------------------+--------------------+
              v                    v                    v
     +---------------+    +---------------+    +-------+--------+
     | Timeout       |    | Retry w/      |    | Circuit Breaker|
     | (deadline     |    | budget        |    | (closed, open, |
     |  per call)    |    | (20% cap)     |    |  half-open)    |
     +---------------+    +---------------+    +-------+--------+
                                                        |
                                          +-------------+-------------+
                                          v                           v
                                 +----------------+          +----------------+
                                 | Fallback       |          | Bulkhead       |
                                 | (cache, default|          | (semaphore per |
                                 |  degraded)     |          |  dependency)   |
                                 +----------------+          +----------------+
```

The wrapping order is a design decision, not an accident. A defensible order from outside in:

1. Bulkhead (admission control). Reject excess concurrency before it touches anything downstream.
2. Circuit breaker. Fail fast when the dependency is known-bad, without consuming retry budget.
3. Retry. Attempt the call up to N times for transient failures.
4. Timeout. Each individual attempt gets its own deadline.

Why this order: the breaker sits outside the retry loop so one logical call counts as one observation, not three. If retry were outside the breaker, a single user request could trip the breaker by itself, which makes the breaker measure your retry policy instead of downstream health. The timeout is innermost so every attempt is bounded; a timeout on the outside of the retry loop would let one slow attempt eat the whole budget.

You build one of these stacks per downstream dependency, not one shared stack. The payment service breaker must trip independently of the recommendation service breaker. Shared resilience state is how a struggling non-critical dependency takes down your critical path.

## Timeouts: The Foundation

Every network call needs a timeout. No exceptions. Without timeouts, a hung downstream service holds your connections open indefinitely, exhausting your connection pool and thread pool.

**Timeout values matter more than most teams realize:**

- Too long (30s): slow failures cascade before the timeout triggers
- Too short (100ms): healthy requests get cut off during normal latency spikes
- Right: p99 latency plus headroom, typically 1-5 seconds for internal APIs

```go
ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
defer cancel()

resp, err := client.Do(req.WithContext(ctx))
if err != nil {
    // Could be timeout, connection refused, DNS failure
    // Handle based on error type
}
```

**Timeout budgets** for chained calls: If service A calls B calls C, and A has a 5-second timeout, B should not use the full 5 seconds. Pass deadline context downstream.

```go
// A has 5s total. It calls B, giving B 3s (leaving 2s for A's own processing).
ctx, cancel := context.WithTimeout(parentCtx, 3*time.Second)
defer cancel()
resp, err := serviceB.Call(ctx, req)
```

Go's context propagation handles this naturally if you pass contexts through. The mistake is creating fresh contexts with full timeouts at each hop.

## Retries: Helpful Until They Are Not

Retries handle transient failures: momentary network blips, brief overloads, leader elections. They make things worse during sustained outages (retry storms).

**When to retry:**
- Connection refused (service might be restarting)
- 503 Service Unavailable (temporary overload)
- 429 Too Many Requests (with backoff, respecting Retry-After)
- Timeout (maybe transient, maybe not)

**When NOT to retry:**
- 400 Bad Request (your request is wrong, retrying will not fix it)
- 401/403 (auth issue, retrying is pointless)
- 404 Not Found (it is not going to appear)
- 500 Internal Server Error (ambiguous, usually do not retry without understanding)

```go
func callWithRetry(ctx context.Context, fn func() error) error {
    var lastErr error
    for attempt := 0; attempt < 3; attempt++ {
        if err := fn(); err == nil {
            return nil
        } else {
            lastErr = err
        }
        // Exponential backoff with jitter
        delay := time.Duration(math.Pow(2, float64(attempt))) * 100 * time.Millisecond
        jitter := time.Duration(rand.Float64() * float64(delay) * 0.5)
        select {
        case <-time.After(delay + jitter):
        case <-ctx.Done():
            return ctx.Err()
        }
    }
    return fmt.Errorf("failed after 3 attempts: %w", lastErr)
}
```

**Retry budgets** prevent retry storms. Instead of "retry 3 times per request," enforce "retries cannot exceed 20% of total requests." If the budget is exhausted, fail fast. This bounds the amplification factor during outages.

## Circuit Breakers: Stop Calling Broken Services

A circuit breaker monitors calls to a downstream service. When failures exceed a threshold, it "opens" and immediately rejects calls without attempting them. After a cooldown, it allows a test request ("half-open"). If that succeeds, it closes. If not, it stays open.

Three states:

1. **Closed** (normal): Requests flow through. Failures are counted.
2. **Open** (tripped): Requests fail immediately without calling downstream. Gives the downstream service time to recover.
3. **Half-open** (testing): After cooldown, allow one test request. Success closes the breaker. Failure re-opens it.

```go
type CircuitBreaker struct {
    mu               sync.Mutex
    state            State
    failures         int
    threshold        int           // failures to trip
    cooldown         time.Duration // how long to stay open
    lastFailure      time.Time
}

func (cb *CircuitBreaker) Call(fn func() error) error {
    cb.mu.Lock()
    switch cb.state {
    case Open:
        if time.Since(cb.lastFailure) < cb.cooldown {
            cb.mu.Unlock()
            return ErrCircuitOpen // fail fast
        }
        cb.state = HalfOpen // cooldown expired, try one request
    case HalfOpen:
        // Only one request allowed through in half-open
        // (simplified: real impl needs atomic check)
    }
    cb.mu.Unlock()

    err := fn()

    cb.mu.Lock()
    defer cb.mu.Unlock()
    if err != nil {
        cb.failures++
        cb.lastFailure = time.Now()
        if cb.failures >= cb.threshold {
            cb.state = Open
        }
        if cb.state == HalfOpen {
            cb.state = Open // test failed, re-open
        }
        return err
    }
    // Success
    cb.failures = 0
    cb.state = Closed
    return nil
}
```

**Tune the threshold carefully.** Too sensitive (trip after 3 failures) causes flapping during minor blips. Too lenient (trip after 100 failures) means the breaker never helps. Start with: trip after 50% failure rate over a 30-second window, minimum 20 requests.

**Fallbacks:** When the breaker is open, what does the caller do? Options: return cached data, return a default, degrade gracefully (show fewer recommendations), or fail with a clear error. The fallback depends on how critical the downstream service is.

## Bulkheads: Isolate Failure Domains

Named after ship compartments: if one floods, the others stay dry. In software: isolate resources so one failing dependency does not consume everything.

**Connection pool isolation:** Separate connection pools per downstream service. If service B is slow, it exhausts its own pool. Service C's pool is unaffected.

**Thread/goroutine isolation:** Limit concurrent calls per downstream. A semaphore per dependency:

```go
// Max 50 concurrent calls to payment service
var paymentSem = make(chan struct{}, 50)

func callPayment(ctx context.Context) error {
    select {
    case paymentSem <- struct{}{}:
        defer func() { <-paymentSem }()
    case <-ctx.Done():
        return ctx.Err()
    default:
        return errors.New("payment service at capacity")
    }
    return doPaymentCall(ctx)
}
```

## Hedging: For Latency, Not Failures

Hedging sends the same request to multiple instances and uses the first response. This handles tail latency (one slow instance) without waiting.

```go
func hedgedCall(ctx context.Context) (*Response, error) {
    // Send to primary immediately
    // If no response in 100ms, send to secondary too
    // Use whichever responds first
}
```

**Warning:** Hedging increases load (duplicate requests). Only use when: latency matters more than cost, downstream can handle 2x traffic, and requests are idempotent. Never hedge non-idempotent writes.

## Scalability

Circuit breaker state is usually local to each instance, and that is the right default. Every instance trips based on what it observes. With a fleet of hundreds of instances behind a load balancer, a struggling downstream sees staggered breaker behavior: some instances back off while others keep calling. This is acceptable for most services because the aggregate load still drops sharply.

Shared breaker state (in Redis, for example) coordinates the whole fleet: when one instance trips, all instances back off. Use it only when the downstream cannot tolerate partial traffic, such as a fragile legacy system where even ten percent of normal load during an incident is too much. The cost is real: the breaker now depends on Redis on the call path, and you have a consistency problem (stale reads mean some instances call a downstream everyone else considers dead). You have traded a resilience mechanism for a new dependency. Make sure the trade is worth it.

Counting at high request rates needs care. A mutex-protected counter becomes a contention point past tens of thousands of requests per second per instance. Use lock-free ring buffers or atomic counters with periodic aggregation. Established libraries already do this; it is one more reason not to hand-roll.

Window choice interacts with traffic level. Count-based windows (last 100 calls) react fast at high RPS but are meaningless at low RPS, where 100 calls might span an hour. Time-based windows (last 30 seconds) with a minimum call threshold combine both: ignore the window until you have enough samples to trust it.

Thresholds need retuning as you scale. At 100x traffic, tighten the window (10 seconds instead of 30) because the blast radius of a slow breaker is proportionally larger. A breaker that takes 30 seconds to trip at 100k RPS lets 3 million doomed requests through.

Watch the interaction with autoscaling. Breaker opens, downstream load drops, the autoscaler scales the downstream in, the breaker closes, and full traffic hits reduced capacity, which trips the breaker again. The system oscillates. Fix it by pausing scale-in while breakers against that service are open, or by scaling on queue depth rather than request rate.

Hedging deserves a scaling note too. Hedging every request doubles load, which is fine at small scale and dangerous at large scale. The safe form is conditional hedging: only send the second request if the first has not responded by p95 latency. That adds roughly five percent load while still cutting tail latency.

Static thresholds versus adaptive limits: the patterns above use fixed thresholds (trip at 50 percent failures). An alternative approach adjusts a concurrency limit up and down based on gradient signals like queueing delay, with no explicit failure threshold. Adaptive limits handle gray failures (slow but not erroring) better than breakers, but they are harder to reason about and tune. A pragmatic setup uses breakers for clear-cut failure detection and adaptive concurrency limits where tail latency is the business metric.

## Security Considerations

Resilience patterns have security implications that get overlooked.

Fail-open versus fail-closed is the big one. When the breaker for your authentication service opens, what happens? Fail open means every request is treated as authenticated: a security hole. Fail closed means an auth outage becomes a total outage. There is no universally correct answer. Payment and identity paths should fail closed. Recommendations and personalization can fail open with degraded content. Document the choice per dependency and make it a deliberate decision, not an accident of whatever the default fallback does.

Breakers can become a denial-of-service amplifier. An attacker who can reliably trigger downstream failures (requests that always produce 500s, for example) can trip your breakers and take features offline without overwhelming your infrastructure. Mitigations: prefer failure-rate thresholds over absolute counts so low-volume attack traffic cannot trip the breaker alone, alert on every trip event, and consider per-tenant breakers for multi-tenant paths so one abusive tenant cannot degrade others.

Retry behavior is also a weapon. If your service retries aggressively and an attacker can force failures cheaply, your retries multiply their impact. Retry budgets bound this, and honoring Retry-After headers keeps you from becoming the attacker against someone else's recovering service.

## Putting It Together

A resilient service client combines all patterns:

1. Timeout on every call (2-5s)
2. Retry transient failures (max 3, with backoff and jitter, respecting retry budgets)
3. Circuit breaker per downstream (trip at 50% failure rate)
4. Bulkhead isolation (separate pools per dependency)
5. Fallback when breaker is open (cache, default, or graceful degradation)

Libraries like `resilience4j` (Java), `polly` (.NET), or `gobreaker` + `backoff` (Go) implement these. Do not hand-roll unless you have a specific reason. The edge cases in circuit breaker state machines are subtle.

## Production Checklist

**Metrics (per downstream dependency):**

- Breaker state transitions, counted by direction (closed to open, open to half-open, and so on)
- Failure rate over the breaker window
- Retry rate and retry budget consumption percentage
- Bulkhead rejections and queue depth
- Fallback invocation rate (a rising fallback rate is an early warning)
- Timeout rate versus total error rate (timeouts indicate slowness, errors indicate breakage; they need different responses)

**Alerts:**

- Breaker open for more than 5 minutes: page. Either the downstream is really down or the threshold is wrong.
- Flapping: more than 3 state transitions in 10 minutes. Warn. The threshold or cooldown needs tuning.
- Retry budget above 80 percent consumed: warn. You are close to fail-fast behavior.
- Fallback error rate rising: warn. Your fallback path has its own bugs.

**Runbooks:**

- Breaker stuck open: verify downstream health independently (not through your service), then reset manually. Never reset blindly during an ongoing incident; the breaker is doing its job.
- Threshold changes: make them configuration, not code. The runbook covers which flag to change and how to validate the new threshold against the last incident's traffic.
- Fallback validation: fallbacks rot because they rarely execute. Exercise them in game days. A fallback that throws is worse than no fallback.

**What breaks at 3am:** multiple breakers trip at once across unrelated dependencies. That pattern almost never means several services failed simultaneously. It means a shared dependency failed: DNS, the service mesh control plane, or a network partition. Check the platform layer first, not the individual services. The second most common 3am page is a breaker that will not close because the half-open probe keeps failing against a downstream that is actually healthy but slow; the fix is usually a longer half-open timeout, not a breaker reset.
