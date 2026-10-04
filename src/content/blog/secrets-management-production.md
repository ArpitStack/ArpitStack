---
title: "Secrets Management in Production: Vault, AWS Secrets Manager, and Rotation"
date: "2027-02-22"
tags: ["Security", "DevOps", "AWS"]
description: "Secret injection patterns, rotation without restarts, and audit trails: production secrets management compared."
readingTime: 11
---

Every application needs secrets: database passwords, API keys, TLS certificates. How you store, inject, and rotate them determines whether a credential leak is a minor incident or a major breach. This post covers production patterns for the two most common options.

## The Problem with Environment Variables

The default approach is environment variables. They are simple, universally supported, and visible in process listings, container inspect output, and CI logs. That visibility is the problem.

Environment variables are not secret. They appear in:
- `ps e` output (on some systems)
- Docker inspect output
- Kubernetes pod descriptions (if set directly in manifests)
- Application crash dumps
- CI/CD logs (if not properly masked)

Use environment variables for configuration, not for secrets. The distinction matters.

## AWS Secrets Manager

AWS Secrets Manager stores secrets as encrypted key-value pairs, with built-in rotation support and fine-grained IAM access control.

```python
import boto3
import json

def get_secret(secret_name):
    client = boto3.client('secretsmanager', region_name='us-east-1')
    response = client.get_secret_value(SecretId=secret_name)
    return json.loads(response['SecretString'])

# Usage
db_creds = get_secret('prod/database/credentials')
```

**Pricing:** $0.40 per secret per month, plus $0.05 per 10,000 API calls. For 100 secrets with moderate access, roughly $50-100/month. Not free, but reasonable.

**Rotation:** Secrets Manager supports automatic rotation with Lambda functions. For RDS, it provides built-in rotation templates. The rotation process creates a new credential, tests it, then deprecates the old one.

### Injection Patterns

**Sidecar or init container.** Fetch secrets at pod startup and write to a shared volume or environment. Simple, but secrets exist as files that could be read if the pod is compromised.

**CSI Secrets Store Driver.** Mounts secrets as volumes directly from Secrets Manager. The driver handles authentication and refresh. Secrets never appear in environment variables or pod specs.

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: db-secrets
spec:
  provider: aws
  parameters:
    objects: |
      - objectName: "prod/database/credentials"
        objectType: "secretsmanager"
