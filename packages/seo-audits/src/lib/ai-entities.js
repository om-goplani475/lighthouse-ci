/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the informational `author-entity-signals` audit: who the page says wrote it and
 * who publishes it, and how consistently the site names itself. Reads JSON-LD (author, publisher, Organization,
 * Person, WebSite, `sameAs`, logo), `<meta name="author">`, `<link rel="author">` and `og:site_name`. Descriptive
 * only (decision with the developer): it never fails and gives no advice about what an answer engine will do with
 * these signals. No I/O, never throws.
 */

import {extractTypedEntities} from './json-ld-graph.js';
import {clip, notApplicable, table} from './content-common.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */

const MAX_ROWS = 40;

/**
 * @param {unknown} value A JSON-LD author or publisher value: a name, an object, or an array of either.
 * @return {Array<{name: string, type: string}>}
 */
function namesOf(value) {
  /** @type {Array<{name: string, type: string}>} */
  const out = [];
  for (const item of Array.isArray(value) ? value : [value]) {
    if (typeof item === 'string' && item.trim()) {
      out.push({name: item.trim().slice(0, 100), type: 'text'});
    } else if (item && typeof item === 'object') {
      const o = /** @type {Record<string, unknown>} */ (item);
      if (typeof o.name === 'string' && o.name.trim()) {
        out.push({
          name: o.name.trim().slice(0, 100),
          type: typeof o['@type'] === 'string' ? o['@type'] : 'object',
        });
      }
    }
  }
  return out;
}

/**
 * @param {string} name
 * @return {string}
 */
function normName(name) {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * @param {unknown} jsonLd
 * @return {Array<{type: string, data: Record<string, unknown>}>}
 */
function entitiesOf(jsonLd) {
  /** @type {Array<{type: string, data: Record<string, unknown>}>} */
  const out = [];
  for (const block of Array.isArray(jsonLd) ? jsonLd.slice(0, 20) : []) {
    if (block && typeof block.content === 'string') {
      out.push(...extractTypedEntities(block.content));
    }
  }
  return out;
}

/**
 * @param {unknown} jsonLd StructuredDataJsonLd
 * @param {unknown} metaElements MetaElements
 * @param {unknown} linkElements LinkElements
 * @return {Product}
 */
function buildEntitySignalsProduct(jsonLd, metaElements, linkElements) {
  if (!Array.isArray(metaElements) || !Array.isArray(linkElements) || !Array.isArray(jsonLd)) {
    return notApplicable('The structured data or the page head was not collected.');
  }
  const entities = entitiesOf(jsonLd);
  /** @type {Array<Record<string, string>>} */
  const rows = [];
  let authors = 0;
  let publishers = 0;

  for (const e of entities) {
    for (const a of namesOf(e.data.author)) {
      authors++;
      rows.push({
        signal: 'Author',
        value: clip(a.name, 80),
        source: `JSON-LD ${e.type} author (${a.type})`,
      });
    }
    for (const p of namesOf(e.data.publisher)) {
      publishers++;
      rows.push({
        signal: 'Publisher',
        value: clip(p.name, 80),
        source: `JSON-LD ${e.type} publisher (${p.type})`,
      });
    }
  }
  const metaAuthor = metaElements.find(
    m => m && m.name === 'author' && typeof m.content === 'string' && m.content.trim()
  );
  if (metaAuthor) {
    authors++;
    rows.push({
      signal: 'Author',
      value: clip(metaAuthor.content.trim(), 80),
      source: '<meta name="author">',
    });
  }
  const relAuthor = linkElements.find(
    l => l && typeof l.rel === 'string' && l.rel.split(/\s+/).includes('author') && l.href
  );
  if (relAuthor) {
    authors++;
    rows.push({
      signal: 'Author',
      value: clip(String(relAuthor.href), 80),
      source: '<link rel="author">',
    });
  }

  /** @type {string[]} */
  const sameAs = [];
  for (const e of entities) {
    const raw = e.data.sameAs;
    for (const v of Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]) {
      if (typeof v === 'string') sameAs.push(v.trim());
    }
  }
  const validSameAs = [...new Set(sameAs.filter(v => /^https?:\/\/[^\s/]+/i.test(v)))];
  const badSameAs = sameAs.filter(v => !/^https?:\/\/[^\s/]+/i.test(v));
  if (sameAs.length > 0) {
    rows.push({
      signal: 'sameAs links',
      value: `${validSameAs.length} valid${
        badSameAs.length
          ? `, ${badSameAs.length} not an absolute http(s) URL (${clip(badSameAs[0], 40)})`
          : ''
      }`,
      source: 'JSON-LD sameAs',
    });
  }
  const logoOwner = entities.find(
    e => (e.type === 'Organization' || e.type === 'LocalBusiness') && e.data.logo !== undefined
  );
  rows.push({
    signal: 'Organization logo',
    value: logoOwner ? 'declared' : 'not declared',
    source: 'JSON-LD',
  });

  /** @type {Array<{name: string, source: string}>} */
  const siteNames = [];
  for (const e of entities) {
    if (
      (e.type === 'Organization' || e.type === 'WebSite' || e.type === 'LocalBusiness') &&
      typeof e.data.name === 'string'
    ) {
      siteNames.push({name: e.data.name.trim().slice(0, 100), source: `JSON-LD ${e.type} name`});
    }
  }
  const ogSite = metaElements.find(
    m => m && m.property === 'og:site_name' && typeof m.content === 'string' && m.content.trim()
  );
  if (ogSite) siteNames.push({name: ogSite.content.trim().slice(0, 100), source: 'og:site_name'});
  const distinct = new Set(siteNames.map(s => normName(s.name)).filter(Boolean));
  if (siteNames.length > 0) {
    rows.push({
      signal: 'Site name',
      value:
        distinct.size > 1
          ? `differs: ${siteNames.map(s => `"${clip(s.name, 30)}" (${s.source})`).join(' / ')}`
          : `"${clip(siteNames[0].name, 60)}" (consistent in ${siteNames.length} ${
              siteNames.length === 1 ? 'place' : 'places'
            })`,
      source: 'JSON-LD and og:site_name',
    });
  }
  rows.push({
    signal: 'Note',
    value:
      'Descriptive only: these are the signals that say who wrote and who publishes the page. No rule says how an answer engine uses them.',
    source: '',
  });
  return {
    score: 1,
    displayValue: `Author: ${authors ? `${authors} found` : 'none found'}, publisher: ${
      publishers ? 'yes' : 'none found'
    }, sameAs links: ${validSameAs.length}`,
    details: table(rows.slice(0, MAX_ROWS), [
      ['signal', 'Signal'],
      ['value', 'Value'],
      ['source', 'Where it is declared'],
    ]),
  };
}

export {buildEntitySignalsProduct, namesOf, normName};
