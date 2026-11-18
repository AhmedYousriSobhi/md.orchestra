# Architecture Decision Records

An Architecture Decision Record (ADR) records one significant decision: why it was
needed, which options were weighed, what was chosen, and what that costs. ADRs
complement, not replace, the other docs:

- [SPEC.md](../../SPEC.md) says **what** the product must do.
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) says **how** it is built today.
- An ADR says **why** a structural choice was made, or is being proposed.

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [0001](0001-vscode-extension.md) | Deliver MD.Orchestra as a VS Code extension | Proposed | 2026-11-18 |

## How to add one

1. Copy the template below into `docs/adr/NNNN-short-kebab-title.md`, using the next
   free number. Numbers are never reused.
2. Open it with **Status: Proposed**. Following CLAUDE.md, the change that
   implements a decision still needs its own GitHub issue and the owner's approval.
   An ADR is the reasoning behind that issue, not a substitute for it.
3. When the owner decides, set the status to **Accepted**, **Rejected** or
   **Deferred** and add the date. Don't rewrite an accepted ADR's reasoning
   afterwards. If the decision changes later, write a new ADR and mark the old one
   **Superseded by NNNN**.
4. If the decision changes SPEC.md or CLAUDE.md, list the exact changes in the
   ADR's Consequences section. Apply them in the same change that implements the
   decision, not before.
5. Add a row to the index above.

## Template

```markdown
# NNNN. Title

- **Status:** Proposed | Accepted | Rejected | Deferred | Superseded by NNNN
- **Date:** YYYY-MM-DD
- **Deciders:** (who signs off)
- **Related:** issues, PRs, docs

## Context
What forces are at play: the product, technical and organisational facts that make
this decision necessary now.

## Decision drivers
The criteria the options are judged against, in priority order.

## Options considered
### Option A: ...
Pros / Cons.

## Decision
The chosen option, or the recommendation if still Proposed, and why it wins on the
drivers.

## Consequences
What becomes easier, what becomes harder, and the doc/spec changes this implies.

## Risks
What could make this the wrong call, and how we'd notice.

## Open questions
What the decider still has to answer.
```
