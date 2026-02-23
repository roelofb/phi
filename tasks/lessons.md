# Lessons

## 1. Code changes require durable artefacts — always

**Date:** 2026-02-23
**Trigger:** User had to ask "is there a spec or learning for this?" after implementation was already done.

**The rule:** Every non-trivial code change MUST be accompanied by its durable artefacts *as part of the same unit of work*, not as an afterthought. This is not optional — it's the core Phoenix Architecture invariant.

Before marking any implementation complete, check:

- [ ] **Spec updated?** Does `docs/product-specs/` reflect the new behaviour?
- [ ] **Solution captured?** If this fixes a problem or adds a pattern, does `docs/solutions/` have a searchable entry?
- [ ] **Tests cover it?** Not just "tests pass" but "tests encode the new understanding"
- [ ] **Contracts changed?** If types changed, are they reflected in `contracts/`?

**Why this matters:** "If knowledge only exists in the implementation, it's not knowledge — it's risk." (ARCHITECTURE.md). The whole point of Phoenix is that `src/` is regenerable from specs + tests + contracts. Code without a spec is a debt that compounds silently.

**The fix:** Treat spec/solution updates as part of the implementation, not a separate step. Write them *before* announcing completion.
