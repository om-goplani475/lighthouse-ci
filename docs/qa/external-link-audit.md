# QA checklist: Broken external links (Phase 8 item 6)

- audit: `broken-external-links`; new library `external-link-checker.js` and a strict fetch in `safe-fetch.js`
- build mode: lightweight, after a design conversation, with a careful security review (the first request surface to other people's sites)
- branch: `feat/external-link-audit`, off `phase-8-internal-linking`

## Functional (real Lighthouse run, real network)

- [x] Audited page (a local site) linking to `https://example.com/` (200), `https://example.com/this-page-does-not-exist-...` (404), `https://nonexistent-host-....invalid/gone` (DNS failure) and five private
      targets: **fails** with **2 broken external links**: the 404 ("HTTP 404") and the missing host ("host not found"); `example.com` passes; the run took 11 s.
- [x] **Private targets** (`http://127.0.0.1:9599/...`, `http://localhost:9599/...`, `http://[::1]:9599/...`, `http://169.254.169.254/...`, `http://10.0.0.5/...`), with
      `LHCI_SEO_ALLOW_PRIVATE_NETWORK=1` on (the audited site is on localhost): **none requested**: a spy server on the loopback port received **0** requests; each is reported as "points at a private address, not requested".
- [x] **Unit tests**: the strict fetch (14 new in `safe-fetch.test.js`: 9 private address kinds, no opt-in hint, host names that resolve to loopback, both lookup reply shapes, invalid user-agent), the checker
      (12: dedupe, user-agent, 1 KiB cap, 2 per host, never two in flight to one host and at most 5 overall, redirects across hosts, the 3-hop limit, loops, bad `Location`, every error code, the 15 s budget,
      malformed input), the result builder (39: every status and error code classified, caps, wording), the crawler wiring (5) and `crawl-coverage` (the note); an integration test over real local servers
      proving a link to a local server is refused with the opt-in on and the server receives nothing.

## Safety

- [x] **Private addresses are refused whatever the environment says** (loopback, RFC 1918, link-local and the metadata address, IPv6 loopback and unique-local, IPv4-mapped forms, `0.0.0.0`), at the literal-IP check
      and at DNS resolution; every redirect hop goes through the same fetch.
- [x] **Politeness and bounds**: 20 links at most, 2 per host, one at a time per host, 5 in flight, 5 s per request, 3 redirect hops, a 15 s total budget, 1 KiB of body, the crawler user-agent, no
      cookies or credentials, no third-party robots.txt. What is not reached is counted as "not checked".
- [x] **Classification**: 404 and 410, DNS failure and refused connections fail; 5xx, timeouts, resets, TLS errors and too many redirects are listed and never fail; 401, 403, 429, 999 and other 4xx are not judged.

## Findings (fixed, each with a test)

1. Status 999 (LinkedIn's checker block) was treated as a server error (it is above 500): now "not judged".
2. The summary text counted private-address refusals as "answered 401, 403, 429": now separate.
3. The result builder would have thrown on a malformed stored check: it now skips such entries.

## Not verified

- A wide set of real third-party sites (flaky ones, slow ones, ones that block checkers); only `example.com` and made-up hosts were used.
- A real GitHub Actions run (a shared runner's DNS and egress rules); the viewer; the Node 18.20.8 re-run. See `docs/open-items.md`.
