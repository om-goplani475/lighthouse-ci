/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure logic for the six e-commerce audits (`product-identifiers`, `product-offer-values`, `product-variants`,
 * `faceted-navigation-explosion`, `product-pages-in-sitemap`, `product-category-linking`). The first three judge the
 * audited page's own product markup (from the `structured-facts.js` projection); the last three read the site crawl and
 * the sitemap. No I/O, never throws.
 *
 * Sources: Google's merchant listing and product variants documentation (read 2026-10-06). A rule that is only our judgement
 * says so in the audit's description. A page with no product markup is "not applicable", never a failure.
 *
 * Levels: `product-offer-values` is the error tier (a value Google's documentation calls invalid: the offer is ignored);
 * the others are advice (a partial score, the warn tier).
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {hasType, isProduct} from './structured-facts.js';
import {buildGraph, crawlCompleteness} from './crawl-graph.js';
import {scriptBuiltContent} from './crawl-coverage.js';
import {looseKey} from './url-key.js';
import {isTrackingParam, isSessionParam} from './url-quality.js';

/** @typedef {import('./structured-facts.js').Entity} Entity */
/** @typedef {import('./crawl-snapshot.js').SiteCrawlArtifact} SiteCrawlArtifact */
/** @typedef {import('./crawl-snapshot.js').CrawlPage} CrawlPage */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {{product: string, check: string, detail: string}} Finding */

const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;
const MIN_FACET_URLS = 20;
const MIN_FACET_PARAMS = 2;
const MIN_LISTING_LINKS = 3;

const ITEM_AVAILABILITY = new Set([
  'InStock',
  'OutOfStock',
  'BackOrder',
  'PreOrder',
  'Discontinued',
  'OnlineOnly',
  'InStoreOnly',
  'LimitedAvailability',
  'PreSale',
  'SoldOut',
  'Reserved',
  'MadeToOrder',
]);
const ITEM_CONDITION = new Set([
  'NewCondition',
  'RefurbishedCondition',
  'UsedCondition',
  'DamagedCondition',
]);
const VARIES_BY = new Set([
  'size',
  'color',
  'colour',
  'material',
  'pattern',
  'suggestedage',
  'suggestedgender',
]);
const PAGINATION_PARAMS = new Set(['page', 'p', 'pg', 'paged', 'pagenumber', 'offset', 'start']);

/** @param {string} text @return {string} */
function clip(text) {
  return text.length <= MAX_CELL_CHARS ? text : `${text.slice(0, MAX_CELL_CHARS)}...`;
}

/** @param {number} n @param {string} noun @return {string} */
function count(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** @param {string} explanation @return {Product} */
function notApplicable(explanation) {
  return {score: 1, notApplicable: true, explanation};
}

/** @param {Entity} e @return {string} */
function label(e) {
  return clip(e.name || e.id || e.types[0] || 'Product');
}

/**
 * Strips the schema.org prefix a JSON-LD value may carry, so `https://schema.org/InStock`, `schema:InStock` and the bare
 * `InStock` (valid when the context maps it) all read as `InStock`.
 * @param {string} value
 * @return {string}
 */
function enumToken(value) {
  return value
    .trim()
    .replace(/^https?:\/\/schema\.org\//i, '')
    .replace(/^schema:/i, '');
}

/**
 * @param {string} digits
 * @return {boolean} Whether the GS1 check digit is right (weights 3 and 1 from the digit left of the check digit).
 */
function gtinCheckDigitOk(digits) {
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/**
 * @param {string} key `gtin`, `gtin8`, `gtin12`, `gtin13` or `gtin14`
 * @param {string} value
 * @return {string | null}
 */
function gtinProblem(key, value) {
  if (!/^\d+$/.test(value)) return `${key} "${clip(value)}" is not numeric`;
  /** @type {Record<string, number[]>} */
  const lengths = {gtin: [8, 12, 13, 14], gtin8: [8], gtin12: [12], gtin13: [13], gtin14: [14]};
  const want = lengths[key] || [8, 12, 13, 14];
  if (!want.includes(value.length)) {
    return `${key} has ${value.length} digits (expected ${want.join(' or ')})`;
  }
  return gtinCheckDigitOk(value) ? null : `${key} "${value}" has an invalid check digit`;
}

/**
 * @param {Array<{heading: string, key: string}>} columns
 * @param {Array<Record<string, string>>} rows
 * @return {import('lighthouse/types/audit.js').default.Details.Table}
 */
function table(columns, rows) {
  return Audit.makeTableDetails(
    columns.map(c => ({key: c.key, valueType: /** @type {const} */ ('text'), label: c.heading})),
    rows.slice(0, MAX_ROWS)
  );
}

// ---------------------------------------------------------------- product-identifiers

/**
 * @param {Entity[]} entities
 * @return {{products: number, findings: Finding[]}}
 */
function evaluateIdentifiers(entities) {
  const products = entities.filter(e => isProduct(e) && !hasType(e, 'ProductGroup'));
  /** @type {Finding[]} */
  const findings = [];
  for (const e of products) {
    const p = /** @type {NonNullable<Entity['product']>} */ (e.product);
    const name = label(e);
    const gtins = Object.entries(p.gtins);
    if (gtins.length === 0 && !p.mpn && !p.sku) {
      findings.push({
        product: name,
        check: 'Identifier',
        detail: 'No gtin, mpn or sku. An identifier lets Google match the product with others.',
      });
    }
    for (const [key, value] of gtins) {
      const problem = gtinProblem(key, value);
      if (problem) findings.push({product: name, check: 'GTIN', detail: problem});
    }
    if (p.sku && /\s/.test(p.sku)) {
      findings.push({
        product: name,
        check: 'SKU',
        detail: `sku "${clip(p.sku)}" contains whitespace, which Google does not allow.`,
      });
    }
    if (!p.brand) {
      findings.push({
        product: name,
        check: 'Brand',
        detail: 'No brand. Google recommends brand.name, especially with a gtin or mpn.',
      });
    }
  }
  return {products: products.length, findings};
}

/** @param {Entity[]} entities @return {Product} */
function identifiersProduct(entities) {
  const {products, findings} = evaluateIdentifiers(entities);
  if (products === 0) return notApplicable('The page has no Product markup.');
  if (findings.length === 0) {
    return {score: 1, displayValue: count(products, 'product') + ' checked'};
  }
  return {
    score: 0.5,
    displayValue: count(findings.length, 'identifier problem'),
    explanation: findings
      .slice(0, 5)
      .map(f => `${f.product}: ${f.detail}`)
      .join(' '),
    details: table(
      [
        {key: 'product', heading: 'Product'},
        {key: 'check', heading: 'Check'},
        {key: 'detail', heading: 'Finding'},
      ],
      findings
    ),
  };
}

// ---------------------------------------------------------------- product-offer-values

/** @return {(code: string) => boolean} Whether a string is a currency code the runtime knows (any case). */
function currencyChecker() {
  /** @type {Set<string> | null} */
  let known = null;
  try {
    const supported = /** @type {any} */ (Intl).supportedValuesOf;
    if (typeof supported === 'function') known = new Set(supported('currency'));
  } catch (_) {
    known = null;
  }
  return code => (known ? known.has(code.toUpperCase()) : /^[A-Za-z]{3}$/.test(code));
}
const isCurrency = currencyChecker();

/**
 * @param {string} raw
 * @return {{problem: string | null, note: string | null}} A price must be a plain number: no symbol, text or thousands separator.
 */
function priceProblem(raw) {
  const v = raw.trim();
  if (/^\d+(\.\d+)?$/.test(v)) {
    return {
      problem: null,
      note:
        Number(v) === 0
          ? 'The price is 0. Google merchant listings need a price above zero.'
          : null,
    };
  }
  if (/^-\d/.test(v)) return {problem: `price "${clip(v)}" is negative`, note: null};
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) {
    return {
      problem: `price "${clip(v)}" has a thousands separator; write it as ${v.replace(/,/g, '')}`,
      note: null,
    };
  }
  if (/^\d+,\d+$/.test(v)) {
    return {
      problem: `price "${clip(v)}" uses a comma as the decimal mark; use a point`,
      note: null,
    };
  }
  if (/[^\d.]/.test(v)) {
    return {
      problem: `price "${clip(
        v
      )}" contains a currency symbol or text; use digits only and put the currency in priceCurrency`,
      note: null,
    };
  }
  return {problem: `price "${clip(v)}" is not a number`, note: null};
}

/**
 * @param {Entity[]} entities
 * @return {{offers: number, problems: Finding[], notes: Finding[]}}
 */
function evaluateOffers(entities) {
  /** @type {Finding[]} */
  const problems = [];
  /** @type {Finding[]} */
  const notes = [];
  let offers = 0;
  for (const e of entities) {
    if (!isProduct(e)) continue;
    const name = label(e);
    for (const o of /** @type {NonNullable<Entity['product']>} */ (e.product).offers) {
      offers++;
      for (const [field, value] of /** @type {Array<[string, string | null]>} */ ([
        ['price', o.price],
        ['lowPrice', o.lowPrice],
        ['highPrice', o.highPrice],
      ])) {
        if (value === null) continue;
        const {problem, note} = priceProblem(value);
        if (problem) {
          problems.push({product: name, check: field, detail: problem.replace(/^price/, field)});
        }
        if (note) notes.push({product: name, check: field, detail: note});
      }
      if (o.priceCurrency !== null) {
        if (!isCurrency(o.priceCurrency)) {
          problems.push({
            product: name,
            check: 'priceCurrency',
            detail: `priceCurrency "${clip(
              o.priceCurrency
            )}" is not an ISO 4217 currency code (three letters, for example EUR).`,
          });
        } else if (o.priceCurrency !== o.priceCurrency.toUpperCase()) {
          notes.push({
            product: name,
            check: 'priceCurrency',
            detail: `priceCurrency "${o.priceCurrency}" should be upper case.`,
          });
        }
      }
      const availability = [...new Set(o.availability.map(enumToken))];
      if (availability.length > 1) {
        problems.push({
          product: name,
          check: 'availability',
          detail: `${availability.length} availability values (${availability
            .slice(0, 3)
            .map(clip)
            .join(', ')}): only one is allowed.`,
        });
      }
      for (const a of availability) {
        if (!ITEM_AVAILABILITY.has(a)) {
          problems.push({
            product: name,
            check: 'availability',
            detail: `availability "${clip(a)}" is not a schema.org ItemAvailability value.`,
          });
        }
      }
      const condition = [...new Set(o.itemCondition.map(enumToken))];
      if (condition.length > 1) {
        problems.push({
          product: name,
          check: 'itemCondition',
          detail: `${condition.length} itemCondition values: only one is allowed.`,
        });
      }
      for (const c of condition) {
        if (!ITEM_CONDITION.has(c)) {
          problems.push({
            product: name,
            check: 'itemCondition',
            detail: `itemCondition "${clip(
              c
            )}" is not NewCondition, RefurbishedCondition, UsedCondition or DamagedCondition.`,
          });
        }
      }
    }
  }
  return {offers, problems, notes};
}

/** @param {Entity[]} entities @return {Product} */
function offerValuesProduct(entities) {
  const {offers, problems, notes} = evaluateOffers(entities);
  if (offers === 0) return notApplicable('The page has no product offer.');
  const rows = [
    ...problems.map(f => ({product: f.product, check: f.check, detail: f.detail})),
    ...notes.map(f => ({product: f.product, check: f.check, detail: `Note: ${f.detail}`})),
  ];
  if (problems.length === 0) {
    return {
      score: 1,
      displayValue: count(offers, 'offer') + ' checked',
      ...(rows.length && {
        details: table(
          [
            {key: 'product', heading: 'Product'},
            {key: 'check', heading: 'Field'},
            {key: 'detail', heading: 'Finding'},
          ],
          rows
        ),
      }),
    };
  }
  return {
    score: 0,
    displayValue: count(problems.length, 'invalid value'),
    explanation: problems
      .slice(0, 5)
      .map(f => `${f.product}: ${f.detail}`)
      .join(' '),
    details: table(
      [
        {key: 'product', heading: 'Product'},
        {key: 'check', heading: 'Field'},
        {key: 'detail', heading: 'Finding'},
      ],
      rows
    ),
  };
}

// ---------------------------------------------------------------- product-variants

/**
 * @param {Entity[]} entities
 * @return {{applicable: boolean, findings: Finding[]}}
 */
function evaluateVariants(entities) {
  const products = entities.filter(isProduct);
  if (products.length === 0) return {applicable: false, findings: []};
  /** @type {Finding[]} */
  const findings = [];
  for (const g of products.filter(e => hasType(e, 'ProductGroup'))) {
    const p = /** @type {NonNullable<Entity['product']>} */ (g.product);
    const name = label(g);
    if (!p.productGroupID) {
      findings.push({
        product: name,
        check: 'productGroupID',
        detail: 'A ProductGroup needs a productGroupID (the parent SKU).',
      });
    }
    if (p.variesBy.length === 0) {
      findings.push({
        product: name,
        check: 'variesBy',
        detail: 'A ProductGroup needs variesBy: what the variants differ in (size, color, ...).',
      });
    }
    for (const v of p.variesBy) {
      if (!VARIES_BY.has(enumToken(v).toLowerCase())) {
        findings.push({
          product: name,
          check: 'variesBy',
          detail: `Note: variesBy "${clip(
            v
          )}" is not one of size, color, material, pattern, suggestedAge, suggestedGender.`,
        });
      }
    }
    if (p.variantCount === 0) {
      findings.push({
        product: name,
        check: 'hasVariant',
        detail:
          'Note: no hasVariant. That is fine when each variant has its own page with its own markup (isVariantOf); a single-page product lists its variants in hasVariant.',
      });
    }
    /** @type {Map<string, number>} */
    const seen = new Map();
    for (const v of p.variants) {
      // A variant that is only a pointer ({"@type": "Product", "url": ...}) is a variant with its own page: its own markup is judged there.
      if (!v.detailed) continue;
      const id = v.sku || v.gtin;
      if (!id) {
        findings.push({
          product: name,
          check: 'Variant identifier',
          detail: `Variant "${clip(
            v.name || '(unnamed)'
          )}" has no sku or gtin; each variant needs a unique one.`,
        });
        continue;
      }
      seen.set(id, (seen.get(id) || 0) + 1);
    }
    for (const [id, n] of seen) {
      if (n > 1) {
        findings.push({
          product: name,
          check: 'Variant identifier',
          detail: `${n} variants share the identifier "${clip(id)}"; each must be unique.`,
        });
      }
    }
  }
  // Products that look like variants of one thing (same name, different identifiers) but are not grouped.
  /** @type {Map<string, Set<string>>} */
  const byName = new Map();
  for (const e of products) {
    const p = /** @type {NonNullable<Entity['product']>} */ (e.product);
    if (hasType(e, 'ProductGroup') || p.isVariantOf || !e.name) continue;
    const id = p.sku || Object.values(p.gtins)[0] || p.mpn;
    if (!id) continue;
    const set = byName.get(e.name) || new Set();
    set.add(id);
    byName.set(e.name, set);
  }
  for (const [name, ids] of byName) {
    if (ids.size > 1) {
      findings.push({
        product: clip(name),
        check: 'Grouping',
        detail: `${ids.size} products share this name with different identifiers but are not in a ProductGroup. If they are variants, use ProductGroup with hasVariant.`,
      });
    }
  }
  return {applicable: true, findings};
}

/** @param {Entity[]} entities @return {Product} */
function variantsProduct(entities) {
  const {applicable, findings} = evaluateVariants(entities);
  if (!applicable) return notApplicable('The page has no Product markup.');
  const problems = findings.filter(f => !f.detail.startsWith('Note: '));
  if (problems.length === 0) {
    return {
      score: 1,
      ...(findings.length && {
        details: table(
          [
            {key: 'product', heading: 'Product'},
            {key: 'check', heading: 'Check'},
            {key: 'detail', heading: 'Finding'},
          ],
          findings
        ),
      }),
    };
  }
  return {
    score: 0.5,
    displayValue: count(problems.length, 'variant problem'),
    explanation: problems
      .slice(0, 5)
      .map(f => `${f.product}: ${f.detail}`)
      .join(' '),
    details: table(
      [
        {key: 'product', heading: 'Product'},
        {key: 'check', heading: 'Check'},
        {key: 'detail', heading: 'Finding'},
      ],
      findings
    ),
  };
}

// ---------------------------------------------------------------- crawl-based

/**
 * @param {CrawlPage} page
 * @return {boolean} Whether the crawled page is a product page worth judging: read, status 200, not noindex, with product markup.
 */
function isProductPage(page) {
  if (page.extraction !== 'ok' || page.status !== 200) return false;
  if (page.robotsMetas.some(m => /noindex|none/i.test(m.content))) return false;
  if (page.xRobotsTag.some(v => /noindex|none/i.test(v))) return false;
  return (page.entities || []).some(isProduct);
}

/**
 * @param {SiteCrawlArtifact} artifact
 * @return {{snapshot: NonNullable<SiteCrawlArtifact['snapshot']>} | {reason: string}}
 */
function usableSnapshot(artifact) {
  if (!artifact || !artifact.snapshot) {
    return {
      reason:
        artifact && artifact.state === 'disabled'
          ? 'The site crawl is switched off.'
          : 'The site crawl was not collected.',
    };
  }
  return {snapshot: artifact.snapshot};
}

/**
 * @param {NonNullable<SiteCrawlArtifact['snapshot']>} snapshot
 * @return {string | null} Why the audited page cannot be used to judge product markup, or null when it was read in full.
 */
function auditedPageProblem(snapshot) {
  const audited = snapshot.pages.find(p => p.source === 'audited');
  if (!audited) return 'The crawl did not include the audited page.';
  if (audited.extraction === 'error' || audited.status === null) {
    return 'The crawler could not fetch the audited page.';
  }
  if (!(audited.status >= 200 && audited.status < 300)) {
    return `The crawler got status ${audited.status} for the audited page (a site can answer a crawler differently from a browser), so its product markup was not read.`;
  }
  if (audited.extraction !== 'ok') return 'The crawler could not read the audited page as HTML.';
  if (audited.truncated) {
    return 'The crawler read only the start of the audited page (it is larger than the size cap), so markup near its end may be missing.';
  }
  return null;
}

/**
 * Groups the internal links the crawl saw by path, and finds paths reached with many different combinations of facet
 * parameters: the shape of a faceted-navigation crawl trap. Tracking, session and pagination parameters are ignored.
 * @param {NonNullable<SiteCrawlArtifact['snapshot']>} snapshot
 * @return {Array<{path: string, urls: number, params: string[], example: string}>} Worst first.
 */
function findFacetExplosions(snapshot) {
  /** @type {Map<string, {signatures: Set<string>, names: Set<string>, example: string}>} */
  const byPath = new Map();
  /** @param {string} href */
  const add = href => {
    /** @type {URL} */
    let url;
    try {
      url = new URL(href);
    } catch (_) {
      return;
    }
    if (!url.search) return;
    /** @type {Array<[string, string]>} */
    const pairs = [];
    for (const [k, v] of url.searchParams) {
      const name = k.toLowerCase();
      if (isTrackingParam(name) || isSessionParam(name, v) || PAGINATION_PARAMS.has(name)) continue;
      pairs.push([name, v]);
    }
    if (pairs.length === 0) return;
    pairs.sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
    );
    const key = `${url.origin}${url.pathname}`;
    let entry = byPath.get(key);
    if (!entry) {
      entry = {signatures: new Set(), names: new Set(), example: href};
      byPath.set(key, entry);
    }
    if (entry.signatures.size < 5000) {
      entry.signatures.add(pairs.map(([k, v]) => `${k}=${v}`).join('&'));
    }
    for (const [k] of pairs) entry.names.add(k);
  };
  for (const page of snapshot.pages) {
    add(page.url);
    for (const link of page.links) add(link.url);
  }
  return [...byPath.entries()]
    .filter(([, e]) => e.signatures.size >= MIN_FACET_URLS && e.names.size >= MIN_FACET_PARAMS)
    .map(([path, e]) => ({
      path: clip(path),
      urls: e.signatures.size,
      params: [...e.names].sort().slice(0, 8),
      example: clip(e.example),
    }))
    .sort((a, b) => b.urls - a.urls);
}

/** @param {SiteCrawlArtifact} artifact @return {Product} */
function facetedProduct(artifact) {
  const usable = usableSnapshot(artifact);
  if (!('snapshot' in usable)) return notApplicable(usable.reason);
  const found = findFacetExplosions(usable.snapshot);
  if (found.length === 0) return {score: 1, displayValue: 'No facet explosion seen'};
  return {
    score: 0.5,
    displayValue: count(found.length, 'path'),
    explanation: `${found[0].path} is linked with ${
      found[0].urls
    } different combinations of ${found[0].params.join(
      ', '
    )}. Combinations like this can use up a crawler's time on near-duplicate pages. Keep facet links out of the crawl (nofollow, robots.txt, or a canonical to the unfiltered page) unless they are pages you want indexed. The crawl is partial, so the real number may be higher.`,
    details: table(
      [
        {key: 'path', heading: 'Path'},
        {key: 'urls', heading: 'Combinations seen'},
        {key: 'params', heading: 'Parameters'},
        {key: 'example', heading: 'Example'},
      ],
      found.map(f => ({
        path: f.path,
        urls: String(f.urls),
        params: f.params.join(', '),
        example: f.example,
      }))
    ),
  };
}

/**
 * @param {import('./sitemap-parse.js').SitemapDocumentsArtifact | null | undefined} sitemaps
 * @return {{listed: Set<string>} | {reason: string}} The set of listed URLs, or why a "not listed" verdict cannot be trusted.
 */
function listedUrls(sitemaps) {
  if (!sitemaps || sitemaps.discovery === 'none' || sitemaps.discovery === 'unavailable') {
    return {reason: 'No sitemap was found, so there is nothing to compare with.'};
  }
  if (sitemaps.documentsTruncated) {
    return {
      reason:
        'The sitemap has more files than were read, so a page missing from it cannot be proved.',
    };
  }
  const docs = sitemaps.documents || [];
  if (docs.some(d => d.outcome !== 'ok' || d.entriesTruncated || d.kind === 'invalid')) {
    return {
      reason:
        'A sitemap file could not be read in full, so a page missing from it cannot be proved.',
    };
  }
  /** @type {Set<string>} */
  const listed = new Set();
  for (const d of docs) {
    if (d.kind !== 'urlset') continue;
    for (const loc of d.locs) {
      const key = looseKey(loc);
      if (key) listed.add(key);
    }
  }
  return listed.size ? {listed} : {reason: 'The sitemap lists no URLs.'};
}

/**
 * @param {SiteCrawlArtifact} artifact
 * @param {import('./sitemap-parse.js').SitemapDocumentsArtifact | null | undefined} sitemaps
 * @param {(page: CrawlPage) => boolean} isTarget Which crawled pages are the ones that should be listed.
 * @param {string} noun For messages, for example "product".
 * @return {Product}
 */
function sitemapCoverageProduct(artifact, sitemaps, isTarget, noun) {
  const usable = usableSnapshot(artifact);
  if (!('snapshot' in usable)) return notApplicable(usable.reason);
  const targets = usable.snapshot.pages.filter(isTarget);
  if (targets.length === 0) {
    const problem = auditedPageProblem(usable.snapshot);
    return notApplicable(problem || `The crawl found no ${noun} pages.`);
  }
  const listed = listedUrls(sitemaps);
  if (!('listed' in listed)) return notApplicable(listed.reason);
  const audited = usable.snapshot.pages.find(p => p.source === 'audited');
  const missing = targets.filter(
    p => !listed.listed.has(looseKey(p.finalUrl) || '') && !listed.listed.has(looseKey(p.url) || '')
  );
  if (missing.length === 0) {
    return {score: 1, displayValue: `${count(targets.length, `${noun} page`)} listed`};
  }
  const auditedMissing = !!audited && missing.includes(audited);
  /** @type {Product} */
  const product = {
    // As the other cross-page audits: the audited page is what is judged; the rest are listed.
    score: auditedMissing ? 0.5 : 1,
    displayValue: `${missing.length} of ${targets.length} ${noun} pages not listed`,
    details: table(
      [
        {key: 'url', heading: 'Page'},
        {key: 'note', heading: 'Note'},
      ],
      missing.map(p => ({url: clip(p.finalUrl), note: p === audited ? 'The audited page' : ''}))
    ),
  };
  if (auditedMissing) {
    product.explanation = `This ${noun} page is not in any sitemap. Sitemaps help crawlers find and recrawl pages; list every page you want indexed.`;
  } else {
    product.explanation = `${missing.length} other crawled ${noun} page${
      missing.length === 1 ? ' is' : 's are'
    } not in any sitemap (listed below, not judged). The audited page is listed.`;
  }
  return product;
}

/** @param {SiteCrawlArtifact} artifact @param {import('./sitemap-parse.js').SitemapDocumentsArtifact | null | undefined} sitemaps @return {Product} */
function productSitemapProduct(artifact, sitemaps) {
  return sitemapCoverageProduct(artifact, sitemaps, isProductPage, 'product');
}

/**
 * @param {SiteCrawlArtifact} artifact
 * @return {Product}
 */
function categoryLinkingProduct(artifact) {
  const usable = usableSnapshot(artifact);
  if (!('snapshot' in usable)) return notApplicable(usable.reason);
  const script = scriptBuiltContent(artifact);
  if (script) {
    return notApplicable(
      'The audited page looks to be built by script, so the links the crawler read are not its real links.'
    );
  }
  const graph = buildGraph(usable.snapshot);
  const productNodes = [...graph.nodes.values()].filter(n => isProductPage(n.page));
  if (productNodes.length === 0) {
    return notApplicable(
      auditedPageProblem(usable.snapshot) || 'The crawl found no product pages.'
    );
  }
  const completeness = crawlCompleteness(usable.snapshot);
  if (!completeness.complete) {
    return notApplicable(
      `Whether a product page is linked from a category page is only known if the crawl saw the whole site, and here ${completeness.reasons.join(
        '; '
      )}.`
    );
  }
  const productKeys = new Set(productNodes.map(n => n.key));
  const listingKeys = new Set(
    [...graph.nodes.values()]
      .filter(
        n =>
          n.page.extraction === 'ok' &&
          [...n.out].filter(k => productKeys.has(k)).length >= MIN_LISTING_LINKS
      )
      .map(n => n.key)
  );
  if (listingKeys.size === 0) {
    return notApplicable(
      `No crawled page links to ${MIN_LISTING_LINKS} or more product pages, so there is no category page to compare with.`
    );
  }
  const unlinked = productNodes.filter(n => ![...n.in].some(k => listingKeys.has(k)));
  const audited = usable.snapshot.pages.find(p => p.source === 'audited');
  if (unlinked.length === 0) {
    return {
      score: 1,
      displayValue: `${count(productNodes.length, 'product page')} linked from a category page`,
    };
  }
  const auditedUnlinked =
    !!audited && unlinked.some(n => n.page === audited || n.key === looseKey(audited.finalUrl));
  return {
    score: auditedUnlinked ? 0.5 : 1,
    displayValue: `${unlinked.length} of ${productNodes.length} product pages not linked from a category page`,
    explanation: auditedUnlinked
      ? 'No category page (a page that links to 3 or more products) links to this product. Shoppers and crawlers reach products through categories; link every product from at least one.'
      : `${unlinked.length} other product page${
          unlinked.length === 1 ? ' is' : 's are'
        } not linked from any category page (listed below, not judged).`,
    details: table(
      [
        {key: 'url', heading: 'Product page'},
        {key: 'inbound', heading: 'Pages linking to it'},
      ],
      unlinked.map(n => ({url: clip(n.page.finalUrl), inbound: String(n.in.size)}))
    ),
  };
}

export {
  evaluateIdentifiers,
  identifiersProduct,
  evaluateOffers,
  offerValuesProduct,
  evaluateVariants,
  variantsProduct,
  findFacetExplosions,
  facetedProduct,
  productSitemapProduct,
  sitemapCoverageProduct,
  listedUrls,
  categoryLinkingProduct,
  isProductPage,
  gtinProblem,
  gtinCheckDigitOk,
  priceProblem,
  enumToken,
  usableSnapshot,
  MIN_FACET_URLS,
  MIN_LISTING_LINKS,
};
