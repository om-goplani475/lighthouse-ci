/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  classifyCanonical,
  robotsAccess,
  findConflicts,
  verdictOf,
  verdictRows,
  verdictProduct,
  conflictsProduct,
} = require('../../src/lib/indexability.js');

const PAGE = 'https://example.com/shoes';
const OPEN_ROBOTS = {status: 200, content: 'User-agent: *\nDisallow:'};
const BLOCK_ALL = {status: 200, content: 'User-agent: *\nDisallow: /'};
const BLOCK_GOOGLEBOT = {status: 200, content: 'User-agent: Googlebot\nDisallow: /shoes'};

/** @param {any} over */
const input = over => ({
  pageUrl: PAGE,
  status: 200,
  robotsTxt: OPEN_ROBOTS,
  metas: [],
  xRobotsTag: [],
  canonicals: [],
  target: null,
  bodyTextLength: 500,
  ...over,
});
const noindexMeta = [{name: 'robots', content: 'noindex'}];
/** @param {any} over */
const target = over => ({
  url: 'https://example.com/shoes-main',
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
  ...over,
});
const conflictTexts = (/** @type {any} */ i) => findConflicts(i).map(c => c.conflict);

describe('classifyCanonical', () => {
  it('classifies none, self, trailing slash, conflicting and elsewhere', () => {
    expect(classifyCanonical(PAGE, [])).toEqual({kind: 'none'});
    expect(classifyCanonical(PAGE, [PAGE]).kind).toBe('self');
    expect(classifyCanonical(PAGE, [`${PAGE}#frag`]).kind).toBe('self');
    expect(classifyCanonical(PAGE, [`${PAGE}/`]).kind).toBe('trailing-slash');
    expect(classifyCanonical(PAGE, ['/a', '/b']).kind).toBe('conflicting');
    expect(classifyCanonical(PAGE, ['/a', '/a']).kind).toBe('elsewhere');
    expect(classifyCanonical(PAGE, ['/other'])).toEqual({
      kind: 'elsewhere',
      target: 'https://example.com/other',
    });
  });

  it('ignores unusable hrefs and resolves relative ones', () => {
    expect(classifyCanonical(PAGE, ['http://[bad']).kind).toBe('none');
    expect(classifyCanonical(PAGE, ['//cdn.example.com/x']).target).toBe(
      'https://cdn.example.com/x'
    );
  });
});

describe('robotsAccess', () => {
  it('reports unavailable, absent and present states', () => {
    expect(robotsAccess(null, PAGE)).toEqual({state: 'unavailable', blocked: []});
    expect(robotsAccess({status: 503, content: null}, PAGE).state).toBe('unavailable');
    expect(robotsAccess({status: 404, content: null}, PAGE)).toEqual({
      state: 'absent',
      blocked: [],
    });
    expect(robotsAccess(OPEN_ROBOTS, PAGE)).toEqual({state: 'present', blocked: []});
  });

  it('names the search crawlers robots.txt blocks, independently', () => {
    expect(robotsAccess(BLOCK_ALL, PAGE).blocked).toEqual(['googlebot', 'bingbot']);
    expect(robotsAccess(BLOCK_GOOGLEBOT, PAGE).blocked).toEqual(['googlebot']);
  });
});

