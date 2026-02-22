# Documentation

This directory is the **system of record** for pi-harness-engineering.

## Structure

```
docs/
├── ARCHITECTURE.md   # System architecture, Phoenix philosophy, invariants
├── exec-plans/       # Execution plans for complex work
│   ├── TEMPLATE.md   # Template for new plans
│   ├── active/       # Currently in-progress plans
│   └── completed/    # Finished plans (kept for reference)
├── product-specs/    # Feature specifications
├── solutions/        # Captured learnings (searchable, YAML frontmatter)
└── references/       # External docs, LLM-friendly formats
```

## Guidelines

### For Agents

1. **Check here first** before starting complex work
2. **Create an exec-plan** for multi-step tasks
3. **Update ARCHITECTURE.md** when making structural changes
4. **Log progress** in exec-plans so work can be resumed
5. **Compound learnings** in `solutions/` when debugging reveals insight

### For Humans

1. **Product specs** should be created here before implementation
2. **Design decisions** should be documented in ARCHITECTURE.md
3. **Don't delete completed plans** — they're valuable context

## What Doesn't Belong Here

- Auto-generated API documentation
- Component docs (use JSDoc/TSDoc in source)
- Temporary notes (use exec-plan progress logs instead)
