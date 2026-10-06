/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * One small, bounded "facts" projection of a page's JSON-LD, shared by the audits that judge the audited page
 * (from the `StructuredDataJsonLd` artifact) and by the site crawler (which stores it for every crawled page). Using
 * one projection for both means a page-level and a cross-page audit can never disagree about what a page says.
 *
 * It keeps only a whitelist of properties (identity, address, phone, hours, geo, sameAs, product identifiers, offers and
 * variants) as short strings, so a hostile page cannot make a snapshot large: at most 10 blocks of 200,000 characters
 * are read, at most 10 entities and about 6,000 characters of facts are kept per page, and every string, list and
 * nesting level is capped. Values are kept as the page wrote them (a price is the string "1,299.00", not a number), because
 * the audits judge the format. `@type` may be a string or a list; `@graph` containers and bare `{"@id": ...}`
 * references are resolved one level deep. No I/O, never throws.
 */

const MAX_BLOCKS = 10;
const MAX_BLOCK_CHARS = 200_000;
const MAX_ENTITIES = 10;
const MAX_FACT_CHARS = 6_000;
const MAX_STRING = 200;
const MAX_LIST = 20;
const MAX_OFFERS = 10;
const MAX_VARIANTS = 20;
const MAX_TYPES = 5;
const ARTICLE_TYPES = new Set([
  'Article',
  'NewsArticle',
  'BlogPosting',
  'ReportageNewsArticle',
  'AnalysisNewsArticle',
  'OpinionNewsArticle',
  'ReviewNewsArticle',
  'BackgroundNewsArticle',
  'LiveBlogPosting',
  'TechArticle',
  'SocialMediaPosting',
]);

/**
 * @typedef {{
 *   streetAddress: string | null, addressLocality: string | null, addressRegion: string | null,
 *   postalCode: string | null, addressCountry: string | null,
 * }} Address
 * @typedef {{
 *   kind: 'Offer' | 'AggregateOffer', price: string | null, lowPrice: string | null, highPrice: string | null,
 *   priceCurrency: string | null, availability: string[], itemCondition: string[], url: string | null,
 * }} Offer
 * @typedef {{
 *   name: string | null, id: string | null, url: string | null, sku: string | null, gtin: string | null, mpn: string | null,
 *   detailed: boolean,
 * }} Variant
 * `detailed` is false for a variant that is only a pointer (`{"@type": "Product", "url": ...}`): each variant has its own page.
 * @typedef {{
 *   sku: string | null, gtins: Record<string, string>, mpn: string | null, brand: string | null,
 *   productGroupID: string | null, variesBy: string[], variantCount: number, variants: Variant[],
 *   isVariantOf: string | null, offers: Offer[], hasImage: boolean,
 * }} ProductFacts
 * @typedef {{type: string | null, name: string | null, url: string | null, hasSameAs: boolean}} Author
 * @typedef {{
 *   headline: string | null, datePublished: string | null, dateModified: string | null, authors: Author[],
 *   publisher: string | null, hasImage: boolean, isAccessibleForFree: string | null,
 *   paywallParts: Array<{isAccessibleForFree: string | null, cssSelector: string | null}>,
 * }} ArticleFacts
 * @typedef {{
 *   name: string | null, description: string | null, thumbnailUrls: string[], uploadDate: string | null,
 *   duration: string | null, contentUrl: string | null, embedUrl: string | null, expires: string | null,
 * }} VideoFacts
 * @typedef {{
 *   types: string[], id: string | null, name: string | null, url: string | null,
 *   address: Address | null, telephone: string | null, email: string | null,
 *   geo: {latitude: string | null, longitude: string | null} | null,
 *   openingHours: string[], openingHoursSpecification: Array<{dayOfWeek: string[], opens: string | null, closes: string | null}>,
 *   priceRange: string | null, sameAs: string[], logo: string | null,
 *   identifiers: Record<string, string>, product: ProductFacts | null, article: ArticleFacts | null,
 *   video: VideoFacts | null,
 * }} Entity
 */

/**
 * @param {unknown} v
 * @return {v is Record<string, unknown>}
 */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @return {string | null} A trimmed, clipped string from a string, a number or a `{"@value": ...}` node.
 */
function text(v) {
  if (isObject(v) && '@value' in v) return text(v['@value']);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length <= MAX_STRING ? t : t.slice(0, MAX_STRING);
}

/**
 * @param {unknown} v
 * @return {unknown[]} The value as a list (a single value becomes a one-item list), capped.
 */
