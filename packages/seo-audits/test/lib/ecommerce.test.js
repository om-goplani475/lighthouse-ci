/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {projectEntities} = require('../../src/lib/structured-facts.js');
const {
  evaluateIdentifiers,
  identifiersProduct,
  evaluateOffers,
  offerValuesProduct,
  evaluateVariants,
  variantsProduct,
  findFacetExplosions,
  facetedProduct,
  productSitemapProduct,
  categoryLinkingProduct,
  gtinProblem,
  gtinCheckDigitOk,
  priceProblem,
  enumToken,
} = require('../../src/lib/ecommerce.js');

const ents = (...objs) => projectEntities(objs.map(o => JSON.stringify(o)));
const product = (over = {}) => ({
  '@type': 'Product',
  name: 'Shoe',
  brand: {name: 'Acme'},
  sku: 'SH-1',
  offers: {
    '@type': 'Offer',
    price: '19.99',
    priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
  },
  ...over,
});

describe('GTIN checks', () => {
  it('accepts real GTINs of every length (UPC-A, EAN-13, EAN-8, GTIN-14)', () => {
    for (const [key, value] of [
      ['gtin12', '036000291452'],
      ['gtin13', '4006381333931'],
      ['gtin8', '96385074'],
      ['gtin', '4006381333931'],
      ['gtin14', '10036000291459'],
      ['gtin', '036000291452'],
    ]) {
      expect(gtinProblem(key, value)).toBeNull();
    }
  });

  it('flags non-numeric values, wrong lengths and a wrong check digit, with the reason', () => {
    expect(gtinProblem('gtin13', 'ABC123')).toMatch(/not numeric/);
    expect(gtinProblem('gtin13', '123-456')).toMatch(/not numeric/);
    expect(gtinProblem('gtin13', '036000291452')).toMatch(/12 digits \(expected 13\)/);
    expect(gtinProblem('gtin', '12345')).toMatch(/5 digits \(expected 8 or 12 or 13 or 14\)/);
    expect(gtinProblem('gtin13', '4006381333932')).toMatch(/invalid check digit/);
    expect(gtinCheckDigitOk('4006381333931')).toBe(true);
    expect(gtinCheckDigitOk('4006381333930')).toBe(false);
  });
});

describe('product-identifiers', () => {
  it('is not applicable without a Product, or with only a ProductGroup', () => {
    expect(identifiersProduct(ents({'@type': 'Organization', name: 'x'})).notApplicable).toBe(true);
    expect(
      identifiersProduct(ents({'@type': 'ProductGroup', name: 'g', productGroupID: 'g'}))
        .notApplicable
    ).toBe(true);
    expect(identifiersProduct([]).notApplicable).toBe(true);
  });

  it('passes a product with an identifier and a brand', () => {
    expect(identifiersProduct(ents(product())).score).toBe(1);
    expect(identifiersProduct(ents(product({sku: undefined, gtin13: '4006381333931'}))).score).toBe(
      1
    );
    expect(identifiersProduct(ents(product({sku: undefined, mpn: 'M1'}))).score).toBe(1);
  });

  it('warns (a partial score) for no identifier, no brand, a bad GTIN, or whitespace in the sku', () => {
    const none = evaluateIdentifiers(ents(product({sku: undefined})));
    expect(none.findings.map(f => f.check)).toEqual(['Identifier']);
    expect(
      evaluateIdentifiers(ents(product({brand: undefined}))).findings.map(f => f.check)
    ).toEqual(['Brand']);
    expect(
      evaluateIdentifiers(ents(product({gtin13: '4006381333932'}))).findings[0].detail
    ).toMatch(/check digit/);
    expect(evaluateIdentifiers(ents(product({sku: 'AB 12'}))).findings[0].detail).toMatch(
      /whitespace/
    );
    const result = identifiersProduct(ents(product({sku: undefined, brand: undefined})));
    expect(result.score).toBe(0.5);
    expect(result.details.items).toHaveLength(2);
  });

  it('judges each product on the page, and does not judge the products of a group by the group', () => {
    const r = evaluateIdentifiers(ents(product(), product({name: 'Boot', sku: undefined})));
    expect(r.products).toBe(2);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].product).toBe('Boot');
  });
});

