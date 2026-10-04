---
title: "API Versioning That Does Not Break Clients"
date: "2026-10-15"
tags: ["API", "Backend", "Architecture"]
description: "URL vs header versioning, deprecation policies, additive changes, and contract testing for evolving APIs without breaking consumers."
readingTime: 14
---

APIs evolve. New features need new fields, old endpoints need deprecation, and clients need time to migrate. Versioning done well makes this boring. Versioning done poorly creates 2 AM pages and angry Slack messages from consumer teams.

Here is what works in practice.

## Design Overview

Versioning is not just a URL convention. It is a routing layer, an evolution discipline, and a communication process. The routing layer directs each request to the right handler based on the version signal. Handlers share as much logic as possible, with thin adapters for behavior that genuinely changed. Contract tests in CI guard the boundary, and the database evolves underneath it all with backward-compatible migrations.

```
+----------------+     +-----------------------+     +-------------+
|  Client on v1  +---->|  Version Routing      +---->|  Handlers   |
|  Client on v2  +---->|  (path prefix /v1,    |     |  (shared    |
|  Client (old,  +---->|   /v2, Sunset and     +---->|   logic +   |
|   unversioned) |     |   Deprecation headers,|     |   adapters) |
+----------------+     |   per-version split) |     +------+------+
                       +-----------+---------+            |
                                   |                      v
                                   v              +-------------+
                       +-----------------------+ |  Database   |
                       |  Contract Tests (CI)  | |  (nullable  |
                       |  oasdiff / Pact,      | |   columns,  |
                       |  breaking-change gate | |   expand /  |
                       +-----------------------+ |   contract)|
                                                 +-------------+
```

The key insight in the diagram: versioning touches the router, the handlers, the tests, and the database. Teams that treat it as only a URL problem end up with a clean URL and a broken system underneath.

## The Golden Rule: Never Break Existing Clients

This sounds obvious, but it is violated constantly. The rule is simple: once an API is in production and has consumers, you cannot change its behavior in ways that break those consumers without their explicit coordination.

What counts as breaking:
- Removing a field from a response
- Changing a field type (string to number, even if the values look similar)
- Changing error response format
- Adding required request parameters
- Changing default behavior

What does not break (generally safe):
- Adding new optional fields to responses
- Adding new endpoints
- Adding new optional query parameters
- Adding new enum values (if clients handle unknown values gracefully)

When in doubt, assume it breaks. The cost of being wrong is a production incident.

## Versioning Strategies

### URL Versioning: /v1/, /v2/

```
GET /v1/users/123
GET /v2/users/123
```

**Pros:**
- Explicit and visible. You can see the version in logs, browser dev tools, and documentation.
- Easy to route. Load balancers and API gateways can route by path prefix.
- Cache-friendly. Different URLs are naturally cached separately.

**Cons:**
- URL pollution. `/v1/users`, `/v2/users`, `/v3/users` accumulate.
- Can encourage breaking changes ("we will just bump the version") instead of designing for evolution.

**Verdict:** The most common choice, and usually the right one. The explicitness outweighs the downsides.

### Header Versioning

```
GET /users/123
Accept: application/vnd.myapi.v2+json
```

**Pros:**
- Clean URLs that do not change.
- Version is a representation concern, which is philosophically pure REST.

**Cons:**
- Invisible. Harder to debug (you cannot see the version in the URL).
- Harder to test (need to set headers in every tool).
- Caching is trickier (vary on Accept header).

**Verdict:** Theoretically elegant, practically annoying. I do not recommend it unless you have a specific reason.

### Query Parameter Versioning

```
GET /users/123?version=2
```

**Pros:** Simple to implement.

**Cons:** Messy URLs, easy to forget, caching complications.

**Verdict:** Avoid. It combines the downsides of both approaches above.

### Content Negotiation

```
GET /users/123
Accept: application/vnd.myapi+json; version=2
```

