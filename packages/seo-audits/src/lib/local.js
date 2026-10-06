/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure logic for the five local-business audits (`local-business-values`, `local-nap-consistency`,
 * `local-name-consistency`, `local-pages-report`, `local-pages-in-sitemap`). The first judges the audited page's own
 * `LocalBusiness` markup; the others read the entities the site crawl recorded for every crawled page. No I/O, never throws.
 *
 * Sources: Google's local business documentation (read 2026-10-06): telephone with country and area code, opening hours as
 * `hh:mm` with the weekday names, geo coordinates with at least five decimals, `priceRange` under 100 characters, and a full
 * `PostalAddress`. Consistency of name, address and phone across pages is our judgement (the standard local-SEO practice).
 *
 * All of them are advice (a partial score, the warn tier). A site with several locations is expected to show different
 * addresses and phones for different locations, so a conflict is only reported when the same business is identified by its
 * `@id`, or when two pages agree on one of phone and address and disagree on the other.
 */

import {isLocalBusiness} from './structured-facts.js';
import {
  clip,
  count,
  notApplicable,
  table,
  usableSnapshot,
  auditedPageProblem,
  sitemapCoverageProduct,
  isIndexablePage,
  normalizeName,
} from './vertical-common.js';

/** @typedef {import('./structured-facts.js').Entity} Entity */
/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {{business: string, check: string, detail: string, severity: 'problem' | 'note'}} Finding */

const DAYS = new Set([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'PublicHolidays',
]);
const DAY_ABBREVIATIONS = new Set(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** @param {string} value @return {string} */
function dayToken(value) {
  return value
    .trim()
    .replace(/^https?:\/\/schema\.org\//i, '')
    .replace(/^schema:/i, '');
}

/** @param {Entity} e @return {string} */
function label(e) {
  return clip(e.name || e.id || e.types[0] || 'Business');
}

/** @param {string} text @return {number} The number of digits after the decimal point. */
function decimals(text) {
  const m = /\.(\d+)$/.exec(text.trim());
  return m ? m[1].length : 0;
}

/**
 * @param {string} spec One `openingHours` string such as `Mo-Fr 09:00-17:00` or `Mo,We 09:00-12:00`.
 * @return {boolean}
 */
function openingHoursStringOk(spec) {
  const m = /^([A-Za-z,\- ]+?)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(spec.trim());
  if (!m) return false;
  const days = m[1].split(/[,\- ]+/).filter(Boolean);
  if (days.length === 0 || !days.every(d => DAY_ABBREVIATIONS.has(d))) return false;
  return [m[2], m[3]].every(t => TIME.test(t.length === 4 ? `0${t}` : t));
}

// ---------------------------------------------------------------- local-business-values

/**
 * @param {Entity[]} entities
 * @return {{businesses: number, findings: Finding[]}}
 */
function evaluateLocalValues(entities) {
  const locals = entities.filter(isLocalBusiness);
  /** @type {Finding[]} */
  const findings = [];
  for (const e of locals) {
    const business = label(e);
    /** @param {'problem' | 'note'} severity @param {string} check @param {string} detail */
    const add = (severity, check, detail) => findings.push({business, check, detail, severity});

    if (e.telephone) {
      const digits = e.telephone.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) {
        add(
          'problem',
          'telephone',
          `telephone "${clip(e.telephone)}" has ${
            digits.length
          } digits; a phone number has 7 to 15.`
        );
      } else if (!e.telephone.trim().startsWith('+')) {
        add(
          'note',
          'telephone',
          `telephone "${clip(
            e.telephone
          )}" has no country code. Google asks for the country code and area code (for example +1 555 010 0100).`
        );
      }
    }
    if (e.geo) {
      const {latitude, longitude} = e.geo;
      if (!latitude || !longitude) {
        add('problem', 'geo', 'geo needs both latitude and longitude.');
      } else {
        const lat = Number(latitude);
        const lon = Number(longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          add('problem', 'geo', `geo "${clip(latitude)}, ${clip(longitude)}" is not numeric.`);
        } else if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          add(
            'problem',
            'geo',
            `geo ${lat}, ${lon} is outside the valid range (latitude -90 to 90, longitude -180 to 180).`
          );
        } else if (lat === 0 && lon === 0) {
          add('problem', 'geo', 'geo 0, 0 is a placeholder, not a place.');
        } else if (decimals(latitude) < 5 || decimals(longitude) < 5) {
          add(
            'problem',
            'geo',
            `geo ${latitude}, ${longitude} is too coarse: Google asks for at least 5 decimal places.`
          );
        }
      }
    }
    for (const spec of e.openingHoursSpecification) {
      const days = spec.dayOfWeek.map(dayToken);
      if (days.length === 0) {
        add('problem', 'openingHoursSpecification', 'An opening-hours entry has no dayOfWeek.');
      }
      for (const d of days) {
        if (!DAYS.has(d)) {
          add(
            'problem',
            'openingHoursSpecification',
            `dayOfWeek "${clip(d)}" is not a weekday name (Monday to Sunday).`
          );
        }
      }
      for (const [field, value] of /** @type {Array<[string, string | null]>} */ ([
        ['opens', spec.opens],
        ['closes', spec.closes],
      ])) {
        if (!value) {
          add(
            'problem',
            'openingHoursSpecification',
            `An opening-hours entry has no ${field} time (use "00:00" for both when closed all day).`
          );
        } else if (!TIME.test(value)) {
          add(
            'problem',
            'openingHoursSpecification',
            `${field} "${clip(value)}" is not a 24-hour time such as 09:00.`
          );
        }
      }
    }
    for (const hours of e.openingHours) {
      if (!openingHoursStringOk(hours)) {
        add(
          'problem',
          'openingHours',
          `openingHours "${clip(hours)}" is not in the form "Mo-Fr 09:00-17:00".`
        );
      }
    }
    if (e.priceRange && e.priceRange.length >= 100) {
      add(
        'problem',
        'priceRange',
        `priceRange is ${e.priceRange.length} characters; Google asks for fewer than 100.`
      );
    }
    if (e.address) {
      const missing = /** @type {const} */ ([
        'streetAddress',
        'addressLocality',
        'addressCountry',
      ]).filter(k => !(/** @type {any} */ (e.address)[k]));
      if (missing.length === 3 && e.address.streetAddress === null) {
        // an address given as plain text arrives as streetAddress only; a node with nothing at all is reported as empty
        add('problem', 'address', 'The address has no street, locality or country.');
      } else if (missing.length) {
        add(
          'problem',
          'address',
          `The address has no ${missing.join(', ')}. Use a full PostalAddress.`
        );
      }
    }
  }
  return {businesses: locals.length, findings};
}

