/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const lib = require('../../src/lib/rendering.js');

const URL_ = 'https://example.com/page';
const words = (/** @type {number} */ n) => Array.from({length: n}, (_, i) => `word${i}`).join(' ');
const html = ({
  title = 'My title',
  desc = 'My description',
  canonical = 'https://example.com/page',
  robots = '',
  h1 = 'Heading',
  text = words(120),
  links = ['/a', '/b', '/c', '/d', '/e'],
} = {}) =>
  `<!doctype html><html><head>${title === null ? '' : `<title>${title}</title>`}${
    desc === null ? '' : `<meta name="description" content="${desc}">`
  }${canonical === null ? '' : `<link rel="canonical" href="${canonical}">`}${
    robots ? `<meta name="robots" content="${robots}">` : ''
  }</head><body>${h1 === null ? '' : `<h1>${h1}</h1>`}<p>${text}</p>${links
    .map(l => `<a href="${l}">link ${l}</a>`)
    .join(' ')}</body></html>`;
const rendered = (/** @type {string} */ h, truncated = false) => ({html: h, truncated});

describe('buildHeadSignalsProduct', () => {
  const run = (/** @type {string} */ raw, /** @type {string} */ live) =>
    lib.buildHeadSignalsProduct(raw, rendered(live), URL_);

  it('passes when the head is identical', () => {
    expect(run(html(), html()).score).toBe(1);
  });
  it('fails a title, description and canonical that exist only after JavaScript', () => {
    const p = run(html({title: null, desc: null, canonical: null}), html());
    expect(p.score).toBe(0);
    expect(p.details.items.map((/** @type {any} */ i) => [i.field, i.problem])).toEqual([
      ['Title', 'only after JavaScript'],
      ['Meta description', 'only after JavaScript'],
      ['Canonical', 'only after JavaScript'],
    ]);
  });
  it('fails a changed title and a changed canonical', () => {
    const p = run(html(), html({title: 'Other', canonical: 'https://example.com/other'}));
    expect(p.details.items.map((/** @type {any} */ i) => i.problem)).toEqual([
      'differs',
      'differs',
    ]);
  });
  it('fails noindex added or removed by JavaScript', () => {
    expect(run(html(), html({robots: 'noindex'})).details.items[0].field).toBe('Robots (noindex)');
    expect(run(html({robots: 'noindex'}), html()).score).toBe(0);
    expect(run(html({robots: 'index, follow'}), html()).score).toBe(1);
  });
  it('ignores whitespace and relative canonical forms', () => {
    expect(run(html({title: 'My   title '}), html({canonical: '/page'})).score).toBe(1);
  });
  it('is not applicable without both sides', () => {
    expect(lib.buildHeadSignalsProduct('', rendered(html()), URL_).notApplicable).toBe(true);
    expect(lib.buildHeadSignalsProduct(html(), null, URL_).notApplicable).toBe(true);
    expect(lib.buildHeadSignalsProduct(html(), rendered(''), URL_).notApplicable).toBe(true);
    // @ts-expect-error - deliberately wrong input
    expect(lib.buildHeadSignalsProduct(undefined, rendered(html()), undefined).notApplicable).toBe(
      true
    );
  });
});

describe('buildLinksProduct', () => {
  const run = (/** @type {string[]} */ raw, /** @type {string[]} */ live) =>
    lib.buildLinksProduct(html({links: raw}), rendered(html({links: live})), URL_);
  const many = Array.from({length: 10}, (_, i) => `/p${i}`);

  it('passes when every rendered link is in the raw HTML', () => {
    expect(run(many, many).displayValue).toBe('All 10 internal links are in the raw HTML');
  });
  it('fails past 20% and at least 3 links', () => {
    const p = run(many.slice(0, 6), many);
    expect(p.score).toBe(0);
    expect(p.details.items).toHaveLength(4);
  });
  it('is a note under the share or under 3 links', () => {
    expect(run(many.slice(0, 9), many).score).toBe(1); // 10%
    expect(run(['/a', '/b'], ['/a', '/b', '/c', '/d']).score).toBe(1); // 2 links
    expect(run(many.slice(0, 9), many).details.items).toHaveLength(1);
  });
  it('is not applicable when the rendered page has no internal links', () => {
    expect(run([], []).notApplicable).toBe(true);
  });
});

