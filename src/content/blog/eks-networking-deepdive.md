---
title: "EKS Networking Explained: VPC CNI and Pod Communication"
date: "2026-12-07"
tags: ["Kubernetes", "AWS", "Networking", "EKS"]
description: "How pod networking actually works on EKS: VPC CNI modes, security groups for pods, network policies, and DNS."
readingTime: 10
---

EKS networking confuses people because it is not one thing. It is a stack: VPC, subnets, the CNI plugin, security groups, kube-proxy, CoreDNS, and network policies. Each layer has its own behavior and failure modes. This post walks through the full picture.

## The VPC CNI: How Pods Get IPs

EKS uses the Amazon VPC CNI plugin by default. Unlike overlay-based CNIs (Calico, Flannel) that assign pod IPs from a separate CIDR, the VPC CNI assigns real VPC IP addresses to pods. Each pod gets an IP from the subnet's CIDR range, routable within the VPC without NAT or encapsulation.

This has real consequences:

- Pods are first-class VPC citizens. They can communicate with RDS, ElastiCache, and other VPC resources directly.
- You consume VPC IP addresses fast. Each node has a limit on elastic network interfaces (ENIs), and each ENI supports a limited number of secondary IPs. A large node running many small pods can exhaust IPs before it exhausts CPU or memory.
- Security groups apply at the pod level (with additional configuration), not just the node.

The IP exhaustion problem is the most common EKS networking surprise. Monitor `vpc.amazonaws.com/pod-ips` allocation. If pods are stuck in Pending with "insufficient IP addresses" events, you need larger subnets, prefix delegation, or fewer pods per node.

### Prefix Delegation

By default, the VPC CNI assigns individual secondary IPs to pods. With prefix delegation enabled, it assigns /28 prefixes (16 IPs) instead. This dramatically increases the number of pods per node on Nitro-based instances. Enable it unless you have a reason not to:

```yaml
# In the aws-node DaemonSet
env:
- name: ENABLE_PREFIX_DELEGATION
  value: "true"
```

## CNI Modes: A Note on Alternatives

The VPC CNI is not the only option. Some teams run Calico or Cilium on EKS for advanced network policy enforcement or eBPF-based observability. These are valid choices, but they add operational complexity. The VPC CNI handles the common case well. Switch only when you have a specific requirement (like WireGuard encryption or L7 network policies) that the VPC CNI cannot meet.

## Security Groups for Pods

By default, pods inherit the node's security group. This is coarse. A compromised pod has the same network access as the node itself.

Security Groups for Pods (SGP) lets you assign distinct security groups to individual pods. The CNI creates a trunk ENI on the node and attaches pod-specific ENIs with their own security groups.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: api-server
  labels:
    app: api
spec:
  securityGroupPolicy:
    securityGroups:
      - sg-0abc123def456
```

Use SGP for workloads with distinct network access requirements: a pod that talks to a PCI-scoped database should not share a security group with a pod that only serves public HTTP.

Caveats: SGP has per-node limits on the number of security groups and pod ENIs. It also adds slight latency to pod startup because ENI attachment takes time. Do not use it for every pod. Use it where network segmentation matters.

## Pod-to-Pod Communication

Within a cluster, pods communicate directly via their VPC IPs. There is no overlay, no NAT. kube-proxy (in iptables or IPVS mode) handles Service ClusterIPs by programming NAT rules on each node.

EKS now supports eBPF-based kube-proxy replacement via Cilium, but the default iptables mode works fine for most clusters. IPVS mode scales better beyond a few thousand Services.

The scaling limit worth knowing is iptables rule count. Every Service and every Endpoint creates iptables rules on every node, so rule count grows with services times endpoints. Past a few thousand services, kube-proxy sync latency climbs and rule updates lag, which surfaces as intermittent connection failures to newly scaled pods. IPVS uses a hash table instead of a linear rule list, so it degrades far more gracefully. The other classic surprise is cross-AZ data transfer: pods in different AZs still incur inter-AZ charges even when they talk directly, and chatty east-west traffic between microservices can produce a painful AWS bill. Topology-aware routing and zone-aware endpoint distribution keep most traffic inside the AZ.

Key debugging steps when pod-to-pod communication fails:

1. Check if the pods have IPs (`kubectl get pods -o wide`). No IP means CNI or IPAM failure.
2. Check security groups. The most common cause of "connection refused" between pods is a security group blocking the port.
3. Check network policies. If you use Calico or Cilium for policy enforcement, a missing allow rule silently drops traffic.
4. Check DNS. If IPs work but hostnames do not, the problem is CoreDNS, not networking.

## Network Policies

Kubernetes NetworkPolicies are API objects. They do nothing unless a CNI plugin enforces them. The VPC CNI added network policy support, but many teams still use Calico for this.

A default-deny policy is the starting point for zero-trust pod networking:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
```