/** @param {Entity[]} entities @return {Product} */
function localValuesProduct(entities) {
  const {businesses, findings} = evaluateLocalValues(entities);
  if (businesses === 0) return notApplicable('The page has no local business markup.');
  const problems = findings.filter(f => f.severity === 'problem');
  const rows = findings.map(f => ({
    business: f.business,
    check: f.check,
    detail: f.severity === 'note' ? `Note: ${f.detail}` : f.detail,
  }));
  const headings = [
    {key: 'business', heading: 'Business'},
    {key: 'check', heading: 'Field'},
    {key: 'detail', heading: 'Finding'},
  ];
  if (problems.length === 0) {
    return {
      score: 1,
      displayValue: `${count(businesses, 'business')} checked`,
      ...(rows.length && {details: table(headings, rows)}),
    };
  }
  return {
    score: 0.5,
    displayValue: count(problems.length, 'value problem'),
    explanation: problems
      .slice(0, 5)
      .map(f => `${f.business}: ${f.detail}`)
      .join(' '),
    details: table(headings, rows),
  };
}

// ---------------------------------------------------------------- cross-page

/**
 * @param {NonNullable<SiteCrawlArtifact['snapshot']>} snapshot
 * @return {Array<{page: CrawlPage, businesses: Entity[]}>} Crawled pages that carry a local business.
 */
function localPages(snapshot) {
  /** @type {Array<{page: CrawlPage, businesses: Entity[]}>} */
  const out = [];
  for (const page of snapshot.pages) {
    if (!isIndexablePage(page)) continue;
    const businesses = (page.entities || []).filter(isLocalBusiness);
    if (businesses.length) out.push({page, businesses});
  }
  return out;
}

/** @param {string | null} a @param {string | null} b @return {boolean} Same number, allowing one to carry a country code the other lacks. */
function samePhone(a, b) {
  if (!a || !b) return false;
  const x = a.replace(/\D/g, '');
  const y = b.replace(/\D/g, '');
  if (x.length < 7 || y.length < 7) return false;
  if (x === y) return true;
  // A national number may carry a leading trunk "0" (020 7946 0958) that the international form drops (+44 20 7946 0958).
  const nx = x.replace(/^0+/, '');
  const ny = y.replace(/^0+/, '');
  if (nx.length < 7 || ny.length < 7) return false;
  return nx === ny || nx.endsWith(ny) || ny.endsWith(nx);
}

