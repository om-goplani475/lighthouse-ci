/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure logic for the four entity audits: `entity-same-as-values`, `entity-same-as-reachable`,
 * `entity-identity-consistency` and `entity-disambiguation`. They judge how an organization, a business or a person is
 * identified in the page's JSON-LD (and, for consistency, across the crawled pages). The only I/O is the `sameAs` probe, whose
 * fetcher is passed in. Never throws.
 *
 * Source (Google's organization structured data documentation, read 2026-10-06): there are no required properties; `name`, `url`,
 * `logo` (at least 112 x 112 px, crawlable) and `sameAs` (profile pages on other sites) are recommended, and identifiers such as
 * `iso6523Code`, `leiCode`, `duns` and `naics` help to tell the organization apart from others. Everything about consistency across
 * pages, and the 8-address probe budget, is our judgement.
 */

import {isLocalBusiness} from './structured-facts.js';
import {looseKey} from './url-key.js';
import {
  clip,
  count,
  notApplicable,
  table,
  usableSnapshot,
  auditedPageProblem,
  isIndexablePage,
  normalizeName,
  probeStatuses,
} from './vertical-common.js';

/** @typedef {import('./structured-facts.js').Entity} Entity */
/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {{entity: string, check: string, detail: string, severity: 'problem' | 'note'}} Finding */

const ORGANIZATION_TYPES = [
  'Organization',
  'Corporation',
  'NGO',
  'EducationalOrganization',
  'GovernmentOrganization',
  'MedicalOrganization',
  'NewsMediaOrganization',
  'OnlineBusiness',
  'OnlineStore',
  'SportsOrganization',
  'Airline',
  'Consortium',
  'PerformingGroup',
  'ResearchOrganization',
  'WorkersUnion',
  'LibrarySystem',
  'School',
  'CollegeOrUniversity',
];
const DEFAULT_MAX_CHECKS = 8;
const HARD_MAX_CHECKS = 20;
const MAX_SAME_AS = 15;

/** @param {Entity} e @return {boolean} An organization (or a subtype), a local business, or a person. */
function isEntity(e) {
  return (
    e.types.includes('Person') ||
    isLocalBusiness(e) ||
    e.types.some(t => ORGANIZATION_TYPES.includes(t))
  );
}

/** @param {Entity} e @return {string} */
function label(e) {
  return clip(e.name || e.id || e.types[0] || 'Entity');
}

/**
 * @param {Record<string, string | undefined>} env
 * @return {number} How many sameAs addresses to request: `LHCI_SEO_SAMEAS_MAX_CHECKS` (default 8, at most 20, 0 switches the check off).
 */
function parseMaxChecks(env) {
  const raw = env && env.LHCI_SEO_SAMEAS_MAX_CHECKS;
  if (raw === undefined || raw === '') return DEFAULT_MAX_CHECKS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_MAX_CHECKS;
  return Math.min(n, HARD_MAX_CHECKS);
}

/** @param {string} host @return {boolean} A bare name, an IP address or localhost: not a public profile address. */
function notPublicHost(host) {
  return (
    host === 'localhost' ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.includes(':') ||
    !host.includes('.')
  );
}

// ---------------------------------------------------------------- entity-same-as-values

/**
 * @param {Entity[]} entities
 * @param {string} pageUrl
 * @return {{entities: number, findings: Finding[], reachable: string[]}} `reachable` are the valid addresses on other sites, worth requesting.
 */
function evaluateSameAs(entities, pageUrl) {
  const withSameAs = entities.filter(e => isEntity(e) && e.sameAs.length > 0);
  /** @type {Finding[]} */
  const findings = [];
  /** @type {string[]} */
  const reachable = [];
  let pageHost = '';
  try {
    pageHost = new URL(pageUrl).hostname.toLowerCase();
  } catch (_) {
    pageHost = '';
  }
  for (const e of withSameAs) {
    const name = label(e);
    /** @param {'problem' | 'note'} severity @param {string} detail */
    const add = (severity, detail) =>
      findings.push({entity: name, check: 'sameAs', detail, severity});
    const own = new Set(
      [looseKey(pageUrl), looseKey(e.url || ''), looseKey(e.id || '')].filter(Boolean)
    );
    /** @type {Set<string>} */
    const seen = new Set();
    if (e.sameAs.length > MAX_SAME_AS) {
      add(
        'note',
        `${e.sameAs.length} sameAs addresses. Keep to the profile pages that truly describe this entity.`
      );
    }
    for (const raw of e.sameAs) {
      /** @type {URL | null} */
      let url = null;
      try {
        url = new URL(raw);
      } catch (_) {
        url = null;
      }
      if (!url) {
        add(
          'problem',
          /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(raw)
            ? `sameAs "${clip(raw)}" has no scheme; write the full address (https://...).`
            : `sameAs "${clip(raw)}" is not a valid address.`
        );
        continue;
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        add(
          'problem',
          `sameAs "${clip(raw)}" is not an http(s) address; it must point to a profile page.`
        );
        continue;
      }
      const host = url.hostname.toLowerCase();
      if (notPublicHost(host)) {
        add('problem', `sameAs "${clip(raw)}" is not a public web address.`);
        continue;
      }
      const key = looseKey(raw);
      if (key && seen.has(key)) {
        add('note', `sameAs "${clip(raw)}" is listed more than once.`);
        continue;
      }
      if (key) seen.add(key);
      if (url.protocol === 'http:') add('note', `sameAs "${clip(raw)}" uses http; use https.`);
      if (key && own.has(key)) {
        add(
          'note',
          `sameAs "${clip(
            raw
          )}" points to this page or entity itself; list other places that describe it.`
        );
      } else if (
        pageHost &&
        (host === pageHost || host === `www.${pageHost}` || `www.${host}` === pageHost)
      ) {
        add(
          'note',
          `sameAs "${clip(raw)}" is on the same site; sameAs is for profiles on other sites.`
        );
      } else {
        reachable.push(raw);
      }
    }
  }
  return {entities: withSameAs.length, findings, reachable: [...new Set(reachable)]};
}

/** @param {Entity[]} entities @param {string} pageUrl @return {Product} */
function sameAsValuesProduct(entities, pageUrl) {
  const {entities: n, findings} = evaluateSameAs(entities, pageUrl);
  if (n === 0) {
    return notApplicable('The page has no organization, business or person with a sameAs list.');
  }
  const problems = findings.filter(f => f.severity === 'problem');
  const columns = [
    {key: 'entity', heading: 'Entity'},
    {key: 'detail', heading: 'Finding'},
  ];
  const rows = findings.map(f => ({
    entity: f.entity,
    detail: f.severity === 'note' ? `Note: ${f.detail}` : f.detail,
  }));
  if (problems.length === 0) {
    return {
      score: 1,
      displayValue: `${count(n, 'entity')} checked`,
      ...(rows.length && {details: table(columns, rows)}),
    };
  }
  return {
    score: 0.5,
    displayValue: count(problems.length, 'sameAs problem'),
    explanation: problems
      .slice(0, 5)
      .map(f => `${f.entity}: ${f.detail}`)
      .join(' '),
    details: table(columns, rows),
  };
}

// ---------------------------------------------------------------- entity-same-as-reachable

/**
 * @param {Entity[]} entities
 * @param {string} pageUrl
 * @param {(url: string, firstParty: boolean) => Promise<{status: number}>} fetchStatus
 * @param {(host: string) => string} siteOf
 * @param {number} max
 * @return {Promise<Product>}
 */
async function sameAsReachableProduct(entities, pageUrl, fetchStatus, siteOf, max) {
  if (max === 0) {
    return notApplicable('The sameAs check is switched off (LHCI_SEO_SAMEAS_MAX_CHECKS=0).');
  }
  const {reachable} = evaluateSameAs(entities, pageUrl);
  if (reachable.length === 0) {
    return notApplicable('The page has no sameAs address on another site to check.');
  }
  const {rows, checked, notChecked} = await probeStatuses({
    urls: reachable,
    pageUrl,
    max,
    fetchStatus,
    siteOf,
  });
  const extra = notChecked > 0 ? ` (${count(notChecked, 'more address')} not checked)` : '';
  if (rows.length === 0) {
    return {score: 1, displayValue: `${count(checked, 'sameAs address')} reachable${extra}`};
  }
  /** @param {import('./vertical-common.js').ProbeRow} r @return {string} */
  const describe = r =>
    r.kind === 'gone'
      ? `answered ${r.status}: the profile page is gone.`
      : r.kind === 'missing-host'
      ? `could not be reached (${r.message}).`
      : r.kind === 'status'
      ? r.status !== null && r.status >= 300 && r.status < 400
        ? `answered ${r.status}, a redirect (not followed, so not judged).`
        : `answered ${r.status} (social networks refuse automated requests with codes like 403, 429 or 999; not judged).`
      : `could not be checked (${r.message}).`;
  const columns = [
    {key: 'url', heading: 'sameAs address'},
    {key: 'result', heading: 'Result'},
  ];
  const tableRows = rows.map(r => ({
    url: clip(r.url),
    result: r.severity === 'note' ? `Note: ${describe(r)}` : describe(r),
  }));
  const problems = rows.filter(r => r.severity === 'problem');
  if (problems.length === 0) {
    return {
      score: 1,
      displayValue: `${count(rows.length, 'address')} could not be confirmed${extra}`,
      details: table(columns, tableRows),
    };
  }
  return {
    score: 0.5,
    displayValue: count(problems.length, 'broken sameAs address'),
    explanation: `${problems
      .map(p => `${p.url} ${describe(p)}`)
      .slice(0, 3)
      .join(
        ' '
      )} A sameAs address that no longer exists does not help Google tell the entity apart.`,
    details: table(columns, tableRows),
  };
}

// ---------------------------------------------------------------- entity-identity-consistency

/**
 * @typedef {{field: string, values: Array<{value: string, urls: string[]}>}} IdentityConflict
 * @param {NonNullable<SiteCrawlArtifact['snapshot']>} snapshot
 * @return {{groups: number, conflicts: Array<{entity: string, conflicts: IdentityConflict[]}>}}
 */
function findIdentityConflicts(snapshot) {
  /** @type {Map<string, Array<{url: string, entity: Entity}>>} */
  const byKey = new Map();
  for (const page of snapshot.pages) {
    if (!isIndexablePage(page)) continue;
    for (const entity of page.entities || []) {
      if (!isEntity(entity)) continue;
      const key = entity.id ? `id:${entity.id}` : entity.url ? `url:${looseKey(entity.url)}` : null;
      if (!key) continue;
      const list = byKey.get(key) || [];
      list.push({url: page.finalUrl, entity});
      byKey.set(key, list);
    }
  }
  let groups = 0;
  /** @type {Array<{entity: string, conflicts: IdentityConflict[]}>} */
  const out = [];
  for (const list of byKey.values()) {
    if (new Set(list.map(o => o.url)).size < 2) continue;
    groups++;
    /** @type {IdentityConflict[]} */
    const conflicts = [];
    /** @param {string} field @param {Array<{value: string, url: string}>} items @param {(v: string) => string} normalize */
    const compare = (field, items, normalize) => {
      /** @type {Map<string, {value: string, urls: string[]}>} */
      const clusters = new Map();
      for (const {value, url} of items) {
        const k = normalize(value);
        const c = clusters.get(k) || {value: clip(value), urls: []};
        if (!c.urls.includes(url)) c.urls.push(url);
        clusters.set(k, c);
      }
      if (clusters.size > 1) conflicts.push({field, values: [...clusters.values()]});
    };
    compare(
      'name',
      list
        .filter(o => o.entity.name)
        .map(o => ({value: /** @type {string} */ (o.entity.name), url: o.url})),
      normalizeName
    );
    compare(
      'logo',
      list
        .filter(o => o.entity.logo)
        .map(o => ({value: /** @type {string} */ (o.entity.logo), url: o.url})),
      v => looseKey(v) || v
    );
    // The same social network named with two different profile addresses.
    /** @type {Map<string, Array<{value: string, url: string}>>} */
    const byHost = new Map();
    for (const o of list) {
      for (const raw of o.entity.sameAs) {
        try {
          const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
          const items = byHost.get(host) || [];
          items.push({value: raw, url: o.url});
          byHost.set(host, items);
        } catch (_) {
          // an invalid address is entity-same-as-values' concern
        }
      }
    }
    for (const [host, items] of byHost) compare(`sameAs (${host})`, items, v => looseKey(v) || v);
    if (conflicts.length) out.push({entity: label(list[0].entity), conflicts});
  }
  return {groups, conflicts: out};
}

/** @param {SiteCrawlArtifact} artifact @return {Product} */
function identityConsistencyProduct(artifact) {
  const usable = usableSnapshot(artifact);
  if (!('snapshot' in usable)) return notApplicable(usable.reason);
  const {groups, conflicts} = findIdentityConflicts(usable.snapshot);
  if (groups === 0) {
    return notApplicable(
      auditedPageProblem(usable.snapshot) ||
        'No organization, business or person appears with the same @id (or url) on two or more crawled pages, so there is nothing to compare.'
    );
  }
  if (conflicts.length === 0) {
    return {score: 1, displayValue: `${count(groups, 'entity')} consistent`};
  }
  const audited = usable.snapshot.pages.find(p => p.source === 'audited');
  const involvesAudited =
    !!audited &&
    conflicts.some(c =>
      c.conflicts.some(x => x.values.some(v => v.urls.includes(audited.finalUrl)))
    );
  const rows = conflicts.flatMap(c =>
    c.conflicts.flatMap(x =>
      x.values.map(v => ({
        entity: c.entity,
        field: x.field,
        value: v.value,
        pages:
          clip(v.urls.slice(0, 3).join(', ')) +
          (v.urls.length > 3 ? ` and ${v.urls.length - 3} more` : ''),
      }))
    )
  );
  return {
    score: involvesAudited ? 0.5 : 1,
    displayValue: `${count(conflicts.length, 'entity')} described inconsistently`,
    explanation: involvesAudited
      ? `${conflicts[0].entity} is described differently on different pages (${conflicts[0].conflicts[0].field}), including this one. Keep the name, logo and profile addresses of an entity the same on every page.`
      : `${count(
          conflicts.length,
          'entity'
        )} described inconsistently on other crawled pages (listed below, not judged).`,
    details: table(
      [
        {key: 'entity', heading: 'Entity'},
        {key: 'field', heading: 'Field'},
        {key: 'value', heading: 'Value'},
        {key: 'pages', heading: 'Pages'},
      ],
      rows
    ),
  };
}

// ---------------------------------------------------------------- entity-disambiguation

/** @param {Entity[]} entities @return {Product} */
function disambiguationProduct(entities) {
  const list = entities.filter(isEntity);
  if (list.length === 0) {
    return notApplicable('The page has no organization, business or person markup.');
  }
  const rows = list.map(e => ({
    entity: label(e),
    type: clip(e.types.join(', ')),
    id: e.id ? 'yes' : 'no',
    url: e.url ? 'yes' : 'no',
    logo: e.logo ? 'yes' : 'no',
    sameAs: String(e.sameAs.length),
    identifiers: Object.keys(e.identifiers).join(', ') || 'none',
  }));
  return {
    score: 1,
    displayValue: `${count(list.length, 'entity')} described`,
    details: table(
      [
        {key: 'entity', heading: 'Entity'},
        {key: 'type', heading: 'Type'},
        {key: 'id', heading: '@id'},
        {key: 'url', heading: 'url'},
        {key: 'logo', heading: 'logo'},
        {key: 'sameAs', heading: 'sameAs'},
        {key: 'identifiers', heading: 'Identifiers'},
      ],
      rows
    ),
  };
}

export {
  isEntity,
  parseMaxChecks,
  evaluateSameAs,
  sameAsValuesProduct,
  sameAsReachableProduct,
  findIdentityConflicts,
  identityConsistencyProduct,
  disambiguationProduct,
  DEFAULT_MAX_CHECKS,
  HARD_MAX_CHECKS,
};
