/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  groupTemplates,
  patternsFor,
  templateReportProduct,
  problemsOf,
  reviveTemplates,
  MAX_TEMPLATES,
} = require('../../src/lib/templates.js');
const {page, snapshot, artifact} = require('./vertical-fixtures.js');

const S = 'https://site.example';
const healthy = (path, over = {}) =>
  page(`${S}${path}`, {
    title: `Title of ${path}`,
    description: `About ${path}`,
    canonicals: [`${S}${path}`],
    h1: [`Heading ${path}`],
    wordCount: 400,
    entities: [{type: ['Thing']}],
    ...over,
  });

describe('patternsFor', () => {
  it('finds variable parts from how much the values differ', () => {
    const urls = ['/blog/a', '/blog/b', '/blog/c', '/blog/d'].map(p => S + p);
    expect([...new Set(patternsFor(urls).values())]).toEqual(['/blog/:slug']);
  });

  it('calls a numeric variable an id', () => {
    const urls = ['/item/1', '/item/22', '/item/333'].map(p => S + p);
    expect([...patternsFor(urls).values()][0]).toBe('/item/:id');
  });

  it('keeps single pages as they are, and never makes the first part a variable', () => {
    const urls = ['/about', '/pricing', '/contact', '/team'].map(p => S + p);
    expect(new Set(patternsFor(urls).values())).toEqual(
      new Set(['/about', '/pricing', '/contact', '/team'])
    );
    expect(patternsFor([S + '/']).get(S + '/')).toBe('/');
  });

  it('keeps a fixed middle part and varies the end', () => {
    const urls = [
      '/products/shoes/a',
      '/products/shoes/b',
      '/products/shoes/c',
      '/products/boots/x',
      '/products/boots/y',
      '/products/boots/z',
    ].map(p => S + p);
    expect(new Set(patternsFor(urls).values())).toEqual(
      new Set(['/products/shoes/:slug', '/products/boots/:slug'])
    );
  });

  it('ignores the query string and a trailing slash, and survives odd addresses', () => {
    const urls = [
      `${S}/blog/a/`,
      `${S}/blog/b?x=1`,
      `${S}/blog/c#f`,
      'not a url',
      `${S}/blog/%E0%A4%A`,
    ];
    const map = patternsFor(urls);
    expect(map.get(`${S}/blog/a/`)).toBe('/blog/:slug');
    expect(map.get(`${S}/blog/b?x=1`)).toBe('/blog/:slug');
    expect(map.has('not a url')).toBe(false);
  });

  it('does not call two pages a template', () => {
    const map = patternsFor([`${S}/blog/a`, `${S}/blog/b`]);
    expect(new Set(map.values())).toEqual(new Set(['/blog/a', '/blog/b']));
  });
});

