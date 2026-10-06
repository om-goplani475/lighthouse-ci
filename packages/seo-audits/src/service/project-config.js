/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-project audit configuration: a preset plus category and audit overrides, each `error`, `warn` or `off`, resolved
 * to an ordinary lhci `assertions` object. Pure: no I/O. The result of `resolveAssertions` can be pasted into a
 * `lighthouserc.js` unchanged.
 */

import {CATEGORIES} from '../summary/categories.js';

/** @typedef {'error' | 'warn' | 'off'} Severity */
/** @typedef {Record<string, [string, {minScore: number}]>} Recommended The contents of `recommended-assertions.json`. */
/** @typedef {{preset?: string, categories?: Record<string, string>, audits?: Record<string, string>}} ProjectConfig */

const SEVERITIES = ['error', 'warn', 'off'];

/** The audits each preset starts from. `base` is where severities come from; `only` limits it to categories. */
/** @type {Record<string, {description: string, only?: string[], promote?: string[], silence?: string[]}>} */
const PRESETS = {
  'seo:recommended': {description: 'Every scored audit at its recommended severity.'},
  'seo:strict': {
    description: 'Every scored audit; warn-tier findings fail the build too.',
    promote: CATEGORIES.map(c => c.name),
  },
  ecommerce: {
    description:
      'Recommended, with structured data, images, duplicate content and the e-commerce checks as errors.',
    promote: ['Structured data', 'Images', 'Duplicates and coverage', 'E-commerce'],
  },
  local: {
    description: 'Recommended, with structured data and the local business checks as errors.',
    promote: ['Structured data', 'Local business'],
  },
  news: {
    description: 'Recommended, with structured data and the news checks as errors.',
    promote: ['Structured data', 'News'],
  },
  blog: {
    description: 'Recommended, with international and content checks as errors.',
    promote: ['International (hreflang)', 'Content and AI search', 'Social sharing'],
  },
  'internal-portal': {
    description: 'Only status codes, redirects, HTTPS and indexing.',
    only: ['Crawlability and indexability', 'Robots and sitemaps'],
  },
  minimal: {
    description: 'Only the error-tier checks in crawlability and robots; no warnings.',
    only: ['Crawlability and indexability', 'Robots and sitemaps'],
    silence: ['warn'],
  },
};

const DEFAULT_PRESET = 'seo:recommended';

/** @type {Record<string, string[]>} */
const AUDITS_BY_CATEGORY = Object.fromEntries(CATEGORIES.map(c => [c.name, c.audits]));
const KNOWN_AUDITS = new Set(CATEGORIES.flatMap(c => c.audits));

/**
 * @param {unknown} value
 * @return {value is Severity}
 */
function isSeverity(value) {
  return typeof value === 'string' && SEVERITIES.includes(value);
}

/**
 * @param {Recommended} recommended
 * @param {string} auditId
 * @return {Severity | null} The recommended severity, or null when the audit is informational (never asserted).
 */
function recommendedSeverity(recommended, auditId) {
  const entry = recommended[auditId];
  return entry ? /** @type {Severity} */ (entry[0]) : null;
}

/**
 * @param {ProjectConfig | null | undefined} config
 * @return {string[]} Every problem found; empty when the config is valid.
 */
function validateConfig(config) {
  /** @type {string[]} */
  const problems = [];
  if (config === null || config === undefined) return problems;
  if (typeof config !== 'object' || Array.isArray(config)) return ['config must be an object'];

  const preset = config.preset;
  if (preset !== undefined && !Object.prototype.hasOwnProperty.call(PRESETS, preset)) {
    problems.push(`unknown preset "${preset}" (known: ${Object.keys(PRESETS).join(', ')})`);
  }

  /**
   * @param {string} field
   * @param {unknown} map
   * @param {(key: string) => boolean} known
   * @param {string} noun
   */
  const checkMap = (field, map, known, noun) => {
    if (map === undefined) return;
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      problems.push(`${field} must be an object`);
      return;
    }
    for (const [key, value] of Object.entries(map)) {
      if (!known(key)) problems.push(`${field}: unknown ${noun} "${key}"`);
      if (!isSeverity(value)) {
        problems.push(`${field}.${key}: must be one of ${SEVERITIES.join(', ')}`);
      }
    }
  };
  checkMap(
    'categories',
    config.categories,
    k => Object.prototype.hasOwnProperty.call(AUDITS_BY_CATEGORY, k),
    'category'
  );
  checkMap('audits', config.audits, k => KNOWN_AUDITS.has(k), 'audit');
  return problems;
}

