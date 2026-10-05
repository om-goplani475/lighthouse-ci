# QA checklist: Pagination audits (Phase 8 item 5)

- audits: `pagination-links`, `paginated-canonical`, `pagination-trap`; also the audited page's `rel=next`/`rel=prev` targets are now status-checked with its links
- build mode: lightweight, after a design conversation; no new request pattern beyond the existing link checks
- branch: `feat/pagination-audits`, off `phase-8-internal-linking`

## Functional (real Lighthouse runs against a planted site)

| Audited page | `pagination-links` | `paginated-canonical` | `pagination-trap` |
|---|---|---|---|
| `/good?page=2` (consistent 1 to 4, self canonicals) | pass (2 links checked) | pass | pass (4 variants) |
| `/broken?page=2` (`rel=next` to a 404) | **fail** | pass | pass |
| `/recip?page=2` (`rel=next` to a page with no `rel=prev`) | **fail** | pass | pass |
| `/canon?page=2` (canonical to `?page=1`) | pass | **fail** | pass |
| `/trap?page=1` (every page has a `rel=next`, endlessly), default depth 3 | pass | pass | pass: "too few to call it a trap" (5 variants known) |
| `/trap?page=1` with `LHCI_SEO_CRAWL_MAX_DEPTH=5` | pass | pass | **fail** ("At least 6 numbered variants, still going") |
| `/` (no pagination) | n/a | n/a | n/a |

- [x] **Unit tests**: 54 (broken target by crawl or status check, self link, no link back, loop, redirecting target note, other origin, reciprocity through a redirected URL, canonical to page
      1 or another member, relative canonical, view-all pass, several canonicals, series from both directions, the trap thresholds, other pages listed and capped, malformed input).

## Safety and cost

- [x] **Time on hostile snapshots** (200 pages, each with 5 `next` and 5 `prev` targets): `pagination-links` **175 ms** with 1,900-character URLs (3.9 s before indexing the pages
      by URL), the other two under 60 ms; output at most 51 KiB (rows capped at 100, cells clipped at 200).

## Findings

- **The first trap rule missed a next-only endless chain** (the live run passed it): the crawl follows 3 hops, so it never saw 6 variants. Widened to count variants only pointed at by a
  `rel=next` (with the threshold kept above 5 so a normal short series is not flagged), tested and documented; at the default depth such a chain is "too few to call it a trap".
- **A quadratic scan** in `pagination-links` found by the hostile timing run, fixed (index by URL).
- **Known limit**: a `rel=next` loop longer than 50 pages is not detected (the chain walk is capped).

## Not verified

- A real public site; the viewer; a real GitHub Actions run; the Node 18.20.8 re-run (see `docs/open-items.md`).
