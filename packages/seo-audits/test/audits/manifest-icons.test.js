/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mocks safe-fetch.js's `safeFetchJson` — its own SSRF/DoS protections and request mechanics are
 * already unit-tested directly in test/lib/safe-fetch.test.js against a real local server. This
 * file only exercises manifest-icons.js's own control flow (does it call safeFetchJson with the
 * manifest href, does it build the right result from what comes back). The real end-to-end fetch
 * path is verified separately by the live `lhci collect` run (docs/qa/favicon-and-manifest.md).
 */

/* eslint-env jest */

jest.mock('../../src/lib/safe-fetch.js', () => ({
  safeFetchJson: jest.fn(),
}));

const {default: ManifestIcons} = require('../../src/audits/manifest-icons.js');
const {safeFetchJson} = require('../../src/lib/safe-fetch.js');

function faviconLinksWithManifest(href) {
  return [{rel: 'manifest', href, sizes: null, type: null}];
}

describe('manifest-icons audit', () => {
  beforeEach(() => {
    safeFetchJson.mockReset();
  });

  it('is notApplicable when there is no manifest link', async () => {
    const result = await ManifestIcons.audit({FaviconLinks: []});
    expect(result.notApplicable).toBe(true);
    expect(safeFetchJson).not.toHaveBeenCalled();
  });

  it('fetches the manifest href and scores 1 when it has an adequate icon', async () => {
    safeFetchJson.mockResolvedValue({icons: [{src: 'big.png', sizes: '512x512'}]});
    const result = await ManifestIcons.audit({
      FaviconLinks: faviconLinksWithManifest('https://example.com/manifest.json'),
    });
    expect(safeFetchJson).toHaveBeenCalledWith('https://example.com/manifest.json');
    expect(result.score).toBe(1);
  });

  it('scores 0 when the manifest has no adequately-sized icon', async () => {
    safeFetchJson.mockResolvedValue({icons: [{src: 'small.png', sizes: '48x48'}]});
    const result = await ManifestIcons.audit({
      FaviconLinks: faviconLinksWithManifest('https://example.com/manifest.json'),
    });
    expect(result.score).toBe(0);
  });

  it('scores 0 with the fetch error surfaced when the fetch fails (network error, SSRF block, timeout, etc.)', async () => {
    safeFetchJson.mockRejectedValue(new Error('refusing to fetch: a private/reserved IP address'));
    const result = await ManifestIcons.audit({
      FaviconLinks: faviconLinksWithManifest('http://169.254.169.254/manifest.json'),
    });
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('private/reserved IP address');
  });

  it('scores 0 when the fetched manifest is not valid JSON (safeFetchJson rejects)', async () => {
    safeFetchJson.mockRejectedValue(new Error('response was not valid JSON'));
    const result = await ManifestIcons.audit({
      FaviconLinks: faviconLinksWithManifest('https://example.com/manifest.json'),
    });
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('not valid JSON');
  });
});
