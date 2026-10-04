---
title: "How to Structure a Large Go Codebase: Lessons from Production"
date: "2027-03-01"
tags: ["Go", "Architecture", "Backend"]
description: "Package layout, dependency direction, interface design, and the monorepo question, drawn from running multiple Go microservices in production."
readingTime: 13
---

Go gives you very little structure out of the box. No classes, no namespaces, no enforced module system beyond the package. This freedom is great for small programs and dangerous for large ones. After running multiple Go microservices in production, here is what I have learned about keeping a large codebase maintainable.

## Start with the Standard Layout (Then Adapt)

The Go community has converged on a rough standard for project layout. It is not official, but it is widely understood:

```
myservice/
+-- cmd/
|   +-- myservice/
|       +-- main.go
+-- internal/
|   +-- handler/
|   +-- service/
|   +-- repository/
|   +-- model/
+-- pkg/
|   +-- shared/
+-- api/
|   +-- proto/
+-- migrations/
+-- go.mod
+-- Dockerfile
```

What each directory means:

- **cmd/**: Entry points. Each subdirectory is a separate binary. `main.go` should be thin, just wiring.
- **internal/**: Private code. Go enforces this: packages under `internal/` cannot be imported by code outside the parent module. Use this for everything that is not a shared library.
- **pkg/**: Public shared code. Be conservative about what goes here. Once something is in `pkg/`, other services may depend on it, and changing it becomes expensive.
- **api/**: Protocol definitions (protobuf, OpenAPI). The contract between services.

The mistake I see most often: putting everything in `pkg/` because it feels like the "code" directory. Then every service imports from every other service's `pkg/`, and you have a distributed monolith with none of the benefits of either architecture.

## Design Overview

Before the directory detail, here is the dependency graph for a typical service in this layout. Arrows show compile-time dependency direction, and it always points one way: toward the inner layer.

```
+----------+     +----------+     +----------+     +----------+
|   cmd    |---->| handler  |---->| service  |---->|   repo   |
+----------+     +----------+     +----------+     +----------+
     |                                                  |
     v                                                  v
+----------+                                        +----------+
|  config  |                                        | postgres |
+----------+                                        +----------+

+------------+     +------------+
| pkg/logs   |     | pkg/metrics|
+------------+     +------------+
```

Two rules fall out of this picture. First, no layer may depend on a layer to its left: `service` never imports `handler`, `repo` never imports `service`. Second, `cmd` is the only package that knows about everything. It reads configuration, constructs each layer, and injects dependencies downward (the composition root pattern, covered later). The bottom row shows cross-cutting packages any layer may import; they must contain no domain logic.

If you can draw this diagram for your service and every arrow points the same way, your boundaries are probably right. The next sections are about keeping it that way.

## Dependency Direction: The Most Important Rule

In a well-structured Go service, dependencies point inward. Handlers depend on services. Services depend on repositories. Nothing depends on handlers.

```
handler -> service -> repository -> database
```

The repository layer defines interfaces. The service layer depends on those interfaces, not on concrete implementations. This is the dependency inversion principle, and in Go it is natural because interfaces are satisfied implicitly.

```go
// repository/user.go
type UserRepository interface {
    GetByID(ctx context.Context, id string) (*User, error)
    Create(ctx context.Context, user *User) error
}

// service/user.go
type UserService struct {
    repo repository.UserRepository
}

func NewUserService(repo repository.UserRepository) *UserService {
    return &UserService{repo: repo}
}
```

Why this matters in practice:

- **Testing.** You can mock the repository with a simple struct. No database needed for service-layer tests.
- **Swapping implementations.** Moving from PostgreSQL to another store means writing a new repository implementation, not touching the service layer.
- **Clarity.** When you read the service code, you see business logic, not SQL.

The rule is simple: concrete types live at the edges (handlers, repository implementations). The core depends only on interfaces.

## Keep Interfaces Small

Go interfaces work best when they are tiny. The standard library models this: `io.Reader` has one method, `io.Writer` has one method, `http.Handler` has one method.

```go
// Good: small, focused
type Saver interface {
    Save(ctx context.Context, data []byte) error
}

// Bad: kitchen sink
type DataManager interface {
    Save(ctx context.Context, data []byte) error
    Load(ctx context.Context, id string) ([]byte, error)
    Delete(ctx context.Context, id string) error
    List(ctx context.Context, filter Filter) ([][]byte, error)
    Count(ctx context.Context) (int, error)
    // ... 15 more methods
}
```

Large interfaces are hard to mock, hard to implement, and they couple consumers to methods they do not use. If you find yourself writing an interface with more than 3 to 4 methods, consider splitting it.

Define interfaces where they are consumed, not where they are implemented. The service package defines `UserRepository` because the service is the consumer. The repository package just provides a struct with matching methods. This keeps interfaces minimal because each consumer only declares what it actually needs.

## Testing Strategy Per Layer

Each layer gets a different kind of test. Mixing them up is why test suites become slow and flaky.

**Handler tests** verify HTTP behavior: status codes, response shapes, auth rejection. Use `httptest` with a fake service. Never start a real server or touch a database here.

**Service tests** are the bulk of the suite. The repository is a fake (an in-memory map or a hand-written struct), so these run in milliseconds. Use table-driven tests:

```go
func TestUserService_GetByID(t *testing.T) {
    tests := []struct {
        name    string
        id      string
        wantErr bool
    }{
        {"found", "u1", false},
        {"missing", "nope", true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            svc := NewUserService(fakeRepoWithUsers())
            _, err := svc.GetByID(context.Background(), tt.id)
            if (err != nil) != tt.wantErr {
                t.Fatalf("got err=%v, wantErr=%v", err, tt.wantErr)
            }
        })
    }
}
```

**Repository tests** are integration tests against a real database. Test the SQL, not business logic: does this query return the right rows, does this migration apply cleanly. Spin up Postgres in Docker for these and run them in CI, not on every save.

The ratio to aim for: many service tests, some handler tests, few repository tests. If your suite takes more than a couple of minutes, the usual cause is repository-style tests leaking into the service layer.

## Package Names: Short and Clear

Go package names should be short, lowercase, single words. No underscores, no mixed caps.

Good: `user`, `order`, `payment`, `auth`
Bad: `userService`, `user_management`, `UserModels`

The package name appears at every use site, so verbosity multiplies. `userService.GetUser()` is redundant. `user.Get()` or `service.GetUser()` reads better.

Avoid generic names like `util`, `common`, `helpers`, or `misc`. These become dumping grounds for unrelated functions. If you cannot name a package specifically, that is a sign the code does not belong together. Split it by domain.

## The Monorepo Question

For multiple Go microservices, you have two choices: one repository per service, or a monorepo containing all services.

**Monorepo advantages:**
- Shared code is easy (just import from another package in the repo)
- Atomic changes across services (update the API and all consumers in one commit)
- Single CI/CD pipeline configuration
- Easier code search and refactoring

**Multi-repo advantages:**
- Independent versioning and deployment
- Clearer ownership boundaries
- Smaller clone times

For teams under 50 engineers, I recommend the monorepo. The coordination cost of multi-repo (versioning shared libraries, synchronizing API changes) outweighs the benefits at small scale. Use Go workspaces (`go.work`) if you need separate modules within the monorepo.

The critical discipline for monorepos: enforce boundaries. Use `internal/` aggressively. Just because two services are in the same repo does not mean they should share code freely. Each service should be independently deployable, even if it lives next to its siblings.

## Drawing the Boundary: Package vs Microservice

The layout above covers one service. The harder question is when something deserves to be its own service instead of a package.

My rule of thumb: a package boundary is a compile-time decision, a service boundary is an operational one. Crossing a service boundary costs you network latency, retry logic, partial failure, independent versioning, and distributed tracing. Only pay that cost for one of these reasons:

- **Independent scaling.** The billing worker needs 10x the CPU of the API. Packages cannot scale separately.
- **Independent deployment.** The team shipping notifications deploys daily; the payments team deploys monthly. Forcing one release train creates friction.
- **Separate data ownership.** If a component needs its own database and its own transactions, it is a service candidate. Sharing a database between services is the fastest route to a distributed monolith.
- **Team ownership.** Past a certain size, one team cannot own everything. A service is a unit of ownership as much as a unit of software.

What does not justify a service: "it might need to scale later," "it feels like a separate domain," or "microservices are the standard." I have seen teams split a working monolith into five services on day one and spend six months reimplementing transactions as sagas, debugging eventual consistency they did not need, and versioning APIs nobody else consumed.

Start as packages. Extract a service when one of the four reasons above is actually true, not anticipated. Extraction from a well-structured monolith (clean interfaces, one service owning its data) is straightforward. Untangling a distributed monolith is not.

## Scalability

Scale here means two things: team size and build time. The layout above survives 10x team growth; what changes is the tooling around it.

**At 10 engineers**, a monorepo with this layout just works. Full builds take seconds, `go test ./...` runs in a minute or two, and everyone knows where everything is.

**At 50 engineers**, CI wall-clock time becomes the bottleneck. Fixes that work:

- Share the build cache across CI runners (`GOCACHE`) so unchanged packages are never recompiled.
- Run tests only for changed packages and their dependents (`go list` can compute the affected set). Full-suite runs move to nightly.
- Split modules with `go.work` when parts of the repo need independent versioning, but keep them in one repo as long as you can.

**At 100+ engineers**, module boundaries become load-bearing. Shared internal libraries need semantic versioning discipline, because an uncoordinated breaking change now blocks dozens of teams. The `internal/` convention does real work here: it limits the blast radius of any change to the module that owns it.

What breaks first is rarely compilation. Go compiles fast. What breaks first is the feedback loop: a 40-minute CI pipeline, merge conflicts in shared code, and version drift across repositories if you went multi-repo. In a monorepo, what breaks first is discipline: someone imports across a service boundary "just this once," and six months later you have a distributed monolith wearing a monorepo costume. Enforce boundaries in CI with import checks (a simple allowlist over `go list` output) before that happens.

## Security Considerations

Code structure is a security control. Boundaries that are clear in the source are easier to audit and harder to misuse.

**Supply chain.** Every third-party module is code you did not write running in your binary. Pin versions in `go.mod`, keep `go.sum` committed, and let the checksum database do its job. Run `govulncheck` in CI. For air-gapped or high-assurance builds, vendor dependencies (`go mod vendor`) so the build fetches nothing at deploy time. Review new dependencies before adding them; a small utility library with one maintainer is not free, it is a trust decision.

**Trust boundaries.** Treat the handler layer as the trust boundary. Validate and sanitize all input there: request bodies, headers, query params. Deeper layers should be able to assume they receive valid data. Defense in depth does not mean re-validating everything in every layer; it means each layer enforces its own invariants (the repository enforces constraints, the service enforces business rules, the handler enforces input shape).

**Secrets.** Configuration flows one way, from `main` downward, and secrets flow the same way. Never commit secrets, never put them in `pkg/`, never log them. Load them from environment variables or a secret manager in `config.Load()`, and pass only what each layer needs. A repository that needs a database password should receive the connection string, not access to the entire secret store.

**The `internal/` convention as a security feature.** It prevents other modules from importing your half-finished, unaudited helpers. Public API surface is attack surface; `internal/` keeps it small by default.

## Configuration and Wiring

Keep `main.go` thin. Its job is to read configuration, initialize dependencies, and start the server. Business logic does not belong here.

```go
func main() {
    cfg := config.Load()

    db, err := postgres.Connect(cfg.DatabaseURL)
    if err != nil {
        log.Fatal(err)
    }

    userRepo := repository.NewUserRepository(db)
    userService := service.NewUserService(userRepo)
    userHandler := handler.NewUserHandler(userService)

    srv := &http.Server{
        Addr:    ":" + cfg.Port,
        Handler: router.Setup(userHandler),
    }

    // Graceful shutdown wiring here
    log.Fatal(srv.ListenAndServe())
}
```

This pattern, sometimes called "composition root" or "wiring," makes dependencies explicit. You can see the entire dependency graph of the service in one place. When something is hard to wire, that is a signal the design has a problem.

## What Breaks at Scale

Small Go codebases tolerate mess. Large ones do not. Here is what I have seen break:

1. **Circular imports.** Go forbids them at compile time, which is actually a feature. When you hit one, it means your package boundaries are wrong. Extract the shared types into a separate package.
2. **God packages.** A `service` package with 50 files and 10,000 lines. Split by domain: `user`, `order`, `billing`.
3. **Leaky abstractions.** The service layer constructing SQL queries because "it was faster." Six months later, nobody can change the database schema without breaking three layers.
4. **Shared mutable state.** Global variables for configuration, database handles, or caches. Use dependency injection instead. Globals make testing painful and concurrency dangerous.

## Production Checklist

Structure pays off only if the pipeline enforces it. These are the gates I want on every Go service before it ships:

- **`go vet` and `gofmt` in CI.** Non-negotiable. Formatting debates end at `gofmt -l`.
- **Race detector on every test run** (`go test -race ./...`). It roughly doubles test time and catches data races that only appear under load. Worth it.
- **A linter with teeth.** `golangci-lint` with a small, agreed set of linters (unused, staticcheck, errcheck). Large linter configs get ignored; five enforced rules get followed.
- **Tidy modules.** `go mod tidy` checked in CI so `go.mod` never drifts.
- **Observability from day one.** Structured logs with request IDs, RED metrics (rate, errors, duration) per endpoint, and `net/http/pprof` available behind authentication for live debugging.
- **Health and readiness probes.** Kubernetes needs to know when to send traffic and when to restart. A `/healthz` that checks the database connection, not one that always returns 200.
- **Rollback story.** For a Go binary, rollback is the previous container tag. Keep the last N images, make rollback a one-command operation, and test it before you need it.

Runbook pointer: when an incident hits, the dependency diagram at the top of this post is your map. Requests flow left to right; start debugging at the layer where the symptom appears and move inward.

## The Checklist

Before I consider a Go codebase well-structured:

- `main.go` is under 100 lines
- No package has more than 15 to 20 files
- Interfaces are defined by consumers and have fewer than 5 methods
- `internal/` is used for everything service-specific
- No circular dependencies (enforced by the compiler)
- Configuration flows in one direction: main to handlers to services to repositories

Structure is not about following rules for their own sake. It is about making the codebase easy to change six months from now, when you have forgotten why you wrote it the way you did.
