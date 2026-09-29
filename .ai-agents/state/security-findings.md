# Security findings

## 2026-09-29 — structured-data-type-conflicts

- severity: low
- finding: `structured-data-type-conflicts.js`'s `audit()` originally built `typeCounts` and
  `blocksByType` as plain `{}` object literals keyed directly by the page's own JSON-LD `@type`
  value — fully page/attacker-controlled. A block declaring `"@type": "__proto__"` against a plain
  object literal triggers the inherited `__proto__` accessor, silently reassigning that specific
  object's own prototype instead of creating a normal data property. Confirmed via direct Node
  test: does **not** pollute the global `Object.prototype` (other objects/audits are unaffected —
  the effect is contained to that one local object), but it is undefined-ish, unintended behavior a
  page shouldn't be able to trigger at all.
- status: **resolved**, fixed in the same sitting rather than deferred to backlog (cheap fix, real
  code I'd just written) — both objects now use `Object.create(null)`, which has no `__proto__`
  setter, so every `@type` string behaves as an ordinary data key. Verified live: a page with
  `"@type": "__proto__"` now audits cleanly (score 1, no findings — the type simply isn't tracked,
  same as any other unrecognized type). Added a regression test
  (`structured-data-type-conflicts.test.js`) asserting this specific case, not just reasoning about
  it.
- other checklist items reviewed, no findings:
  - SSRF / network fetch: not applicable — no network code anywhere in the diff (confirmed via
    grep for `fetch|http\.|https\.|child_process|exec\(|eval\(` across the new audit, engine, and
    registry addition — zero matches).
  - New dependency: **none** — `package.json` untouched.
  - `registry.js`'s modification (adding `resolveTypeConflictsRuleset()`) is additive-only, reviewed
    against the three already-shipped `resolve*Ruleset` functions — no shared-code risk introduced.
  - Report data exposure (worth noting, not fixing): `conflicting-entity` findings embed the full,
    unbounded field *values* that differ (e.g. both prices in a price conflict) into the report
    message — broader than `structured-data-json-ld`'s existing 80-char-capped snippet. Assessed as
    low risk under the same "JSON-LD is public, crawler-facing markup the site owner already
    published" reasoning accepted for that snippet, but unlike the snippet this has no length cap —
    a pathological page with a very large field value could produce an unusually large report
    entry. Not fixed now (truncating could remove the exact information a developer needs to
    resolve the conflict), but worth a length cap if this proves to matter in practice — recorded
    for a future revision, not blocking.

## 2026-09-29 — structured-data-rich-result-eligibility

**No findings.** Reviewed against `.ai-agents/prompts/security-checklist.md`. This feature's entire
diff (`14fb4b0..62d659c`) is a new audit file, its fixture test, a config-registration change, and
README/state docs — confirmed via `git diff --name-only`, zero matches for
`fetch|http\.|https\.|child_process|exec\(|eval\(` in the new audit source.

- SSRF / network fetch: not applicable — no network access, no file I/O beyond what
  `resolveEligibilityRuleset()` already does (reviewed and accepted in the `structured-data-rule-engine`
  review). This feature adds no new file-reading logic of its own.
- New dependency: **none** — `packages/seo-audits/package.json` has no diff in this feature.
- Report data exposure: the `type` column can now contain **any** `@type` string found on the page,
  including untracked ones — this is a deliberate behavioral difference from
  `structured-data-schema-properties` (which only echoes a fixed allowlist of 12 known type names)
  and is worth flagging explicitly rather than waving through by precedent. Assessed as low risk:
  `@type` values are, by definition, values a site owner already chose to publish in public,
  crawler-facing JSON-LD markup — the same category of already-public data
  `structured-data-json-ld`'s snippet field was reviewed and accepted for. An arbitrary string here
  is bounded (comes from a JSON string value, rendered as a plain-text table cell, not interpreted
  as markup/HTML) and Lighthouse's own report renderer already treats table `text` cells as
  plain text, not raw HTML — no new XSS/injection surface introduced by widening from 12 fixed
  values to arbitrary page-supplied strings.
- Prototype pollution / DoS: grouping uses a plain `Map` keyed by the `@type` string (not a plain
  object), so a page supplying `@type: "__proto__"` cannot pollute `Object.prototype` — confirmed by
  reading the implementation, not assumed. Unbounded-growth risk (an attacker page with many
  thousands of distinct `@type` strings inflating the report table) is the same bound every other
  audit consuming this gatherer's artifact already accepts (bounded by whatever
  `StructuredDataJsonLd` collects, no new gatherer here).

## 2026-09-28 — structured-data-remaining-types

**No findings.** Reviewed against `.ai-agents/prompts/security-checklist.md`. This feature's entire
diff (`f97606c..00e6f71`) is 9 files: two JSON ruleset files, two `current.json` version pointers, a
README, and three test files — confirmed via `git diff --name-only`, zero matches for
`fetch|http\.|https\.|child_process|exec|eval\(` across the changed non-test files.