**Pros:**
- Clean URLs, version as a representation parameter.
- One resource, multiple representations, which is the REST-purist ideal.

**Cons:**
- All of header versioning's invisibility problems, plus worse tooling support. Most HTTP clients, caches, and API gateways treat media-type parameters as second-class citizens.
- Content negotiation logic in code tends to sprawl: version checks scattered through handlers instead of one routing rule.

**Verdict:** The worst of both worlds for most teams. Only consider it if a standard or a large enterprise client mandates it.

**My recommendation:** Use URL versioning (`/v1/`, `/v2/`). It is the industry standard for a reason, and the reasons are operational, not aesthetic:

- **Observability.** The version is in the access log, the trace, and the dashboard. You can answer "how much traffic is still on v1?" with a log query.
- **Routing.** A path-prefix rule in the gateway or load balancer is trivial. Header-based routing works but is harder to read and easier to misconfigure.
- **Caching.** Different URLs are naturally separate cache entries. Header versioning requires `Vary: Accept`, which many caches handle poorly.
- **Debuggability.** You can paste a versioned URL into a browser, a ticket, or a runbook. Headers cannot be pasted.

Headers win only when URL stability is a hard requirement, such as a HATEOAS-pure API or an enterprise standard that forbids versioned paths. That is rare. Default to the URL.

## Designing for Evolution (Avoid Version Bumps)

The best versioning strategy is the one you rarely need. Design APIs to evolve without breaking changes:

**Additive changes only:**
```json
// v1 response
{"id": "123", "name": "Alice"}

// v2 response (backward compatible)
{"id": "123", "name": "Alice", "email": "alice@example.com"}
```

Old clients ignore the new `email` field. New clients use it. No version bump needed.

**Never remove, only deprecate:**
```json
// Instead of removing 'username', mark it deprecated
{
  "id": "123",
  "name": "Alice",
  "username": "alice123",  // Deprecated: use 'name' instead
  "email": "alice@example.com"
}
```

**Use optional parameters for new behavior:**
```
# Old clients: default behavior (unchanged)
GET /v1/users/123

# New clients: opt into new behavior
GET /v1/users/123?include_deleted=true
```

If you follow additive-only evolution rigorously, you may never need v2. Many successful APIs have run on v1 for years with continuous additive improvements.

**Additive discipline, in detail.** Adding a field is safe only if old clients ignore unknown fields, so confirm that for each client platform you support (most JSON parsers do, but strict decoders and some code-generated clients do not). Adding enum values is safe only if clients handle unknown values gracefully; if a client switches exhaustively over your enum, a new value crashes it. Either document "treat unknown enum values as X" or version the enum change.

Renaming a field is never additive, so do it as add-then-deprecate: add the new field, mark the old one deprecated with a removal date, wait for usage to hit zero, then remove. This is two changes separated by months, not one change. Teams that try to do it in one change are the ones writing incident reports.

New behavior behind optional parameters keeps the default path untouched:

```
# Default behavior: exactly what v1 always did
GET /v1/orders

# New behavior, opt-in only
GET /v1/orders?sort=created_desc
```

The rule of thumb: a client written against last year's API should work against this year's API without modification. If you cannot say that, you need a version bump and a migration plan.

## Database Schema Versioning

API versioning fails when the database underneath cannot support two versions at once. The fix is the expand-contract pattern, applied to every migration:

1. **Expand.** Add the new column as nullable (or the new table alongside the old one). Deploy. Old code keeps working because it ignores the new column.
2. **Migrate.** Dual-write to both old and new columns, then backfill historical rows. Readers still use the old column.
3. **Contract.** Switch readers to the new column, verify, then drop the old column in a later deploy.

Never rename a column in one deploy. Never add a non-nullable column without a default to a table that old code writes to. Every migration must be backward compatible with the currently deployed application version, because during a rolling deploy both versions run against the same database at the same time.

This is also why additive API evolution and additive database evolution go together: a nullable column maps cleanly to an optional API field, and the same "never remove, only deprecate" discipline applies at both layers.

