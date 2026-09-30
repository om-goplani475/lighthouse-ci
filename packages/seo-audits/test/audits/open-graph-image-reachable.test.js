/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

jest.mock('../../src/lib/safe-fetch.js', () => ({
  safeFetchStatus: jest.fn(),
}));

const {safeFetchStatus} = require('../../src/lib/safe-fetch.js');
const {
  default: OpenGraphImageReachable,
} = require('../../src/audits/open-graph-image-reachable.js');

/**
 * @param {string | undefined} ogImage
 */
function runAudit(ogImage) {
  return OpenGraphImageReachable.audit({
    MetaElements: ogImage ? [{property: 'og:image', content: ogImage}] : [],
  });
}

describe('open-graph-image-reachable audit', () => {
  beforeEach(() => {
    safeFetchStatus.mockReset();
  });

  it("is notApplicable when there is no og:image at all — that is open-graph-completeness's concern", async () => {
    const result = await runAudit(undefined);
    expect(result.score).toBeNull();
    expect(result.notApplicable).toBe(true);
    expect(safeFetchStatus).not.toHaveBeenCalled();
  });

  it('scores 1 when the fetch returns 200', async () => {
    safeFetchStatus.mockResolvedValue({status: 200});
    const result = await runAudit('https://example.com/image.png');
    expect(result.score).toBe(1);
    expect(safeFetchStatus).toHaveBeenCalledWith('https://example.com/image.png');
  });

  it('fails when the fetch returns 404', async () => {
    safeFetchStatus.mockResolvedValue({status: 404});
    const result = await runAudit('https://example.com/missing.png');
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('404');
  });

  it('fails when the fetch itself rejects (e.g. blocked by SSRF protection, timeout)', async () => {
    safeFetchStatus.mockRejectedValue(
      new Error('refusing to fetch: a private/reserved IP address')
    );
    const result = await runAudit('http://169.254.169.254/image.png');
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('could not be fetched');
  });
});