describe('verdictOf', () => {
  it('is Indexable for a clean page, with a self canonical too', () => {
    expect(verdictOf(input({})).short).toBe('Indexable');
    expect(verdictOf(input({canonicals: [PAGE]})).short).toBe('Indexable');
    expect(verdictOf(input({canonicals: [`${PAGE}/`]})).short).toBe('Indexable');
  });

  it('is not indexable on an error status, naming it', () => {
    const v = verdictOf(input({status: 404}));
    expect(v.short).toBe('Not indexable (HTTP 404)');
    expect(v.long).toMatch(/drop error pages/);
  });

  it('is not indexable with noindex via meta, header or a crawler-scoped value', () => {
    expect(verdictOf(input({metas: noindexMeta})).short).toBe('Not indexable (noindex)');
    expect(verdictOf(input({xRobotsTag: ['noindex']})).long).toMatch(/X-Robots-Tag header/);
    const scoped = verdictOf(input({xRobotsTag: ['googlebot: noindex']}));
    expect(scoped.long).toMatch(/Googlebot will not index/);
    expect(scoped.long).not.toMatch(/Bingbot/);
  });

  it('says blocked by robots.txt, with the "can still appear" caveat', () => {
    const v = verdictOf(input({robotsTxt: BLOCK_GOOGLEBOT}));
    expect(v.short).toBe('Blocked by robots.txt');
    expect(v.long).toMatch(/Googlebot may not crawl/);
    expect(v.long).toMatch(/without a description/);
  });

  it('says canonical elsewhere', () => {
    const v = verdictOf(input({canonicals: ['/other']}));
    expect(v.short).toBe('Indexable, canonical elsewhere');
    expect(v.long).toMatch(/https:\/\/example.com\/other/);
  });

  it('ranks status over noindex over robots over canonical', () => {
    expect(verdictOf(input({status: 500, metas: noindexMeta})).short).toMatch(/HTTP 500/);
    expect(verdictOf(input({metas: noindexMeta, robotsTxt: BLOCK_ALL})).short).toMatch(/noindex/);
    expect(verdictOf(input({robotsTxt: BLOCK_ALL, canonicals: ['/o']})).short).toMatch(/robots/);
  });

  it('points to indexability-conflicts when signals contradict', () => {
    expect(verdictOf(input({metas: noindexMeta, canonicals: ['/o']})).long).toMatch(
      /indexability-conflicts/
    );
    expect(verdictOf(input({})).long).not.toMatch(/indexability-conflicts/);
  });
});

describe('verdictRows', () => {
  it('always has the five steps in order', () => {
    const rows = verdictRows(input({}));
    expect(rows.map(r => r.step)).toEqual([
      '1. HTTP status',
      '2. robots.txt',
      '3. Meta robots and X-Robots-Tag',
      '4. Canonical',
      '5. Text content',
    ]);
    expect(rows[0].signal).toBe('HTTP 200');
    expect(rows[1].signal).toBe('Googlebot: allowed, Bingbot: allowed');
    expect(rows[3].signal).toBe('no canonical');
  });

  it('describes each signal state', () => {
    const rows = verdictRows(
      input({
        status: 404,
        robotsTxt: BLOCK_GOOGLEBOT,
        metas: noindexMeta,
        canonicals: ['/other'],
        bodyTextLength: 10,
      })
    );
    expect(rows[0].finding).toMatch(/error status/);
    expect(rows[1].signal).toBe('Googlebot: blocked, Bingbot: allowed');
    expect(rows[2].signal).toMatch(/Googlebot: noindex via <meta name="robots">/);
    expect(rows[3].signal).toBe('https://example.com/other');
    expect(rows[4].finding).toMatch(/Under 100 characters/);
  });

  it('handles an unreadable robots.txt, a missing one, unknown text length, conflicting canonicals', () => {
    expect(verdictRows(input({robotsTxt: null}))[1].signal).toBe('robots.txt could not be read');
    expect(verdictRows(input({robotsTxt: {status: 404, content: null}}))[1].signal).toBe(
      'no robots.txt'
    );
    expect(verdictRows(input({bodyTextLength: null}))[4].signal).toBe('unknown');
    expect(verdictRows(input({canonicals: ['/a', '/b']}))[3].signal).toBe('2 different canonicals');
  });

  it('adds what was found at the canonical target', () => {
    const ok = verdictRows(input({canonicals: ['/shoes-main'], target: target({})}))[3];
    expect(ok.finding).toMatch(/Target checked: HTTP 200, indexable/);
    const bad = verdictRows(input({canonicals: ['/shoes-main'], target: target({status: 404})}))[3];
    expect(bad.finding).toMatch(/returns HTTP 404/);
  });
});

