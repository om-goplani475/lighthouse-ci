/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure logic for the four news audits: `article-values` (the audited page's Article, NewsArticle or BlogPosting markup)
 * and `news-sitemap-valid`, `news-sitemap-freshness`, `news-sitemap-report` (the Google News sitemap among the sitemaps the
 * gatherer read). No I/O, never throws.
 *
 * Sources (Google documentation, read 2026-10-06): article markup has no required properties; dates are ISO 8601 and a
 * timezone is recommended; `author.name` holds only the name (no "posted by", no job title), authors are listed one each,
 * `Person` or `Organization`, never `Thing`; headlines: "consider a concise title, as long titles may be truncated" (no limit
 * is given, so 110 characters is our own note); paywalled content uses `isAccessibleForFree: false` with a `hasPart` that has a
 * `.class` `cssSelector`. News sitemap: the news namespace; required `news:publication` (`name`, `language`),
 * `news:publication_date`, `news:title`; at most 1,000 `news:news` per sitemap; only articles of the last two days.
 */

import {clip, count, notApplicable, table, unreadSitemapsNote} from './vertical-common.js';
import {ARTICLE_TYPES} from './structured-facts.js';

/** @typedef {import('./structured-facts.js').Entity} Entity */
/** @typedef {import('./sitemap-parse.js').SitemapDocumentsArtifact} SitemapDocumentsArtifact */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {{article: string, check: string, detail: string, severity: 'problem' | 'note'}} Finding */

const LONG_HEADLINE = 110;
const MAX_NEWS_ENTRIES = 1000;
// A news sitemap with fewer than this share of old entries is not warned about (our threshold).
const STALE_SHARE = 0.1;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * @param {string} value
 * @return {{ok: boolean, ms: number, hasTime: boolean, hasZone: boolean}} Whether it is an ISO 8601 date or date-time (a real calendar date), and when.
 */
function parseIsoDate(value) {
  const m = ISO_DATE.exec(value.trim());
  const bad = {ok: false, ms: NaN, hasTime: false, hasZone: false};
  if (!m) return bad;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return bad;
  const hasTime = m[4] !== undefined;
  if (
    hasTime &&
    (Number(m[4]) > 23 || Number(m[5]) > 59 || (m[6] !== undefined && Number(m[6]) > 59))
  ) {
    return bad;
  }
  const zone = m[7];
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}${
    zone
      ? zone === 'Z'
        ? 'Z'
        : zone.length === 5
        ? `${zone.slice(0, 3)}:${zone.slice(3)}`
        : zone
      : 'Z'
  }`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? bad : {ok: true, ms, hasTime, hasZone: zone !== undefined};
}

/** @param {Entity} e @return {string} */
function label(e) {
  return clip((e.article && e.article.headline) || e.name || e.id || e.types[0] || 'Article');
}

// ---------------------------------------------------------------- article-values

/**
 * @param {Entity[]} entities
 * @param {number} [now]
 * @return {{articles: number, findings: Finding[]}}
 */
function evaluateArticles(entities, now = Date.now()) {
  const articles = entities.filter(e => e.article && e.types.some(t => ARTICLE_TYPES.has(t)));
  /** @type {Finding[]} */
  const findings = [];
  for (const e of articles) {
    const a = /** @type {NonNullable<Entity['article']>} */ (e.article);
    const name = label(e);
    /** @param {'problem' | 'note'} severity @param {string} check @param {string} detail */
    const add = (severity, check, detail) =>
      findings.push({article: name, check, detail, severity});

    if (!a.headline) add('note', 'headline', 'No headline.');
    else if (a.headline.length > LONG_HEADLINE) {
      add(
        'note',
        'headline',
        `The headline is ${a.headline.length} characters. Google gives no limit but says long titles may be truncated (our note starts at ${LONG_HEADLINE}).`
      );
    }
    if (!a.hasImage) {
      add(
        'note',
        'image',
        'No image. Google recommends one or more crawlable, high-resolution images.'
      );
    }

    const published = a.datePublished ? parseIsoDate(a.datePublished) : null;
    const modified = a.dateModified ? parseIsoDate(a.dateModified) : null;
    for (const [
      field,
      value,
      parsed,
    ] of /** @type {Array<[string, string | null, ReturnType<typeof parseIsoDate> | null]>} */ ([
      ['datePublished', a.datePublished, published],
      ['dateModified', a.dateModified, modified],
    ])) {
      if (!value || !parsed) continue;
      if (!parsed.ok) {
        add(
          'problem',
          field,
          `${field} "${clip(
            value
          )}" is not an ISO 8601 date (for example 2026-10-06T08:00:00+00:00).`
        );
      } else if (parsed.hasTime && !parsed.hasZone) {
        add(
          'note',
          field,
          `${field} "${clip(value)}" has no timezone. Without one Google assumes Googlebot's.`
        );
      }
    }
    if (published && modified && published.ok && modified.ok && modified.ms < published.ms) {
      add('problem', 'dateModified', 'dateModified is before datePublished.');
    }
    if (published && published.ok && published.ms > now + DAY_MS) {
      add('note', 'datePublished', 'datePublished is more than a day in the future.');
    }
    if (!a.datePublished) add('note', 'datePublished', 'No datePublished.');

    if (a.authors.length === 0) {
      add('note', 'author', 'No author. Google recommends one, with a link that identifies them.');
    }
    for (const au of a.authors) {
      if (!au.name) {
        add('problem', 'author', 'An author has no name.');
        continue;
      }
      if (/^\s*(posted\s+by|written\s+by|by|author:)\s/i.test(au.name)) {
        add(
          'problem',
          'author',
          `author name "${clip(au.name)}" has an introductory word; put only the name.`
        );
      } else if (/\s(and|&)\s|,/.test(au.name)) {
        add(
          'note',
          'author',
          `author name "${clip(au.name)}" may combine several people; list each author separately.`
        );
      }
      if (au.type === null) {
        add('note', 'author', `author "${clip(au.name)}" has no type; use Person or Organization.`);
      } else if (au.type !== 'Person' && au.type !== 'Organization') {
        add(
          'problem',
          'author',
          `author "${clip(au.name)}" has type ${clip(
            au.type
          )}; Google asks for Person or Organization.`
        );
      }
      if (!au.url && !au.hasSameAs) {
        add(
          'note',
          'author',
          `author "${clip(au.name)}" has no url or sameAs that identifies them.`
        );
      }
    }

    const free = a.isAccessibleForFree;
    if (free !== null && !/^(true|false)$/i.test(free)) {
      add(
        'problem',
        'isAccessibleForFree',
        `isAccessibleForFree "${clip(free)}" is not true or false.`
      );
    }
    if (free !== null && /^false$/i.test(free) && a.paywallParts.length === 0) {
      add(
        'problem',
        'hasPart',
        'The article says it is not free but marks no paywalled part: add a hasPart with isAccessibleForFree false and a .class cssSelector.'
      );
    }
    for (const part of a.paywallParts) {
      if (!part.cssSelector) add('problem', 'hasPart', 'A paywalled part has no cssSelector.');
      else if (!/^\.[A-Za-z_][\w-]*$/.test(part.cssSelector)) {
        add(
          'problem',
          'hasPart',
          `cssSelector "${clip(
            part.cssSelector
          )}" is not a single .class selector, the only form Google accepts.`
        );
      }
      if (part.isAccessibleForFree === null || !/^false$/i.test(part.isAccessibleForFree)) {
        add('problem', 'hasPart', 'A paywalled part must have isAccessibleForFree set to false.');
      }
    }
  }
  return {articles: articles.length, findings};
}