```

**Application SDK.** The application fetches secrets directly using IAM roles. Most flexible, but requires SDK integration in every service. Best when you need dynamic secret fetching (not just startup).

## HashiCorp Vault

Vault is the self-hosted alternative. It provides secrets storage, dynamic secret generation, encryption as a service, and detailed audit logs.

**Dynamic secrets** are Vault's killer feature. Instead of storing a static database password, Vault generates short-lived credentials on demand:

```bash
# Vault generates a temporary database user
vault read database/creds/myapp-role
# Returns: username="v-root-myapp-12345", password="...", lease_duration="1h"
```

When the lease expires, Vault revokes the credentials automatically. Even if leaked, they stop working within the hour. This is fundamentally more secure than long-lived static secrets.

**Operational cost:** Vault requires running a cluster (3+ nodes for HA), managing Raft storage, handling unsealing, and monitoring. It is not trivial to operate. Use it when you need features AWS Secrets Manager lacks (dynamic secrets, multi-cloud, advanced audit).

## Rotation Without Restarts

The hardest part of secrets management is rotation. Changing a database password should not require restarting every application.

**Approach 1: Dual credentials.** Maintain two valid credentials during rotation. Update applications to the new credential gradually, then revoke the old. Works but requires application support for credential switching.

**Approach 2: Dynamic reloading.** Applications watch for secret changes (file watcher on mounted secrets, or periodic refresh) and reload without restart. The CSI driver supports auto-rotation by updating mounted files.

**Approach 3: Short-lived credentials.** With Vault dynamic secrets, credentials expire automatically. Applications request new ones before expiry. No rotation event, just continuous renewal.

**What does not work:** Restarting all pods simultaneously to pick up new secrets. This causes downtime. Use rolling restarts at minimum, but prefer dynamic reloading.

## Audit Trails

Both solutions provide audit logs, but with different granularity:

- **Secrets Manager**: CloudTrail logs API calls (who accessed which secret, when). It does not log what the application did with the secret.
- **Vault**: Detailed audit log of every request, including client identity, request path, and response (with sensitive data hashed). More granular, but requires log management infrastructure.

For compliance (SOC2, PCI), Vault's audit trail is more complete. For standard AWS workloads, CloudTrail plus application logging is usually sufficient.

## Choosing Between Them

**Use AWS Secrets Manager when:**
- You are AWS-native and want minimal operational overhead
- Secrets are relatively static (database passwords, API keys)
- Team does not have Vault expertise
- Cost of $0.40/secret/month is acceptable

**Use Vault when:**
- You need dynamic, short-lived credentials
- You operate multi-cloud or hybrid infrastructure
- You need advanced audit capabilities for compliance
- You have the operational capacity to run Vault reliably

**Use both when:** Static secrets in Secrets Manager for simplicity, Vault for the specific workloads that need dynamic credentials. This is common in larger organizations.

## What to Avoid

- **Secrets in Git.** Even private repos. Use git-secrets or similar pre-commit hooks to prevent accidental commits.
- **Secrets in container images.** They are visible to anyone who can pull the image.
- **Shared secrets across environments.** Production database passwords should not work in dev.
- **No rotation policy.** If a secret has never been rotated, assume it is compromised.

## Tradeoff Deep-Dive: Static Versus Dynamic, Managed Versus Self-Hosted

The fundamental tradeoff in secrets management is credential lifetime. Static secrets are simple to reason about and universally supported: every framework reads a password from somewhere. Their failure mode is silent accumulation of risk. A database password created two years ago exists in backups, in old container image layers, in a former employee's shell history, and in a chat thread someone pasted it into during an incident. Rotation is the mitigation, and rotation is where static secrets get expensive: every rotation is a coordinated distributed-systems event across every consumer.

Dynamic secrets invert this. Vault generates a credential with a one-hour lease; when it expires, it stops working, leaked or not. The blast radius of any single credential is bounded by time. The price is architectural: every application must handle credential renewal, which means retry logic, lease watchers, and graceful handling of renewal failing at 3 AM. Applications written against static secrets need rework, and the failure mode shifts from "leaked credential" to "renewal loop bug takes down the service when Vault is unreachable". Teams underestimate this: adopting dynamic secrets means adopting a new availability dependency on the Vault cluster for every database connection in the fleet.

The managed versus self-hosted axis is an operational-capacity question disguised as a feature comparison. Secrets Manager costs $0.40 per secret per month plus API charges; for most teams this is noise next to one engineer's time. Vault is free software with a very real payroll cost: three or more nodes, Raft operations, unseal procedures, upgrades, monitoring, and on-call for the system everything else depends on. The break-even is roughly this: if you need dynamic secrets, multi-cloud, or compliance-grade audit trails, and you have (or will hire) someone who has operated Vault before, self-host. Otherwise the managed service wins on total cost by a wide margin. The hybrid pattern (Secrets Manager for static secrets, Vault for the workloads that genuinely need dynamic credentials) is not indecision; it is matching the tool to the threat model per workload.

One more tradeoff interviews love: rotation frequency against availability risk. Rotating monthly bounds exposure, but each rotation is a chance to break production. The mature answer is not a fixed cadence but automation maturity: rotate as often as your automation is reliable. Start quarterly with dual-credential windows, measure the rotation success rate, tighten the cadence as it approaches 100%. A team rotating weekly with 99.9% automated success is safer than a team rotating annually with a manual runbook nobody has tested.

## System Architecture

```
+--------------+     +------------------+
|  App pod     |---->|  Injector        |
+--------------+     |  CSI or sidecar  |
                     |  or SDK          |
                     +--------+---------+
                              |
                    +---------+---------+
                    |                   |
                    v                   v
           +------------------+ +------------------+
           |  Vault cluster   | |  AWS Secrets     |
           |  dynamic creds   | |  Manager         |
           |  Raft storage    | |  rotation Lambda |
           +------------------+ +------------------+
