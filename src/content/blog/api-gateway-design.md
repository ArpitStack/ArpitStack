---
title: "API Gateway Design: Routing, Rate Limiting, and Auth at Scale"
date: "2026-10-12"
tags: ["API Gateway", "System Design", "Microservices"]
description: "High-level design of an API gateway: request routing, rate limiting algorithms, auth termination, and request transformation at scale."
readingTime: 11
---

Every microservices architecture eventually needs a front door. Requests come in from the internet, and something has to decide where they go, who is allowed through, and how fast. That something is the API gateway.

This post covers the high-level design: what the gateway does, how to build rate limiting that works, where auth belongs, and the failure modes that catch teams off guard.

## What the Gateway Owns

The gateway sits between clients and your services. Its responsibilities:

1. **Routing**: Map incoming paths to backend services (`/api/orders/*` goes to the order service)
2. **Authentication**: Validate tokens, terminate TLS, attach identity to requests
3. **Rate limiting**: Protect backends from overload and abuse
4. **Request/response transformation**: Header injection, path rewriting, protocol translation
5. **Observability**: Request logging, metrics, tracing initiation

What it should NOT own: business logic, data aggregation across services (that is BFF territory), or long-running state.

```
Client --> [TLS] --> [API Gateway] --> Order Service
                                     --> Payment Service
                                     --> User Service
```

The gateway is on the critical path for every request. If it goes down, everything goes down. Design accordingly.

## Routing: Simple Until It Is Not

Basic routing is path-prefix matching. `/api/v1/orders` goes to the order service. Most gateways (Kong, Envoy, AWS API Gateway) handle this declaratively.

It gets interesting with:

**Canary routing**: Send 5% of traffic to a new service version. The gateway needs weighted routing rules and the ability to update them without restarts.

**Header-based routing**: Route based on a tenant ID header for multi-tenant isolation, or a feature flag header for testing.

**Path rewriting**: Strip the `/api/v1` prefix before forwarding, so backend services see clean paths.

Configuration should be declarative (YAML or a control plane API), versioned in git, and deployable without gateway restarts. If changing a route requires a deploy, your iteration speed suffers.

## Rate Limiting: Algorithms That Work

Rate limiting protects your backends. Without it, one misbehaving client or a retry storm can cascade through your entire system.

**Token bucket** (most common): Each client has a bucket that refills at a fixed rate. Requests consume tokens. Empty bucket means rejected. Allows bursts up to bucket size, then enforces the sustained rate.

**Sliding window**: Count requests in the last N seconds. More accurate than fixed windows (no boundary effects), slightly more expensive to compute.

**Fixed window**: Count requests per minute/hour. Simple but has the boundary problem: 100 requests at 11:59:59 and 100 more at 12:00:01 = 200 requests in 2 seconds, both within "limit."

For most APIs, token bucket is the right default. Implementation:

```go
type TokenBucket struct {
    mu       sync.Mutex
    tokens   float64
    capacity float64
    refillRate float64 // tokens per second
    lastRefill time.Time
}

func (b *TokenBucket) Allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()

    now := time.Now()
    elapsed := now.Sub(b.lastRefill).Seconds()
    b.tokens = math.Min(b.capacity, b.tokens + elapsed * b.refillRate)
    b.lastRefill = now

    if b.tokens >= 1 {
        b.tokens--
        return true
    }
    return false
}
```

**Distributed rate limiting** is the hard part. A single gateway instance can track limits in memory. With 10 gateway instances behind a load balancer, each sees 1/10th of the traffic. Options:

1. **Sticky sessions**: Route each client to the same gateway. Simple but fragile (instance failure loses state).
2. **Centralized store** (Redis): All gateways check a shared counter. Accurate but adds latency to every request (one Redis round trip).
3. **Approximate**: Each gateway enforces limit/N locally. Simple, slightly inaccurate, usually fine.

For most systems, option 3 with a centralized fallback for abusive clients is the pragmatic choice. Perfect accuracy in rate limiting is rarely worth the latency cost.

