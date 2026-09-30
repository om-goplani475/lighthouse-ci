/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: SitemapIndexability} = require('../../src/audits/sitemap-indexability.js');

/** A sampled page as the gatherer records it: a healthy, indexable, self-canonical 200 by default. */
const page = (url, overrides = {}) => ({
  url,
  status: 200,
  redirectLocation: null,
  error: null,
  notChecked: false,
  contentType: 'text/html',
  xRobotsTag: [],
  bodyRead: 'html',
  truncated: false,
  metas: [],
  canonicals: [],
  headComplete: true,
  ...overrides,
});
const u = path => `https://example.com${path}`;

const run = (pages, {eligibleCount = pages.length, discovery = 'robots-txt'} = {}) =>
  SitemapIndexability.audit({
    SitemapDocuments: {
      discovery,
      unavailableReason: null,
      ignoredSitemapLines: [],
      documentsTruncated: false,
      documents: [],
      urlSample: {sampleSize: 10, eligibleCount, skippedCrossOrigin: 0, pages},
    },
  });

describe('sitemap-indexability audit — pass', () => {
  it('passes indexable, self-canonical or canonical-less pages and says it was a sample', () => {
    const result = run(
      [
        page(u('/a')),
        page(u('/b'), {canonicals: [u('/b')]}),
        page(u('/c'), {canonicals: ['/c'], metas: [{name: 'robots', content: 'index, follow'}]}),
      ],
      {eligibleCount: 500}
    );
    expect(result.score).toBe(1);
    expect(result.displayValue).toBe('Checked 3 of 500 listed URLs (a sample).');
    expect(result.details).toBeUndefined();
  });

  it('treats a fragment on the canonical, or scheme/host case, as the same URL', () => {
    expect(run([page(u('/a'), {canonicals: [`${u('/a')}#top`]})]).score).toBe(1);
    expect(run([page(u('/a'), {canonicals: ['HTTPS://EXAMPLE.COM/a']})]).score).toBe(1);
  });
});

describe('sitemap-indexability audit — noindex', () => {
  it.each([
    [
      'an X-Robots-Tag header',
      {xRobotsTag: ['noindex']},
      'noindex for Googlebot and Bingbot (X-Robots-Tag header)',
    ],
    [
      'a <meta name="robots">',
      {metas: [{name: 'robots', content: 'noindex, follow'}]},
      'noindex for Googlebot and Bingbot (<meta name="robots">)',
    ],
    [
      'a <meta name="googlebot">',
      {metas: [{name: 'googlebot', content: 'noindex'}]},
      'noindex for Googlebot (<meta name="googlebot">)',
    ],
    [
      'a <meta name="bingbot">',
      {metas: [{name: 'bingbot', content: 'none'}]},
      'noindex for Bingbot (<meta name="bingbot">)',
    ],
    [
      'a googlebot-scoped header',
      {xRobotsTag: ['googlebot: noindex']},
      'noindex for Googlebot (X-Robots-Tag header)',
    ],
    [
      'a bingbot-scoped header with several directives',
      {xRobotsTag: ['bingbot: none, nofollow']},
      'noindex for Bingbot (X-Robots-Tag header)',
    ],
    [
      '`none` (noindex, nofollow)',
      {metas: [{name: 'robots', content: 'NONE'}]},
      'noindex for Googlebot and Bingbot (<meta name="robots">)',
    ],
  ])('fails %s', (_label, overrides, problem) => {
    const result = run([page(u('/private'), overrides)]);
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([{url: u('/private'), problem}]);
    expect(result.explanation).toContain('1 noindex among 1 judged URL(s)');
  });

  it('combines the sources when a header and a meta both say noindex', () => {
    const result = run([
      page(u('/p'), {xRobotsTag: ['noindex'], metas: [{name: 'robots', content: 'noindex'}]}),
    ]);
    expect(result.details.items[0].problem).toBe(
      'noindex for Googlebot and Bingbot (<meta name="robots"> and X-Robots-Tag header)'
    );
  });

  it('does not fail non-blocking directives, a scope for another crawler, or `max-snippet: 20`', () => {
    const result = run([
      page(u('/a'), {xRobotsTag: ['nosnippet', 'otherbot: noindex', 'max-snippet: 20']}),
      page(u('/b'), {metas: [{name: 'robots', content: 'nofollow, noarchive'}]}),
    ]);
    expect(result.score).toBe(1);
  });

  it('catches a noindex on a non-HTML page from its header alone', () => {
    const result = run([
      page(u('/report.pdf'), {
        contentType: 'application/pdf',
        bodyRead: 'skipped-not-html',
        xRobotsTag: ['noindex'],
        headComplete: false,
      }),
    ]);
    expect(result.score).toBe(0);
    expect(result.details.items[0].problem).toContain('X-Robots-Tag header');
  });
});

