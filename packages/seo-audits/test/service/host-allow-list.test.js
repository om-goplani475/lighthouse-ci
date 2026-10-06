/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {validateAllowList, checkAuditUrl} = require('../../src/service/host-allow-list.js');

describe('validateAllowList', () => {
  it('accepts exact hosts and subdomain wildcards', () => {
    expect(
      validateAllowList(['preview.example.com', '*.example.com', 'localhost-app.dev'])
    ).toEqual([]);
  });

  it('rejects an empty list, a non-list, and oversize lists', () => {
    expect(validateAllowList([]).length).toBe(1);
    expect(validateAllowList('example.com').length).toBe(1);
    expect(validateAllowList(Array(51).fill('a.example.com')).length).toBeGreaterThan(0);
  });

  it('rejects too-broad wildcards, IP addresses, and anything that is not a host', () => {
    for (const bad of [
      '*',
      '*.com',
      '*.',
      '127.0.0.1',
      '10.0.0.0',
      '*.1',
      'a b.com',
      'http://x.com',
      'x.com/path',
      'x.com:8080',
      '',
      5,
      null,
    ]) {
      expect(validateAllowList([bad]).length).toBeGreaterThan(0);
    }
  });
});

describe('checkAuditUrl', () => {
  const allowed = ['preview.example.com', '*.stage.example.org'];

  it('accepts an exact host and a wildcard subdomain, ignoring port and case, and drops the fragment', () => {
    expect(checkAuditUrl('https://Preview.Example.com:8443/a?b=1#frag', allowed)).toEqual({
      ok: true,
      url: 'https://preview.example.com:8443/a?b=1',
    });
    expect(checkAuditUrl('http://pr-4.stage.example.org/', allowed).ok).toBe(true);
    expect(checkAuditUrl('https://a.b.stage.example.org/', allowed).ok).toBe(true);
  });

  it('accepts a trailing-dot host name as the same host', () => {
    expect(checkAuditUrl('https://preview.example.com./', allowed).ok).toBe(true);
  });

  it('rejects hosts that merely look similar', () => {
    for (const url of [
      'https://evilpreview.example.com/',
      'https://preview.example.com.evil.net/',
      'https://stage.example.org/', // the wildcard does not cover the bare domain
      'https://xstage.example.org/',
      'https://preview.example.com@evil.net/', // credentials form
      'https://evil.net/?preview.example.com',
    ]) {
      expect(checkAuditUrl(url, allowed).ok).toBe(false);
    }
  });

  it('rejects other schemes, credentials, bad urls, long urls, and a missing list', () => {
    expect(checkAuditUrl('file:///etc/passwd', allowed).ok).toBe(false);
    expect(checkAuditUrl('ftp://preview.example.com/', allowed).ok).toBe(false);
    expect(checkAuditUrl('https://u:p@preview.example.com/', allowed).reason).toMatch(
      /credentials/
    );
    expect(checkAuditUrl('not a url', allowed).ok).toBe(false);
    expect(checkAuditUrl('https://preview.example.com/' + 'a'.repeat(2100), allowed).ok).toBe(
      false
    );
    expect(checkAuditUrl(undefined, allowed).ok).toBe(false);
    expect(checkAuditUrl('https://preview.example.com/', []).reason).toMatch(
      /no valid host allow-list/
    );
  });

  it('does not let an IP address through, even when a similar-looking pattern is configured', () => {
    expect(checkAuditUrl('http://127.0.0.1/', allowed).ok).toBe(false);
    expect(checkAuditUrl('http://[::1]/', allowed).ok).toBe(false);
    expect(checkAuditUrl('http://2130706433/', allowed).ok).toBe(false);
  });
});
