# Schema — QA Spec

Written by Agent 06 to `docs/qa/{slug}.md`.

```markdown
# QA checklist: {Name}

- slug: {kebab-case-slug}
- merged: {PR link / commit sha}

## Functional

- [ ] Documented pass case verified against a real page
- [ ] Documented fail case verified against a real page

## Edge cases

- [ ] Missing/absent expected data (audit degrades gracefully, doesn't throw)
- [ ] Malformed markup
- [ ] {any edge case from the feature spec}

## Integration

- [ ] Score composes correctly into its category total
- [ ] Renders correctly in packages/viewer
- [ ] `.lighthouserc.js` new config keys are correctly picked up
- [ ] `lhci assert` enforces the new assertion preset severities correctly

## Regression

- [ ] `npm run start:seed-database` seed data unaffected (no unexpected score changes elsewhere)
```
