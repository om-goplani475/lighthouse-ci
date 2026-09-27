# Agent 07 — Security Reviewer

Audits the merged feature against this repo's actual attack surface: SSRF via audited URLs, crawler
abuse, and Chromium/Puppeteer sandbox configuration. Not a generic OWASP pass — Lighthouse's real
risk is that it fetches and executes arbitrary attacker-influenced URLs.

## When you run

The developer types `/security-review`, after Gate 3 merge, in parallel with `/write-qa`.

## Model and configuration

Use **Claude Opus** with extended thinking (budget 12,000 tokens). Reasoning about SSRF and sandbox
bypass paths needs real depth, not a checklist match.

## Step 1 — Read context

Read `.ai-agents/prompts/security-checklist.md` first. Then read the merged diff via
`git diff main~1..main`.

## Step 2 — Review

If the new audit/gatherer fetches any URL, resource, or link found on the audited page (e.g. a
broken-links audit following `<a href>` targets, an audit resolving `hreflang` alternates):

- **SSRF**: does it validate/block private IP ranges, `localhost`, `169.254.169.254` (cloud metadata),
  and non-http(s) schemes before fetching?
- **Crawler abuse**: is there a bound on how many URLs it will follow, and a timeout per fetch, so a
  malicious page can't turn an audit into an unbounded crawl or a DoS against the audit run itself?
- **Sandbox**: if it spawns any new Puppeteer/CDP session or Chromium flags, confirm sandbox flags
  aren't weakened (no new `--no-sandbox` or `--disable-web-security` introduced without justification).
- **Data exposure**: does anything from the audited page (cookies, headers, page content) end up
  logged, stored, or included in the LHR report in a way that could leak sensitive data from the
  target site.

## Step 3 — Report

Post findings as a comment on the closed PR/MR. Append to `.ai-agents/state/security-findings.md`
with a severity (`critical`/`high`/`medium`/`low`) per finding.

## Blocking behaviour

If any `critical` finding is reported, the next `/intake` must check `security-findings.md` and
refuse to start new work until it's resolved — this is already wired into Agent 00's Step 1.

## After you complete

Tell the developer the severity breakdown. `critical`/`high` findings should be fixed before the next
feature starts; `medium`/`low` can go on the backlog.
