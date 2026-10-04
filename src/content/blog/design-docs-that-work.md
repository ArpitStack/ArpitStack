---
title: "Writing Design Docs That Get Approved"
date: "2026-11-23"
tags: ["Architecture", "Documentation", "Engineering Practices"]
description: "Doc structure, tradeoff analysis, alternatives considered, and decision records. How to write technical design documents that actually drive decisions."
readingTime: 13
---

Most design docs fail not because the technical thinking is wrong, but because the document does not do its job. A design doc has one purpose: to drive a decision. If reviewers finish reading and do not know what you are proposing, why, and what the alternatives were, the doc failed regardless of how clever the solution is.

I review design docs regularly as a tech lead. Here is what separates docs that get approved quickly from docs that languish in comment threads for weeks.

## Why Write Design Docs

Before the structure, the rationale. Design docs serve four purposes:

1. **Force clarity.** Writing exposes gaps in thinking that verbal discussions hide. If you cannot explain it clearly, you do not understand it well enough yet.
2. **Enable async review.** Not everyone can attend every meeting. A doc lets stakeholders review on their own time and provide thoughtful feedback.
3. **Create a record.** Six months later, when someone asks "why did we choose this?", the doc has the answer. Without it, you rely on fading memories.
4. **Surface risks early.** The act of writing tradeoffs and alternatives forces you to confront problems before they become implementation surprises.

If your team does not write design docs for significant changes, you are making decisions without a paper trail. That works until it does not.

## The Structure That Works

Here is a template I have refined over years. Adapt it to your team's needs, but do not skip sections.

### 1. Summary (3-5 sentences)

What are you proposing, in plain language? A busy executive should understand the gist from this section alone.

Bad: "This document describes the proposed architecture for the notification subsystem refactoring initiative."

Good: "We propose replacing our polling-based notification system with an event-driven architecture using SNS and SQS. This reduces notification latency from 5 minutes to under 10 seconds and eliminates the database load from polling queries. The migration will take approximately 3 weeks and requires no downtime."

### 2. Background and Problem Statement

What problem are you solving? What is the current state, and why is it insufficient?

Include:
- Current architecture (brief, with diagram if helpful)
- Specific pain points with data ("polling generates 50K queries/hour against the primary database")
- Why now? What triggered this work?

### 3. Goals and Non-Goals

Explicitly state what this design will and will not address.

**Goals:**
- Reduce notification latency to under 10 seconds
- Eliminate polling load on primary database
- Support 10x current notification volume

**Non-goals:**
- Changing the notification content or templates (separate workstream)
- Real-time delivery guarantees (at-least-once is sufficient)
- Mobile push notification infrastructure (out of scope for this phase)

Non-goals prevent scope creep during review. When someone suggests adding a feature, you can point to the non-goals section.

### 4. Proposed Design

This is the core. Describe the architecture with:

- **High-level diagram.** Boxes and arrows showing major components and data flow. Keep it simple enough to understand in 30 seconds.
- **Component descriptions.** What each piece does, in 2-3 sentences each.
- **Data flow.** Walk through the key operations step by step. "When a user triggers a notification: 1) API writes event to SNS, 2) SQS queue buffers, 3) worker processes and sends..."
- **API changes.** If interfaces change, document the new contracts.
- **Data model changes.** Schema changes, migrations, backward compatibility.

### 5. Alternatives Considered

This section is what separates senior-level docs from junior-level docs. You must show that you evaluated other options.

For each alternative:
- Brief description
- Why you rejected it (specific reasons, not hand-waving)
- Under what conditions you would reconsider

Example:

**Alternative: WebSockets for real-time delivery**
We considered persistent WebSocket connections for instant delivery. Rejected because our notification volume does not justify the connection management overhead, and our clients are primarily mobile apps with unreliable connections that would cause frequent reconnects. We would reconsider if we add a real-time collaboration feature requiring sub-second updates.

If you cannot articulate why you did not choose the obvious alternative, reviewers will assume you did not consider it.

### 6. Tradeoffs

Be honest about what you are giving up. Every design has costs.

- **Complexity vs. simplicity.** What did you choose and why?
- **Consistency vs. availability.** Where do you land on the spectrum?
- **Build vs. buy.** Why build custom instead of using a managed service (or vice versa)?
- **Short-term vs. long-term.** Are you incurring technical debt deliberately? If so, document the payback plan.

### 7. Risks and Mitigations

What could go wrong? For each risk:
- Likelihood (high/medium/low)
- Impact (high/medium/low)
- Mitigation strategy
- Rollback plan