## Deprecation Policy

When you must remove something, do it with a clear policy:

1. **Announce deprecation** with a timeline (minimum 6 months for external APIs, 3 months for internal).
2. **Add deprecation headers** to responses from deprecated endpoints.
3. **Monitor usage.** Track which clients still use deprecated endpoints. Do not remove until usage is zero or you have explicit sign-off from remaining consumers.
4. **Communicate directly.** For important clients, reach out personally. Do not rely on them reading changelogs.

```
# Deprecation headers
Deprecation: true
Sunset: Sat, 01 Mar 2026 00:00:00 GMT
Link: <https://docs.example.com/migration>; rel="deprecation"
```

The `Sunset` header (RFC 8594) is the standard way to communicate removal dates. Use it.

**Deprecation communication, beyond headers.** Headers only reach clients that are looking. A real deprecation campaign has layers:

- **Changelog with teeth.** Every deprecation gets a dated entry with the sunset date, the replacement, and a migration example. "Deprecated" without a date is not a plan.
- **Usage dashboards.** Track deprecated-endpoint traffic by client (API key, service name, or user agent). Publish the dashboard where consumer teams can see it. Nothing motivates migration like seeing your own service at the top of the "still on v1" list.
- **Direct outreach for the long tail.** After the announcement, contact the top consumers personally. After that, contact the stragglers again at 50 percent and 90 percent of the timeline. The clients who never read changelogs are the ones who page you when the endpoint disappears.
- **SDK and log warnings.** If you ship client SDKs, log a deprecation warning on every call to a deprecated path. Developers notice their own logs faster than your docs.
- **Hard dates, kept.** If you extend a sunset date once, every future date becomes negotiable. Extend only for genuine blockers, and say so publicly.

The failure mode here is always the same: the team announces the deprecation, nobody migrates, the date arrives, and the team blinks. Then the deprecated version lives forever and the next deprecation is ignored from day one. Keep your dates.

## Contract Testing

Even with careful versioning, changes slip through. Contract testing catches them.

**Consumer-driven contracts (Pact):**
- Consumers define their expectations as contracts
- Providers verify against these contracts in CI
- Breaking changes are caught before deployment, not after

**Schema validation in CI:**
- Validate OpenAPI specs on every PR
- Detect breaking changes automatically (tools like `oasdiff`)
- Block merges that introduce breaking changes without explicit approval

```bash
# Example: detect breaking changes between spec versions
oasdiff breaking old-spec.yaml new-spec.yaml
```

This should run in CI for every API change. If it detects a breaking change, the PR requires explicit approval from API consumers or a version bump.

## Versioning Internal vs External APIs

**External APIs** (third-party developers, public):
- Strict versioning required
- Long deprecation timelines (12+ months)
- Detailed migration guides
- Consider never removing old versions (Stripe still supports very old API versions)

**Internal APIs** (service-to-service within your company):
- More flexibility, but still need discipline
- Shorter deprecation timelines (1-3 months)
- Can coordinate directly with consumer teams
- Still avoid breaking changes; use additive evolution

The temptation with internal APIs is to be sloppy ("we will just update all the callers"). This works until you have 50 services and cannot coordinate a synchronized deploy. Treat internal APIs with nearly the same rigor as external ones.

## Scalability

Versioning scales badly in a specific way: traffic is rarely the problem, operational surface is.

**Version sprawl.** Each supported version multiplies your test matrix, your documentation, your SDK surface, and your on-call cognitive load. Three versions of an API is roughly three times the maintenance, because bug fixes and security patches often need backporting to every live version. At 10x the number of consumers, the cost is not requests per second, it is the support queue: more clients on more versions, each with their own quirks. At 100x, teams quietly stop testing old versions, old versions rot, and the incident that finally forces a cleanup is always worse than the cleanup would have been.