- SSRF / network fetch: not applicable — no code changes at all (audit, engines, gatherer, registry
  all untouched by this feature). The same "registry.js only reads local files, never attacker
  input" reasoning from `structured-data-rule-engine`'s review still holds; this feature adds rows to
  those already-reviewed files, not new file-reading logic.
- New dependency: **none** — `packages/seo-audits/package.json` has no diff in this feature. The
  `ajv` dependency reviewed for the prior feature is unchanged and still only validates this fork's
  own checked-in files.
- Prototype pollution: unchanged from the prior review — no merge/assign operation was introduced;
  this feature is pure data.
- Report data exposure: the 10 new types extend the same fixed-allowlist mechanism already reviewed
  — `googleRuleset.types[schemaType]` must match one of the 12 tracked types before any row is
  generated, so an attacker-controlled `@type` value still can't get echoed into the report
  unless it happens to be one of the 12 known type names, same guarantee as before. Property/message
  text for the 10 new types is this fork's own authored ruleset content (Google's published
  guidelines as documented in `docs/audit-specs/structured-data-remaining-types.md`), not derived
  from page content.
- Restricted-eligibility data (`FAQPage`/`HowTo` → `supported: false`) is informational text only,
  no new surface — reviewed as a correctness/accuracy decision at design time
  (`docs/audit-specs/structured-data-remaining-types.md`), not a security concern.

## 2026-09-28 — structured-data-rule-engine

**No findings.** Reviewed against `.ai-agents/prompts/security-checklist.md`:

- SSRF / network fetch: not applicable — no network access anywhere in the new code (`registry.js`
  only reads local files under `packages/seo-audits/rules/`; confirmed via direct grep for
  fetch/http/exec/eval/child_process — zero matches).
- File paths passed to `registry.js` (`rulesDir`, `schemaPath`) are always hardcoded by the calling
  audit, never derived from page content or any attacker-influenced input — no path-traversal
  surface.
- `ajv` (new dependency, task-01) only validates this fork's own checked-in `rules/*.json` files
  against this fork's own checked-in schemas — never validates or compiles a schema derived from
  page content. Not exposed to attacker input.
- Prototype pollution: `google-requirements-engine.js`/`schema-org-engine.js` only read properties
  off the page-content-derived parsed object (`property in parsedBlock`) — no merge/assign operation
  that could combine an attacker-supplied `__proto__` key with a shared object. Plain `JSON.parse`
  does not itself cause prototype pollution (that risk applies to merge/copy operations, not simple
  property reads).
- Report data exposure: the new audit's `type` column only ever contains `Product`/`Article` (an
  exact match against the fixed tracked-type list is required before a row is generated at all —
  untracked `@type` values are skipped entirely, never echoed into the report). `property`/`message`
  values come from this fork's own ruleset data, not page content. No new echo-page-content-into-report
  surface beyond what was already reviewed and accepted for `structured-data-json-ld`'s snippet field.

## 2026-09-27 — structured-data-validation

- severity: low
- finding: the audit's report table includes an 80-char `snippet` of each
  `<script type="application/ld+json">` block's raw text content
  (`packages/seo-audits/src/audits/structured-data-json-ld.js`'s `snippetOf`). If a page embeds
  something sensitive-looking in a JSON-LD block (e.g. a staging page accidentally including a
  key-shaped string), it would surface in the LHR report, which `packages/server` may store.
- status: resolved — not a regression. Precedent confirmed: Lighthouse's own core `hreflang` audit
  (`node_modules/lighthouse/core/audits/seo/hreflang.js:104`) already echoes raw page markup
  (`<link>` snippets) into report details. JSON-LD blocks are, by design, content site owners
  deliberately embed in publicly-served HTML for search engines to read — not private data, and
  consistent with this repo's existing audit-report conventions. No action needed; recorded for
  completeness per the security-checklist's data-exposure criterion, not because it's a new risk.

**No other findings.** Reviewed against `.ai-agents/prompts/security-checklist.md`:
- SSRF: not applicable — this feature makes no new network fetch of any kind. The gatherer only
  reads `<script>` content already present in the DOM via
  `driver.executionContext.evaluate(...)` (the same CDP-evaluate mechanism the core `MetaElements`
  gatherer uses), never fetches an external URL.
- Crawler/resource abuse: not applicable — no additional network activity beyond the page load
  Lighthouse already performs.
- Chromium/Puppeteer sandbox: no new CDP session or Chromium flags introduced; uses the same
  `driver.executionContext.evaluate` path as an existing core gatherer.

No `critical`/`high` findings. Nothing blocks the next feature.

<!-- Appended by Agent 07 after each /security-review. Format per entry:

## {date} — {slug}

- severity: critical | high | medium | low
- finding: {description}
- status: open | resolved

A `critical` entry with status `open` blocks Agent 00 from starting new work (see
.ai-agents/agents/00-product-intake.md, Step 1).
-->
