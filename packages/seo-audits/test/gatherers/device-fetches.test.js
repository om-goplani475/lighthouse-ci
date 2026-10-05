/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  collectDeviceFetches,
  MOBILE_UA,
  DESKTOP_UA,
} = require('../../src/gatherers/device-fetches.js');
const {isValidUserAgentForTest} = {
  isValidUserAgentForTest: (/** @type {string} */ s) => /^[\x20-\x7e]{1,200}$/.test(s),
};

const ok = (/** @type {string} */ html) => ({
  status: 200,
  redirectLocation: null,
  headers: {},
  body: Buffer.from(html),
  bodyRead: 'html',
  truncated: false,
});

describe('collectDeviceFetches', () => {
  it('fetches the audited URL once per user-agent with the size and time bounds', async () => {
    const fetchPage = jest.fn(async (/** @type {string} */ _url, /** @type {any} */ options) =>
      ok(options.userAgent === MOBILE_UA ? '<p>m</p>' : '<p>d</p>')
    );
    // @ts-expect-error - partial fetch result
    const artifact = await collectDeviceFetches('https://example.com/a', {env: {}, fetchPage});
    expect(artifact).toMatchObject({
      state: 'fetched',
      mobile: {html: '<p>m</p>'},
      desktop: {html: '<p>d</p>'},
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchPage.mock.calls) {
      expect(url).toBe('https://example.com/a');
      expect(options).toMatchObject({maxBytes: 512 * 1024, timeoutMs: 10_000});
    }
    expect(fetchPage.mock.calls.map(c => c[1].userAgent).sort()).toEqual(
      [DESKTOP_UA, MOBILE_UA].sort()
    );
  });

  it('sends user-agents the safe fetch accepts and that name this tool', () => {
    for (const ua of [MOBILE_UA, DESKTOP_UA]) {
      expect(isValidUserAgentForTest(ua)).toBe(true);
      expect(ua).toMatch(/lhci-seo-audits\/1\.0$/);
    }
    expect(MOBILE_UA).toMatch(/Mobile/);
    expect(DESKTOP_UA).not.toMatch(/Mobile/);
  });

  it('records a failed fetch as data, and does not read the body of a non-HTML answer', async () => {
    const fetchPage = jest.fn(async (/** @type {string} */ _u, /** @type {any} */ options) => {
      if (options.userAgent === MOBILE_UA) throw new Error('connect ECONNREFUSED');
      return {...ok('%PDF'), bodyRead: 'skipped-not-html'};
    });
    // @ts-expect-error - partial fetch result
    const artifact = await collectDeviceFetches('https://example.com/a', {env: {}, fetchPage});
    expect(artifact.mobile).toMatchObject({
      status: null,
      error: 'connect ECONNREFUSED',
      html: null,
    });
    expect(artifact.desktop).toMatchObject({status: 200, html: null, bodyRead: 'skipped-not-html'});
  });

  it('makes no request when switched off or when the URL is not http(s)', async () => {
    const fetchPage = jest.fn();
    // @ts-expect-error - partial deps
    expect(
      (
        await collectDeviceFetches('https://example.com/', {
          env: {LHCI_SEO_DEVICE_PARITY: '0'},
          fetchPage,
        })
      ).state
    ).toBe('disabled');
    // @ts-expect-error - partial deps
    expect((await collectDeviceFetches('file:///etc/passwd', {env: {}, fetchPage})).state).toBe(
      'unavailable'
    );
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