/** @param {Entity[]} entities @param {number} [now] @return {Product} */
function articleValuesProduct(entities, now = Date.now()) {
  const {articles, findings} = evaluateArticles(entities, now);
  if (articles === 0) {
    return notApplicable('The page has no Article, NewsArticle or BlogPosting markup.');
  }
  const problems = findings.filter(f => f.severity === 'problem');
  const rows = findings.map(f => ({
    article: f.article,
    check: f.check,
    detail: f.severity === 'note' ? `Note: ${f.detail}` : f.detail,
  }));
  const columns = [
    {key: 'article', heading: 'Article'},
    {key: 'check', heading: 'Field'},
    {key: 'detail', heading: 'Finding'},
  ];
  if (problems.length === 0) {
    return {
      score: 1,
      displayValue: `${count(articles, 'article')} checked`,
      ...(rows.length && {details: table(columns, rows)}),
    };
  }
  return {
    score: 0.5,
    displayValue: count(problems.length, 'value problem'),
    explanation: problems
      .slice(0, 5)
      .map(f => `${f.article}: ${f.detail}`)
      .join(' '),
    details: table(columns, rows),
  };
}

// ---------------------------------------------------------------- news sitemap

/** @param {SitemapDocumentsArtifact | null | undefined} sitemaps @return {string} */
function noNewsSitemap(sitemaps) {
  return `No Google News sitemap (news:news entries) was found among the sitemaps read.${unreadSitemapsNote(
    sitemaps
  )}`;
}

/**
 * @param {SitemapDocumentsArtifact | null | undefined} sitemaps
 * @return {Array<{url: string, entries: NonNullable<import('./sitemap-parse.js').SitemapDocument['news']>, truncated: boolean}>} The sitemaps that carry news entries.
 */