describe('priceProblem', () => {
  it('accepts plain numbers and notes a zero price', () => {
    for (const v of ['19.99', '19', '0.5', '1299.00']) expect(priceProblem(v).problem).toBeNull();
    expect(priceProblem('0').note).toMatch(/above zero/);
    expect(priceProblem('0.00').problem).toBeNull();
  });

  it('flags symbols, text, thousands separators, decimal commas, negatives and junk', () => {
    expect(priceProblem('$19.99').problem).toMatch(/currency symbol or text/);
    expect(priceProblem('19.99 USD').problem).toMatch(/currency symbol or text/);
    expect(priceProblem('1,299.00').problem).toMatch(/thousands separator; write it as 1299.00/);
    expect(priceProblem('19,99').problem).toMatch(/decimal mark/);
    expect(priceProblem('-5').problem).toMatch(/negative/);
    expect(priceProblem('free').problem).toMatch(/currency symbol or text/);
    expect(priceProblem('').problem).toMatch(/not a number/);
    expect(priceProblem('1.2.3').problem).toMatch(/not a number|currency/);
  });
});

describe('product-offer-values', () => {
  it('is not applicable without an offer', () => {
    expect(offerValuesProduct(ents(product({offers: undefined}))).notApplicable).toBe(true);
    expect(offerValuesProduct([]).notApplicable).toBe(true);
  });

  it('passes a correct offer, and accepts every spelling of an enumeration', () => {
    expect(offerValuesProduct(ents(product())).score).toBe(1);
    for (const a of [
      'https://schema.org/InStock',
      'http://schema.org/InStock',
      'schema:InStock',
      'InStock',
      ' InStock ',
      'OutOfStock',
      'PreOrder',
      'SoldOut',
    ]) {
      expect(
        evaluateOffers(ents(product({offers: {price: '1', priceCurrency: 'USD', availability: a}})))
          .problems
      ).toEqual([]);
    }
    for (const c of [
      'https://schema.org/NewCondition',
      'UsedCondition',
      'schema:RefurbishedCondition',
    ]) {
      expect(
        evaluateOffers(
          ents(product({offers: {price: '1', priceCurrency: 'USD', itemCondition: c}}))
        ).problems
      ).toEqual([]);
    }
  });

  it('fails (score 0) for invalid values, naming the field and the fix', () => {
    const run = offers =>
      evaluateOffers(ents(product({offers}))).problems.map(p => `${p.check}: ${p.detail}`);
    expect(run({price: '1,299.00', priceCurrency: 'USD'})[0]).toMatch(
      /^price: price "1,299.00" has a thousands separator/
    );
    expect(run({price: '$5', priceCurrency: 'USD'})[0]).toMatch(/currency symbol/);
    expect(run({price: '5', priceCurrency: 'EURO'})[0]).toMatch(/not an ISO 4217/);
    expect(run({price: '5', priceCurrency: 'XXQ'})[0]).toMatch(/not an ISO 4217/);
    expect(run({price: '5', priceCurrency: 'USD', availability: 'Available'})[0]).toMatch(
      /not a schema.org ItemAvailability/
    );
    expect(
      run({price: '5', priceCurrency: 'USD', availability: ['InStock', 'OutOfStock']})[0]
    ).toMatch(/only one is allowed/);
    expect(run({price: '5', priceCurrency: 'USD', itemCondition: 'Mint'})[0]).toMatch(
      /not NewCondition/
    );
    expect(
      run({price: '5', priceCurrency: 'USD', itemCondition: ['NewCondition', 'UsedCondition']})[0]
    ).toMatch(/only one is allowed/);
  });

  it('treats the same availability written two ways as one value', () => {
    const r = evaluateOffers(
      ents(
        product({
          offers: {
            price: '5',
            priceCurrency: 'USD',
            availability: ['https://schema.org/InStock', 'InStock'],
          },
        })
      )
    );
    expect(r.problems).toEqual([]);
  });

  it('notes, without failing, a lower-case currency and a zero price', () => {
    const r = evaluateOffers(ents(product({offers: {price: '0', priceCurrency: 'usd'}})));
    expect(r.problems).toEqual([]);
    expect(r.notes.map(n => n.check).sort()).toEqual(['price', 'priceCurrency']);
    const result = offerValuesProduct(ents(product({offers: {price: '0', priceCurrency: 'usd'}})));
    expect(result.score).toBe(1);
    expect(result.details.items).toHaveLength(2);
  });

  it('reads prices from priceSpecification and AggregateOffer', () => {
    expect(
      evaluateOffers(
        ents(product({offers: {priceSpecification: {price: '$5', priceCurrency: 'USD'}}}))
      ).problems
    ).toHaveLength(1);
    const agg = evaluateOffers(
      ents(
        product({
          offers: {
            '@type': 'AggregateOffer',
            lowPrice: '5',
            highPrice: '9,99',
            priceCurrency: 'USD',
          },
        })
      )
    );
    expect(agg.problems.map(p => p.check)).toEqual(['highPrice']);
  });

  it('judges every offer of every product', () => {
    const r = evaluateOffers(
      ents(
        product({
          offers: [
            {price: '1', priceCurrency: 'USD'},
            {price: 'x', priceCurrency: 'USD'},
          ],
        }),
        product({name: 'B', offers: {price: '2', priceCurrency: 'ZZZ'}})
      )
    );
    expect(r.offers).toBe(3);
    expect(r.problems).toHaveLength(2);
  });

  it('enumToken strips prefixes', () => {
    expect([
      enumToken('https://schema.org/InStock'),
      enumToken('schema:InStock'),
      enumToken(' InStock '),
    ]).toEqual(['InStock', 'InStock', 'InStock']);
  });
});

