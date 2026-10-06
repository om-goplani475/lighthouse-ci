/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {parseIsoDate} = require('../../src/lib/vertical-common.js');
const {
  evaluateArticles,
  articleValuesProduct,
  evaluateNewsSitemap,
  newsSitemapValidProduct,
  newsSitemapFreshnessProduct,
  newsSitemapReportProduct,
  languageOk,
  languageWithRegion,
} = require('../../src/lib/news.js');
const {ents} = require('./vertical-fixtures.js');

const NOW = Date.parse('2026-10-06T12:00:00Z');
const article = (over = {}) => ({
  '@type': 'NewsArticle',
  headline: 'Big story',
  datePublished: '2026-10-06T08:00:00+00:00',
  dateModified: '2026-10-06T09:00:00+00:00',
  author: {'@type': 'Person', name: 'Ann Lee', url: 'https://x.example/ann'},
  image: ['https://x.example/a.jpg'],
  ...over,
});
const problems = (over, now = NOW) =>
  evaluateArticles(ents(article(over)), now)
    .findings.filter(f => f.severity === 'problem')
    .map(f => `${f.check}: ${f.detail}`);
const notes = (over, now = NOW) =>
  evaluateArticles(ents(article(over)), now)
    .findings.filter(f => f.severity === 'note')
    .map(f => `${f.check}: ${f.detail}`);

describe('parseIsoDate', () => {
  it('accepts the forms Google lists, with or without a time and timezone', () => {
    for (const v of [
      '2026-10-06',
      '2026-10-06T08:00',
      '2026-10-06T08:00:00',
      '2026-10-06T08:00:00.5Z',
      '2026-10-06T08:00:00+01:00',
      '2026-10-06T08:00:00-0500',
      '2026-10-06 08:00:00Z',
    ]) {
      expect(parseIsoDate(v).ok).toBe(true);
    }
    expect(parseIsoDate('2026-10-06T08:00:00+01:00').ms).toBe(Date.parse('2026-10-06T07:00:00Z'));
    expect(parseIsoDate('2026-10-06T08:00:00-0500').ms).toBe(Date.parse('2026-10-06T13:00:00Z'));
    expect(parseIsoDate('2026-10-06')).toMatchObject({hasTime: false, hasZone: false});
    expect(parseIsoDate('2026-10-06T08:00')).toMatchObject({hasTime: true, hasZone: false});
  });

  it('rejects other forms and impossible dates', () => {
    for (const v of [
      '6 Oct 2026',
      '10/06/2026',
      '2026-13-01',
      '2026-02-30',
      '2026-10-06T25:00:00',
      '2026-10-06T08:61',
      'yesterday',
      '',
      '2026-10-6',
    ]) {
      expect(parseIsoDate(v).ok).toBe(false);
    }
    expect(parseIsoDate('2024-02-29').ok).toBe(true);
    expect(parseIsoDate('2026-02-29').ok).toBe(false);
  });
});