```

The application pod authenticates to the injector through IRSA or the Vault Kubernetes auth method (this is the secret-zero problem, solved with short-lived identities rather than long-lived tokens). The injector fetches from Vault for dynamic, short-lease credentials or from Secrets Manager for static secrets, with a rotation Lambda keeping the latter fresh. Every access lands in the audit trail: CloudTrail for Secrets Manager, the Vault audit device for Vault. The CSI driver mounts secrets as tmpfs volumes with automatic rotation, so secrets never touch disk or environment variables.

## Scalability

At 10x secrets and services, Secrets Manager GetSecretValue API rate limits begin to bite; naive per-request fetching turns the secrets service into a hot path. Cache aggressively with TTLs (the SDK cache extensions exist for this). Vault's single active node handles all writes; read throughput scales with performance standby nodes, write throughput does not.

At 100x, the dominant risk is rotation storms: a thousand secrets rotating in the same window means a thousand Lambda invocations, a thousand database credential changes, and a thousand application reloads. Databases serialize credential changes; connection pools churn; monitoring drowns in rotation events. Vault unseal and leader election add load at the worst moment; CSI driver DaemonSets consume node resources on every pod start.

The scaling strategy: stagger rotation schedules with jitter across the fleet (never rotate everything Sunday at midnight). Cache client-side with sensible TTLs so steady-state read load is near zero. Use Vault performance replicas for read-heavy patterns. Batch and window rotations per service tier (critical datastores rotate alone, with verification). Load-test the rotation path, not just the read path. Cap rotation Lambda concurrency so a fleet-wide rotation cannot overwhelm the database control plane.

## Security Considerations

IAM least privilege per secret path: a service's role reads exactly its own secrets, nothing else; no wildcard secretsmanager actions. Vault policies bind to Kubernetes service accounts through the Kubernetes auth method, with short TTLs and explicit maximums. Encryption in transit via TLS everywhere; at rest through KMS (Secrets Manager) or the seal mechanism plus encrypted Raft snapshots (Vault).

Secret hygiene: mount secrets on tmpfs volumes, never on disk; avoid environment variables for secrets (they leak into process listings and crash dumps); mask secrets in CI logs; encrypt etcd (Kubernetes Secrets are base64, not encrypted, by default); rotate the rotation Lambda's own credentials too.

Realistic attack vectors: a compromised node reading every secret mounted on it (mitigate with per-pod scoping, short-lived dynamic credentials, and node isolation for sensitive workloads); an overly broad IAM policy letting one service read all secrets (mitigate with per-secret resource ARNs and regular access reviews); leaked rotation Lambda credentials carrying database admin rights (mitigate with least privilege and short-lived execution roles); etcd snapshot theft exposing all Kubernetes Secrets (mitigate with encryption at rest and restricted snapshot access); secrets committed to Git (pre-commit hooks plus periodic history scans); a former employee's access lingering (tie secret access to SSO groups with automated deprovisioning).

## Production Checklist

Signals: secret read error rate; rotation success and failure counts; Vault sealed status and leader changes; CSI driver mount failure rate; audit log delivery lag; GetSecretValue throttling metrics.

Alert thresholds: any rotation failure (a failed rotation means the next one may compound, so treat it as an incident); Vault sealed for more than a few minutes; mount failures above 1% of pod starts; audit log delivery gap above 5 minutes; sustained API throttling.

Failure modes seen in practice: a rotation Lambda bug that sets the database password to a value nobody recorded (the classic split-brain: rotation writes the new password to the secret but the database rejects it, or vice versa; runbook: keep a dual-credential window where old and new both work, verify the new credential with a test connection before deprecating the old); Vault sealed after a node restart with no auto-unseal configured (runbook: documented unseal ceremony with key holders, or better, auto-unseal via KMS from day one); a CSI driver upgrade breaking secret mounts across the fleet (pin driver versions, canary on non-critical namespaces); an expired TLS certificate on the Vault cluster (monitor expiry, automate renewal); a KMS key scheduled for deletion taking every secret with it (multi-region key replication, deletion protection, alarms on key state changes); an application caching a secret forever and missing a rotation (enforce maximum cache TTLs in code review).

Runbook notes: break-glass database credentials in a sealed envelope (physical or split-knowledge), tested quarterly. Rotation rollback means reinstating the previous credential version, which Secrets Manager retains. Never revoke the old credential until the new one is verified in production traffic. Game-day a Vault seal event before it happens for real.

---

*The best secrets management system is the one developers actually use. If it is too complex, they will hardcode credentials.*