describe('product-variants', () => {
  const group = (over = {}) => ({
    '@type': 'ProductGroup',
    name: 'Shoe',
    productGroupID: 'SH',
    variesBy: ['https://schema.org/size', 'color'],
    hasVariant: [
      {'@type': 'Product', name: 'Shoe S', sku: 'SH-S'},
      {'@type': 'Product', name: 'Shoe M', sku: 'SH-M'},
    ],
    ...over,
  });

  it('is not applicable without products, and passes a simple product', () => {
    expect(variantsProduct([]).notApplicable).toBe(true);
    expect(variantsProduct(ents({'@type': 'Organization', name: 'x'})).notApplicable).toBe(true);
    expect(variantsProduct(ents(product())).score).toBe(1);
  });

  it('passes a complete group', () => {
    expect(variantsProduct(ents(group())).score).toBe(1);
  });

  it('warns for what the group is missing', () => {
    const checks = over => evaluateVariants(ents(group(over))).findings.map(f => f.check);
    expect(checks({productGroupID: undefined})).toContain('productGroupID');
    expect(checks({variesBy: undefined})).toContain('variesBy');
    expect(checks({hasVariant: undefined})).toContain('hasVariant');
    expect(variantsProduct(ents(group({variesBy: undefined}))).score).toBe(0.5);
  });

  it('does not demand identifiers from variants that are only pointers to their own pages (a real multi-page shop)', () => {
    const pointers = group({
      hasVariant: Array.from({length: 5}, (_, i) => ({
        '@type': 'Product',
        url: `https://shop.example/p/v${i}`,
      })),
    });
    const r = evaluateVariants(ents(pointers));
    expect(r.findings).toEqual([]);
    expect(variantsProduct(ents(pointers)).score).toBe(1);
    // an inline variant with details but no identifier is still judged
    const mixed = group({
      hasVariant: [
        {'@type': 'Product', url: 'https://shop.example/p/v1'},
        {'@type': 'Product', name: 'Detailed', offers: {price: '5'}},
      ],
    });
    expect(evaluateVariants(ents(mixed)).findings.map(f => f.check)).toEqual([
      'Variant identifier',
    ]);
  });

  it('only notes a ProductGroup with no hasVariant, because variants may live on their own pages', () => {
    const r = variantsProduct(ents(group({hasVariant: undefined})));
    expect(r.score).toBe(1);
    expect(r.details.items[0].detail).toMatch(/^Note: no hasVariant/);
  });

  it('warns for a variant with no identifier and for duplicate identifiers', () => {
    const noId = evaluateVariants(
      ents(
        group({
          hasVariant: [
            {'@type': 'Product', name: 'S'},
            {'@type': 'Product', name: 'M', sku: 'x'},
          ],
        })
      )
    );
    expect(noId.findings[0].detail).toMatch(/no sku or gtin/);
    const dup = evaluateVariants(
      ents(
        group({
          hasVariant: [
            {'@type': 'Product', sku: 'x'},
            {'@type': 'Product', sku: 'x'},
          ],
        })
      )
    );
    expect(dup.findings[0].detail).toMatch(/2 variants share/);
  });

  it('notes, without failing, a variesBy value Google does not list', () => {
    const r = variantsProduct(ents(group({variesBy: ['flavour']})));
    expect(r.score).toBe(1);
    expect(r.details.items[0].detail).toMatch(/^Note:/);
  });

  it('warns for products that look like variants but are not grouped', () => {
    const r = evaluateVariants(
      ents(product({sku: 'A'}), product({sku: 'B'}), product({name: 'Other', sku: 'C'}))
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].check).toBe('Grouping');
    // the same product listed twice with the same identifier is not a variant
    expect(evaluateVariants(ents(product(), product())).findings).toEqual([]);
    // a product that says it is a variant of a group is grouped
    expect(
      evaluateVariants(
        ents(
          product({sku: 'A', isVariantOf: {productGroupID: 'g'}}),
          product({sku: 'B', isVariantOf: {productGroupID: 'g'}})
        )
      ).findings
    ).toEqual([]);
  });
});