describe('findConflicts: the four chosen contradictions', () => {
  it('none for a clean page, an intentional noindex alone, or a canonical alone', () => {
    expect(findConflicts(input({}))).toEqual([]);
    expect(findConflicts(input({metas: noindexMeta}))).toEqual([]);
    expect(findConflicts(input({canonicals: ['/other']}))).toEqual([]);
    expect(findConflicts(input({robotsTxt: BLOCK_ALL}))).toEqual([]);
    expect(findConflicts(input({status: 404}))).toEqual([]);
  });

  it('does not call a canonical target a conflict when it answered with bot protection or a refusal', () => {
    for (const status of [401, 403, 406, 429, 503]) {
      expect(findConflicts(input({canonicals: ['/shoes-main'], target: target({status})}))).toEqual(
        []
      );
    }
    expect(
      conflictTexts(input({canonicals: ['/shoes-main'], target: target({status: 404})}))
    ).toEqual([expect.stringMatching(/canonical target returns HTTP 404/)]);
  });

  it('1. noindex that robots.txt hides, per crawler', () => {
    const both = conflictTexts(input({metas: noindexMeta, robotsTxt: BLOCK_ALL}));
    expect(both).toEqual(['noindex, but robots.txt blocks Googlebot and Bingbot']);
    const one = conflictTexts(input({metas: noindexMeta, robotsTxt: BLOCK_GOOGLEBOT}));
    expect(one).toEqual(['noindex, but robots.txt blocks Googlebot']);
  });

  it('1. is not triggered when the noindex is for the crawler that is allowed', () => {
    expect(
      findConflicts(
        input({
          metas: [{name: 'bingbot', content: 'noindex'}],
          robotsTxt: BLOCK_GOOGLEBOT,
        })
      )
    ).toEqual([]);
  });

  it('2. noindex with a canonical to another URL, but not with a self or trailing-slash canonical', () => {
    expect(conflictTexts(input({metas: noindexMeta, canonicals: ['/other']}))).toEqual([
      'noindex, but the canonical points to https://example.com/other',
    ]);
    expect(findConflicts(input({metas: noindexMeta, canonicals: [PAGE]}))).toEqual([]);
    expect(findConflicts(input({metas: noindexMeta, canonicals: [`${PAGE}/`]}))).toEqual([]);
    expect(findConflicts(input({xRobotsTag: ['noindex'], canonicals: ['/a', '/b']}))).toEqual([]);
  });

  it('3. robots.txt blocking a page whose canonical points elsewhere', () => {
    expect(conflictTexts(input({robotsTxt: BLOCK_GOOGLEBOT, canonicals: ['/other']}))).toEqual([
      'robots.txt blocks Googlebot, but the canonical points to https://example.com/other',
    ]);
  });

  it('4. a canonical on an error page, including a self canonical', () => {
    expect(conflictTexts(input({status: 404, canonicals: [PAGE]}))).toEqual([
      'HTTP 404 page that declares a canonical',
    ]);
    expect(conflictTexts(input({status: 500, canonicals: ['/other']}))).toEqual([
      'HTTP 500 page that declares a canonical',
    ]);
    expect(findConflicts(input({status: 200, canonicals: [PAGE]}))).toEqual([]);
  });

  it('can report several conflicts at once', () => {
    const texts = conflictTexts(
      input({metas: noindexMeta, robotsTxt: BLOCK_ALL, canonicals: ['/other'], status: 404})
    );
    expect(texts).toHaveLength(4);
  });

  it('every conflict explains why in plain English', () => {
    for (const c of findConflicts(
      input({metas: noindexMeta, robotsTxt: BLOCK_ALL, canonicals: ['/other'], status: 404})
    )) {
      expect(c.why.length).toBeGreaterThan(40);
    }
  });
});