/** @param {Entity} e @return {string | null} */
function addressKey(e) {
  const a = e.address;
  if (!a || !a.streetAddress) return null;
  const parts = [a.streetAddress, a.addressLocality, a.postalCode].filter(Boolean);
  if (parts.length < 2) return null;
  return (
    parts
      .join(' ')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim() || null
  );
}

/**
 * @typedef {{url: string, entity: Entity, page: CrawlPage}} Occurrence
 * @param {ReturnType<typeof localPages>} pages
 * @return {Occurrence[]}
 */
function occurrences(pages) {
  /** @type {Occurrence[]} */
  const out = [];
  for (const {page, businesses} of pages) {
    for (const entity of businesses) out.push({url: page.finalUrl, entity, page});
  }
  return out;
}

/**
 * Splits values into groups that are the same, listing the pages each appears on.
 * @template T
 * @param {Array<{value: T, url: string}>} items
 * @param {(a: T, b: T) => boolean} same
 * @return {Array<{value: T, urls: string[]}>}
 */
function cluster(items, same) {
  /** @type {Array<{value: T, urls: string[]}>} */
  const groups = [];
  for (const {value, url} of items) {
    const g = groups.find(x => same(x.value, value));
    if (g) {
      if (!g.urls.includes(url)) g.urls.push(url);
    } else groups.push({value, urls: [url]});
  }
  return groups;
}

/**
 * @typedef {{business: string, field: 'telephone' | 'address', values: Array<{value: string, urls: string[]}>}} Conflict
 * @param {ReturnType<typeof localPages>} pages
 * @return {Conflict[]}
 */
function findNapConflicts(pages) {
  const occ = occurrences(pages);
  /** @type {Conflict[]} */
  const conflicts = [];

  // The same business named by its @id: its phone and address must be one.
  /** @type {Map<string, Occurrence[]>} */
  const byId = new Map();
  for (const o of occ) {
    if (!o.entity.id) continue;
    const list = byId.get(o.entity.id) || [];
    list.push(o);
    byId.set(o.entity.id, list);
  }
  for (const [, list] of byId) {
    if (new Set(list.map(o => o.url)).size < 2) continue;
    const business = label(list[0].entity);
    const phones = cluster(
      list
        .filter(o => o.entity.telephone)
        .map(o => ({value: /** @type {string} */ (o.entity.telephone), url: o.url})),
      samePhone
    );
    if (phones.length > 1) {
      conflicts.push({
        business,
        field: 'telephone',
        values: phones.map(g => ({value: clip(g.value), urls: g.urls})),
      });
    }
    const addresses = cluster(
      list
        .filter(o => addressKey(o.entity))
        .map(o => ({value: /** @type {string} */ (addressKey(o.entity)), url: o.url})),
      (a, b) => a === b
    );
    if (addresses.length > 1) {
      conflicts.push({
        business,
        field: 'address',
        values: addresses.map(g => ({value: clip(g.value), urls: g.urls})),
      });
    }
  }

  // Without an @id: the same name agreeing on phone but not address, or on address but not phone.
  /** @type {Map<string, Occurrence[]>} */
  const byName = new Map();
  for (const o of occ) {
    if (o.entity.id || !o.entity.name) continue;
    const key = normalizeName(o.entity.name);
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(o);
    byName.set(key, list);
  }
  for (const [, list] of byName) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.url === b.url) continue;
        const phoneKnown = !!a.entity.telephone && !!b.entity.telephone;
        const addressA = addressKey(a.entity);
        const addressB = addressKey(b.entity);
        const addressKnown = !!addressA && !!addressB;
        if (!phoneKnown || !addressKnown) continue;
        const phoneSame = samePhone(a.entity.telephone, b.entity.telephone);
        const addressSame = addressA === addressB;
        if (phoneSame === addressSame) continue; // both agree (the same place) or both differ (another location)
        const field = phoneSame ? 'address' : 'telephone';
        const business = label(a.entity);
        const existing = conflicts.find(
          c =>
            c.business === business &&
            c.field === field &&
            c.values.some(v => v.urls.includes(a.url) || v.urls.includes(b.url))
        );
        const valueOf = (/** @type {Occurrence} */ o) =>
          clip(
            field === 'telephone'
              ? /** @type {string} */ (o.entity.telephone)
              : /** @type {string} */ (addressKey(o.entity))
          );
        if (existing) {
          for (const o of [a, b]) {
            const v = existing.values.find(x => x.value === valueOf(o));
            if (v) {
              if (!v.urls.includes(o.url)) v.urls.push(o.url);
            } else existing.values.push({value: valueOf(o), urls: [o.url]});
          }
        } else {
          conflicts.push({
            business,
            field,
            values: [
              {value: valueOf(a), urls: [a.url]},
              {value: valueOf(b), urls: [b.url]},
            ],
          });
        }
      }
    }
  }
  return conflicts;
}