// ---- crawl-based

const page = (url, over = {}) => ({
  url,
  finalUrl: url,
  redirects: [],
  status: 200,
  contentType: 'text/html',
  bytes: 1000,
  truncated: false,
  title: null,
  description: null,
  canonicals: [],
  robotsMetas: [],
  xRobotsTag: [],
  h1: [],
  textHash: 'h',
  textLength: 500,
  wordCount: 100,
  links: [],
  externalLinks: [],
  pagination: {next: [], prev: []},
  entities: [],
  depth: 1,
  source: 'link',
  extraction: 'ok',
  ...over,
});
const link = url => ({url, nofollow: false, sponsored: false, ugc: false, anchor: 'x'});
const productPage = (url, over = {}) => page(url, {entities: ents(product({name: url})), ...over});
const snapshot = (pages, over = {}) => ({
  version: 3,
  origin: 'https://shop.example',
  createdAt: new Date().toISOString(),
  bounds: {pages: 50, depth: 3, budgetMs: 1000, robots: 'honour', userAgent: 'x'},
  robots: {state: 'present'},
  seeds: {audited: 1, home: 0, links: 0, sitemap: 0},
  sitemapUrls: [],
  pages,
  skipped: [],
  stats: {
    requests: pages.length,
    elapsedMs: 10,
    truncatedByBudget: false,
    overPageCap: false,
    cutByDepth: false,
  },
  ...over,
});
const artifact = (snap, state = 'crawled') => ({
  state,
  auditedUrl: 'https://shop.example/p/1',
  reason: null,
  snapshot: snap,
  auditedRenderedTextLength: null,
  linkChecks: null,
  externalChecks: null,
});

