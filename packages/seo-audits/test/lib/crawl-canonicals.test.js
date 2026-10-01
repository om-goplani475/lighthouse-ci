/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildCanonicalConflictsProduct,
  canonicalOf,
  MAX_ROWS,
} = require('../../src/lib/crawl-canonicals.js');

const mkUrl = (/** @type {string} */ p) => `https://example.com${p}`;
/** @param {any} over */
const page = (over = {}) => {
  const built = {
    url: mkUrl('/'),
    status: 200,
    canonicals: [],
    robotsMetas: [],
    xRobotsTag: [],
    textHash: 'h-home',
    source: 'link',
    extraction: 'ok',
    ...over,
  };
  if (!('finalUrl' in over)) built.finalUrl = built.url;
  return built;
};
const audited = (/** @type {any} */ over = {}) => page({source: 'audited', ...over});
/**
 * @param {any[]} pages
 * @param {any[]} [skipped]
 */
const artifact = (pages, skipped = []) => ({
  state: 'crawled',
  auditedUrl: mkUrl('/'),
  reason: null,
  snapshot: {pages, skipped},
  auditedRenderedTextLength: null,
});
/** @param {any[]} pages @param {any[]} [skipped] */
const run = (pages, skipped) =>
  // @ts-expect-error - partial test artifact
  buildCanonicalConflictsProduct(artifact(pages, skipped));
/** @param {any} product */
const problems = product => product.details.items.map((/** @type {any} */ i) => i.problem);

describe('canonicalOf', () => {
  it('resolves a relative canonical and ignores self, none, several and unreadable pages', () => {
    expect(canonicalOf(page({canonicals: ['/a#x']}))).toBe(mkUrl('/a'));
    expect(canonicalOf(page({canonicals: [mkUrl('/')]}))).toBeNull();
    expect(canonicalOf(page({canonicals: []}))).toBeNull();
    expect(canonicalOf(page({canonicals: ['/a', '/b']}))).toBeNull();
    expect(canonicalOf(page({canonicals: ['/a'], extraction: 'error'}))).toBeNull();
    expect(canonicalOf(page({canonicals: ['mailto:x@y.z']}))).toBeNull();
  });
});