Then add explicit allow rules per workload. This is tedious but correct. Start with new namespaces, not existing ones. Applying default-deny to a running namespace will break things until you add the allow rules.

## DNS: CoreDNS on EKS

CoreDNS runs as a Deployment in kube-system, typically with 2 replicas. Every pod's `/etc/resolv.conf` points to the ClusterIP of the kube-dns Service.

Common DNS issues on EKS:

- **Slow DNS resolution**: CoreDNS pods are CPU-throttled. Increase CPU requests. Also consider NodeLocal DNSCache, which runs a DNS cache on each node and reduces CoreDNS load.
- **DNS loops**: Pods using the VPC DNS (169.254.169.253) alongside cluster DNS can create resolution loops. Keep pod DNS config simple.
- **External DNS latency**: CoreDNS forwards non-cluster domains to the VPC resolver. If external resolution is slow, the problem is usually VPC DNS, not CoreDNS.

```yaml
# NodeLocal DNSCache DaemonSet (simplified)
# Reduces CoreDNS load by caching on each node
# Recommended for clusters with high DNS query volume
```

One DNS behavior worth knowing: the `ndots:5` default in pod resolv.conf means any name with fewer than five dots is tried against every search domain first. A lookup for `postgres` becomes `postgres.namespace.svc.cluster.local`, then `postgres.svc.cluster.local`, and so on, generating up to five queries per lookup. Applications that resolve external hostnames frequently multiply their DNS load by 5x. Mitigations: use fully qualified names with a trailing dot in application config, or deploy NodeLocal DNSCache so the amplification is absorbed on-node instead of hitting CoreDNS.

## Load Balancing: ALB vs NLB

EKS does not include an ingress controller by default. You choose:

- **AWS Load Balancer Controller** provisions ALBs (Layer 7) for Ingress objects and NLBs (Layer 4) for Service type LoadBalancer.
- ALB is right for HTTP/HTTPS with path-based routing, WAF integration, and OIDC authentication.
- NLB is right for TCP/UDP, extreme performance, static IPs, and non-HTTP protocols.

For pod-direct routing (bypassing kube-proxy), use ALB target type `ip`. Traffic goes directly to pod IPs. This reduces a network hop and preserves source IP. It requires the VPC CNI (which you have).

## Practical Checklist

For a production EKS cluster, verify:

- [ ] Subnets are large enough for pod IP growth (plan for 2x current pods)
- [ ] Prefix delegation is enabled
- [ ] Security Groups for Pods is configured for sensitive workloads
- [ ] Network policies enforce default-deny in production namespaces
- [ ] CoreDNS has adequate CPU and NodeLocal DNSCache is considered
- [ ] ALB uses `ip` target type for pod-direct routing
- [ ] VPC Flow Logs are enabled for network debugging

EKS networking is not complicated once you see the layers. The problems come from treating it as a black box. Understand the CNI, the security groups, and DNS, and you can debug anything.

## System Architecture

Traffic enters through a load balancer, lands on worker nodes, and is routed to pods by the CNI and kube-proxy. Each layer below is a separate failure domain.

```
+------------------+     +------------------+
|  Clients         |---->|  ALB or NLB      |
+------------------+     +------------------+
                                |
                                v
                     +------------------+
                     |  Worker Nodes    |
                     |  VPC CNI         |
                     +------------------+
                      |                |
                      v                v
             +---------------+  +---------------+
             |  Pod with SGP |  |  Pod          |
             |  10.0.1.15    |  |  10.0.2.44    |
             +---------------+  +---------------+
                      |                |
                      +-------+--------+
                              |
                              v
                     +------------------+
                     |  CoreDNS and     |
                     |  kube-proxy      |
                     +------------------+
```

