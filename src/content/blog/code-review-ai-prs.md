---
title: "Reviewing AI-Generated Code: A Checklist for Real Bugs"
date: "2026-11-09"
tags: ["AI", "Code Review", "Engineering Practices"]
description: "What AI gets wrong: edge cases, error paths, hidden assumptions. A practical review checklist for AI-assisted pull requests."
readingTime: 13
---

AI coding assistants are now part of daily engineering work. I use Claude regularly, and it accelerates implementation significantly. But AI-generated code has characteristic failure modes that differ from human-written bugs. If you review AI pull requests the same way you review human ones, you will miss things.

This post is a practical checklist based on what I have actually seen go wrong, and how to catch it in review.

## What AI Gets Right

First, credit where due. AI assistants are genuinely good at:

- **Boilerplate and scaffolding.** API handlers, data models, test setups. The repetitive stuff.
- **Common patterns.** CRUD operations, standard library usage, well-documented frameworks.
- **Refactoring.** Renaming, extracting functions, converting between patterns.
- **Documentation.** Docstrings, comments, README updates.

The output looks clean. It follows conventions. It passes linting. This is precisely what makes the failures dangerous: the code looks right.

## What AI Gets Wrong

### 1. Edge Cases

AI generates code for the happy path and common cases. Edge cases are systematically underrepresented.

**What to check:**
- Empty inputs (empty lists, empty strings, null values)
- Boundary values (zero, negative numbers, maximum integers)
- Concurrent access (what happens when two requests hit this simultaneously?)
- Resource exhaustion (what if the list has 10 million items instead of 10?)

**Example pattern I have seen:**
```python
# AI-generated: looks fine
def get_user_orders(user_id):
    user = db.get_user(user_id)
    return user.orders  # What if user is None?
```

The fix is trivial, but the AI did not consider that `user_id` might not exist. A human writing this from scratch would likely think about it because they are imagining the calling context. The AI is pattern-matching on similar functions it has seen.

### 2. Error Paths

AI-generated code often has minimal error handling. The happy path works; the failure modes are unhandled or handled generically.

**What to check:**
- Are specific exceptions caught, or is there a blanket `except Exception`?
- What happens when a downstream service times out?
- Are errors logged with enough context to debug?
- Does the function clean up resources (connections, files, locks) on failure?
- Are retry policies appropriate, or will this hammer a failing dependency?

**Red flag pattern:**
```python
# AI-generated: swallows everything
try:
    result = external_api.call(data)
    return process(result)
except Exception as e:
    logger.error(f"Error: {e}")
    return None  # Caller has no idea what went wrong
```

Returning `None` on any error pushes the failure upstream silently. The caller now has to handle `None` without knowing why. This creates debugging nightmares.

### 3. Hidden Assumptions

AI code bakes in assumptions that are not stated and may not hold.

**Common hidden assumptions:**
- **Data shape.** "The API always returns a list" (until it returns an error object)
- **Ordering.** "Items arrive in chronological order" (until they do not)
- **Uniqueness.** "IDs are unique" (until a migration creates duplicates)
- **Timezone.** "Timestamps are UTC" (until a client sends local time)
- **Encoding.** "Strings are UTF-8" (until they are not)

**What to check:** For every external input (API response, database row, file, user input), ask: "What is this code assuming about the shape and content? What happens when the assumption is violated?"

### 4. Abstractions

AI tends to create abstractions based on surface patterns rather than domain understanding.

**Symptoms:**
- Generic names (`process_data`, `handle_item`, `Manager`, `Helper`)
- Abstractions that do not match the domain model
- Premature generalization (a "flexible" system for requirements that do not exist)
- Leaky abstractions (implementation details bleeding through the interface)

**What to check:** Does the abstraction reflect how the domain actually works, or does it reflect how similar code is usually structured? Ask the author (human or AI-assisted) to explain the abstraction in domain terms. If they cannot, the abstraction is wrong.

### 5. Security

AI-generated code frequently has security gaps because security requires thinking about adversarial inputs, which is not the default mode.

**Checklist:**
- **Input validation.** Are all external inputs validated? What happens with malicious input?
- **Injection.** SQL, command, XSS, template injection. Is user input ever interpolated into queries or commands?
- **Authentication/authorization.** Are permission checks present on every path, or just the obvious ones?
- **Secrets.** Are credentials hardcoded? Logged? Exposed in error messages?
- **Rate limiting.** Can this endpoint be abused for DoS or cost attacks?

```python
# AI-generated: SQL injection vulnerability
def search_users(name):
    query = f"SELECT * FROM users WHERE name = '{name}'"
    return db.execute(query)  # Never do this

# Correct: parameterized
def search_users(name):
    query = "SELECT * FROM users WHERE name = %s"
    return db.execute(query, (name,))
```

