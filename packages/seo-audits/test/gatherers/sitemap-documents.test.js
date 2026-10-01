/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const zlib = require('zlib');
const {
  default: SitemapDocuments,
  collectSitemapDocuments,
  skippedWarning,
} = require('../../src/gatherers/sitemap-documents.js');
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

/**
 * A page fetcher for tests that are not about the page sample: answers every sampled URL with a
 * skipped, empty result, so nothing can reach the network. (The gatherer now samples the URLs a
 * sitemap lists; without this, a test listing https://example.com/... would request it for real.)
 */
const harmlessFetchPage = async () => ({
  status: 200,
  redirectLocation: null,
  headers: {'x-robots-tag': [], 'content-type': [], 'content-encoding': [], location: []},
  body: Buffer.alloc(0),
  bodyRead: 'skipped-not-html',
  truncated: false,
});

const run = routes => {
  const {fetchBytes, calls} = fakeFetch(routes);
  return collectSitemapDocuments(PAGE, {fetchBytes, fetchPage: harmlessFetchPage}).then(
    artifact => ({
      artifact,
      calls,
    })
  );
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
      fetchPage: harmlessFetchPage,
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

describe('collectSitemapDocuments — sitemap index following', () => {
  const index = (...locs) =>
    `<sitemapindex xmlns="${NS}">${locs
      .map(l => `<sitemap><loc>${l}</loc></sitemap>`)
      .join('')}</sitemapindex>`;
  const ROBOTS = {
    'https://example.com/robots.txt': {body: 'Sitemap: https://example.com/index.xml'},
  };

  it('fetches the children of an index as index-child documents with their parent', async () => {
    const {artifact} = await run({
      ...ROBOTS,
      'https://example.com/index.xml': {
        body: index('https://example.com/s1.xml', 'https://example.com/s2.xml'),
      },
      'https://example.com/s1.xml': {body: urlset('https://example.com/a')},
      'https://example.com/s2.xml': {body: urlset('https://example.com/b')},
    });
    expect(artifact.documents.map(d => [d.url, d.source, d.parentUrl])).toEqual([
      ['https://example.com/index.xml', 'declared', null],
      ['https://example.com/s1.xml', 'index-child', 'https://example.com/index.xml'],
      ['https://example.com/s2.xml', 'index-child', 'https://example.com/index.xml'],
    ]);
    expect(artifact.documentsTruncated).toBe(false);
  });

  it('follows the index found through the /sitemap.xml fallback too', async () => {
    const {artifact} = await run({
      'https://example.com/sitemap.xml': {body: index('https://example.com/s1.xml')},
      'https://example.com/s1.xml': {body: urlset('https://example.com/a')},
    });
    expect(artifact.discovery).toBe('default-location');
    expect(artifact.documents.map(d => d.source)).toEqual(['default-location', 'index-child']);
  });

  it('records a failing child (404) without aborting the others', async () => {
    const {artifact} = await run({
      ...ROBOTS,
      'https://example.com/index.xml': {
        body: index('https://example.com/gone.xml', 'https://example.com/s2.xml'),
      },
      'https://example.com/s2.xml': {body: urlset('https://example.com/b')},
    });
    expect(artifact.documents.map(d => d.outcome)).toEqual(['ok', 'http-error', 'ok']);
  });

  it('records a nested index but does not fetch its children (one level only)', async () => {
    const {artifact, calls} = await run({
      ...ROBOTS,
      'https://example.com/index.xml': {body: index('https://example.com/nested.xml')},
      'https://example.com/nested.xml': {body: index('https://example.com/deep.xml')},
      'https://example.com/deep.xml': {body: urlset('https://example.com/a')},
    });
    expect(artifact.documents.map(d => d.kind)).toEqual(['sitemapindex', 'sitemapindex']);
    expect(calls).not.toContain('https://example.com/deep.xml');
    expect(artifact.documentsTruncated).toBe(false);
  });

  it('stops at MAX_DOCUMENTS total and flags truncation', async () => {
    const children = Array.from({length: 25}, (_, i) => `https://example.com/c${i}.xml`);
    const routes = {...ROBOTS, 'https://example.com/index.xml': {body: index(...children)}};
    for (const c of children) routes[c] = {body: urlset('https://example.com/a')};
    const {artifact, calls} = await run(routes);
    expect(artifact.documents).toHaveLength(LIMITS.MAX_DOCUMENTS);
    expect(artifact.documentsTruncated).toBe(true);
    // robots.txt + the index itself + 9 children.
    expect(calls).toHaveLength(1 + LIMITS.MAX_DOCUMENTS);
  });

  it('does not flag truncation when the children exactly fill the budget', async () => {
    const children = Array.from(
      {length: LIMITS.MAX_DOCUMENTS - 1},
      (_, i) => `https://example.com/c${i}.xml`
    );
    const {artifact} = await run({
      ...ROBOTS,
      'https://example.com/index.xml': {body: index(...children)},
    });
    expect(artifact.documents).toHaveLength(LIMITS.MAX_DOCUMENTS);
    expect(artifact.documentsTruncated).toBe(false);
  });

  it('counts declared roots against the same budget as children', async () => {
    const roots = Array.from({length: 3}, (_, i) => `https://example.com/i${i}.xml`);
    const routes = {
      'https://example.com/robots.txt': {body: roots.map(r => `Sitemap: ${r}`).join('\n')},
    };
    for (const [n, r] of roots.entries()) {
      const kids = Array.from({length: 5}, (_, k) => `https://example.com/i${n}-c${k}.xml`);
      routes[r] = {body: index(...kids)};
    }
    const {artifact} = await run(routes);
    expect(artifact.documents).toHaveLength(LIMITS.MAX_DOCUMENTS);
    expect(artifact.documentsTruncated).toBe(true);
    // Breadth-first over roots in order: the first index gets its children before the last.
    expect(
      artifact.documents.filter(d => d.parentUrl === 'https://example.com/i0.xml')
    ).toHaveLength(5);
    expect(
      artifact.documents.filter(d => d.parentUrl === 'https://example.com/i2.xml')
    ).toHaveLength(0);
  });

  it('never requests a child whose loc failed validation, nor one already fetched', async () => {
    const {calls} = await run({
      ...ROBOTS,
      'https://example.com/index.xml': {
        body: index(
          '/relative.xml',
          'ftp://example.com/x.xml',
          'https://example.com/s1.xml',
          'https://example.com/s1.xml',
          'https://example.com/index.xml'
        ),
      },
      'https://example.com/s1.xml': {body: urlset('https://example.com/a')},
    });
    expect(calls).toEqual([
      'https://example.com/robots.txt',
      'https://example.com/index.xml',
      'https://example.com/s1.xml',
    ]);
  });

  it('does not follow anything from a urlset, a broken document, or a failed root', async () => {
    const {calls} = await run({
      'https://example.com/robots.txt': {
        body: 'Sitemap: https://example.com/a.xml\nSitemap: https://example.com/b.xml\nSitemap: https://example.com/c.xml',
      },
      'https://example.com/a.xml': {body: urlset('https://example.com/x')},
      'https://example.com/b.xml': {body: '<sitemapindex'},
      'https://example.com/c.xml': {status: 500},
    });
    expect(calls).toHaveLength(4);
  });
});

describe('collectSitemapDocuments — why discovery was unavailable', () => {
  it('records the reason when robots.txt cannot be fetched (e.g. refused by the SSRF policy)', async () => {
    const {artifact} = await run({
      'https://example.com/robots.txt': new Error(
        'refusing to connect to "example.com": a private/reserved IP address.'
      ),
    });
    expect(artifact.discovery).toBe('unavailable');
    expect(artifact.unavailableReason).toBe(
      'https://example.com/robots.txt could not be fetched: refusing to connect to "example.com": a private/reserved IP address.'
    );
  });

  it('records the HTTP status when robots.txt returns a server error', async () => {
    const {artifact} = await run({'https://example.com/robots.txt': {status: 503}});
    expect(artifact.unavailableReason).toBe('https://example.com/robots.txt returned HTTP 503');
  });

  it('records the reason when the /sitemap.xml probe fails, for an error, a status and a redirect', async () => {
    const robots = {'https://example.com/robots.txt': {body: ''}};
    const url = 'https://example.com/sitemap.xml';
    const err = (await run({...robots, [url]: new Error('boom')})).artifact;
    expect(err.unavailableReason).toBe('boom');
    const status = (await run({...robots, [url]: {status: 500}})).artifact;
    expect(status.unavailableReason).toBe(`${url} returned HTTP 500`);
    const redirect = (
      await run({...robots, [url]: {status: 301, location: 'https://x.test/s.xml'}})
    ).artifact;
    expect(redirect.unavailableReason).toBe(`${url} redirects to https://x.test/s.xml`);
  });

  it.each([
    [
      'a found sitemap',
      {
        'https://example.com/robots.txt': {body: 'Sitemap: https://example.com/s.xml'},
        'https://example.com/s.xml': {body: urlset('https://example.com/a')},
      },
    ],
    ['no sitemap at all (404)', {'https://example.com/robots.txt': {body: ''}}],
  ])('has no reason (and no warning) for %s', async (_label, routes) => {
    const {artifact} = await run(routes);
    expect(artifact.unavailableReason).toBeNull();
    expect(skippedWarning(artifact)).toBeNull();
  });

  it('builds a run warning only for an unavailable discovery with a reason', () => {
    expect(skippedWarning({discovery: 'unavailable', unavailableReason: 'x', documents: []})).toBe(
      'Sitemap audits were skipped: x'
    );
    expect(
      skippedWarning({discovery: 'unavailable', unavailableReason: null, documents: []})
    ).toBeNull();
    expect(skippedWarning({discovery: 'none', unavailableReason: null, documents: []})).toBeNull();
  });
});

describe('SitemapDocuments gatherer class', () => {
  const original = process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK;
  afterEach(() => {
    if (original === undefined) delete process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK;
    else process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK = original;
  });

  it('adds a run warning naming the cause and the setting when a private host is refused', async () => {
    delete process.env.LHCI_SEO_ALLOW_PRIVATE_NETWORK;
    const passContext = {
      baseArtifacts: {URL: {finalDisplayedUrl: 'http://127.0.0.1:9/'}, LighthouseRunWarnings: []},
    };
    // Real default fetcher: the SSRF policy refuses the loopback address before any connection.
    const artifact = await new SitemapDocuments().getArtifact(passContext);
    expect(artifact.discovery).toBe('unavailable');
    expect(passContext.baseArtifacts.LighthouseRunWarnings).toHaveLength(1);
    expect(passContext.baseArtifacts.LighthouseRunWarnings[0]).toMatch(
      /Sitemap audits were skipped: .*private\/reserved.*LHCI_SEO_ALLOW_PRIVATE_NETWORK=1/
    );
  });

  it('adds no warning when nothing was skipped', async () => {
    const passContext = {
      baseArtifacts: {URL: {finalDisplayedUrl: 'https://example.com/'}, LighthouseRunWarnings: []},
    };
    // Not calling the network: assert the helper contract used by getArtifact instead.
    expect(skippedWarning({discovery: 'none', unavailableReason: null, documents: []})).toBeNull();
    expect(passContext.baseArtifacts.LighthouseRunWarnings).toEqual([]);
  });
});

describe('collectSitemapDocuments — the sampled page section (urlSample)', () => {
  const index = (...locs) =>
    `<sitemapindex xmlns="${NS}">${locs
      .map(l => `<sitemap><loc>${l}</loc></sitemap>`)
      .join('')}</sitemapindex>`;
  const ROBOTS = {'https://example.com/robots.txt': {body: 'Sitemap: https://example.com/s.xml'}};
  const htmlPage = (head, extra = {}) => ({
    status: 200,
    redirectLocation: null,
    headers: {
      'x-robots-tag': [],
      'content-type': ['text/html'],
      'content-encoding': [],
      location: [],
    },
    body: Buffer.from(`<html><head>${head}</head><body>x</body></html>`),
    bodyRead: 'html',
    truncated: false,
    ...extra,
  });

  /** @param {(url: string) => Promise<any>} fetchPage */
  const runWith = (routes, fetchPage, deps = {}) => {
    const {fetchBytes} = fakeFetch(routes);
    return collectSitemapDocuments(PAGE, {fetchBytes, fetchPage, env: {}, ...deps});
  };

  it('samples the listed URLs after the documents, requesting each once, and stores signals not HTML', async () => {
    const requested = [];
    const artifact = await runWith(
      {
        ...ROBOTS,
        'https://example.com/s.xml': {
          body: urlset('https://example.com/a', 'https://example.com/b'),
        },
      },
      async url => {
        requested.push(url);
        return htmlPage('<meta name="robots" content="noindex"><link rel="canonical" href="/c">');
      }
    );
    expect(requested).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(artifact.urlSample).toMatchObject({
      sampleSize: 10,
      eligibleCount: 2,
      skippedCrossOrigin: 0,
    });
    expect(artifact.urlSample.pages[0]).toMatchObject({
      url: 'https://example.com/a',
      status: 200,
      bodyRead: 'html',
      metas: [{name: 'robots', content: 'noindex'}],
      canonicals: ['/c'],
      headComplete: true,
    });
    expect(JSON.stringify(artifact)).not.toContain('<body>');
  });

  it('also samples after the /sitemap.xml fallback', async () => {
    const artifact = await runWith(
      {
        'https://example.com/robots.txt': {body: ''},
        'https://example.com/sitemap.xml': {body: urlset('https://example.com/a')},
      },
      async () => htmlPage('')
    );
    expect(artifact.discovery).toBe('default-location');
    expect(artifact.urlSample.pages).toHaveLength(1);
  });

  it.each([
    ['no sitemap (404 on the fallback)', {'https://example.com/robots.txt': {body: ''}}],
    ['robots.txt unavailable', {'https://example.com/robots.txt': {status: 503}}],
  ])('takes no sample for %s, and never calls the page fetcher', async (_label, routes) => {
    let called = false;
    const artifact = await runWith(routes, async () => {
      called = true;
      return htmlPage('');
    });
    expect(artifact.urlSample).toBeNull();
    expect(called).toBe(false);
  });

  it('takes no sample when the only sitemap failed to fetch or lists nothing on its own origin', async () => {
    const failed = await runWith(ROBOTS, async () => htmlPage(''));
    expect(failed.urlSample).toBeNull();
    const foreign = await runWith(
      {...ROBOTS, 'https://example.com/s.xml': {body: urlset('https://other.test/a')}},
      async () => htmlPage('')
    );
    expect(foreign.urlSample).toBeNull();
  });

  it("samples the URLs of an index's child sitemaps, not the child sitemap URLs themselves", async () => {
    const requested = [];
    const artifact = await runWith(
      {
        ...ROBOTS,
        'https://example.com/s.xml': {
          body: index('https://example.com/c1.xml', 'https://example.com/gone.xml'),
        },
        'https://example.com/c1.xml': {body: urlset('https://example.com/a')},
      },
      async url => {
        requested.push(url);
        return htmlPage('');
      }
    );
    expect(requested).toEqual(['https://example.com/a']);
    expect(artifact.documents.map(d => d.outcome)).toEqual(['ok', 'ok', 'http-error']);
  });

  it('honors the sample-size variable and records it', async () => {
    const locs = Array.from({length: 50}, (_, i) => `https://example.com/p${i}`);
    const artifact = await runWith(
      {...ROBOTS, 'https://example.com/s.xml': {body: urlset(...locs)}},
      async () => htmlPage(''),
      {env: {LHCI_SEO_SITEMAP_SAMPLE_SIZE: '3'}}
    );
    expect(artifact.urlSample.sampleSize).toBe(3);
    expect(artifact.urlSample.pages.map(p => p.url)).toEqual([
      'https://example.com/p0',
      'https://example.com/p25',
      'https://example.com/p49',
    ]);
  });

  it('records a page that failed, without failing the run or losing the documents', async () => {
    const artifact = await runWith(
      {
        ...ROBOTS,
        'https://example.com/s.xml': {
          body: urlset('https://example.com/a', 'https://example.com/b'),
        },
      },
      async url => {
        if (url.endsWith('a')) throw new Error('ECONNREFUSED');
        return htmlPage('');
      }
    );
    expect(artifact.documents[0].outcome).toBe('ok');
    expect(artifact.urlSample.pages.map(p => p.error)).toEqual(['ECONNREFUSED', null]);
  });
});

describe('collectSitemapDocuments — the shared time budget for discovery and the documents', () => {
  const ROBOTS3 = {
    body: 'Sitemap: https://example.com/a.xml\nSitemap: https://example.com/b.xml\nSitemap: https://example.com/c.xml',
  };
  const index = (...locs) =>
    `<sitemapindex xmlns="${NS}">${locs
      .map(l => `<sitemap><loc>${l}</loc></sitemap>`)
      .join('')}</sitemapindex>`;

  /**
   * A fetcher that advances a fake clock by `cost(url)` per request, and records the timeout each
   * request was given.
   */
  function timedFetch(routes, cost, clock) {
    const seen = [];
    const fetchBytes = async (url, options) => {
      seen.push([url, options.timeoutMs]);
      clock.now += cost(url);
      const route = routes[url];
      if (!route) return {status: 404, redirectLocation: null, body: Buffer.alloc(0)};
      return {
        status: route.status ?? 200,
        redirectLocation: null,
        body: Buffer.from(route.body ?? ''),
      };
    };
    return {fetchBytes, seen};
  }

  it('stops fetching declared sitemaps once the budget is used up, and says the run was cut short', async () => {
    const clock = {now: 0};
    const {fetchBytes, seen} = timedFetch(
      {
        'https://example.com/robots.txt': ROBOTS3,
        'https://example.com/a.xml': {body: urlset('https://example.com/p1')},
        'https://example.com/b.xml': {body: urlset('https://example.com/p2')},
        'https://example.com/c.xml': {body: urlset('https://example.com/p3')},
      },
      url => (url.endsWith('robots.txt') ? 100 : 20_000),
      clock
    );
    const artifact = await collectSitemapDocuments(PAGE, {
      fetchBytes,
      fetchPage: harmlessFetchPage,
      env: {},
      now: () => clock.now,
      documentsBudgetMs: 30_000,
    });
    // robots.txt (0.1 s) + a.xml (20 s) leaves ~9.9 s: b.xml is fetched, c.xml has no time left.
    expect(artifact.documents.map(d => d.url)).toEqual([
      'https://example.com/a.xml',
      'https://example.com/b.xml',
    ]);
    expect(artifact.documentsTruncated).toBe(true);
    expect(seen.map(s => s[0])).not.toContain('https://example.com/c.xml');
  });

  it('gives each request no more time than the budget has left, so the phase cannot overrun', async () => {
    const clock = {now: 0};
    const {fetchBytes, seen} = timedFetch(
      {
        'https://example.com/robots.txt': ROBOTS3,
        'https://example.com/a.xml': {body: urlset('https://example.com/p1')},
        'https://example.com/b.xml': {body: urlset('https://example.com/p2')},
      },
      url => (url.endsWith('a.xml') ? 6_000 : 0),
      clock
    );
    await collectSitemapDocuments(PAGE, {
      fetchBytes,
      fetchPage: harmlessFetchPage,
      env: {},
      now: () => clock.now,
      documentsBudgetMs: 12_000,
    });
    const timeouts = Object.fromEntries(seen);
    expect(timeouts['https://example.com/robots.txt']).toBe(5_000); // its own limit is below what is left
    expect(timeouts['https://example.com/a.xml']).toBe(10_000); // 12 s left, capped at the request limit
    expect(timeouts['https://example.com/b.xml']).toBe(6_000); // only 6 s left: clamped to what remains
  });

  it('does not start a request with under a second left (it could only time out)', async () => {
    const clock = {now: 0};
    const {fetchBytes, seen} = timedFetch(
      {
        'https://example.com/robots.txt': ROBOTS3,
        'https://example.com/a.xml': {body: urlset('https://example.com/p1')},
      },
      url => (url.endsWith('a.xml') ? 9_500 : 0),
      clock
    );
    const artifact = await collectSitemapDocuments(PAGE, {
      fetchBytes,
      fetchPage: harmlessFetchPage,
      env: {},
      now: () => clock.now,
      documentsBudgetMs: 10_000,
    });
    // 0.5 s left after a.xml: below the one-second minimum, so b.xml and c.xml are never requested.
    expect(seen.map(s => s[0])).toEqual([
      'https://example.com/robots.txt',
      'https://example.com/a.xml',
    ]);
    expect(artifact.documentsTruncated).toBe(true);
  });

  it("stops following an index's children when the budget runs out, and flags it", async () => {
    const clock = {now: 0};
    const children = Array.from({length: 6}, (_, i) => `https://example.com/c${i}.xml`);
    const routes = {
      'https://example.com/robots.txt': {body: 'Sitemap: https://example.com/index.xml'},
      'https://example.com/index.xml': {body: index(...children)},
    };
    for (const c of children) routes[c] = {body: urlset('https://example.com/p')};
    const {fetchBytes, seen} = timedFetch(routes, url => (url.includes('/c') ? 15_000 : 0), clock);
    const artifact = await collectSitemapDocuments(PAGE, {
      fetchBytes,
      fetchPage: harmlessFetchPage,
      env: {},
      now: () => clock.now,
      documentsBudgetMs: 40_000,
    });
    // 15 s each: c0 and c1 fit (30 s); 10 s left for c2 (clamped); then nothing is left for c3.
    const fetchedChildren = seen.filter(s => s[0].includes('/c')).map(s => s[0]);
    expect(fetchedChildren).toEqual([children[0], children[1], children[2]]);
    expect(artifact.documentsTruncated).toBe(true);
  });

  it("still takes the page sample from the documents it did fetch, with the sample's own budget", async () => {
    const clock = {now: 0};
    const {fetchBytes} = timedFetch(
      {
        'https://example.com/robots.txt': ROBOTS3,
        'https://example.com/a.xml': {
          body: urlset('https://example.com/p1', 'https://example.com/p2'),
        },
      },
      url => (url.endsWith('a.xml') ? 50_000 : 0), // the first document alone exhausts the documents budget
      clock
    );
    const pagesRequested = [];
    const artifact = await collectSitemapDocuments(PAGE, {
      fetchBytes,
      fetchPage: async url => {
        pagesRequested.push(url);
        return harmlessFetchPage();
      },
      env: {},
      now: () => clock.now,
      documentsBudgetMs: 40_000,
    });
    expect(artifact.documentsTruncated).toBe(true);
    expect(artifact.urlSample.pages.map(p => p.url)).toEqual([
      'https://example.com/p1',
      'https://example.com/p2',
    ]);
    expect(pagesRequested).toHaveLength(2);
  });

  it('is invisible when there is time to spare: the default budget does not alter a normal run', async () => {
    const {artifact} = await run({
      'https://example.com/robots.txt': ROBOTS3,
      'https://example.com/a.xml': {body: urlset('https://example.com/p1')},
      'https://example.com/b.xml': {body: urlset('https://example.com/p2')},
      'https://example.com/c.xml': {body: urlset('https://example.com/p3')},
    });
    expect(artifact.documents).toHaveLength(3);
    expect(artifact.documentsTruncated).toBe(false);
  });

  it('exposes the documents budget as a constant of 40 seconds', () => {
    expect(LIMITS.DOCUMENTS_BUDGET_MS).toBe(40_000);
    expect(LIMITS.MIN_REQUEST_MS).toBe(1_000);
  });
});
