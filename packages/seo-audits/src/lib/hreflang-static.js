/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The hreflang result builders that read only the page itself (no request): `hreflang-codes` (scored),
 * `hreflang-x-default` and `hreflang-locale-meta` (informational). No I/O, never throws.
 *
 * Rules, chosen with the developer: fail on an invalid language or region code, on a page that does not list
 * itself, and on one hreflang value that points at two different URLs. A missing x-default and a mismatch with
 * the page's `lang`, `content-language` or `og:locale` are notes only.
 */

import {parseHreflang} from './hreflang-codes.js';
import {looseKey} from './url-key.js';
import {clip, gate, selfEntries, table} from './hreflang-common.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {import('../gatherers/hreflang-data.js').HreflangDataArtifact} HreflangDataArtifact */

/**
 * @param {HreflangDataArtifact} data
 * @return {Product}
 */
function buildCodesProduct(data) {
  const skip = gate(data);
  if (skip) return skip;
  /** @type {Array<Record<string, string>>} */
  const rows = [];
  for (const alt of data.alternates) {
    const parsed = parseHreflang(alt.hreflang);
    if (!parsed.valid) {
      rows.push({
        value: clip(alt.hreflang, 60),
        problem: parsed.problem || 'it is not valid',
        fix: parsed.suggestion ? `use "${parsed.suggestion}"` : '',
      });
    }
  }
  if (selfEntries(data).length === 0) {
    rows.push({
      value: '(this page)',
      problem:
        'the page does not list itself; each version should list every version, including itself',
      fix: `add a link with this page's own URL (${clip(data.pageUrl, 80)})`,
    });
  }
  /** @type {Map<string, Set<string>>} */
  const targets = new Map();
  for (const alt of data.alternates) {
    const key = alt.hreflang.trim().toLowerCase();
    const set = targets.get(key) || new Set();
    set.add(looseKey(alt.href) || alt.href);
    targets.set(key, set);
  }
  for (const [value, set] of targets) {
    if (set.size > 1) {
      rows.push({
        value: clip(value, 60),
        problem: `the same value points at ${set.size} different URLs`,
        fix: 'give each URL its own language or region',
      });
    }
  }
  if (rows.length === 0) {
    return {
      score: 1,
      displayValue: `${data.alternates.length} hreflang values are valid and the page lists itself`,
    };
  }
  return {
    score: 0,
    displayValue: `${rows.length} hreflang ${rows.length === 1 ? 'problem' : 'problems'}`,
    explanation:
      'Search engines ignore an hreflang value they cannot read, and may ignore the whole set when it contradicts itself. Use a two-letter language code with an optional region (en, en-GB, zh-Hant), x-default for the fallback, and list every version including the page itself.',
    details: table(rows, [
      ['value', 'hreflang'],
      ['problem', 'Problem'],
      ['fix', 'Fix'],
    ]),
  };
}

/**
 * @param {HreflangDataArtifact} data
 * @return {Product}
 */
function buildXDefaultProduct(data) {
  const skip = gate(data);
  if (skip) return skip;
  const xs = data.alternates.filter(a => parseHreflang(a.hreflang).kind === 'x-default');
  if (xs.length === 0) {
    return {
      score: 1,
      displayValue: 'No x-default (optional)',
      details: table(
        [
          {
            note: 'x-default names the page to show visitors whose language is not listed (often a language chooser). Google treats it as optional, so this is advice only.',
          },
        ],
        [['note', 'Note']]
      ),
    };
  }
  const urls = new Set(xs.map(a => looseKey(a.href) || a.href));
  return {
    score: 1,
    displayValue: urls.size > 1 ? `${urls.size} different x-default URLs` : 'x-default present',
    details: table(
      xs.map(a => ({
        url: clip(a.href),
        note:
          urls.size > 1
            ? 'more than one x-default URL; a page should name only one'
            : 'the fallback version',
      })),
      [
        ['url', 'x-default URL'],
        ['note', 'Note'],
      ]
    ),
  };
}

/**
 * @param {string | null | undefined} value
 * @return {string | null} The lower-case primary language subtag.
 */
function primaryOf(value) {
  if (typeof value !== 'string') return null;
  const primary = value.trim().split(/[-_]/)[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

/**
 * @param {string | null | undefined} value
 * @return {string | null} The upper-case region subtag, when there is one.
 */
function regionOf(value) {
  if (typeof value !== 'string') return null;
  const region = value.trim().split(/[-_]/)[1];
  return region && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : null;
}

/**
 * @param {HreflangDataArtifact} data
 * @return {Product}
 */
function buildLocaleMetaProduct(data) {
  const skip = gate(data);
  if (skip) return skip;
  const own = selfEntries(data)
    .map(a => parseHreflang(a.hreflang))
    .find(p => p.valid && p.kind === 'language');
  if (!own || !own.language) {
    return {
      score: 1,
      notApplicable: true,
      explanation:
        'The page does not list itself with a valid language, so there is nothing to compare.',
    };
  }
  const declared = own.raw;
  /** @type {Array<Record<string, string>>} */
  const rows = [];
  let present = 0;
  let matching = 0;
  /**
   * @param {string} source
   * @param {string | null | undefined} value
   */
  const compare = (source, value) => {
    if (typeof value !== 'string' || value.trim() === '') return;
    present++;
    const language = primaryOf(value);
    const region = regionOf(value);
    const languageOk = language === own.language;
    const regionOk = !region || !own.region || region === own.region.toUpperCase();
    if (languageOk && regionOk) matching++;
    rows.push({
      source,
      value: clip(value, 60),
      result: !languageOk
        ? `a different language from the hreflang (${declared})`
        : !regionOk
        ? `a different region from the hreflang (${declared})`
        : 'matches',
    });
  };
  compare('<html lang>', data.htmlLang);
  compare('content-language', data.contentLanguage);
  compare('og:locale', data.ogLocale);
  if (present === 0) {
    return {score: 1, displayValue: 'No lang, content-language or og:locale to compare'};
  }
  return {
    score: 1,
    displayValue: `${matching} of ${present} locale ${
      present === 1 ? 'signal matches' : 'signals match'
    } the hreflang (${declared})`,
    details: table(rows, [
      ['source', 'Where'],
      ['value', 'Value'],
      ['result', 'Compared with this page hreflang'],
    ]),
  };
}

export {buildCodesProduct, buildXDefaultProduct, buildLocaleMetaProduct, primaryOf, regionOf};