This is basic, but I have seen AI generate the vulnerable version when the prompt did not explicitly mention security.

### 6. Performance

AI does not think about scale unless prompted. Code that works for 100 records may collapse at 10 million.

**What to check:**
- **N+1 queries.** Is there a database query inside a loop?
- **Memory.** Does this load the entire dataset into memory?
- **Algorithmic complexity.** Is that nested loop O(n²) on data that will grow?
- **Unnecessary work.** Is it fetching columns it does not use? Making API calls it does not need?

## The Review Checklist

Here is the checklist I use for AI-assisted pull requests:

**Correctness:**
- [ ] Edge cases handled (empty, null, boundary, concurrent)
- [ ] Error paths have specific handling, not blanket catches
- [ ] Resources cleaned up on all paths (success and failure)
- [ ] No hidden assumptions about data shape, ordering, or encoding

**Security:**
- [ ] All external inputs validated
- [ ] No injection vulnerabilities (SQL, command, XSS)
- [ ] Auth checks on every path, not just the main flow
- [ ] No secrets in code, logs, or error messages

**Performance:**
- [ ] No N+1 queries
- [ ] Memory usage bounded for large inputs
- [ ] No O(n²) on growing datasets

**Design:**
- [ ] Abstractions match the domain, not just patterns
- [ ] Names are specific and meaningful
- [ ] No premature generalization

**Testing:**
- [ ] Tests cover edge cases, not just happy path
- [ ] Error paths are tested
- [ ] If AI wrote the tests too, verify the tests actually assert meaningful behavior (AI-generated tests sometimes assert trivially true conditions)

## The Review Pipeline

Think of AI-assisted review as a pipeline with stages, where each stage catches different failure classes. Skipping a stage does not save time; it moves the bug to a more expensive stage.

```
+----------------+     +-----------------+     +------------------+
|  Author        |---->|  Automated      |---->|  Human review    |
|  human plus AI |     |  checks         |     |  the checklist   |
+----------------+     +-----------------+     +------------------+
                                |                       |
                                v                       v
                        +--------------+     +------------------+
                        |  lint tests    |     | Merge only if    |
                        |  type checks   |     | the human author |
                        | secrets scan |     | can explain      |
                        +--------------+     | every line       |
                                               +------------------+
```

**Stage 1, the author:** the human working with the AI is the first reviewer. Before opening the PR, they read the full diff, run the tests, and check the AI's work against the actual requirements. Most AI bugs should die here. If the author cannot explain a line, that line does not go into the PR.

**Stage 2, automated checks:** linting, type checking, unit tests, and secret scanning run on every PR. These catch the mechanical issues so human reviewers spend their attention on judgment calls. Add AI-specific gates here: a check that flags PRs with a high ratio of AI-generated lines for deeper review, and secret scanning tuned for the patterns AI tools tend to emit (hardcoded keys in examples, tokens in test fixtures).

**Stage 3, human review:** the checklist from the previous section, applied with attention proportional to risk. A typo fix in a README gets a skim. A new authentication path gets the full checklist plus a second reviewer.

The gate between the stages matters more than the stages. The rule is simple: nothing merges that the human author cannot explain. That single rule, enforced consistently, prevents most cognitive debt.

## Cognitive Debt

There is a broader concern here that the industry is starting to name: cognitive debt. When engineers accept AI-generated code without fully understanding it, the team accumulates code that nobody deeply comprehends.

This is different from traditional technical debt. Technical debt is a conscious tradeoff: "we are shipping fast now and will refactor later." Cognitive debt is unconscious: "the AI wrote it, it passed tests, I did not fully trace through the logic."

**How to prevent it:**
- Require the human author to explain the AI-generated code in review. If they cannot explain it, it should not merge.
- Mandatory deep-dive reviews for AI-assisted PRs above a certain complexity threshold.
- Track what percentage of merged code the author can actually explain. If it drops, slow down.

I use repo-specific SKILLS.md files with Claude to improve output quality, and I never accept generated code without a thorough review. The AI is a powerful accelerator, but the human remains responsible for every line that ships.

## Scaling This to Your Org

**At 10 engineers:** the checklist lives in the PR template and everyone reviews everything. You know each other's code. AI usage is visible because the team is small. What works: a shared norm that AI-assisted PRs get the same scrutiny as any other, and authors who explain their diffs in the PR description.