**Deprecation at scale.** With ten consumers you can coordinate migration over coffee. With a thousand, you need machinery: per-client usage tracking (log the API key or service name with the version on every request), automated reminders keyed to usage, and a sunset process that does not require human judgment per client. Build this instrumentation before you need it. Retrofitting client attribution into logs during a forced migration is miserable.

**Multi-version traffic splitting.** When you do ship a new version, do not cut over all at once. Route a small percentage of the new version's traffic to the new code (canary by version), watch error rates and latency against the old version, then ramp. Version prefixes make this trivial at the gateway: send 1 percent of `/v2/` traffic to the new deployment. Adapters that translate v1 requests into v2 internally let you run one codebase behind two versioned surfaces, which cuts the sprawl cost dramatically. One implementation, two contracts.

**What breaks first.** Not throughput. It is the team's willingness to maintain old versions: tests get skipped, docs go stale, and a security patch ships to v3 while v1 and v2 sit exposed. The fix is structural, not heroic: keep the number of live versions small (two is comfortable, three is the warning sign), automate the deprecation pipeline, and treat every version you keep as a promise you are still paying for.

## Security Considerations

**Auth on every version.** Every live version must enforce current authentication and authorization. The classic failure is v1 shipping before the new auth scheme existed, and nobody backporting it. An old version with weaker auth is not legacy, it is a hole. When you add a security control, the rollout plan must cover all live versions or explicitly sunset the ones it cannot cover.

**Version confusion attacks.** If the server accepts the version from multiple signals (URL path, header, query parameter), an attacker can send conflicting signals and get the server to process the request under the weaker version's validation. Defense: one canonical version signal (the URL path), resolved once at the edge, and reject requests with ambiguous or conflicting version indicators.

**Deprecated endpoint exploitation.** Old versions accumulate known issues: weaker input validation, verbose error messages that leak internals, missing rate limits. Attackers enumerate old versions precisely because defenders stop watching them. Keep deprecated endpoints patched until removal, monitor them for anomalous traffic, and treat a traffic spike on a deprecated version as a security signal, not just a migration failure.

**Defense in depth.** Validate inputs in every version's handlers, not just the latest. Apply rate limiting per version and per client, so one client's v1 flood cannot starve v2 traffic. Terminate TLS at the gateway, enforce auth at the edge, and re-check authorization in the service. Versioning multiplies your attack surface by the number of live versions; the controls have to multiply too.

## Production Checklist

- p99 latency and error rate per version, not just per service. A regression in v2 hides inside aggregate metrics.
- Traffic share per version over time. v1's share should shrink monotonically after v2 launches. If it grows, your migration is failing.
- Deprecated endpoint request counts with client attribution (API key, service name). You cannot sunset what you cannot attribute.
- Alert on: deprecated-endpoint traffic above threshold near a sunset date, error-budget burn on any live version, and version skew (unexpected v1 growth).
- Run `oasdiff breaking` (or equivalent spec diffing) in CI on every API change. Block merges on breaking changes unless explicitly approved with a version bump.
- Consumer-driven contract tests (Pact) for your most important consumers. They catch the breaking changes that spec diffs miss, like changed default behavior.
- Canary new versions by routing a small share of the version's traffic to the new code first.
- Failure modes to rehearse: a breaking change that slipped past CI, a major client pinned to a version with a known bug, and a database migration that was not backward compatible with the old app version during rollout.
- Sunset process: announce with a date, add `Sunset` headers, monitor usage, do direct outreach to stragglers, remove only at zero usage or with explicit sign-off.

## The Checklist

- Use URL versioning (`/v1/`, `/v2/`)
- Prefer additive changes over version bumps
- Never remove fields without deprecation
- Set explicit sunset dates for deprecated endpoints
- Monitor deprecated endpoint usage before removal
- Run contract tests or spec diffing in CI
- Document migration paths for breaking changes
- Treat internal APIs with almost the same rigor as external

Good API versioning is invisible. Clients upgrade on their schedule, not yours. Breaking changes are rare and well-communicated. That is the goal.