describe('sitemap-indexability audit — canonical', () => {
  it('fails an absolute canonical pointing at a different path', () => {
    const result = run([page(u('/shoes/red'), {canonicals: [u('/shoes')]})]);
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([
      {url: u('/shoes/red'), problem: `canonical points to ${u('/shoes')}`},
    ]);
    expect(result.explanation).toContain(
      '1 with a canonical pointing elsewhere among 1 judged URL(s)'
    );
  });

  it('fails a canonical that drops the query string, and one that adds it', () => {
    expect(run([page(u('/shoes?color=red'), {canonicals: [u('/shoes')]})]).score).toBe(0);
    expect(run([page(u('/shoes'), {canonicals: [u('/shoes?utm=1')]})]).score).toBe(0);
  });

  it('resolves a relative canonical against the page URL before comparing', () => {
    expect(run([page(u('/shoes/red'), {canonicals: ['/shoes']})]).details.items[0].problem).toBe(
      `canonical points to ${u('/shoes')}`
    );
    expect(run([page(u('/a/b'), {canonicals: ['../a/b']})]).score).toBe(1);
    expect(run([page(u('/a'), {canonicals: ['//example.com/a']})]).score).toBe(1);
  });

  it.each([
    ['http instead of https', 'http://example.com/a'],
    ['www instead of the bare host', 'https://www.example.com/a'],
    ['a different host', 'https://other.test/a'],
    ['a different port', 'https://example.com:8443/a'],
    ['a different letter case in the path', 'https://example.com/A'],
  ])('fails %s', (_label, canonical) => {
    expect(run([page(u('/a'), {canonicals: [canonical]})]).score).toBe(0);
  });

  it('notes, but does not fail, a canonical that differs only by a trailing slash, in either direction', () => {
    const result = run([
      page(u('/shoes'), {canonicals: [u('/shoes/')]}),
      page(u('/hats/'), {canonicals: [u('/hats')]}),
    ]);
    expect(result.score).toBe(1);
    expect(result.displayValue).toContain(
      '2 canonical(s) differ from the URL only by a trailing slash.'
    );
  });

  it('does not treat the root with and without a slash as different', () => {
    expect(run([page('https://example.com/', {canonicals: ['https://example.com']})]).score).toBe(
      1
    );
  });

  it('notes conflicting canonicals without judging them', () => {
    const result = run([page(u('/a'), {canonicals: [u('/x'), u('/y')]})]);
    expect(result.score).toBe(1);
    expect(result.displayValue).toContain('1 page(s) declare conflicting canonicals (not judged).');
  });

  it('counts the same canonical repeated (once resolved) as one canonical, not a conflict', () => {
    expect(run([page(u('/a'), {canonicals: [u('/a'), '/a', `${u('/a')}#x`]})]).score).toBe(1);
    expect(run([page(u('/a'), {canonicals: [u('/z'), '/z']})]).details.items).toHaveLength(1);
  });

  it('ignores an href that cannot be resolved', () => {
    expect(run([page(u('/a'), {canonicals: ['http://[bad']})]).score).toBe(1);
  });

  it('reports both problems on one page as two rows', () => {
    const result = run([page(u('/p'), {xRobotsTag: ['noindex'], canonicals: [u('/other')]})]);
    expect(result.details.items).toHaveLength(2);
    expect(result.explanation).toContain(
      '1 noindex, 1 with a canonical pointing elsewhere among 1 judged URL(s)'
    );
  });
});

