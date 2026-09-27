# Schema — Task Sequence

Written by Agent 03 to `docs/task-sequences/{slug}.md`. Read by Agent 04.

```markdown
# Task sequence: {Name}

- slug: {kebab-case-slug}

## Tasks

### task-01: {short title}

- scope_whitelist: [packages/seo-audits/src/types/{...}.ts]
- depends_on: none
- description: {what this task does, concretely}
- commit_message: "type(scope): imperative summary"

### task-02: {short title}

- scope_whitelist: [...]
- depends_on: task-01
- description: ...
- commit_message: "..."

<!-- repeat for every task; keep each one atomic and independently commit-able -->
```

Every task's `scope_whitelist` should stay inside `packages/seo-audits` unless explicitly flagged as
higher-risk (see Agent 03, Step 2) with justification written here.
