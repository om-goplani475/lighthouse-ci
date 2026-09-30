/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const zlib = require('zlib');
const {collectSitemapDocuments} = require('../../src/gatherers/sitemap-documents.js');
const {LIMITS, SITEMAP_NAMESPACE} = require('../../src/lib/sitemap-parse.js');

const PAGE = {finalDisplayedUrl: 'https://example.com/products/shoe?x=1#top'};
const NS = SITEMAP_NAMESPACE;

const urlset = (...locs) =>
  `<urlset xmlns="${NS}">${locs.map(l => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;

/**
 * Builds an injectable fetcher from a url → response map. A value that is an Error is thrown; a
 * URL not in the map is a 404. Records every requested URL in `calls`.
 * @param {Record<string, {status?: number, body?: string | Buffer, location?: string} | Error>} routes
 */
function fakeFetch(routes) {
  const calls = [];
  const fetchBytes = async url => {
    calls.push(url);
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (!route) return {status: 404, redirectLocation: null, body: Buffer.alloc(0)};
    return {
      status: route.status ?? 200,
      redirectLocation: route.location ?? null,
      body: Buffer.isBuffer(route.body) ? route.body : Buffer.from(route.body ?? ''),
    };
  };
  return {fetchBytes, calls};
}

const run = routes => {
  const {fetchBytes, calls} = fakeFetch(routes);
  return collectSitemapDocuments(PAGE, {fetchBytes}).then(artifact => ({artifact, calls}));
};

describe('collectSitemapDocuments — discovery and root documents', () => {
  it('fetches robots.txt from the page origin and a declared sitemap', async () => {
    const {artifact, calls} = await run({
      'https://example.com/robots.txt': {body: 'User-agent: *\nSitemap: https://example.com/s.xml'},
      'https://example.com/s.xml': {body: urlset('https://example.com/a')},
    });
    expect(calls).toEqual(['https://example.com/robots.txt', 'https://example.com/s.xml']);
    expect(artifact.discovery).toBe('robots-txt');
    expect(artifact.documents).toHaveLength(1);
    expect(artifact.documents[0]).toMatchObject({
      url: 'https://example.com/s.xml',
      source: 'declared',
      parentUrl: null,
      outcome: 'ok',
      kind: 'urlset',
      locs: ['https://example.com/a'],
    });
  });

  it('fetches a cross-origin declared sitemap (allowed by decision, via the safe fetcher)', async () => {
    const {artifact, calls} = await run({
      'https://example.com/robots.txt': {body: 'Sitemap: https://cdn.other.net/s.xml'},
      'https://cdn.other.net/s.xml': {body: urlset('https://example.com/a')},
    });
    expect(calls).toContain('https://cdn.other.net/s.xml');
    expect(artifact.documents[0].outcome).toBe('ok');
  });

  it('records relative and non-http Sitemap lines as ignored, and does not fetch them', async () => {
    const {artifact, calls} = await run({
      'https://example.com/robots.txt': {
        body: 'Sitemap: /relative.xml\nSitemap: ftp://example.com/s.xml\nSitemap: https://example.com/s.xml',
      },
      'https://example.com/s.xml': {body: urlset('https://example.com/a')},
    });
    expect(artifact.ignoredSitemapLines).toEqual(['/relative.xml', 'ftp://example.com/s.xml']);
    expect(calls).toEqual(['https://example.com/robots.txt', 'https://example.com/s.xml']);
  });

  it('dedupes declared sitemaps and caps them at MAX_DECLARED', async () => {
    const lines = Array.from({length: 8}, (_, i) => `Sitemap: https://example.com/s${i}.xml`);
    const {artifact, calls} = await run({
      'https://example.com/robots.txt': {
        body: ['Sitemap: https://example.com/s0.xml', ...lines].join('\n'),
      },
    });
    expect(artifact.documents).toHaveLength(LIMITS.MAX_DECLARED);
    expect(calls.filter(u => u.endsWith('s0.xml'))).toHaveLength(1);
  });

  it('falls back to /sitemap.xml when robots.txt declares nothing', async () => {
    const {artifact, calls} = await run({
      'https://example.com/robots.txt': {body: 'User-agent: *\nDisallow:'},
      'https://example.com/sitemap.xml': {body: urlset('https://example.com/a')},
    });
    expect(calls).toEqual(['https://example.com/robots.txt', 'https://example.com/sitemap.xml']);
    expect(artifact.discovery).toBe('default-location');
    expect(artifact.documents[0].source).toBe('default-location');
  });

  it('falls back to /sitemap.xml when robots.txt is absent (404)', async () => {
    const {artifact} = await run({
      'https://example.com/sitemap.xml': {body: urlset('https://example.com/a')},
    });
    expect(artifact.discovery).toBe('default-location');
  });

  it.each([[404], [410]])(
    'reports discovery "none" when the fallback probe is %i',
    async status => {
      const {artifact} = await run({
        'https://example.com/robots.txt': {body: ''},
        'https://example.com/sitemap.xml': {status},
      });
      expect(artifact).toMatchObject({discovery: 'none', documents: []});
    }
  );

  it.each([
    ['a 500', {status: 500}],
    ['a redirect', {status: 301, location: 'https://example.com/other'}],
    ['a network error', new Error('boom')],
  ])('reports discovery "unavailable" when the fallback probe gets %s', async (_label, route) => {
    const {artifact} = await run({
      'https://example.com/robots.txt': {body: ''},
      'https://example.com/sitemap.xml': route,
    });
    expect(artifact).toMatchObject({discovery: 'unavailable', documents: []});
  });

  it.each([
    ['a 503', {status: 503}],
    ['a redirect', {status: 301, location: '/x'}],
    ['a network error', new Error('boom')],
  ])('reports "unavailable" without probing when robots.txt is %s', async (_label, route) => {
    const {artifact, calls} = await run({'https://example.com/robots.txt': route});
    expect(artifact).toMatchObject({discovery: 'unavailable', documents: []});
    expect(calls).toEqual(['https://example.com/robots.txt']);
  });

  it('records a declared sitemap that 404s as an http-error document (a defect, not "none")', async () => {
    const {artifact} = await run({
      'https://example.com/robots.txt': {body: 'Sitemap: https://example.com/s.xml'},
    });
    expect(artifact.discovery).toBe('robots-txt');
    expect(artifact.documents[0]).toMatchObject({outcome: 'http-error', status: 404, kind: null});
  });

  it('records a redirecting declared sitemap with its Location, without following it', async () => {
    const {artifact, calls} = await run({
      'https://example.com/robots.txt': {body: 'Sitemap: http://example.com/s.xml'},
      'http://example.com/s.xml': {status: 301, location: 'https://example.com/s.xml'},
    });
    expect(artifact.documents[0]).toMatchObject({
      outcome: 'redirect',
      status: 301,
      redirectLocation: 'https://example.com/s.xml',
    });
    expect(calls).not.toContain('https://example.com/s.xml');
  });

  it('records a network error on one sitemap without losing the others', async () => {
    const {artifact} = await run({
      'https://example.com/robots.txt': {
        body: 'Sitemap: https://example.com/a.xml\nSitemap: https://example.com/b.xml',
      },
      'https://example.com/a.xml': new Error('connect ECONNREFUSED'),
      'https://example.com/b.xml': {body: urlset('https://example.com/x')},
    });
    expect(artifact.documents.map(d => d.outcome)).toEqual(['network-error', 'ok']);
    expect(artifact.documents[0].errorMessage).toMatch(/ECONNREFUSED/);
  });

  it('parses a gzip sitemap and records a bad-XML sitemap as data', async () => {
    const {artifact} = await run({
      'https://example.com/robots.txt': {
        body: 'Sitemap: https://example.com/s.xml.gz\nSitemap: https://example.com/bad.xml',
      },
      'https://example.com/s.xml.gz': {
        body: zlib.gzipSync(Buffer.from(urlset('https://example.com/a'))),
      },
      'https://example.com/bad.xml': {body: '<urlset'},
    });
    expect(artifact.documents[0]).toMatchObject({gzip: true, kind: 'urlset'});
    expect(artifact.documents[1].parseError).not.toBeNull();
  });

  it('uses the origin of the final displayed URL, not the path', async () => {
    const {calls} = await run({});
    expect(calls[0]).toBe('https://example.com/robots.txt');
  });

  it('passes the documented timeout and byte caps to the fetcher', async () => {
    const seen = [];
    await collectSitemapDocuments(PAGE, {
      fetchBytes: async (url, options) => {
        seen.push([url, options]);
        return {
          status: url.endsWith('robots.txt') ? 200 : 404,
          redirectLocation: null,
          body: Buffer.from('Sitemap: https://example.com/s.xml'),
        };
      },
    });
    expect(seen[0][1]).toEqual({timeoutMs: 5000, maxBytes: 1024 * 1024});
    expect(seen[1][1]).toEqual({
      timeoutMs: LIMITS.REQUEST_TIMEOUT_MS,
      maxBytes: LIMITS.MAX_COMPRESSED_BYTES,
    });
  });
});
