# Upstream sync check

Read by Agent 01, Step 0, before designing any new audit/gatherer. This is the check that catches
API drift: this fork depends on upstream Lighthouse/LHCI packages as libraries, and upstream can
change their shape in a release you haven't pulled yet, or one you have pulled but haven't re-verified
your design against.

This is a design-time check, not a merge-conflict check — Option B (a separate `packages/seo-audits`
package) already keeps merges clean; this catches drift in the *interfaces* you depend on, which a
clean merge won't warn you about.

## What to check

1. **Installed version** — read `node_modules/lighthouse/package.json` and
   `node_modules/@lhci/utils/package.json` (or the workspace equivalents) for the actual installed
   versions, not what's assumed from memory or an older spec.
2. **Extension API** — grep the installed `lighthouse` package for the audit/gatherer base classes
   (`Audit`, `Gatherer`/`FRGatherer`) you're about to extend. Confirm the constructor signature and
   required static properties (`meta.id`, `meta.supportedModes`, etc.) match what you're about to
   design against.
3. **LHR shape** — if the feature's audit output will be read by `packages/server` or
   `packages/viewer` (i.e., anything beyond a purely additive audit), confirm the LHR schema
   (`lhr.audits`, `lhr.categories`) hasn't changed shape since the last time `seo-audits` was updated.
4. **Changelog scan** — if `git log` shows an upstream pull since the last audit was added, skim
   upstream's own changelog/release notes for that range for any "breaking" or "audit API" mentions.

## If drift is found

Don't silently design around it. Report to the developer exactly what changed and what in the
existing `packages/seo-audits` code (if anything) is now stale, before producing the audit spec.