describe('sitemap-indexability audit — what is and is not judged', () => {
  it.each([
    ['a 404', {status: 404, bodyRead: 'skipped-status'}],
    ['a redirect', {status: 301, redirectLocation: u('/new'), bodyRead: 'skipped-status'}],
    ['a fetch error', {status: null, error: 'ECONNREFUSED', bodyRead: null}],
    ['a page the time budget never reached', {status: null, notChecked: true, bodyRead: null}],
  ])(
    'does not judge %s, even with a noindex header, and points to sitemap-url-status',
    (_label, overrides) => {
      const result = run([page(u('/ok')), page(u('/x'), {...overrides, xRobotsTag: ['noindex']})]);
      expect(result.score).toBe(1);
      expect(result.displayValue).toContain(
        '1 sampled URL(s) did not return 2xx or were not checked (see sitemap-url-status).'
      );
    }
  );

  it('is notApplicable when no sampled page returned 2xx', () => {
    expect(run([page(u('/a'), {status: 404}), page(u('/b'), {status: null, error: 'x'})])).toEqual({
      score: null,
      notApplicable: true,
    });
  });

  it.each([['none'], ['unavailable']])('is notApplicable when discovery is %s', discovery => {
    expect(run([page(u('/a'))], {discovery})).toEqual({score: null, notApplicable: true});
  });

  it('is notApplicable, without throwing, when there is no sample (null, absent, or empty)', () => {
    const artifact = extra => ({
      SitemapDocuments: {
        discovery: 'robots-txt',
        unavailableReason: null,
        ignoredSitemapLines: [],
        documentsTruncated: false,
        documents: [],
        ...extra,
      },
    });
    expect(SitemapIndexability.audit(artifact({urlSample: null}))).toEqual({
      score: null,
      notApplicable: true,
    });
    expect(SitemapIndexability.audit(artifact({}))).toEqual({score: null, notApplicable: true});
    expect(
      SitemapIndexability.audit(
        artifact({urlSample: {sampleSize: 10, eligibleCount: 0, skippedCrossOrigin: 0, pages: []}})
      )
    ).toEqual({score: null, notApplicable: true});
  });
});

describe('sitemap-indexability audit — never a silent pass', () => {
  it('says when a page had its <head> only partly read and no noindex was found', () => {
    const result = run([page(u('/a'), {truncated: true, headComplete: false})]);
    expect(result.score).toBe(1);
    expect(result.displayValue).toContain(
      '1 page(s) had their <head> only partly read, so no noindex is not proof.'
    );
  });

  it('does not add the partly-read note to a page that was noindex anyway (that is already a failure)', () => {
    const result = run([page(u('/a'), {headComplete: false, xRobotsTag: ['noindex']})]);
    expect(result.score).toBe(0);
    expect(result.explanation).not.toContain('only partly read');
  });

  it('says when a compressed page could only be checked by its header, and when a page is not HTML', () => {
    const result = run([
      page(u('/a'), {bodyRead: 'skipped-compressed', headComplete: false}),
      page(u('/b.pdf'), {
        bodyRead: 'skipped-not-html',
        headComplete: false,
        contentType: 'application/pdf',
      }),
    ]);
    expect(result.score).toBe(1);
    expect(result.displayValue).toContain(
      '1 page(s) were compressed: only their X-Robots-Tag header was checked.'
    );
    expect(result.displayValue).toContain(
      '1 non-HTML page(s): only their X-Robots-Tag header was checked.'
    );
  });

  it('states its limits in its own description: sample, raw HTML only, robots.txt left to another audit', () => {
    const description = SitemapIndexability.meta.description;
    expect(description).toContain('a spot check');
    expect(description).toContain('client-side JavaScript is not seen');
    expect(description).toContain('sitemap-robots-crossref');
  });
});

describe('sitemap-indexability audit — report size', () => {
  it('caps the table at 20 rows and keeps the true total in the explanation', () => {
    const pages = Array.from({length: 25}, (_, i) => page(u(`/p${i}`), {xRobotsTag: ['noindex']}));
    const result = run(pages);
    expect(result.details.items).toHaveLength(20);
    expect(result.explanation).toContain(
      '25 noindex among 25 judged URL(s) (showing the first 20)'
    );
  });
});