### 8. Rollout Plan

How do you get from here to there safely?
- Phases with clear milestones
- Feature flags or gradual rollout strategy
- Monitoring and alerting for each phase
- Rollback criteria ("if error rate exceeds X%, we roll back")

### 9. Open Questions

What is still undecided? List them explicitly. This invites targeted feedback instead of vague "looks good" comments.

## Common Mistakes

**Writing the doc after building.** The doc should drive the decision, not document it retroactively. If you already built it, be honest that this is a retrospective, not a proposal.

**Too much detail too early.** Start with the high-level design. Dive into implementation details only for the riskiest or most complex parts. A 20-page doc that nobody reads is worse than a 5-page doc that drives a decision.

**No diagrams.** Text-only architecture descriptions are hard to follow. Even a simple ASCII diagram helps enormously.

**Ignoring the audience.** If your reviewers include non-engineers (product, leadership), the summary and problem statement must be accessible. Technical depth belongs in the design section, not the opening.

**No decision requested.** End with a clear ask: "Please approve this approach" or "Decision needed on: database choice (Option A vs B)." If reviewers do not know what you need from them, they will not provide it.

## The Review Process

A doc is not done when you finish writing. It is done when it is approved.

**Choose reviewers deliberately.** Include:
- Engineers who will implement it (they spot practical issues)
- Engineers from adjacent teams (they spot integration issues)
- At least one skeptic (they ask the hard questions)

**Set a deadline.** "Please review by Friday" creates urgency. Without a deadline, docs sit unread.

**Resolve comments visibly.** When someone raises a concern, address it in the doc (not just in a reply). Future readers need to see the resolution.

**Know when to stop iterating.** Perfect is the enemy of approved. If the core approach is sound and risks are documented, ship it. You can refine during implementation.

## The Doc Lifecycle

A design doc is not a static artifact. It moves through stages, and each stage has a clear exit condition. Here is the lifecycle:

```
+----------+     +----------+     +----------+
|  Draft   |---->|  Review  |---->| Decision |
+----------+     +----------+     +----------+
     ^           |                |
     |           v                v
     |           +----------+     +----------+
     +-----------|  Revise  |     |  Build   |
                 +----------+     +----------+
                                       |
                                       v
                                  +----------+
                                  |  Record  |
                                  |   ADR    |
                                  +----------+
```

**Draft:** the author writes the proposal using the template. Exit condition: the summary, design, alternatives, and open questions are all filled in. A draft with empty alternatives is not ready for review.

**Review:** stakeholders read and comment async. Exit condition: all blocking comments resolved, or a deadline passes with explicit sign-off from required reviewers. Do not let review run open-ended; a doc in review for three weeks is a decision being avoided.

**Revise:** the author addresses feedback in the document itself, not just in comment replies. Loops back to review until approved or rejected. Cap the loops: if a doc goes through more than three review rounds, the problem is usually scope, not wording. Split it or decide.

**Decision:** an explicit outcome. Approved, approved with conditions, or rejected with reasons. "Looks good" in a comment thread is not a decision. Record who decided and when.

**Build:** implementation follows the approved design. If implementation diverges from the doc (it will, in small ways), note the divergence in the doc. A doc that no longer matches reality is worse than no doc.

**Record:** extract lasting decisions into ADRs. The full doc stays for context; the ADR is the permanent, searchable record of what was decided and why.

Most teams I have seen do draft and build, skip the explicit decision, and never record. That is why nobody can answer "why did we choose this" six months later. The lifecycle only works if every stage actually happens.

## Decision Records

For significant decisions, extract the key choice into an Architecture Decision Record (ADR). ADRs are short (one page) and permanent:

```markdown
# ADR-014: Use SQS for Notification Queueing

## Status
Accepted

## Context
We need a durable buffer between event generation and notification delivery
to handle traffic spikes and worker failures.

## Decision
Use Amazon SQS with a 14-day retention period and dead-letter queue
for failed deliveries.

## Consequences
- Positive: Managed service, no operational overhead, built-in retry
- Negative: Additional AWS cost (~$200/month at current volume),
  eventual consistency on message ordering

## Alternatives Considered
- Kafka: rejected due to operational overhead for our scale
- Database polling: rejected, this is the problem we are solving
```

ADRs create an institutional memory of why decisions were made. When someone questions a choice two years later, the ADR has the answer.

## Scaling This to Your Org

The doc process that works for 10 engineers breaks at 50 and collapses at 200. Here is how it changes.