The AWS Load Balancer Controller provisions the ALB or NLB. With target type `ip`, the ALB routes directly to pod IPs, skipping kube-proxy. The VPC CNI assigns each pod a real VPC address from the subnet, so pods reach RDS and ElastiCache without NAT. kube-proxy programs Service ClusterIPs via iptables or IPVS on each node. CoreDNS resolves cluster names; the VPC resolver handles everything else. Security groups for pods attach distinct ENIs to sensitive pods, and network policies add a second enforcement layer on top.

## Scalability

At 10x pod count, the first bottleneck is IP addresses. A /20 subnet holds about 4,000 IPs, and with prefix delegation each node consumes them in /28 chunks, so headroom disappears faster than expected. The fix is planned at the VPC level: larger subnets, secondary CIDR ranges, or custom networking that places pods in a dedicated subnet carved out for growth. The second bottleneck is CoreDNS: two replicas that were fine for a small cluster start throttling under 10x query volume. Scale CoreDNS replicas with cluster size (the cluster-proportional autoscaler does this) and treat NodeLocal DNSCache as mandatory, not optional.

At 100x, ENI limits per instance type become the constraint on pod density, and security-groups-for-pods trunk ENI limits cap how many segmented workloads fit per node. Plan node instance types around ENI capacity, not just CPU and memory. kube-proxy in iptables mode is typically replaced by IPVS or eBPF at this scale. The horizontal strategy: IP space as code (subnets sized for 3x projected pods), DNS scaled proportionally with on-node caching, and CNI configuration (prefix delegation, custom networking) decided before the cluster fills up, because changing it later requires node churn.

## Security Considerations

Least privilege starts with pod identity. Use IRSA (IAM Roles for Service Accounts) so each pod gets its own scoped IAM role instead of inheriting the node's broad instance role. A pod that only reads from one S3 bucket should have exactly that permission. For network segmentation, combine security groups for pods on sensitive workloads with default-deny network policies in every production namespace, then add explicit allow rules.

Encrypt in transit deliberately: traffic inside a VPC is not encrypted by default, so pod-to-pod traffic is plaintext unless you add mTLS via a service mesh. Decide which data needs it (PII, credentials, payment-adjacent traffic) rather than assuming the VPC boundary is enough. Enable IMDSv2 on nodes and require it; IMDSv1 is the classic SSRF path where a compromised pod queries the metadata endpoint and steals the node role credentials.

Realistic attack vectors: a compromised pod with the node security group can reach the RDS instance the node role was allowed to touch; lateral movement across namespaces is trivial without network policies; and overly broad security group rules (0.0.0.0/0 on database ports, still found in real clusters) expose data stores to the internet. Mitigations are unglamorous: IRSA everywhere, default-deny policies, IMDSv2, and private subnets with VPC endpoints for ECR and S3 so image pulls never traverse the public internet.

## Production Checklist

Monitoring signals:

- **IP pressure**: CNI metrics for assigned vs available IPs per node. Alert at 80% utilization; pods stuck Pending with IP exhaustion events mean you are already late.
- **DNS**: CoreDNS request latency (p99) and error rate. Alert if p99 exceeds 100ms or errors spike; both precede application-level timeouts.
- **Conntrack**: nodes track every connection in the conntrack table, and high-churn workloads (many short-lived connections) can fill it. Alert at 80% of table capacity; a full table drops new connections silently, which looks like random network failures.
- **Flow logs**: VPC Flow Logs for the cluster subnets, sampled if volume is high. They are the ground truth when security groups and policies disagree about what should be allowed.

Failure modes seen in production: conntrack exhaustion under connection churn (mitigate with connection reuse and NodeLocal DNSCache, which cuts UDP DNS churn); CoreDNS CPU throttling after a deploy doubles query volume; ENI attachment delays making SGP pods start 30-60 seconds slower, which breaks tight rollout deadlines; stale kube-proxy rules after rapid scaling, sending traffic to dead pod IPs for seconds.

Runbook notes: keep a documented procedure for draining a node under IP pressure (cordon, drain, verify pod IPs are released before uncordoning); know how to move a namespace from default-deny to audit mode when a policy blocks legitimate traffic during an incident; and test CoreDNS scaling under load in staging before traffic doubles in production.

---

*Most EKS networking issues are security group issues. Check those first.*
