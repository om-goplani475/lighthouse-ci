/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  default: SiteCrawl,
  collectSiteCrawl,
  collectInPage,
  skippedWarning,
} = require('../../src/gatherers/site-crawl.js');

const AUDITED = 'https://example.com/';
const html = '<html><head><title>T</title></head><body><p>hello world</p></body></html>';

const deps = (/** @type {any} */ over = {}) => ({
  env: {
    LHCI_SEO_CRAWL_CACHE_TTL_SECONDS: '0',
    LHCI_SEO_CRAWL_MAX_LINK_CHECKS: '0',
    LHCI_SEO_CRAWL_MAX_EXTERNAL_CHECKS: '0',
  },
  fetchPage: jest.fn(async () => ({
    status: 200,
    redirectLocation: null,
    headers: {
      'x-robots-tag': [],
      'content-type': ['text/html'],
      'content-encoding': [],
      location: [],
    },
    body: Buffer.from(html),
    bodyRead: 'html',
    truncated: false,
  })),
  fetchBytes: jest.fn(async () => ({status: 404, redirectLocation: null, body: Buffer.alloc(0)})),
  collectSitemap: jest.fn(async () => ({documents: [], discovery: 'none'})),
  ...over,
});

describe('collectSiteCrawl', () => {
  it('passes the page links to the crawl and adds the rendered text length', async () => {
    const d = deps();
    const artifact = await collectSiteCrawl(
      {links: ['https://example.com/a', 'https://example.com/b'], renderedTextLength: 321},
      AUDITED,
      d
    );
    expect(artifact.state).toBe('crawled');
    expect(artifact.auditedRenderedTextLength).toBe(321);
    expect(d.fetchPage.mock.calls.map((/** @type {any} */ c) => c[0])).toEqual([
      AUDITED,
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('caps how many page links it forwards', async () => {
    const d = deps();
    const links = Array.from({length: 1000}, (_, i) => `https://example.com/p${i}`);
    await collectSiteCrawl({links, renderedTextLength: 1}, AUDITED, {
      ...d,
      env: {...d.env, LHCI_SEO_CRAWL_MAX_PAGES: '200'},
    });
    expect(d.fetchPage.mock.calls.length).toBeLessThanOrEqual(200);
  });

  it('tolerates a missing or malformed page read', async () => {
    const a = await collectSiteCrawl(
      {links: /** @type {any} */ (null), renderedTextLength: null},
      AUDITED,
      deps()
    );
    expect(a.state).toBe('crawled');
    expect(a.auditedRenderedTextLength).toBeNull();
    const b = await collectSiteCrawl(
      {links: [], renderedTextLength: /** @type {any} */ ('x')},
      AUDITED,
      deps()
    );
    expect(b.auditedRenderedTextLength).toBeNull();
  });

  it('makes no request, and still reports the rendered length, when the crawl is disabled', async () => {
    const d = deps({env: {LHCI_SEO_CRAWL: '0'}});
    const artifact = await collectSiteCrawl(
      {links: ['https://example.com/a'], renderedTextLength: 9},
      AUDITED,
      d
    );
    expect(artifact.state).toBe('disabled');
    expect(artifact.auditedRenderedTextLength).toBe(9);
    expect(d.fetchPage).not.toHaveBeenCalled();
  });
});

describe('skippedWarning', () => {
  const base = {
    state: 'crawled',
    auditedUrl: AUDITED,
    reason: null,
    snapshot: null,
    auditedRenderedTextLength: null,
  };

  it('names the cause when the crawl could not run', () => {
    expect(
      skippedWarning({
        ...base,
        state: 'unavailable',
        reason:
          'no page could be requested: refusing to connect ... LHCI_SEO_ALLOW_PRIVATE_NETWORK=1',
      })
    ).toMatch(/^The site crawl could not run: .*LHCI_SEO_ALLOW_PRIVATE_NETWORK=1/);
  });

  it('is silent for a crawl that ran, was cached, or was switched off on purpose', () => {
    expect(
      skippedWarning({
        ...base,
        state: 'crawled',
        snapshot: /** @type {any} */ ({robots: {state: 'present'}}),
      })
    ).toBeNull();
    expect(
      skippedWarning({
        ...base,
        state: 'cached',
        snapshot: /** @type {any} */ ({robots: {state: 'absent'}}),
      })
    ).toBeNull();
    expect(skippedWarning({...base, state: 'disabled', reason: 'off'})).toBeNull();
  });

  it('says so when robots.txt could not be read and only the audited page was crawled', () => {
    expect(
      skippedWarning({
        ...base,
        state: 'crawled',
        snapshot: /** @type {any} */ ({robots: {state: 'unavailable'}}),
      })
    ).toMatch(/robots.txt could not be read.*only the audited page/);
  });

  it('is silent for an unavailable crawl with no reason', () => {
    expect(skippedWarning({...base, state: 'unavailable'})).toBeNull();
  });
});

describe('collectInPage (the function run inside the browser)', () => {
  /** @param {{hrefs: string[], text?: string, origin?: string, noBody?: boolean}} input */
  const run = ({hrefs, text = '', origin = 'https://example.com', noBody = false}) => {
    const g = /** @type {any} */ (global);
    const saved = {document: g.document, location: g.location};
    g.location = {origin};
    g.document = {
      querySelectorAll: () => hrefs.map(href => ({href})),
      body: noBody ? null : {innerText: text},
    };
    try {
      return collectInPage();
    } finally {
      g.document = saved.document;
      g.location = saved.location;
    }
  };

  it('keeps same-origin links in order without duplicates, and drops the rest', () => {
    const r = run({
      hrefs: [
        'https://example.com/a',
        'https://example.com/a',
        'https://other.test/x',
        'https://example.com.evil.test/x',
        'https://example.com/b#frag',
        '',
      ],
    });
    expect(r.links).toEqual(['https://example.com/a', 'https://example.com/b#frag']);
  });

  it('stops at 200 links', () => {
    const hrefs = Array.from({length: 500}, (_, i) => `https://example.com/p${i}`);
    expect(run({hrefs}).links).toHaveLength(200);
  });

  it('measures the rendered text with whitespace collapsed, and copes with no body', () => {
    expect(run({hrefs: [], text: '  Hello \n\n  world  '}).renderedTextLength).toBe(
      'Hello world'.length
    );
    expect(run({hrefs: [], noBody: true}).renderedTextLength).toBe(0);
  });
});

describe('the SiteCrawl gatherer class', () => {
  it('runs in snapshot and navigation mode', () => {
    expect(new SiteCrawl().meta.supportedModes).toEqual(['snapshot', 'navigation']);
  });
});