describe('article-values', () => {
  it('is not applicable without an article, and passes a complete one', () => {
    expect(
      articleValuesProduct(ents({'@type': 'Organization', name: 'x'}), NOW).notApplicable
    ).toBe(true);
    expect(articleValuesProduct([], NOW).notApplicable).toBe(true);
    const ok = articleValuesProduct(ents(article()), NOW);
    expect(ok.score).toBe(1);
    expect(ok.displayValue).toBe('1 article checked');
  });

  it('covers the whole article family', () => {
    for (const type of ['Article', 'BlogPosting', 'NewsArticle', 'OpinionNewsArticle']) {
      expect(evaluateArticles(ents(article({'@type': type})), NOW).articles).toBe(1);
    }
  });

  it('flags dates that are not ISO 8601, and a modification before the publication', () => {
    expect(problems({datePublished: '6 October 2026'})[0]).toMatch(
      /datePublished "6 October 2026" is not an ISO 8601/
    );
    expect(problems({dateModified: '2026-13-45'})[0]).toMatch(/dateModified/);
    expect(problems({dateModified: '2026-10-05T08:00:00+00:00'})).toEqual([
      'dateModified: dateModified is before datePublished.',
    ]);
    expect(problems({dateModified: '2026-10-06T08:00:00+00:00'})).toEqual([]);
  });

  it('only notes a missing timezone, a missing date, a date far in the future, and a long headline', () => {
    expect(
      notes({datePublished: '2026-10-06T08:00:00', dateModified: undefined}).join(' ')
    ).toMatch(/no timezone/);
    expect(notes({datePublished: '2026-10-06'}).join(' ')).not.toMatch(/timezone/);
    expect(notes({datePublished: undefined, dateModified: undefined}).join(' ')).toMatch(
      /No datePublished/
    );
    expect(
      notes({datePublished: '2026-12-06T08:00:00Z', dateModified: undefined}).join(' ')
    ).toMatch(/more than a day in the future/);
    expect(notes({headline: 'x'.repeat(150)}).join(' ')).toMatch(/150 characters.*no limit/);
    expect(notes({headline: undefined}).join(' ')).toMatch(/No headline/);
    expect(notes({image: undefined}).join(' ')).toMatch(/No image/);
    expect(articleValuesProduct(ents(article({headline: 'x'.repeat(150)})), NOW).score).toBe(1);
  });

  it('judges authors: name only, one per author, Person or Organization, identifiable', () => {
    expect(problems({author: {'@type': 'Person'}})[0]).toMatch(/has no name/);
    expect(problems({author: {'@type': 'Person', name: 'By Ann Lee'}})[0]).toMatch(
      /introductory word/
    );
    expect(problems({author: {'@type': 'Person', name: 'Posted by Ann Lee'}})[0]).toMatch(
      /introductory word/
    );
    expect(
      problems({author: {'@type': 'Thing', name: 'Ann Lee', url: 'https://x.example/a'}})[0]
    ).toMatch(/Person or Organization/);
    expect(
      notes({
        author: {'@type': 'Person', name: 'Ann Lee and Bob Roe', url: 'https://x.example/a'},
      }).join(' ')
    ).toMatch(/several people/);
    expect(notes({author: 'Ann Lee'}).join(' ')).toMatch(/no type/);
    expect(notes({author: {'@type': 'Person', name: 'Ann Lee'}}).join(' ')).toMatch(
      /no url or sameAs/
    );
    expect(
      notes({author: {'@type': 'Person', name: 'Ann Lee', sameAs: ['https://x.example/ann']}}).join(
        ' '
      )
    ).not.toMatch(/no url or sameAs/);
    expect(notes({author: undefined}).join(' ')).toMatch(/No author/);
    expect(
      problems({
        author: [
          {'@type': 'Person', name: 'Ann Lee', url: 'https://x.example/a'},
          {'@type': 'Organization', name: 'Desk', url: 'https://x.example/d'},
        ],
      })
    ).toEqual([]);
  });

  it('judges paywall markup: a boolean, a hasPart with a .class selector set to false', () => {
    expect(problems({isAccessibleForFree: 'maybe'})[0]).toMatch(/not true or false/);
    expect(problems({isAccessibleForFree: false})[0]).toMatch(/marks no paywalled part/);
    expect(
      problems({
        isAccessibleForFree: false,
        hasPart: [{'@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: '.paywall'}],
      })
    ).toEqual([]);
    expect(
      problems({
        isAccessibleForFree: 'False',
        hasPart: {'@type': 'WebPageElement', isAccessibleForFree: 'False', cssSelector: '.paywall'},
      })
    ).toEqual([]);
    expect(
      problems({
        isAccessibleForFree: false,
        hasPart: [{isAccessibleForFree: false, cssSelector: '#paywall'}],
      })[0]
    ).toMatch(/single .class selector/);
    expect(
      problems({
        isAccessibleForFree: false,
        hasPart: [{isAccessibleForFree: false, cssSelector: 'div .paywall'}],
      })[0]
    ).toMatch(/single .class selector/);
    expect(
      problems({isAccessibleForFree: false, hasPart: [{isAccessibleForFree: false}]})[0]
    ).toMatch(/no cssSelector/);
    expect(
      problems({
        isAccessibleForFree: false,
        hasPart: [{isAccessibleForFree: true, cssSelector: '.p'}],
      })[0]
    ).toMatch(/set to false/);
    expect(problems({isAccessibleForFree: true})).toEqual([]);
  });

  it('warns (a partial score) with a table for a problem, and lists notes without scoring them', () => {
    const r = articleValuesProduct(
      ents(article({author: {'@type': 'Thing', name: 'Ann', url: 'https://x.example/a'}})),
      NOW
    );
    expect(r.score).toBe(0.5);
    expect(r.displayValue).toBe('1 value problem');
    expect(r.details.items[0]).toMatchObject({article: 'Big story', check: 'author'});
  });
});

// ---- news sitemap

const sm = (entries, over = {}) => ({
  discovery: 'robots-txt',
  unavailableReason: null,
  ignoredSitemapLines: [],
  documentsTruncated: false,
  documents: [
    {
      url: 'https://news.example/news-sitemap.xml',
      outcome: 'ok',
      kind: 'urlset',
      locs: [],
      entryCount: entries.length,
      entriesTruncated: false,
      news: entries,
      newsTruncated: false,
      ...over,
    },
  ],
});
const entry = (over = {}) => ({
  loc: 'https://news.example/a',
  publicationName: 'The Times',
  language: 'en',
  publicationDate: '2026-10-06T08:00:00+00:00',
  title: 'Big story',
  ...over,
});

describe('news-sitemap-valid', () => {
  it('is not applicable without a news sitemap', () => {
    expect(newsSitemapValidProduct(null).notApplicable).toBe(true);
    expect(
      newsSitemapValidProduct({documents: [{outcome: 'ok', news: [], locs: []}]}).notApplicable
    ).toBe(true);
    expect(
      newsSitemapValidProduct({documents: [{outcome: 'http-error', news: [entry()], locs: []}]})
        .notApplicable
    ).toBe(true);
  });

  it('passes a complete entry', () => {
    expect(newsSitemapValidProduct(sm([entry()])).score).toBe(1);
  });

  it('fails (an error-tier defect) for each missing required tag', () => {
    const run = over => evaluateNewsSitemap(sm([entry(over)])).problems.map(p => p.check);
    expect(run({publicationName: null})).toEqual(['news:name']);
    expect(run({language: null})).toEqual(['news:language']);
    expect(run({publicationDate: null})).toEqual(['news:publication_date']);
    expect(run({title: null})).toEqual(['news:title']);
    expect(newsSitemapValidProduct(sm([entry({title: null})])).score).toBe(0);
  });

  it('checks the language code and the date form', () => {
    for (const ok of ['en', 'eng', 'zh-cn', 'zh-TW', 'fr']) expect(languageOk(ok)).toBe(true);
    for (const bad of ['english', 'e', 'en-US', '']) expect(languageOk(bad)).toBe(false);
    expect(languageWithRegion('en-US')).toBe(true);
    expect(languageWithRegion('pt_BR')).toBe(true);
    expect(languageWithRegion('zh-cn')).toBe(false);
    expect(languageWithRegion('english')).toBe(false);
    expect(evaluateNewsSitemap(sm([entry({language: 'english'})])).problems[0].detail).toMatch(
      /ISO 639/
    );
    expect(
      evaluateNewsSitemap(sm([entry({publicationDate: '6 Oct 2026'})])).problems[0].detail
    ).toMatch(/accepted form/);
    expect(evaluateNewsSitemap(sm([entry({publicationDate: '2026-10-06'})])).problems).toEqual([]);
  });

  it('only notes a language-region tag such as en-US, which a major publisher uses (it is not an error)', () => {
    const r = evaluateNewsSitemap(sm([entry({language: 'en-US'})]));
    expect(r.problems).toEqual([]);
    expect(r.notes[0].detail).toMatch(/language-region tag/);
    const product = newsSitemapValidProduct(sm([entry({language: 'en-US'})]));
    expect(product.score).toBe(1);
    expect(product.details.items[0].detail).toMatch(/^Note: /);
  });

  it('fails above 1,000 entries, and notes a title that contains the publication name', () => {
    const many = Array.from({length: 1001}, (_, i) => entry({loc: `https://news.example/${i}`}));
    expect(evaluateNewsSitemap(sm(many)).problems.map(p => p.check)).toEqual(['size']);
    expect(evaluateNewsSitemap(sm([entry()], {newsTruncated: true})).problems[0].check).toBe(
      'size'
    );
    const note = newsSitemapValidProduct(sm([entry({title: 'Big story - The Times'})]));
    expect(note.score).toBe(1);
    expect(note.details.items[0].detail).toMatch(/^Note: The title contains the publication name/);
  });

  it('reports one row per problem, with the entry address', () => {
    const r = newsSitemapValidProduct(
      sm([entry({title: null}), entry({loc: 'https://news.example/b', language: null})])
    );
    expect(r.details.items.map(i => [i.loc, i.check])).toEqual([
      ['https://news.example/a', 'news:title'],
      ['https://news.example/b', 'news:language'],
    ]);
  });
});

describe('news-sitemap-freshness', () => {
  it('is not applicable without a news sitemap or any readable date', () => {
    expect(newsSitemapFreshnessProduct(null, NOW).notApplicable).toBe(true);
    expect(
      newsSitemapFreshnessProduct(
        sm([entry({publicationDate: null}), entry({publicationDate: 'junk'})]),
        NOW
      ).notApplicable
    ).toBe(true);
  });

  it('passes entries from the last two days, and warns for older ones', () => {
    expect(
      newsSitemapFreshnessProduct(sm([entry({publicationDate: '2026-10-05T13:00:00Z'})]), NOW).score
    ).toBe(1);
    const old = newsSitemapFreshnessProduct(
      sm([
        entry({publicationDate: '2026-10-05T13:00:00Z'}),
        entry({loc: 'https://news.example/old', publicationDate: '2026-09-30T08:00:00Z'}),
      ]),
      NOW
    );
    expect(old.score).toBe(0.5);
    expect(old.displayValue).toBe('1 of 2 entries older than two days');
    expect(old.explanation).toMatch(/oldest entry is from 2026-09-30/);
    expect(old.details.items.map(i => i.loc)).toEqual(['https://news.example/old']);
  });

  it('does not warn about a single late entry among many (under a tenth), but still lists it', () => {
    const entries = Array.from({length: 19}, (_, i) =>
      entry({loc: `https://news.example/${i}`, publicationDate: '2026-10-06T08:00:00Z'})
    );
    entries.push(entry({loc: 'https://news.example/old', publicationDate: '2026-09-20T08:00:00Z'}));
    const r = newsSitemapFreshnessProduct(sm(entries), NOW);
    expect(r.score).toBe(1);
    expect(r.displayValue).toMatch(/1 of 20 entries older than two days \(under 10%, not judged\)/);
    expect(r.details.items.map(i => i.loc)).toEqual(['https://news.example/old']);
    // two of twenty is exactly a tenth: judged
    entries.splice(0, 1);
    entries.push(
      entry({loc: 'https://news.example/old2', publicationDate: '2026-09-21T08:00:00Z'})
    );
    expect(newsSitemapFreshnessProduct(sm(entries), NOW).score).toBe(0.5);
  });

  it('treats exactly two days as fresh', () => {
    expect(
      newsSitemapFreshnessProduct(sm([entry({publicationDate: '2026-10-04T12:00:00Z'})]), NOW).score
    ).toBe(1);
    expect(
      newsSitemapFreshnessProduct(sm([entry({publicationDate: '2026-10-04T11:59:00Z'})]), NOW).score
    ).toBe(0.5);
  });
});

describe('news-sitemap-report', () => {
  it('summarises the news entries', () => {
    const r = newsSitemapReportProduct(
      sm([
        entry(),
        entry({publicationName: 'Other', language: 'fr', publicationDate: '2026-10-04'}),
      ])
    );
    expect(r.score).toBe(1);
    expect(r.displayValue).toBe('2 news entries in 1 sitemap');
    const rows = Object.fromEntries(r.details.items.map(i => [i.item, i.value]));
    expect(rows).toMatchObject({
      Entries: '2',
      Publications: 'The Times, Other',
      Languages: 'en, fr',
      Newest: '2026-10-06',
      Oldest: '2026-10-04',
    });
    expect(newsSitemapReportProduct(null).notApplicable).toBe(true);
  });

  it('survives an entry with nothing readable', () => {
    const r = newsSitemapReportProduct(
      sm([{loc: null, publicationName: null, language: null, publicationDate: 'junk', title: null}])
    );
    expect(r.details.items.find(i => i.item === 'Newest').value).toBe('(no readable date)');
  });
});

describe('when the news sitemap may be behind an unread file', () => {
  it('does not claim there is none', () => {
    const unread = {
      discovery: 'robots-txt',
      documentsTruncated: false,
      documents: [{url: 'http://news.example/news.xml', outcome: 'redirect', news: [], locs: []}],
    };
    for (const product of [
      newsSitemapValidProduct(unread),
      newsSitemapFreshnessProduct(unread, NOW),
      newsSitemapReportProduct(unread),
    ]) {
      expect(product.notApplicable).toBe(true);
      expect(product.explanation).toMatch(
        /1 sitemap file could not be read \(1 answered with a redirect/
      );
    }
  });
});