describe('buildContentProduct', () => {
  const run = (/** @type {number} */ raw, /** @type {number} */ live, extra = {}) =>
    lib.buildContentProduct(
      html({text: words(raw), links: [], ...extra}),
      rendered(html({text: words(live), links: []})),
      URL_
    );

  it('passes similar text', () => {
    expect(run(200, 210).score).toBe(1);
  });
  it('fails when over half of the words appear only after JavaScript', () => {
    const p = run(20, 200);
    expect(p.score).toBe(0);
    expect(p.displayValue).toMatch(/9\d% of the words/);
  });
  it('passes at exactly half missing and reports a heading that exists only after JavaScript', () => {
    expect(run(100, 200).score).toBe(1);
    const p = run(20, 200, {h1: null});
    expect(
      p.details.items.some((/** @type {any} */ i) => /only after JavaScript: Heading/.test(i.value))
    ).toBe(true);
  });
  it('is not applicable for a short page', () => {
    expect(run(5, 10).notApplicable).toBe(true);
  });
});

describe('buildDiffProduct and buildRenderingModeProduct', () => {
  it('lists each measure and counts the differences, informational (score 1)', () => {
    const p = lib.buildDiffProduct(html(), rendered(html({title: 'New'})), URL_, null);
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('1 of 7 measures differ after JavaScript');
    expect(p.details.items[0]).toMatchObject({field: 'Title', same: 'different'});
  });
  it('notes when the crawler own copy differs from the one Chrome received', () => {
    const crawl = {
      snapshot: {
        pages: [{source: 'audited', extraction: 'ok', title: 'Bot title', wordCount: 120}],
      },
    };
    const p = lib.buildDiffProduct(html(), rendered(html()), URL_, crawl);
    expect(p.details.items[p.details.items.length - 1].field).toMatch(
      /crawler's own copy .* title/
    );
    const same = {
      snapshot: {pages: [{source: 'audited', extraction: 'ok', title: 'My title', wordCount: 125}]},
    };
    expect(lib.buildDiffProduct(html(), rendered(html()), URL_, same).details.items).toHaveLength(
      7
    );
  });
  it('classifies server-rendered, hybrid and client-rendered pages and finds framework signs', () => {
    const mode = (/** @type {number} */ raw, /** @type {string} */ shell = '') =>
      lib.buildRenderingModeProduct(
        html({text: words(raw)}) + shell,
        rendered(html({text: words(200)})),
        URL_
      );
    expect(mode(200).displayValue).toBe('server-rendered');
    expect(mode(100).displayValue).toBe('hybrid');
    const csr = mode(5, '<div id="__next"></div>');
    expect(csr.displayValue).toBe('client-rendered');
    expect(csr.details.items[3].value).toBe('Next.js');
    expect(mode(200).details.items[3].value).toBe('none found');
  });
  it('does not classify a page with too little text', () => {
    const p = lib.buildRenderingModeProduct(
      html({text: 'few'}),
      rendered(html({text: 'few'})),
      URL_
    );
    expect(p.displayValue).toBe('Too little text to classify');
  });
});

describe('buildHydrationProduct', () => {
  const msg = (/** @type {string} */ text, level = 'error') => ({text, level});
  it('fails React, Vue and Angular hydration messages and dedupes them', () => {
    const p = lib.buildHydrationProduct([
      msg('Warning: Text content does not match server-rendered HTML.'),
      msg('Warning: Text content does not match server-rendered HTML.'),
      msg('[Vue warn]: Hydration node mismatch', 'warning'),
      msg('Error: NG0500: During hydration Angular expected <div>'),
      msg('Hydration failed because the initial UI does not match'),
    ]);
    expect(p.score).toBe(0);
    expect(p.details.items).toHaveLength(4);
  });
  it('stays fast on a huge console message made of a repeated trigger word', () => {
    const start = Date.now();
    const p = lib.buildHydrationProduct([msg('hydrat'.repeat(500000))]);
    expect(p.score).toBe(1);
    expect(Date.now() - start).toBeLessThan(2500);
  });
  it('passes unrelated messages and handles odd input', () => {
    expect(lib.buildHydrationProduct([msg('Failed to load resource'), null, {text: 5}]).score).toBe(
      1
    );
    expect(lib.buildHydrationProduct([]).score).toBe(1);
    expect(lib.buildHydrationProduct(null).notApplicable).toBe(true);
  });
});