function list(v) {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).slice(0, MAX_LIST);
}

/**
 * @param {unknown} v
 * @param {Map<string, Record<string, unknown>>} ids
 * @return {unknown} A bare `{"@id": ...}` reference replaced by the node it names, when the page defines it.
 */
function deref(v, ids) {
  if (isObject(v) && typeof v['@id'] === 'string' && Object.keys(v).length === 1) {
    return ids.get(v['@id']) || v;
  }
  return v;
}

/**
 * @param {unknown} v A value that is a URL, or an object that carries one.
 * @param {Map<string, Record<string, unknown>>} ids
 * @return {string | null}
 */
function urlOf(v, ids) {
  const d = deref(v, ids);
  if (typeof d === 'string') return text(d);
  if (isObject(d)) return text(d.url) || text(d.contentUrl) || text(d['@id']);
  return null;
}

/**
 * @param {unknown} v
 * @param {Map<string, Record<string, unknown>>} ids
 * @return {string | null} A name from a string or from a node with a `name`.
 */
function nameOf(v, ids) {
  const d = deref(v, ids);
  if (typeof d === 'string') return text(d);
  if (isObject(d)) return text(d.name);
  return null;
}

/**
 * @param {unknown} v
 * @return {string[]}
 */
function types(v) {
  return list(v)
    .map(text)
    .filter(/** @return {t is string} */ t => !!t)
    .slice(0, MAX_TYPES);
}

/**
 * @param {unknown} raw
 * @param {Map<string, Record<string, unknown>>} ids
 * @return {Address | null}
 */
function addressOf(raw, ids) {
  const d = deref(list(raw)[0], ids);
  if (typeof d === 'string') {
    const t = text(d);
    return t
      ? {
          streetAddress: t,
          addressLocality: null,
          addressRegion: null,
          postalCode: null,
          addressCountry: null,
        }
      : null;
  }
  if (!isObject(d)) return null;
  const country = deref(d.addressCountry, ids);
  return {
    streetAddress: text(d.streetAddress),
    addressLocality: text(d.addressLocality),
    addressRegion: text(d.addressRegion),
    postalCode: text(d.postalCode),
    addressCountry: isObject(country) ? text(country.name) : text(country),
  };
}

/**
 * @param {unknown} raw
 * @param {Map<string, Record<string, unknown>>} ids
 * @return {Offer[]}
 */
function offersOf(raw, ids) {
  /** @type {Offer[]} */
  const out = [];
  for (const item of list(raw)) {
    const o = deref(item, ids);
    if (!isObject(o)) continue;
    const spec = deref(o.priceSpecification, ids);
    const specPrice = isObject(spec) ? text(spec.price) : null;
    const specCurrency = isObject(spec) ? text(spec.priceCurrency) : null;
    out.push({
      kind: types(o['@type']).includes('AggregateOffer') ? 'AggregateOffer' : 'Offer',
      price: text(o.price) ?? specPrice,
      lowPrice: text(o.lowPrice),
      highPrice: text(o.highPrice),
      priceCurrency: text(o.priceCurrency) ?? specCurrency,
      availability: list(o.availability)
        .map(text)
        .filter(/** @return {a is string} */ a => !!a),
      itemCondition: list(o.itemCondition)
        .map(text)
        .filter(/** @return {a is string} */ a => !!a),
      url: urlOf(o.url, ids),
    });
    if (out.length >= MAX_OFFERS) break;
  }
  return out;
}

/**
 * @param {Record<string, unknown>} node
 * @param {Map<string, Record<string, unknown>>} ids
 * @return {ProductFacts}
 */
function productOf(node, ids) {
  /** @type {Record<string, string>} */
  const gtins = {};
  for (const key of ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14']) {
    const t = text(node[key]);
    if (t) gtins[key] = t;
  }
  const variantNodes = list(node.hasVariant).map(v => deref(v, ids));
  const variants = variantNodes
    .filter(isObject)
    .slice(0, MAX_VARIANTS)
    .map(v => ({
      name: text(v.name),
      id: text(v['@id']),
      url: urlOf(v.url, ids),
      detailed: Object.keys(v).some(k => k !== '@type' && k !== '@id' && k !== 'url'),
      sku: text(v.sku),
      gtin: text(v.gtin) || text(v.gtin13) || text(v.gtin12) || text(v.gtin14) || text(v.gtin8),
      mpn: text(v.mpn),
    }));
  const group = deref(node.isVariantOf, ids);
  return {
    sku: text(node.sku),
    gtins,
    mpn: text(node.mpn),
    brand: nameOf(node.brand, ids),
    productGroupID: text(node.productGroupID),
    variesBy: list(node.variesBy)
      .map(text)
      .filter(/** @return {t is string} */ t => !!t),
    variantCount: variantNodes.length,
    variants,
    isVariantOf: isObject(group)
      ? text(group['@id']) || text(group.name) || text(group.productGroupID)
      : text(group),
    offers: offersOf(node.offers, ids),
    hasImage: list(node.image).some(i => !!urlOf(i, ids)),
  };
}

