# Security findings

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