describe('buildCanonicalConflictsProduct', () => {
  it('passes when every page canonicals to itself or to a clean page', () => {
    const product = run([
      audited(),
      page({url: mkUrl('/a'), canonicals: [mkUrl('/')]}),
      page({url: mkUrl('/b'), canonicals: [mkUrl('/b')], textHash: 'h-b'}),
    ]);
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('No conflicts among 3 crawled pages');
  });

  it('fails when the audited page is noindex and another page canonicals to it', () => {
    const product = run([
      audited({robotsMetas: [{name: 'robots', content: 'noindex'}]}),
      page({url: mkUrl('/a'), canonicals: [mkUrl('/')]}),
    ]);
    expect(product.score).toBe(0);
    expect(problems(product)).toEqual(['target is noindex']);
    expect(product.details.items[0].audited).toBe('yes');
  });

  it('sees a noindex sent only as an X-Robots-Tag header', () => {
    const product = run([
      audited({xRobotsTag: ['noindex']}),
      page({url: mkUrl('/a'), canonicals: [mkUrl('/')]}),
    ]);
    expect(problems(product)).toEqual(['target is noindex']);
  });

  it('fails when the audited page declares a canonical elsewhere and another page points at it (a chain)', () => {
    const product = run([
      audited({canonicals: [mkUrl('/x')]}),
      page({url: mkUrl('/a'), canonicals: [mkUrl('/')]}),
      page({url: mkUrl('/x'), textHash: 'h-x'}),
    ]);
    expect(product.score).toBe(0);
    expect(problems(product)).toEqual(['target declares another canonical (a chain)']);
  });

  it('does not repeat the audited page’s own bad target (indexability-conflicts covers it)', () => {
    const product = run([
      audited({canonicals: [mkUrl('/n')]}),
      page({
        url: mkUrl('/n'),
        robotsMetas: [{name: 'robots', content: 'noindex'}],
        textHash: 'h-n',
      }),
    ]);
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('No conflicts among 2 crawled pages');
  });

  it('reports a loop through the audited page once, and fails', () => {
    const product = run([
      audited({canonicals: [mkUrl('/b')]}),
      page({url: mkUrl('/b'), canonicals: [mkUrl('/')]}),
    ]);
    expect(product.score).toBe(0);
    expect(problems(product)).toEqual(['canonicals lead in a circle']);
  });

  it('reports a loop among other pages once, listed and not failing', () => {
    const product = run([
      audited(),
      page({url: mkUrl('/c'), canonicals: [mkUrl('/d')]}),
      page({url: mkUrl('/d'), canonicals: [mkUrl('/c')]}),
    ]);
    expect(product.score).toBe(1);
    expect(problems(product)).toEqual(['canonicals lead in a circle']);
    expect(product.displayValue).toBe('1 conflict on other pages');
  });

  it('lists an error, redirecting and blocked target on other pages without failing', () => {
    const product = run(
      [
        audited(),
        page({url: mkUrl('/p1'), canonicals: [mkUrl('/dead')]}),
        page({url: mkUrl('/p2'), canonicals: [mkUrl('/old')]}),
        page({url: mkUrl('/p3'), canonicals: [mkUrl('/private')]}),
        page({url: mkUrl('/dead'), status: 404, extraction: 'skipped-status'}),
        page({url: mkUrl('/old'), finalUrl: mkUrl('/new'), textHash: 'h-new'}),
      ],
      [{url: mkUrl('/private'), reason: 'blocked-by-robots', detail: null}]
    );
    expect(product.score).toBe(1);
    expect(problems(product).sort()).toEqual([
      'target is an error page',
      'target is blocked by robots.txt',
      'target redirects',
    ]);
  });

  it('fails when pages with different content share the audited page as canonical target', () => {
    const product = run([
      audited(),
      page({url: mkUrl('/a'), canonicals: [mkUrl('/')], textHash: 'h-a'}),
      page({url: mkUrl('/b'), canonicals: [mkUrl('/')], textHash: 'h-b'}),
    ]);
    expect(product.score).toBe(0);
    expect(problems(product)).toEqual(['pages with different content share this canonical target']);
  });

  it('does not flag pages with identical content sharing a canonical target', () => {
    const product = run([
      audited(),
      page({url: mkUrl('/a'), canonicals: [mkUrl('/')], textHash: 'same'}),
      page({url: mkUrl('/b'), canonicals: [mkUrl('/')], textHash: 'same'}),
    ]);
    expect(product.score).toBe(1);
  });

  it('does not count a page with several canonicals as a source', () => {
    const product = run([
      audited(),
      page({url: mkUrl('/a'), canonicals: [mkUrl('/'), mkUrl('/z')]}),
    ]);
    expect(product.score).toBe(1);
  });

  it('terminates on a long chain and on a cycle that does not include the start', () => {
    const pages = [audited(), page({url: mkUrl('/s'), canonicals: [mkUrl('/t')]})];
    for (let i = 0; i < 30; i++) {
      pages.push(page({url: mkUrl(`/t${i}`), canonicals: [mkUrl(`/t${i + 1}`)]}));
    }
    pages.push(
      page({url: mkUrl('/t'), canonicals: [mkUrl('/u')]}),
      page({url: mkUrl('/u'), canonicals: [mkUrl('/t')]})
    );
    expect(() => run(pages)).not.toThrow();
  });

  it('caps the rows', () => {
    const pages = [audited({robotsMetas: [{name: 'robots', content: 'noindex'}]})];
    for (let i = 0; i < 80; i++) pages.push(page({url: mkUrl(`/p${i}`), canonicals: [mkUrl('/')]}));
    const product = run(pages);
    expect(product.details.items).toHaveLength(MAX_ROWS + 1);
    expect(product.details.items[MAX_ROWS].page).toBe('30 more not shown');
  });

  it('is not applicable without a second readable page or without the audited page', () => {
    expect(run([audited()]).notApplicable).toBe(true);
    expect(run([audited({extraction: 'error'}), page({url: mkUrl('/a')})]).notApplicable).toBe(
      true
    );
  });

  it.each([null, undefined, {}, {state: 'disabled', reason: 'off'}, {state: 'unavailable'}])(
    'is not applicable and does not throw for a missing or unusable crawl (%j)',
    input => {
      // @ts-expect-error - deliberately malformed
      expect(buildCanonicalConflictsProduct(input).notApplicable).toBe(true);
    }
  );
});