/**
 * @typedef {{kind: 'different names' | 'written differently', names: Array<{name: string, urls: string[]}>}} NameConflict
 * @param {ReturnType<typeof localPages>} pages
 * @return {NameConflict[]}
 */
function findNameConflicts(pages) {
  const occ = occurrences(pages).filter(o => o.entity.name);
  // Union occurrences that are the same business: the same @id, the same phone, or the same address.
  const parent = occ.map((_, i) => i);
  /** @param {number} i @return {number} */
  const find = i => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  /** @param {number} a @param {number} b */
  const union = (a, b) => {
    parent[find(a)] = find(b);
  };
  for (let i = 0; i < occ.length; i++) {
    for (let j = i + 1; j < occ.length; j++) {
      const a = occ[i].entity;
      const b = occ[j].entity;
      const addressA = addressKey(a);
      if (
        (a.id && a.id === b.id) ||
        samePhone(a.telephone, b.telephone) ||
        (addressA && addressA === addressKey(b))
      ) {
        union(i, j);
      }
    }
  }
  /** @type {Map<number, Occurrence[]>} */
  const groups = new Map();
  occ.forEach((o, i) => {
    const root = find(i);
    const list = groups.get(root) || [];
    list.push(o);
    groups.set(root, list);
  });
  /** @type {NameConflict[]} */
  const out = [];
  for (const list of groups.values()) {
    if (new Set(list.map(o => o.url)).size < 2) continue;
    const names = cluster(
      list.map(o => ({value: /** @type {string} */ (o.entity.name), url: o.url})),
      (a, b) => a === b
    );
    if (names.length < 2) continue;
    const normalised = new Set(names.map(n => normalizeName(n.value)));
    out.push({
      kind: normalised.size > 1 ? 'different names' : 'written differently',
      names: names.map(n => ({name: clip(n.value), urls: n.urls})),
    });
  }
  return out;
}

/**
 * @param {SiteCrawlArtifact} artifact
 * @return {{snapshot: NonNullable<SiteCrawlArtifact['snapshot']>, pages: ReturnType<typeof localPages>} | {product: Product}}
 */
function crawlOfLocalPages(artifact) {
  const usable = usableSnapshot(artifact);
  if (!('snapshot' in usable)) return {product: notApplicable(usable.reason)};
  const pages = localPages(usable.snapshot);
  if (pages.length === 0) {
    return {
      product: notApplicable(
        auditedPageProblem(usable.snapshot) || 'The crawl found no page with local business markup.'
      ),
    };
  }
  return {snapshot: usable.snapshot, pages};
}

/** @param {SiteCrawlArtifact} artifact @return {Product} */
function napProduct(artifact) {
  const crawl = crawlOfLocalPages(artifact);
  if ('product' in crawl) return crawl.product;
  if (crawl.pages.length < 2) {
    return notApplicable(
      'Only one crawled page has local business markup, so there is nothing to compare.'
    );
  }
  const conflicts = findNapConflicts(crawl.pages);
  if (conflicts.length === 0) {
    return {score: 1, displayValue: `${count(crawl.pages.length, 'local page')} consistent`};
  }
  const audited = crawl.snapshot.pages.find(p => p.source === 'audited');
  const involvesAudited =
    !!audited && conflicts.some(c => c.values.some(v => v.urls.includes(audited.finalUrl)));
  const rows = conflicts.flatMap(c =>
    c.values.map(v => ({
      business: c.business,
      field: c.field,
      value: v.value,
      pages:
        clip(v.urls.slice(0, 3).join(', ')) +
        (v.urls.length > 3 ? ` and ${v.urls.length - 3} more` : ''),
    }))
  );
  return {
    score: involvesAudited ? 0.5 : 1,
    displayValue: count(conflicts.length, 'inconsistency'),
    explanation: involvesAudited
      ? `${conflicts[0].business} shows different ${
          conflicts[0].field === 'telephone' ? 'phone numbers' : 'addresses'
        } on different pages, including this one. Search engines compare name, address and phone across the web; keep them identical everywhere.`
      : `${count(conflicts.length, 'business')} show${
          conflicts.length === 1 ? 's' : ''
        } inconsistent contact details on other crawled pages (listed below, not judged). A chain with several locations is not flagged: only a business that agrees on one of phone and address and differs on the other, or one with a single @id.`,
    details: table(
      [
        {key: 'business', heading: 'Business'},
        {key: 'field', heading: 'Field'},
        {key: 'value', heading: 'Value'},
        {key: 'pages', heading: 'Pages'},
      ],
      rows
    ),
  };
}