describe('groupTemplates', () => {
  const blog = ['a', 'b', 'c', 'd', 'e'].map(s => `/blog/${s}`);

  it('counts the problems of each template and calls a shared one systemic', () => {
    const pages = [
      healthy('/'),
      healthy('/about'),
      ...blog.map(p => healthy(p, {description: null})),
      ...['x', 'y', 'z'].map(s => healthy(`/shop/${s}`, {h1: []})),
    ];
    const {templates, singles, total} = groupTemplates(pages);
    expect(total).toBe(10);
    expect(singles).toBe(2);
    expect(templates.map(t => [t.pattern, t.pages])).toEqual([
      ['/blog/:slug', 5],
      ['/shop/:slug', 3],
    ]);
    expect(templates[0].problems).toEqual([
      expect.objectContaining({key: 'missingDescription', count: 5}),
    ]);
    expect(templates[0].systemic.map(p => p.key)).toEqual(['missingDescription']);
    expect(templates[1].systemic.map(p => p.key)).toEqual(['missingH1']);
  });

  it('is not systemic when only some pages have the problem', () => {
    const pages = blog.map((p, i) => healthy(p, i < 2 ? {title: ''} : {}));
    const t = groupTemplates(pages).templates[0];
    expect(t.problems.find(p => p.key === 'missingTitle').count).toBe(2);
    expect(t.systemic).toEqual([]);
  });

  it('needs three pages with the problem, even in a small template', () => {
    const pages = ['a', 'b', 'c'].map((s, i) => healthy(`/p/${s}`, i === 0 ? {title: ''} : {}));
    expect(groupTemplates(pages).templates[0].systemic).toEqual([]);
  });

  it('finds shared titles, noindex, thin pages, errors and missing structured data', () => {
    const pages = [
      healthy('/n/a', {title: 'Same', robotsMetas: [{name: 'robots', content: 'noindex, follow'}]}),
      healthy('/n/b', {title: 'same', xRobotsTag: ['noindex']}),
      healthy('/n/c', {wordCount: 20, entities: [], h1: ['a', 'b'], canonicals: []}),
      page(`${S}/n/d`, {status: 404, extraction: 'skipped-status'}),
    ];
    const keys = groupTemplates(pages).templates[0].problems.map(p => p.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'errorStatus',
        'noindex',
        'duplicateTitle',
        'multipleH1',
        'noCanonical',
        'thinContent',
        'noStructuredData',
      ])
    );
    const t = groupTemplates(pages).templates[0];
    expect(t.problems.find(p => p.key === 'noindex').count).toBe(2);
    expect(t.problems.find(p => p.key === 'duplicateTitle').count).toBe(2);
  });

  it('judges nothing but the status of a page that is not an answer, or not HTML', () => {
    expect(problemsOf(page(`${S}/x`, {status: 500}), new Map())).toEqual(['errorStatus']);
    expect(problemsOf(page(`${S}/x`, {status: null}), new Map())).toEqual(['errorStatus']);
    expect(problemsOf(page(`${S}/x`, {extraction: 'skipped-not-html'}), new Map())).toEqual([]);
  });

  it('does not call a truncated page thin', () => {
    expect(problemsOf(healthy('/t', {wordCount: 5, truncated: true}), new Map())).not.toContain(
      'thinContent'
    );
  });

  it(`reports at most ${MAX_TEMPLATES} templates, largest first, and is empty for no pages`, () => {
    const pages = Array.from({length: 30}, (_, g) =>
      ['a', 'b', 'c', ...(g < 5 ? ['d'] : [])].map(s => healthy(`/g${g}/${s}`))
    ).flat();
    const {templates} = groupTemplates(pages);
    expect(templates).toHaveLength(MAX_TEMPLATES);
    expect(templates[0].pages).toBe(4);
    expect(groupTemplates([])).toEqual({templates: [], singles: 0, total: 0});
  });

  it('keeps hostile page text out of the pattern as plain, clipped strings', () => {
    const pages = ['<script>1</script>', 'b', 'c'].map(s =>
      healthy(`/blog/${encodeURIComponent(s)}`)
    );
    const {templates} = groupTemplates(pages);
    expect(templates[0].pattern).toBe('/blog/:slug');
  });
});

describe('templateReportProduct', () => {
  it('is informational: a table, plus the groups as data, and never a failure', () => {
    const pages = ['a', 'b', 'c', 'd'].map(s => healthy(`/blog/${s}`, {description: null}));
    const product = templateReportProduct(artifact(snapshot(pages)));
    expect(product.score).toBe(1);
    expect(product.notApplicable).toBeUndefined();
    expect(product.displayValue).toBe('1 template, 1 shared problem');
    expect(product.details.items[0]).toMatchObject({pattern: '/blog/:slug', pages: '4'});
    expect(product.details.items[0].problems).toContain(
      '4 of 4 pages with no meta description (one fix in the template)'
    );
    expect(product.details.templates[0].pattern).toBe('/blog/:slug');
  });

  it('says why it cannot report when there is no crawl or no template', () => {
    expect(templateReportProduct({state: 'disabled', snapshot: null}).notApplicable).toBe(true);
    const few = templateReportProduct(artifact(snapshot([healthy('/'), healthy('/about')])));
    expect(few.notApplicable).toBe(true);
    expect(few.explanation).toContain('2 crawled pages');
  });
});

describe('reviveTemplates', () => {
  const good = {
    pattern: '/blog/:slug',
    pages: 5,
    examples: ['https://site.example/blog/a'],
    problems: [{key: 'noH1', label: 'no h1', count: 5}],
    systemic: [{key: 'noH1', label: 'no h1', count: 5}],
  };

  it('keeps well-formed templates', () => {
    expect(reviveTemplates(JSON.parse(JSON.stringify([good])))).toEqual([good]);
  });

  it('drops anything that is not the expected shape, and bounds what it keeps', () => {
    expect(reviveTemplates(null)).toEqual([]);
    expect(reviveTemplates('x')).toEqual([]);
    expect(
      reviveTemplates([null, 3, {}, {pattern: 1, pages: 2}, {pattern: '/a/:slug', pages: -1}])
    ).toEqual([]);
    const messy = reviveTemplates([
      {
        pattern: '/a/:slug',
        pages: 3,
        examples: [1, 'ok'],
        problems: [{key: 1}, {key: 'k', label: 'l', count: 'x'}, 7],
      },
    ]);
    expect(messy).toEqual([
      {pattern: '/a/:slug', pages: 3, examples: ['ok'], problems: [], systemic: []},
    ]);
    expect(reviveTemplates(Array.from({length: 100}, () => good))).toHaveLength(MAX_TEMPLATES);
    expect(
      reviveTemplates([{...good, pattern: 'x'.repeat(5000)}])[0].pattern.length
    ).toBeLessThanOrEqual(210);
  });
});