describe('faceted-navigation-explosion', () => {
  const facetLinks = (n, path = '/shoes') =>
    Array.from({length: n}, (_, i) =>
      link(`https://shop.example${path}?color=c${i % 7}&size=s${Math.floor(i / 7)}`)
    );

  it('is not applicable without a crawl', () => {
    expect(facetedProduct(artifact(null, 'disabled')).explanation).toMatch(/switched off/);
    expect(facetedProduct(artifact(null, 'unavailable')).notApplicable).toBe(true);
  });

  it('passes a site with no facet explosion', () => {
    expect(
      facetedProduct(
        artifact(
          snapshot([
            page('https://shop.example/', {links: [link('https://shop.example/shoes?color=red')]}),
          ])
        )
      ).score
    ).toBe(1);
  });

  it('warns when one path is linked with 20 or more combinations of 2 or more parameters', () => {
    const snap = snapshot([page('https://shop.example/', {links: facetLinks(30)})]);
    const {found} = findFacetExplosions(snap);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      path: 'https://shop.example/shoes',
      urls: 30,
      params: ['color', 'size'],
    });
    const result = facetedProduct(artifact(snap));
    expect(result.score).toBe(0.5);
    expect(result.details.items[0].urls).toBe('30');
    expect(result.explanation).toMatch(/partial/);
  });

  it('counts links across pages together, and orders the worst first', () => {
    // 12 + 12 distinct combinations of /shoes (24 together, over the threshold); 40 of /boots
    const other = Array.from({length: 12}, (_, i) =>
      link(`https://shop.example/shoes?color=x${i}&size=y${i}`)
    );
    const snap = snapshot([
      page('https://shop.example/', {links: facetLinks(12, '/shoes')}),
      page('https://shop.example/a', {links: [...other, ...facetLinks(40, '/boots')]}),
    ]);
    expect(findFacetExplosions(snap).found.map(f => [f.path, f.urls])).toEqual([
      ['https://shop.example/boots', 40],
      ['https://shop.example/shoes', 24],
    ]);
    // the same 12 on both pages are still 12 combinations
    const same = snapshot([
      page('https://shop.example/', {links: facetLinks(12)}),
      page('https://shop.example/a', {links: facetLinks(12)}),
    ]);
    expect(findFacetExplosions(same).found).toEqual([]);
  });

  it('does not flag fewer than 20 combinations, a single parameter, or tracking, session and pagination parameters', () => {
    expect(
      findFacetExplosions(snapshot([page('https://shop.example/', {links: facetLinks(19)})])).found
    ).toEqual([]);
    const oneParam = Array.from({length: 50}, (_, i) => link(`https://shop.example/item?id=${i}`));
    expect(
      findFacetExplosions(snapshot([page('https://shop.example/', {links: oneParam})])).found
    ).toEqual([]);
    const noise = Array.from({length: 50}, (_, i) =>
      link(`https://shop.example/list?utm_source=a${i}&page=${i}&PHPSESSID=${i}&gclid=${i}`)
    );
    expect(
      findFacetExplosions(snapshot([page('https://shop.example/', {links: noise})])).found
    ).toEqual([]);
  });

  it('does not warn about a path robots.txt already keeps the crawler out of, and says so', () => {
    // found on Wikipedia: /w/index.php is linked with hundreds of combinations but robots.txt disallows /w/
    const snap = snapshot(
      [
        page('https://shop.example/', {
          links: [...facetLinks(30, '/w/index.php'), ...facetLinks(25, '/shoes')],
        }),
      ],
      {
        skipped: [
          {
            url: 'https://shop.example/w/index.php?color=c1&size=s0',
            reason: 'blocked-by-robots',
            detail: null,
          },
        ],
      }
    );
    const {found, blocked} = findFacetExplosions(snap);
    expect(found.map(f => f.path)).toEqual(['https://shop.example/shoes']);
    expect(blocked).toBe(1);

    const onlyBlocked = snapshot(
      [page('https://shop.example/', {links: facetLinks(30, '/w/index.php')})],
      {
        skipped: [
          {
            url: 'https://shop.example/w/index.php?x=1&y=2',
            reason: 'blocked-by-robots',
            detail: null,
          },
        ],
      }
    );
    const result = facetedProduct(artifact(onlyBlocked));
    expect(result.score).toBe(1);
    expect(result.displayValue).toBe(
      'No open facet explosion seen (1 path with many combinations is blocked by robots.txt)'
    );
  });

  it('still warns when the skipped URLs are for another reason or another path', () => {
    const snap = snapshot([page('https://shop.example/', {links: facetLinks(30)})], {
      skipped: [
        {url: 'https://shop.example/shoes?color=c1&size=s1', reason: 'over-page-cap', detail: null},
        {url: 'https://shop.example/admin?a=1&b=2', reason: 'blocked-by-robots', detail: null},
        {url: 'not a url', reason: 'blocked-by-robots', detail: null},
      ],
    });
    expect(findFacetExplosions(snap).found).toHaveLength(1);
    expect(facetedProduct(artifact(snap)).score).toBe(0.5);
  });

  it('treats the same parameters in another order as one combination', () => {
    const links = Array.from({length: 40}, (_, i) =>
      link(`https://shop.example/s?${i % 2 ? 'a=1&b=2' : 'b=2&a=1'}`)
    );
    expect(findFacetExplosions(snapshot([page('https://shop.example/', {links})])).found).toEqual(
      []
    );
  });

  it('survives malformed link URLs', () => {
    expect(() =>
      findFacetExplosions(
        snapshot([page('https://shop.example/', {links: [link('::not a url'), link('')]})])
      )
    ).not.toThrow();
  });
});