/**
 * @param {unknown} v
 * @return {string | null} Like `text`, but also reads a JSON boolean (`false` is "false", never absent).
 */
function flag(v) {
  return typeof v === 'boolean' ? String(v) : text(v);
}

/**
 * @param {Record<string, unknown>} node
 * @param {Map<string, Record<string, unknown>>} ids
 * @return {ArticleFacts}
 */
function articleOf(node, ids) {
  const authors = list(node.author).map(a => {
    const d = deref(a, ids);
    if (typeof d === 'string') return {type: null, name: text(d), url: null, hasSameAs: false};
    if (!isObject(d)) return {type: null, name: null, url: null, hasSameAs: false};
    return {
      type: types(d['@type'])[0] || null,
      name: text(d.name),
      url: urlOf(d.url, ids),
      hasSameAs: list(d.sameAs).length > 0,
    };
  });
  return {
    headline: text(node.headline),
    datePublished: text(node.datePublished),
    dateModified: text(node.dateModified),
    authors,
    publisher: nameOf(node.publisher, ids),
    hasImage: list(node.image).some(i => !!urlOf(i, ids)),
    isAccessibleForFree: flag(node.isAccessibleForFree),
    paywallParts: list(node.hasPart)
      .map(p => deref(p, ids))
      .filter(isObject)
      .map(p => ({
        isAccessibleForFree: flag(p.isAccessibleForFree),
        cssSelector: text(p.cssSelector),
      })),
  };
}

/**
 * @param {Record<string, unknown>} node
 * @param {Map<string, Record<string, unknown>>} ids
 * @return {VideoFacts}
 */
function videoOf(node, ids) {
  return {
    name: text(node.name),
    description: text(node.description),
    thumbnailUrls: list(node.thumbnailUrl)
      .map(u => urlOf(u, ids))
      .filter(/** @return {t is string} */ t => !!t),
    uploadDate: text(node.uploadDate),
    duration: text(node.duration),
    contentUrl: urlOf(node.contentUrl, ids),
    embedUrl: urlOf(node.embedUrl, ids),
    expires: text(node.expires),
  };
}

/**
 * @param {Record<string, unknown>} node
 * @param {Map<string, Record<string, unknown>>} ids
 * @return {Entity}
 */
function entityOf(node, ids) {
  const entityTypes = types(node['@type']);
  const geo = deref(node.geo, ids);
  const isProduct = entityTypes.some(
    t => t === 'Product' || t === 'ProductGroup' || t === 'IndividualProduct'
  );
  /** @type {Record<string, string>} */
  const identifiers = {};
  for (const key of ['iso6523Code', 'leiCode', 'duns', 'naics', 'taxID', 'vatID']) {
    const t = text(node[key]);
    if (t) identifiers[key] = t;
  }
  return {
    types: entityTypes,
    id: text(node['@id']),
    name: nameOf(node, ids),
    url: urlOf(node.url, ids),
    address: addressOf(node.address, ids),
    telephone: text(node.telephone),
    email: text(node.email),
    geo: isObject(geo) ? {latitude: text(geo.latitude), longitude: text(geo.longitude)} : null,
    openingHours: list(node.openingHours)
      .map(text)
      .filter(/** @return {t is string} */ t => !!t),
    openingHoursSpecification: list(node.openingHoursSpecification)
      .map(s => deref(s, ids))
      .filter(isObject)
      .map(s => ({
        dayOfWeek: list(s.dayOfWeek)
          .map(text)
          .filter(/** @return {t is string} */ t => !!t),
        opens: text(s.opens),
        closes: text(s.closes),
      })),
    priceRange: text(node.priceRange),
    sameAs: list(node.sameAs)
      .map(v => urlOf(v, ids))
      .filter(/** @return {t is string} */ t => !!t),
    logo: urlOf(node.logo, ids),
    identifiers,
    product: isProduct ? productOf(node, ids) : null,
    article: entityTypes.some(t => ARTICLE_TYPES.has(t)) ? articleOf(node, ids) : null,
    video: entityTypes.includes('VideoObject') ? videoOf(node, ids) : null,
  };
}