describe('buildDeviceParityProduct', () => {
  const fetched = (/** @type {string} */ h, over = {}) => ({
    status: 200,
    redirectLocation: null,
    bodyRead: 'html',
    truncated: false,
    html: h,
    error: null,
    ...over,
  });
  const art = (/** @type {any} */ mobile, /** @type {any} */ desktop, over = {}) => ({
    state: 'fetched',
    url: URL_,
    reason: null,
    mobile,
    desktop,
    ...over,
  });

  it('passes the same page', () => {
    expect(lib.buildDeviceParityProduct(art(fetched(html()), fetched(html()))).score).toBe(1);
  });
  it('fails a different title, canonical or noindex', () => {
    const p = lib.buildDeviceParityProduct(
      art(fetched(html({title: 'm.', canonical: 'https://m.example.com/page'})), fetched(html()))
    );
    expect(p.score).toBe(0);
    expect(p.details.items.map((/** @type {any} */ i) => i.signal)).toEqual(['Title', 'Canonical']);
  });
  it('fails links missing on mobile past the share, notes a small gap, ignores extra mobile links', () => {
    const many = Array.from({length: 10}, (_, i) => `/p${i}`);
    expect(
      lib.buildDeviceParityProduct(
        art(fetched(html({links: many.slice(0, 6)})), fetched(html({links: many})))
      ).score
    ).toBe(0);
    const note = lib.buildDeviceParityProduct(
      art(fetched(html({links: many.slice(0, 9)})), fetched(html({links: many})))
    );
    expect(note.score).toBe(1);
    expect(note.details.items[0].problem).toMatch(/^note:/);
    expect(
      lib.buildDeviceParityProduct(
        art(fetched(html({links: many})), fetched(html({links: many.slice(0, 5)})))
      ).score
    ).toBe(1);
  });
  it('fails when mobile has over half fewer words', () => {
    const p = lib.buildDeviceParityProduct(
      art(fetched(html({text: words(40)})), fetched(html({text: words(200)})))
    );
    expect(p.score).toBe(0);
    expect(p.details.items[0].problem).toMatch(/7\d% fewer words/);
  });
  it('is not applicable when off, failed, redirected, an error status or not HTML', () => {
    const ok = fetched(html());
    expect(
      lib.buildDeviceParityProduct(art(null, null, {state: 'disabled', reason: 'off'})).explanation
    ).toBe('off');
    expect(
      lib.buildDeviceParityProduct(art(fetched(null, {error: 'ECONNREFUSED', status: null}), ok))
        .explanation
    ).toMatch(/mobile fetch failed/);
    expect(
      lib.buildDeviceParityProduct(art(ok, fetched(null, {status: 301, redirectLocation: '/x'})))
        .explanation
    ).toMatch(/desktop fetch redirected/);
    expect(lib.buildDeviceParityProduct(art(fetched(null, {status: 503}), ok)).explanation).toMatch(
      /answered 503/
    );
    expect(
      lib.buildDeviceParityProduct(art(ok, fetched(null, {bodyRead: 'skipped-not-html'})))
        .explanation
    ).toMatch(/not HTML/);
    expect(lib.buildDeviceParityProduct(art(fetched('   '), ok)).notApplicable).toBe(true);
    expect(lib.buildDeviceParityProduct(null).notApplicable).toBe(true);
  });
});

describe('row cap', () => {
  it('shows at most 50 rows', () => {
    const links = Array.from({length: 80}, (_, i) => `/p${i}`);
    const p = lib.buildLinksProduct(html({links: []}), rendered(html({links})), URL_);
    expect(p.details.items).toHaveLength(lib.MAX_ROWS + 1);
    expect(p.details.items[lib.MAX_ROWS].url).toBe('30 more not shown');
  });
});