describe('product-pages-in-sitemap', () => {
  const sitemaps = (locs, over = {}) => ({
    discovery: 'robots-txt',
    unavailableReason: null,
    ignoredSitemapLines: [],
    documentsTruncated: false,
    documents: [
      {
        url: 'https://shop.example/sitemap.xml',
        outcome: 'ok',
        kind: 'urlset',
        entriesTruncated: false,
        locs,
        entryCount: locs.length,
      },
    ],
    ...over,
  });
  const audited = productPage('https://shop.example/p/1', {source: 'audited'});

  it('is not applicable without a crawl, a product page, or a trustworthy sitemap', () => {
    expect(productSitemapProduct(artifact(null, 'disabled'), sitemaps([])).notApplicable).toBe(
      true
    );
    expect(
      productSitemapProduct(
        artifact(snapshot([page('https://shop.example/', {source: 'audited'})])),
        sitemaps(['https://shop.example/'])
      ).explanation
    ).toMatch(/no product pages/);
    const snap = snapshot([audited]);
    for (const bad of [
      null,
      sitemaps([], {discovery: 'none'}),
      sitemaps(['https://shop.example/p/1'], {documentsTruncated: true}),
      sitemaps([], {}),
      sitemaps(['https://shop.example/p/1'], {
        documents: [{outcome: 'http-error', kind: null, locs: [], entriesTruncated: false}],
      }),
      sitemaps(['https://shop.example/p/1'], {
        documents: [
          {
            outcome: 'ok',
            kind: 'urlset',
            locs: ['https://shop.example/p/1'],
            entriesTruncated: true,
          },
        ],
      }),
    ]) {
      expect(productSitemapProduct(artifact(snap), bad).notApplicable).toBe(true);
    }
  });

  it('says why when the crawler could not read the audited page, instead of claiming there are no product pages', () => {
    const cases = [
      [{source: 'audited', status: 403}, /status 403/],
      [{source: 'audited', status: null, extraction: 'error'}, /could not fetch/],
      [{source: 'audited', extraction: 'skipped-not-html'}, /as HTML/],
      [{source: 'audited', truncated: true}, /only the start/],
    ];
    for (const [over, pattern] of cases) {
      const snap = snapshot([page('https://shop.example/p/1', over)]);
      expect(
        productSitemapProduct(artifact(snap), sitemaps(['https://shop.example/p/1'])).explanation
      ).toMatch(pattern);
      expect(categoryLinkingProduct(artifact(snap)).explanation).toMatch(pattern);
    }
    expect(
      productSitemapProduct(
        artifact(snapshot([page('https://shop.example/', {source: 'home'})])),
        sitemaps(['https://shop.example/'])
      ).explanation
    ).toMatch(/did not include the audited page/);
  });

  it('passes when every product page is listed, ignoring a trailing slash', () => {
    const snap = snapshot([audited, productPage('https://shop.example/p/2')]);
    expect(
      productSitemapProduct(
        artifact(snap),
        sitemaps(['https://shop.example/p/1/', 'https://shop.example/p/2'])
      ).score
    ).toBe(1);
  });

  it('judges the audited page, and lists the others without failing', () => {
    const snap = snapshot([audited, productPage('https://shop.example/p/2')]);
    const auditedMissing = productSitemapProduct(
      artifact(snap),
      sitemaps(['https://shop.example/p/2'])
    );
    expect(auditedMissing.score).toBe(0.5);
    expect(auditedMissing.details.items[0].note).toBe('The audited page');
    const otherMissing = productSitemapProduct(
      artifact(snap),
      sitemaps(['https://shop.example/p/1'])
    );
    expect(otherMissing.score).toBe(1);
    expect(otherMissing.explanation).toMatch(/not judged/);
    expect(otherMissing.displayValue).toBe('1 of 2 product pages not listed');
  });

  it('ignores noindex pages, non-200 pages and unread pages when deciding which are product pages', () => {
    const snap = snapshot([
      audited,
      productPage('https://shop.example/p/3', {
        robotsMetas: [{name: 'robots', content: 'noindex'}],
      }),
      productPage('https://shop.example/p/4', {xRobotsTag: ['noindex']}),
      productPage('https://shop.example/p/5', {status: 404}),
      productPage('https://shop.example/p/6', {extraction: 'error'}),
    ]);
    expect(
      productSitemapProduct(artifact(snap), sitemaps(['https://shop.example/p/1'])).score
    ).toBe(1);
  });
});