**Rate limit headers**: Always return `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`. Clients need to know when they are being throttled and for how long. Return 429 (Too Many Requests), not 403.

## Auth Termination at the Gateway

The gateway validates authentication so backend services do not have to. Flow:

1. Client sends request with `Authorization: Bearer <jwt>`
2. Gateway validates JWT signature (using cached public keys, not a network call per request)
3. Gateway extracts claims (user ID, tenant ID, scopes)
4. Gateway forwards to backend with identity in headers (`X-User-ID`, `X-Tenant-ID`)
5. Backend trusts these headers (network-level trust, since only the gateway can reach backends)

Key design points:

**Cache public keys.** Fetching JWKS (JSON Web Key Set) on every request adds 50-100ms. Cache keys for 5-10 minutes, refresh in background.

**Do not put auth logic in each service.** Every service implementing its own JWT validation leads to inconsistencies. One team forgets to check expiry, another does not validate the issuer. Centralize it.

**mTLS for service-to-service.** The gateway handles external auth (JWT). Internal service-to-service calls use mutual TLS with short-lived certificates (SPIRE, or Kubernetes service account tokens).

## Request Transformation

Common transformations:

- **Header injection**: Add `X-Request-ID` for tracing, `X-Tenant-ID` from JWT claims
- **Path rewriting**: `/api/v1/orders/123` becomes `/orders/123` for the backend
- **Protocol translation**: Accept REST from clients, call gRPC backends (or vice versa)
- **Response filtering**: Strip internal headers before returning to client

Keep transformations declarative and simple. If you need complex logic, that belongs in a dedicated service, not the gateway config.

## Failure Modes

**Gateway as single point of failure**: Run multiple instances across availability zones. Use health checks and automatic failover. The gateway itself should be stateless (all state in Redis or equivalent) so any instance can handle any request.

**Backend timeout cascading**: If a backend is slow, the gateway holds connections open. Under load, this exhausts the gateway's connection pool. Set aggressive timeouts (2-5 seconds for most APIs) and use circuit breakers.

**Configuration errors**: A bad route config can blackhole traffic. Validate configs in CI, canary config changes, and keep the last known good config for fast rollback.

**Thundering herd on cache expiry**: If the gateway caches JWKS or rate limit data, stagger expiry times. Do not let 10 instances refresh simultaneously.

## System Architecture

```
+--------+     +----------------+     +-----------------+
| Client +---->| Load Balancer  +---->| Gateway (x N,    |
+--------+     +----------------+     | stateless)      |
                                      +---+---+---+-----+
                                          |   |   |
                     +--------------------+   |   +--------------------+
                     v                         v                        v
              +------------+            +-------------+          +------------+
              | Rate limit |            | Auth verify |          | Backends   |
              | (Redis,    |            | (cached     |          | (orders,   |
              |  shared)   |            |  JWKS)      |          |  payments, |
              +------------+            +-------------+          |  users)    |
                                                                +------------+
```

Request flow: the load balancer spreads connections across stateless gateway instances. Each request passes the rate limit check (shared Redis) and JWT verification (cached JWKS, no network call on the hot path) before routing to a backend with identity headers attached. Routing configuration comes from a control plane (not shown): declarative route tables pushed to every instance, versioned in git, applied without restarts.

The instances hold no session state, which is what makes them interchangeable. Anything an instance needs (rate limit counters, public keys, route tables) lives outside it, in Redis, in memory caches with background refresh, or in the pushed config.

## Scalability

The gateway must be stateless: any instance handles any request, so scaling is adding instances behind the load balancer. Know your per-instance capacity: measure requests per second per core with your real middleware chain (TLS plus JWT verify plus Redis rate-limit check). Typical numbers are in the low thousands per core, but measure, do not guess; JWT verification and TLS handshakes dominate CPU.

TLS is the hidden tax. Use session resumption and HTTP keepalives, and consider terminating TLS at the load balancer or CDN so the gateway spends CPU on routing instead of handshakes.

Rate limiting at scale: a centralized Redis check adds roughly a millisecond per request and becomes a bottleneck at very high request rates. Shard Redis, or use local approximation (each instance enforces limit/N) and reserve the centralized check for flagged abusive clients.