/**
 * @param {string} content One `<script type="application/ld+json">` text.
 * @return {Entity[]}
 */
function entitiesOfBlock(content) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    return [];
  }
  /** @type {Array<Record<string, unknown>>} */
  const nodes = [];
  /** @param {unknown} value */
  const collect = value => {
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 200)) collect(item);
    } else if (isObject(value)) {
      if (value['@type'] !== undefined) nodes.push(value);
      if (Array.isArray(value['@graph'])) {
        for (const item of value['@graph'].slice(0, 200)) collect(item);
      }
    }
  };
  collect(parsed);
  /** @type {Map<string, Record<string, unknown>>} */
  const ids = new Map();
  for (const n of nodes) {
    if (typeof n['@id'] === 'string' && !ids.has(n['@id'])) ids.set(n['@id'], n);
  }
  return nodes.map(n => entityOf(n, ids));
}

/**
 * @param {string[]} contents The text of each JSON-LD block on a page.
 * @return {Entity[]} At most 10 entities and about 6,000 characters of facts; later ones are dropped.
 */
function projectEntities(contents) {
  /** @type {Entity[]} */
  const out = [];
  let chars = 0;
  for (const content of (contents || []).slice(0, MAX_BLOCKS)) {
    if (typeof content !== 'string' || content.length > MAX_BLOCK_CHARS) continue;
    for (const entity of entitiesOfBlock(content)) {
      const size = JSON.stringify(entity).length;
      if (out.length >= MAX_ENTITIES || chars + size > MAX_FACT_CHARS) return out;
      out.push(entity);
      chars += size;
    }
  }
  return out;
}

/**
 * @param {Array<{content: string}> | null | undefined} blocks The `StructuredDataJsonLd` artifact.
 * @return {Entity[]} The facts of the audited page.
 */
function entitiesFromArtifact(blocks) {
  return projectEntities(
    (Array.isArray(blocks) ? blocks : []).map(b =>
      b && typeof b.content === 'string' ? b.content : ''
    )
  );
}

/**
 * @param {Entity} entity
 * @param {...string} names
 * @return {boolean} Whether the entity has any of these schema.org types.
 */
function hasType(entity, ...names) {
  return entity.types.some(t => names.includes(t));
}

/** Local business types: `LocalBusiness` and the common subtypes Google documents or sites use. */
const LOCAL_BUSINESS_TYPES = [
  'LocalBusiness',
  'Store',
  'Restaurant',
  'CafeOrCoffeeShop',
  'BarOrPub',
  'Bakery',
  'FastFoodRestaurant',
  'Hotel',
  'LodgingBusiness',
  'MedicalBusiness',
  'Dentist',
  'Physician',
  'Pharmacy',
  'Hospital',
  'AutomotiveBusiness',
  'AutoRepair',
  'AutoDealer',
  'HomeAndConstructionBusiness',
  'Plumber',
  'Electrician',
  'FinancialService',
  'BankOrCreditUnion',
  'InsuranceAgency',
  'LegalService',
  'Attorney',
  'RealEstateAgent',
  'HealthAndBeautyBusiness',
  'HairSalon',
  'BeautySalon',
  'DaySpa',
  'HealthClub',
  'GroceryStore',
  'ShoppingCenter',
  'ClothingStore',
  'ElectronicsStore',
  'FurnitureStore',
  'HardwareStore',
  'BookStore',
  'PetStore',
  'Florist',
  'TravelAgency',
  'TouristInformationCenter',
  'ProfessionalService',
  'AccountingService',
  'ChildCare',
  'EntertainmentBusiness',
  'SportsActivityLocation',
  'Library',
  'GasStation',
  'ParkingFacility',
];

/** @param {Entity} entity @return {boolean} */
function isLocalBusiness(entity) {
  return hasType(entity, ...LOCAL_BUSINESS_TYPES);
}

/** @param {Entity} entity @return {boolean} */
function isProduct(entity) {
  return !!entity.product;
}

export {
  ARTICLE_TYPES,
  projectEntities,
  entitiesFromArtifact,
  hasType,
  isLocalBusiness,
  isProduct,
  LOCAL_BUSINESS_TYPES,
  MAX_FACT_CHARS,
  MAX_ENTITIES,
};