function newsDocuments(sitemaps) {
  return ((sitemaps && sitemaps.documents) || [])
    .filter(d => d.outcome === 'ok' && (d.news || []).length > 0)
    .map(d => ({url: d.url, entries: d.news || [], truncated: !!d.newsTruncated}));
}

/** @param {string} lang @return {boolean} A bare two- or three-letter ISO 639 code, or the two Chinese forms Google names. */
function languageOk(lang) {
  return /^[a-z]{2,3}$/i.test(lang) || /^zh-(cn|tw)$/i.test(lang);
}

/** @param {string} lang @return {boolean} A language tag with a region or script (en-US, pt_BR): well formed, but not the bare code Google asks for. */
function languageWithRegion(lang) {
  return /^[a-z]{2,3}[-_][A-Za-z0-9]{2,8}$/i.test(lang) && !languageOk(lang);
}

/**
 * @param {SitemapDocumentsArtifact | null | undefined} sitemaps
 * @return {{documents: number, entries: number, problems: Array<{loc: string, check: string, detail: string}>, notes: Array<{loc: string, check: string, detail: string}>}}
 */
function evaluateNewsSitemap(sitemaps) {
  const docs = newsDocuments(sitemaps);
  /** @type {Array<{loc: string, check: string, detail: string}>} */
  const problems = [];
  /** @type {Array<{loc: string, check: string, detail: string}>} */
  const notes = [];
  let entries = 0;
  for (const d of docs) {
    entries += d.entries.length;
    if (d.entries.length > MAX_NEWS_ENTRIES || d.truncated) {
      problems.push({
        loc: d.url,
        check: 'size',
        detail: `The sitemap has more than ${MAX_NEWS_ENTRIES} news entries; Google allows ${MAX_NEWS_ENTRIES} per sitemap.`,
      });
    }
    for (const e of d.entries.slice(0, MAX_NEWS_ENTRIES)) {
      const loc = clip(e.loc || d.url);
      if (!e.publicationName) {
        problems.push({
          loc,
          check: 'news:name',
          detail:
            'No news:publication/news:name (the publication name as it appears on Google News).',
        });
      }
      if (!e.language) {
        problems.push({loc, check: 'news:language', detail: 'No news:publication/news:language.'});
      } else if (languageWithRegion(e.language)) {
        notes.push({
          loc,
          check: 'news:language',
          detail: `news:language "${clip(
            e.language
          )}" is a language-region tag. Google's documentation asks for the bare two- or three-letter code (for example "en"); large publishers use a region form and the documentation does not call it invalid, so this is only a note.`,
        });
      } else if (!languageOk(e.language)) {
        problems.push({
          loc,
          check: 'news:language',
          detail: `news:language "${clip(
            e.language
          )}" is not a two- or three-letter ISO 639 code (zh-cn and zh-tw for Chinese).`,
        });
      }
      if (!e.publicationDate) {
        problems.push({loc, check: 'news:publication_date', detail: 'No news:publication_date.'});
      } else if (!parseIsoDate(e.publicationDate).ok) {
        problems.push({
          loc,
          check: 'news:publication_date',
          detail: `news:publication_date "${clip(
            e.publicationDate
          )}" is not in an accepted form (YYYY-MM-DD, or with a time and timezone).`,
        });
      }
      if (!e.title) {
        problems.push({loc, check: 'news:title', detail: 'No news:title (the article headline).'});
      } else if (
        e.publicationName &&
        e.title.toLowerCase().includes(e.publicationName.toLowerCase())
      ) {
        notes.push({
          loc,
          check: 'news:title',
          detail: 'The title contains the publication name; Google asks for the headline only.',
        });
      }
    }
  }
  return {documents: docs.length, entries, problems, notes};
}

/** @param {SitemapDocumentsArtifact | null | undefined} sitemaps @return {Product} */
function newsSitemapValidProduct(sitemaps) {
  const {documents, entries, problems, notes} = evaluateNewsSitemap(sitemaps);
  if (documents === 0) {
    return notApplicable(noNewsSitemap(sitemaps));
  }
  const columns = [
    {key: 'loc', heading: 'Entry'},
    {key: 'check', heading: 'Tag'},
    {key: 'detail', heading: 'Finding'},
  ];
  const rows = [...problems, ...notes.map(n => ({...n, detail: `Note: ${n.detail}`}))];
  if (problems.length === 0) {
    return {
      score: 1,
      displayValue: `${count(entries, 'news entry')} checked`,
      ...(rows.length && {details: table(columns, rows)}),
    };
  }
  return {
    score: 0,
    displayValue: count(problems.length, 'problem'),
    explanation: problems
      .slice(0, 3)
      .map(p => p.detail)
      .join(' '),
    details: table(columns, rows),
  };
}