**At 10 engineers:** keep it lightweight. One template, docs in the repo or a shared wiki, review by whoever is affected. The author picks reviewers. Decisions happen in a thread or a quick huddle. At this size the process is mostly discipline, and that is enough.

**At 50 engineers:** informal stops working. Docs get lost across tools, nobody knows which version is current, and review latency grows because the right reviewers are never obvious. What you need:

- A single home for docs, searchable, with clear ownership per doc.
- Review SLAs: reviewers get three business days, then the author escalates or proceeds with noted dissent.
- Templates per doc type (new service, migration, deprecation, cross-team API change), not one generic template.
- A decision log: every approved doc gets a one-line entry with the decision, date, and link. This becomes the index people actually use.
- Doc champions: one or two engineers per team who nudge authors and keep the bar consistent.

What breaks at this stage: rubber-stamping (approvals without reading), stale docs nobody updates, and review threads that become design-by-committee. Counter with required reviewer roles (at least one implementer, one adjacent-team engineer, one skeptic) and a norm that unresolved blocking comments block the decision, not the build.

**At 200 engineers:** you need a tiered process. Not every change deserves a full RFC.

- Tier 1 (team-local change): short doc, team review, no cross-team process.
- Tier 2 (cross-team impact): full RFC with numbered proposal, review period, explicit decision.
- Tier 3 (architecture-level): review by an architecture group or staff engineers, with a recorded decision and ADR.

What breaks: decision paralysis (too many reviewers, nobody empowered to decide), docs as theater (written after the build to satisfy process), and fragmented knowledge across teams that do not read each other's docs. Counter with named decision-makers per tier, quarterly audits that archive or refresh stale docs, and making docs part of onboarding so new engineers learn where decisions live.

The principle at every size: the process should be the lightest thing that still produces a recorded decision. Heavier process does not produce better decisions. It produces fewer docs.

## Security Considerations

Design docs describe your systems in detail. That makes them sensitive documents. Treat them that way.

**What lives in a design doc:** architecture diagrams, trust boundaries, authentication flows, data stores and what PII they hold, third-party integrations, known weaknesses and planned mitigations, rollout plans with exact timelines. In the wrong hands, this is a map of where to attack. A doc that says "our auth service does not yet rate-limit login attempts, fix planned soon" is useful for reviewers and valuable for an attacker.

**Access control:** default to all-engineering read access for standard docs, because broad review makes better designs. Restrict the sensitive ones: docs covering authentication, cryptography, payment flows, or infrastructure security should be visible to the teams involved plus security, not the whole company. If your docs tool supports per-page permissions, use them. If it does not, keep sensitive docs in a separate space.

**No secrets in docs.** Never put credentials, API keys, real customer data, or production connection strings in a design doc. Use placeholders and reference the secrets manager. Docs get copied, exported to PDF, screenshared in all-hands meetings, and forwarded to partners. Assume anything in a doc will eventually be seen outside the intended audience.

**Threat model sections:** if the doc includes a threat model or a list of known vulnerabilities, mark the doc accordingly and keep its distribution tight. A threat model is an explicit list of how your system can be broken. It is one of the most valuable documents an attacker can find.

**Partner and public versions:** when a design involves external partners, write a separate redacted version. Do not share the internal doc and hope nobody reads the sensitive sections.

**Retention:** docs in version control keep full history, which is usually what you want. But when a doc contains details of a vulnerability that has since been fixed, consider whether the history needs pruning or the doc needs an access change. Old docs do not get less sensitive with age; they get forgotten, which is worse.

## Actionable Takeaways

Apply this week:

- [ ] Pick one upcoming change and write a one-page doc using the template above. Not a big project. A small one, to practice the muscle.
- [ ] Fill in the summary first, in plain language. If you cannot explain it in five sentences, you are not ready to write the rest.
- [ ] Write down two alternatives you considered and rejected, with specific reasons. If you cannot name two, you have not thought hard enough.
- [ ] Name three reviewers before you share the doc, including one skeptic. Set a review deadline.
- [ ] End the doc with an explicit ask: what decision do you need, from whom, by when.
- [ ] Extract one past decision into an ADR. Pick a decision someone asked about recently. One page.
- [ ] Find one old doc for a system you own and check whether it still matches reality. Update it or mark it superseded.

Do these seven and your team's decision quality improves within a month. The template matters less than the habit.

## The Bottom Line

A good design doc is not about showing how smart you are. It is about making it easy for others to understand the problem, evaluate your solution, and make a confident decision. Clarity beats cleverness. Tradeoffs beat assertions. And a doc that gets approved in three days is infinitely more valuable than a perfect doc that takes three weeks.