describe('findConflicts: the canonical target', () => {
  const withTarget = (/** @type {any} */ t) => input({canonicals: ['/shoes-main'], target: t});

  it('is fine when the target is a live, indexable page', () => {
    expect(findConflicts(withTarget(target({})))).toEqual([]);
  });

  it('flags a target that redirects, naming where', () => {
    const texts = conflictTexts(
      withTarget(target({status: 301, redirectLocation: 'https://example.com/new'}))
    );
    expect(texts[0]).toMatch(/redirects \(HTTP 301 to https:\/\/example.com\/new\)/);
  });

  it('flags a target that is gone, but not one that answered 5xx (a hiccup at probe time)', () => {
    expect(conflictTexts(withTarget(target({status: 404})))[0]).toMatch(/returns HTTP 404/);
    expect(conflictTexts(withTarget(target({status: 410})))[0]).toMatch(/returns HTTP 410/);
    expect(conflictTexts(withTarget(target({status: 503})))).toEqual([]);
  });

  it('flags a noindex target, by header or meta', () => {
    expect(conflictTexts(withTarget(target({metas: noindexMeta})))[0]).toMatch(/itself noindex/);
    expect(conflictTexts(withTarget(target({xRobotsTag: ['noindex']})))[0]).toMatch(
      /itself noindex/
    );
  });

  it('flags a canonical chain, but not a target that points to itself or by trailing slash', () => {
    expect(
      conflictTexts(withTarget(target({canonicals: ['https://example.com/third']})))[0]
    ).toMatch(/canonical chain/);
    expect(
      findConflicts(withTarget(target({canonicals: ['https://example.com/shoes-main']})))
    ).toEqual([]);
    expect(
      findConflicts(withTarget(target({canonicals: ['https://example.com/shoes-main/']})))
    ).toEqual([]);
  });

  it('flags a target that robots.txt blocks', () => {
    const i = input({
      canonicals: ['/shoes-main'],
      target: target({}),
      robotsTxt: {status: 200, content: 'User-agent: *\nDisallow: /shoes-main'},
    });
    const texts = conflictTexts(i);
    expect(
      texts.some(t => /robots.txt blocks Googlebot and Bingbot from the canonical target/.test(t))
    ).toBe(true);
  });

  it('does not fail when the target could not be checked, only notes it', () => {
    for (const t of [
      target({error: 'timed out', status: null}),
      target({notChecked: true, status: null}),
    ]) {
      expect(findConflicts(withTarget(t))).toEqual([]);
      expect(verdictRows(withTarget(t))[3].finding).toMatch(/Target: the canonical target/);
    }
  });

  it('notes a partly read target head instead of claiming it is clean', () => {
    const i = withTarget(target({truncated: true, headComplete: false}));
    expect(findConflicts(i)).toEqual([]);
    expect(verdictRows(i)[3].finding).toMatch(
      /only part of the canonical target's <head> was read/
    );
  });

  it('ignores a target when the canonical is not elsewhere', () => {
    expect(findConflicts(input({canonicals: [PAGE], target: target({status: 404})}))).toEqual([]);
  });

  it('cuts an enormous canonical or redirect URL in what it reports', () => {
    const huge = `https://example.com/${'a'.repeat(100_000)}`;
    const texts = conflictTexts(
      input({canonicals: [huge], target: target({url: huge, status: 301, redirectLocation: huge})})
    );
    for (const t of texts) expect(t.length).toBeLessThan(2_500);
  });
});

describe('the products', () => {
  it('are not applicable without input or a status', () => {
    for (const fn of [verdictProduct, conflictsProduct]) {
      expect(fn(null)).toMatchObject({score: 1, notApplicable: true});
      expect(fn(input({status: null}))).toMatchObject({notApplicable: true});
    }
  });

  it('verdict is informative-shaped: always score 1, a short displayValue and a table', () => {
    const p = verdictProduct(input({metas: noindexMeta}));
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('Not indexable (noindex)');
    expect(/** @type {any} */ (p.details).items).toHaveLength(5);
  });

  it('conflicts passes with nothing to report', () => {
    expect(conflictsProduct(input({}))).toEqual({score: 1});
  });

  it('conflicts fails with a count, a sentence and a why-column', () => {
    const p = conflictsProduct(input({metas: noindexMeta, canonicals: ['/other']}));
    expect(p.score).toBe(0);
    expect(p.displayValue).toBe('1 conflict');
    expect(p.explanation).toMatch(/noindex, but the canonical points to/);
    expect(/** @type {any} */ (p.details).items[0].why).toMatch(/Keep one/);
    const two = conflictsProduct(
      input({metas: noindexMeta, robotsTxt: BLOCK_ALL, canonicals: ['/other']})
    );
    expect(two.displayValue).toBe('3 conflicts');
  });
});