/**
 * @param {SitemapDocumentsArtifact | null | undefined} sitemaps
 * @param {number} [now]
 * @return {Product}
 */
function newsSitemapFreshnessProduct(sitemaps, now = Date.now()) {
  const docs = newsDocuments(sitemaps);
  if (docs.length === 0) {
    return notApplicable(noNewsSitemap(sitemaps));
  }
  const dated = docs
    .flatMap(d => d.entries)
    .map(e => ({e, parsed: e.publicationDate ? parseIsoDate(e.publicationDate) : null}))
    .filter(x => x.parsed && x.parsed.ok);
  if (dated.length === 0) return notApplicable('No news entry has a readable publication date.');
  const stale = dated.filter(x => now - /** @type {{ms: number}} */ (x.parsed).ms > TWO_DAYS_MS);
  if (stale.length === 0) {
    return {score: 1, displayValue: `${count(dated.length, 'entry')} within two days`};
  }
  // One late entry among hundreds is not a sitemap that lists old articles: warn from a tenth of the entries (our threshold).
  if (stale.length / dated.length < STALE_SHARE) {
    return {
      score: 1,
      displayValue: `${stale.length} of ${dated.length} entries older than two days (under ${
        STALE_SHARE * 100
      }%, not judged)`,
      details: table(
        [
          {key: 'loc', heading: 'Entry'},
          {key: 'date', heading: 'Published'},
        ],
        stale.map(x => ({loc: clip(x.e.loc || ''), date: clip(x.e.publicationDate || '')}))
      ),
    };
  }
  const oldest = Math.min(...stale.map(x => /** @type {{ms: number}} */ (x.parsed).ms));
  return {
    score: 0.5,
    displayValue: `${stale.length} of ${dated.length} entries older than two days`,
    explanation: `Google asks the news sitemap to list only articles from the last two days; remove older entries or strip their news tags. The oldest entry is from ${new Date(
      oldest
    )
      .toISOString()
      .slice(0, 10)}.`,
    details: table(
      [
        {key: 'loc', heading: 'Entry'},
        {key: 'date', heading: 'Published'},
      ],
      stale
        .sort(
          (a, b) =>
            /** @type {{ms: number}} */ (a.parsed).ms - /** @type {{ms: number}} */ (b.parsed).ms
        )
        .map(x => ({loc: clip(x.e.loc || ''), date: clip(x.e.publicationDate || '')}))
    ),
  };
}

/** @param {SitemapDocumentsArtifact | null | undefined} sitemaps @return {Product} */
function newsSitemapReportProduct(sitemaps) {
  const docs = newsDocuments(sitemaps);
  if (docs.length === 0) {
    return notApplicable(noNewsSitemap(sitemaps));
  }
  const entries = docs.flatMap(d => d.entries);
  const dates = entries
    .map(e => (e.publicationDate ? parseIsoDate(e.publicationDate) : null))
    .filter(d => d && d.ok)
    .map(d => /** @type {{ms: number}} */ (d).ms);
  const languages = [...new Set(entries.map(e => e.language).filter(Boolean))].slice(0, 5);
  const publications = [...new Set(entries.map(e => e.publicationName).filter(Boolean))].slice(
    0,
    5
  );
  const day = (/** @type {number} */ ms) => new Date(ms).toISOString().slice(0, 10);
  return {
    score: 1,
    displayValue: `${count(entries.length, 'news entry')} in ${count(docs.length, 'sitemap')}`,
    details: table(
      [
        {key: 'item', heading: 'Item'},
        {key: 'value', heading: 'Value'},
      ],
      [
        {
          item: 'News sitemaps',
          value: docs
            .map(d => d.url)
            .slice(0, 3)
            .join(', '),
        },
        {item: 'Entries', value: String(entries.length)},
        {item: 'Publications', value: publications.join(', ') || '(none)'},
        {item: 'Languages', value: languages.join(', ') || '(none)'},
        {item: 'Newest', value: dates.length ? day(Math.max(...dates)) : '(no readable date)'},
        {item: 'Oldest', value: dates.length ? day(Math.min(...dates)) : '(no readable date)'},
      ].map(r => ({item: r.item, value: clip(r.value)}))
    ),
  };
}

export {
  parseIsoDate,
  evaluateArticles,
  articleValuesProduct,
  evaluateNewsSitemap,
  newsSitemapValidProduct,
  newsSitemapFreshnessProduct,
  newsSitemapReportProduct,
  newsDocuments,
  languageOk,
  languageWithRegion,
};