**At 50 engineers:** you cannot have everyone review everything. Introduce CODEOWNERS so the right people are tagged automatically. Label PRs by risk: low-risk (docs, tests, refactors with full coverage) gets one reviewer; high-risk (auth, payments, data migrations, public APIs) gets two, one of whom must be senior. Flag PRs where most lines are AI-generated so reviewers know to apply the checklist strictly. What breaks: review latency (PRs sitting for days), rubber-stamping by overloaded reviewers, and inconsistent standards across teams. Counter with review SLAs (first review within one business day), and track them.

**At 200 engineers:** review becomes a system, not a habit.

- Risk-based tiers are mandatory, with clear definitions and examples. Ambiguity in tiering means everything gets classified low-risk.
- AI-assisted pre-review: run an AI reviewer as a first pass that comments on the obvious issues (missing error handling, N+1 patterns), and require human reviewers to address or dismiss each comment. The AI reviewer is a tireless junior, not a decision-maker.
- Audit sampling: each quarter, sample merged PRs per team and check them against the checklist. Publish the results internally. What gets measured gets reviewed.
- Reviewer training: new engineers shadow reviews before they approve. Approving a PR is a responsibility; treat it like one.
- Metrics that matter: review turnaround time, defect escape rate (bugs found in production that review should have caught), and the percentage of AI-assisted PRs where the author could explain the diff when asked.

What breaks at this size: process theater (checklists ticked without reading), reviewer burnout from volume, and teams optimizing for review speed over review quality. The fix is the same at every size: make the cost of a bad review visible. When a production incident traces back to a rubber-stamped PR, do a blameless review of the review, not just the code.

## Security Considerations: AI Tooling Risks

The security checklist earlier in this post covers bugs in generated code. This section covers risks from the tooling itself: the AI assistants, plugins, and agents that now sit inside the development workflow.

**Prompt injection through code and content.** AI coding tools read far more than the file you are editing. They read imported dependencies, README files, issue descriptions, and pasted snippets. Any of that content can carry instructions aimed at the AI rather than at you. A compromised dependency could include a comment telling the agent to ignore its instructions and exfiltrate environment variables, and an agent with shell access might comply. Treat all third-party content the AI ingests as untrusted input. Review AI-suggested changes that touch network calls, subprocess execution, or credential handling with extra suspicion, and be cautious about granting agents broad tool permissions.

**Secrets leaking into AI tools.** When you paste code into an AI assistant, that code leaves your machine. API keys in config files, tokens in test fixtures, customer data in debug logs, proprietary algorithms: all of it can end up in a vendor's systems. The mitigations are straightforward but require discipline:

- Use enterprise tiers with explicit zero data retention for training. Read the actual terms; "we may use data to improve our models" is not zero retention.
- Keep secrets out of the working tree in the first place. If a key is not in the repo, it cannot be pasted into a prompt.
- Run secret scanning in pre-commit hooks so leaked secrets are caught before they reach either the repo or the AI tool.
- Set a team policy on what can go to external AI: customer code, unreleased proprietary work, and anything under NDA stays local or goes only to approved self-hosted models.

**AI-suggested dependencies.** Assistants happily suggest packages. A suggested package can be typosquatted, abandoned, or malicious. Every AI-suggested dependency gets the same vetting as a human-suggested one: check the maintainer, the download counts, the recent commit history, and the permission scope. Installing a package on an AI's recommendation without checking is how supply-chain incidents start.

**Audit what the tools touch.** If your AI tools have repo-wide read access and shell execution, log what they access. When a prompt injection attempt succeeds somewhere in the industry, you want to know whether your tools were exposed and what they did.

## Actionable Takeaways

This week:

- [ ] Add the correctness and security checklist items to your PR template, or pin the checklist where your team reviews.
- [ ] On your next AI-assisted PR, read the full diff before requesting review. Time yourself. If you cannot explain a hunk, rewrite or remove it.
- [ ] Turn on secret scanning in pre-commit hooks if it is not already on.
- [ ] Check your AI tool's data retention settings. Confirm zero retention for training, or switch tiers.
- [ ] Review one recently merged AI-assisted PR against the checklist retroactively. Note what the review missed. Share the findings with the team.
- [ ] Agree on a team norm: PRs above a certain size or risk level require the author to walk through the AI-generated portions in review.
- [ ] Vet one AI-suggested dependency properly (maintainer, history, scope) and document what you checked, as an example for the team.

None of these slow development down. They move bug-catching earlier, where it is cheap.

## The Bottom Line

AI-generated code is not worse than human code. It is differently wrong. Human bugs come from misunderstanding requirements or rushing. AI bugs come from pattern-matching without understanding context.

Review accordingly. Check edge cases harder. Verify error handling exists. Question assumptions explicitly. And never merge code that the human author cannot explain.

The goal is not to slow down AI-assisted development. It is to make sure the speed does not come at the cost of correctness.