/**
 * Resolves a project config to the severity of every audit that can be asserted. Order of precedence, lowest first:
 * the preset, then a category override, then an audit override.
 *
 * @param {ProjectConfig | null | undefined} config
 * @param {Recommended} recommended
 * @return {Record<string, Severity>} Audit id to severity, for scored audits only (informational audits are never asserted).
 * @throws {Error} When the config is invalid; the message lists every problem.
 */
function resolveSeverities(config, recommended) {
  const problems = validateConfig(config);
  if (problems.length) throw new Error(`Invalid project config: ${problems.join('; ')}`);

  const presetName = (config && config.preset) || DEFAULT_PRESET;
  const preset = PRESETS[presetName];
  const only = preset.only ? new Set(preset.only.flatMap(c => AUDITS_BY_CATEGORY[c])) : null;
  const promoted = new Set((preset.promote || []).flatMap(c => AUDITS_BY_CATEGORY[c]));

  /** @type {Record<string, Severity>} */
  const result = {};
  for (const id of KNOWN_AUDITS) {
    const base = recommendedSeverity(recommended, id);
    if (!base) continue;
    if (only && !only.has(id)) result[id] = 'off';
    else if (base === 'warn' && (preset.silence || []).includes('warn')) result[id] = 'off';
    else if (base === 'warn' && promoted.has(id)) result[id] = 'error';
    else result[id] = base;
  }

  const categories = (config && config.categories) || {};
  for (const [name, severity] of Object.entries(categories)) {
    for (const id of AUDITS_BY_CATEGORY[name]) {
      if (id in result) result[id] = /** @type {Severity} */ (severity);
    }
  }
  const audits = (config && config.audits) || {};
  for (const [id, severity] of Object.entries(audits)) {
    // An override of an informational audit cannot be asserted (its score is null), so it is ignored.
    if (id in result) result[id] = /** @type {Severity} */ (severity);
  }
  return result;
}

/**
 * @param {ProjectConfig | null | undefined} config
 * @param {Recommended} recommended
 * @return {Record<string, any>} An lhci `assertions` object. `off` audits are written as
 *   `off` so a project's own `lighthouserc.js` merged on top cannot turn them back on by accident.
 */
function resolveAssertions(config, recommended) {
  const severities = resolveSeverities(config, recommended);
  /** @type {Record<string, any>} */
  const assertions = {};
  for (const [id, severity] of Object.entries(severities)) {
    assertions[id] = severity === 'off' ? 'off' : [severity, recommended[id][1]];
  }
  return assertions;
}

/**
 * What a settings form needs: the presets, and the audits a project can switch, grouped by category, each with its
 * recommended severity. Informational audits are left out (they cannot be asserted).
 * @param {Recommended} recommended
 * @return {{defaultPreset: string, severities: string[], presets: Array<{name: string, description: string}>, categories: Array<{name: string, audits: Array<{id: string, recommended: string}>}>}}
 */
function describeOptions(recommended) {
  return {
    defaultPreset: DEFAULT_PRESET,
    severities: [...SEVERITIES],
    presets: Object.entries(PRESETS).map(([name, p]) => ({name, description: p.description})),
    categories: CATEGORIES.map(c => ({
      name: c.name,
      audits: c.audits
        .filter(id => recommended[id])
        .map(id => ({id, recommended: recommended[id][0]})),
    })).filter(c => c.audits.length > 0),
  };
}

export {
  PRESETS,
  DEFAULT_PRESET,
  SEVERITIES,
  describeOptions,
  validateConfig,
  resolveSeverities,
  resolveAssertions,
};