At 10x: add instances, verify the load balancer distributes evenly (least-connections, not round-robin, when request costs vary), and watch Redis latency.

At 100x: go regional. Anycast DNS routes users to the nearest region's gateway fleet, and each region runs independently. The hard part stops being request handling and becomes config distribution: the control plane must push route changes to hundreds of instances within seconds, with versioning and rollback.

Capacity planning: decompose the p99 latency budget (TLS handshake plus auth verify plus rate limit check plus backend call plus margin). Count connections: instances times backends times pool size; tune keepalives so you are not handshaking per request. Timeout budget rule: backend timeout must be less than gateway timeout, which must be less than client timeout, or the wrong layer gives up first and you get mystery 502s.

Bottlenecks in practice: connection pool exhaustion when a backend slows down (this is what circuit breakers and aggressive timeouts are for), Redis latency spikes stalling every request, and config reload storms when a bad push restarts all instances at once (canary config changes).

Staff-level questions: why should the gateway not aggregate responses from multiple services? (It becomes a coupling point: every backend change risks the gateway, latency budgets multiply across fan-out calls, and failures compose badly. Per-client aggregation belongs in a BFF owned by the client team.) When is local rate limiting wrong? (When you bill or quota per tenant strictly. Approximation is fine for abuse protection; it is not fine for billing.)

## Security Considerations

TLS 1.2 minimum, 1.3 preferred, with a curated cipher list; HSTS on; certificate rotation automated with an alert 30 days before expiry (expired certificates page people more often than anything exotic).

JWT validation must check signature, issuer, audience, and expiry, and must explicitly reject the `none` algorithm. Cache JWKS with background refresh; short access-token lifetimes with refresh tokens limit the damage of a leaked token.

The trust boundary is the whole game: backends accept `X-User-ID` and `X-Tenant-ID` only from the gateway. Enforce it at the network layer (backends unreachable from the internet; security groups or mTLS allowing only gateway IPs). If an attacker can reach a backend directly, header spoofing hands them any identity they want. Defense in depth: backends should still validate the header format and fail closed on anything malformed.

Rate limiting is abuse protection, not DDoS protection. Put a CDN/WAF in front, enforce request size limits (reject the 10MB JSON body at the edge), and set timeouts that kill slow-loris connections.

Secrets: the gateway holds TLS certificates and the JWKS cache; rotate via a secret manager, never commit to git. Logging: log auth failures and 429s for abuse analysis, but never log tokens or full Authorization headers.

## Production Checklist

Golden signals per route: latency (p50/p99), traffic (requests per second), errors (5xx rate, 429 rate), saturation (CPU, active connections, file descriptors).

Alerts: p99 above SLO for 5 minutes; 5xx rate spike; certificate expiry under 30 days; Redis unreachable; config push failures; connection pool near its limit.

Runbooks: gateway OOM (usually a connection leak from a backend that stopped timing out; restart is safe because instances are stateless, then fix the timeout); cascading backend timeouts (tighten timeouts, open circuit breakers manually if automation lags, temporarily tighten rate limits to shed load); bad config deploy (automated rollback to last known good; canary config to one instance first and watch the error rate before a fleet-wide push).

Deploy safety: rolling deploys with health checks that verify the route table actually loaded (a gateway that serves 200 on /health but has no routes is worse than one that is down); drain connections on SIGTERM (stop accepting, finish in-flight, 30s grace).

Load test quarterly to find the real requests-per-instance number before traffic finds it for you. Chaos drills: kill an AZ, kill Redis, expire a certificate on staging and watch the rotation path.

## Build vs Buy

**Use managed** (AWS API Gateway, Cloudflare, Kong Konnect) when: you want zero operations, your routing needs are standard, and you are comfortable with per-request pricing.

**Self-host** (Envoy, Kong OSS, Traefik) when: you need custom plugins, have very high throughput (managed per-request pricing gets expensive), or need features the managed options lack.

For most teams, start managed. Move to self-hosted when the bill justifies the operational cost, usually around very high request volumes.