describe('product-category-linking', () => {
  const products = n =>
    Array.from({length: n}, (_, i) =>
      productPage(`https://shop.example/p/${i + 1}`, i === 0 ? {source: 'audited'} : {})
    );
  const category = (urls, url = 'https://shop.example/c/shoes') =>
    page(url, {links: urls.map(link)});

  it('is not applicable without a crawl, without products, on an incomplete crawl, or with no category page', () => {
    expect(categoryLinkingProduct(artifact(null, 'disabled')).notApplicable).toBe(true);
    expect(
      categoryLinkingProduct(
        artifact(snapshot([page('https://shop.example/', {source: 'audited'})]))
      ).explanation
    ).toMatch(/no product pages/);
    const prods = products(3);
    const incomplete = categoryLinkingProduct(
      artifact(
        snapshot(prods, {
          stats: {
            requests: 3,
            elapsedMs: 1,
            truncatedByBudget: true,
            overPageCap: false,
            cutByDepth: false,
          },
        })
      )
    );
    expect(incomplete.notApplicable).toBe(true);
    expect(incomplete.explanation).toMatch(/whole site/);
    expect(
      categoryLinkingProduct(artifact(snapshot([...prods, category(['https://shop.example/p/1'])])))
        .explanation
    ).toMatch(/3 or more product pages/);
  });

  it('passes when every product is linked from a category page', () => {
    const prods = products(6);
    const snap = snapshot([...prods, category(prods.map(p => p.url))]);
    expect(categoryLinkingProduct(artifact(snap)).score).toBe(1);
  });

  it('judges the audited product, and lists the unlinked others', () => {
    const prods = products(7);
    const linked = prods.slice(1).map(p => p.url); // the audited product (the first) is not linked
    const snap = snapshot([...prods, category(linked)]);
    const result = categoryLinkingProduct(artifact(snap));
    expect(result.score).toBe(0.5);
    expect(result.details.items.map(i => i.url)).toEqual(['https://shop.example/p/1']);

    const others = snapshot([
      ...prods,
      category([prods[0].url, ...prods.slice(2).map(p => p.url)]),
    ]);
    const r2 = categoryLinkingProduct(artifact(others));
    expect(r2.score).toBe(1);
    expect(r2.explanation).toMatch(/not judged/);
  });

  it('does not count a link from a page that is not a category (it links to fewer than 3 products)', () => {
    const prods = products(8);
    const snap = snapshot([
      ...prods,
      category(prods.slice(0, 6).map(p => p.url)),
      page('https://shop.example/blog', {links: [link(prods[7].url)]}),
    ]);
    const result = categoryLinkingProduct(artifact(snap));
    expect(result.details.items.map(i => i.url).sort()).toEqual([
      'https://shop.example/p/7',
      'https://shop.example/p/8',
    ]);
  });

  it('counts a page as a category from 3 product links, and not from 2', () => {
    const prods = products(6);
    const withThree = snapshot([
      ...prods,
      category(
        prods.slice(0, 3).map(p => p.url),
        'https://shop.example/c/a'
      ),
      category(
        prods.slice(3).map(p => p.url),
        'https://shop.example/c/b'
      ),
    ]);
    expect(categoryLinkingProduct(artifact(withThree)).score).toBe(1);
    const onlyTwo = snapshot([...prods, category(prods.slice(0, 2).map(p => p.url))]);
    expect(categoryLinkingProduct(artifact(onlyTwo)).notApplicable).toBe(true);
  });

  it('says so when the audited page looks built by script', () => {
    const prods = products(6);
    const snap = snapshot([...prods, category(prods.map(p => p.url))]);
    const a = {...artifact(snap), auditedRenderedTextLength: 10000};
    prods[0].textLength = 100;
    expect(categoryLinkingProduct(a).notApplicable).toBe(true);
  });
});