/** @param {SiteCrawlArtifact} artifact @return {Product} */
function nameProduct(artifact) {
  const crawl = crawlOfLocalPages(artifact);
  if ('product' in crawl) return crawl.product;
  if (crawl.pages.length < 2) {
    return notApplicable(
      'Only one crawled page has local business markup, so there is nothing to compare.'
    );
  }
  const conflicts = findNameConflicts(crawl.pages);
  if (conflicts.length === 0) {
    return {score: 1, displayValue: `${count(crawl.pages.length, 'local page')} consistent`};
  }
  const audited = crawl.snapshot.pages.find(p => p.source === 'audited');
  const involvesAudited =
    !!audited && conflicts.some(c => c.names.some(n => n.urls.includes(audited.finalUrl)));
  const rows = conflicts.flatMap(c =>
    c.names.map(n => ({
      kind: c.kind,
      name: n.name,
      pages:
        clip(n.urls.slice(0, 3).join(', ')) +
        (n.urls.length > 3 ? ` and ${n.urls.length - 3} more` : ''),
    }))
  );
  return {
    score: involvesAudited ? 0.5 : 1,
    displayValue: count(conflicts.length, 'business') + ' named inconsistently',
    explanation: involvesAudited
      ? 'This business is named differently on different pages (same phone, address or @id). Use one exact name everywhere, including legal suffixes such as Inc. or Ltd.'
      : `${count(
          conflicts.length,
          'business'
        )} named inconsistently on other crawled pages (listed below, not judged).`,
    details: table(
      [
        {key: 'kind', heading: 'Problem'},
        {key: 'name', heading: 'Name'},
        {key: 'pages', heading: 'Pages'},
      ],
      rows
    ),
  };
}

/** @param {SiteCrawlArtifact} artifact @return {Product} */
function localReportProduct(artifact) {
  const crawl = crawlOfLocalPages(artifact);
  if ('product' in crawl) return crawl.product;
  const rows = crawl.pages.flatMap(({page, businesses}) =>
    businesses.map(b => ({
      url: clip(page.finalUrl),
      name: clip(b.name || ''),
      address: clip(
        [
          b.address && b.address.streetAddress,
          b.address && b.address.addressLocality,
          b.address && b.address.postalCode,
        ]
          .filter(Boolean)
          .join(', ')
      ),
      telephone: clip(b.telephone || ''),
    }))
  );
  return {
    score: 1,
    displayValue: count(crawl.pages.length, 'page') + ' with a local business',
    details: table(
      [
        {key: 'url', heading: 'Page'},
        {key: 'name', heading: 'Business'},
        {key: 'address', heading: 'Address'},
        {key: 'telephone', heading: 'Telephone'},
      ],
      rows
    ),
  };
}

/** @param {CrawlPage} page @return {boolean} */
function isLocalPage(page) {
  return isIndexablePage(page) && (page.entities || []).some(isLocalBusiness);
}

/** @param {SiteCrawlArtifact} artifact @param {import('./sitemap-parse.js').SitemapDocumentsArtifact | null | undefined} sitemaps @return {Product} */
function localSitemapProduct(artifact, sitemaps) {
  return sitemapCoverageProduct(artifact, sitemaps, isLocalPage, 'local business');
}

export {
  evaluateLocalValues,
  localValuesProduct,
  findNapConflicts,
  findNameConflicts,
  napProduct,
  nameProduct,
  localReportProduct,
  localSitemapProduct,
  localPages,
  isLocalPage,
  samePhone,
  addressKey,
  normalizeName,
  openingHoursStringOk,
};
