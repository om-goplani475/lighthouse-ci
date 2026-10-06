/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const path = require('path');
const fs = require('fs');
const os = require('os');
const {promisify} = require('util');
const {execFile} = require('child_process');

const execFileAsync = promisify(execFile);

const AUDIT_PATH = path.join(__dirname, '../../src/audits/structured-data-schema-properties.js');

const DRIVER_SCRIPT = `
import {readFileSync} from 'fs';
const {default: Audit} = await import(process.argv[2]);
const artifacts = JSON.parse(readFileSync(process.argv[3], 'utf-8'));
console.log(JSON.stringify(Audit.audit(artifacts)));
`;

/**
 * Same shell-out-via-temp-files pattern as structured-data-json-ld.test.js, for the same
 * reason: this audit transitively imports rule-engine/registry.js, which uses
 * `import.meta.url` at module scope and cannot be loaded directly inside Jest under this
 * repo's shared `module: "commonjs"` tsconfig.
 * @param {Array<{content: string}>} blocks
 * @return {Promise<any>}
 */
async function runAudit(blocks) {
  const artifacts = {StructuredDataJsonLd: blocks.map(b => ({content: b.content, node: {}}))};

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-audits-test-'));
  const artifactsPath = path.join(tmpDir, 'artifacts.json');
  const driverPath = path.join(tmpDir, 'driver.mjs');
  fs.writeFileSync(artifactsPath, JSON.stringify(artifacts));
  fs.writeFileSync(driverPath, DRIVER_SCRIPT);

  try {
    const {stdout} = await execFileAsync('node', [driverPath, AUDIT_PATH, artifactsPath]);
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
}

const VALID_PRODUCT = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Widget',
  image: 'https://example.com/widget.jpg',
  offers: {price: '9.99', priceCurrency: 'USD', availability: 'https://schema.org/InStock'},
});

const PRODUCT_MISSING_AVAILABILITY = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Widget',
  image: 'https://example.com/widget.jpg',
  offers: {price: '9.99', priceCurrency: 'USD'},
});

const VALID_ARTICLE = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Title',
  image: 'https://example.com/a.jpg',
  datePublished: '2026-09-28',
});

const ARTICLE_MISSING_DATE = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Title',
  image: 'https://example.com/a.jpg',
});

// Array-nested property (nested rule applied per-instance, not to a single object).
const VALID_BREADCRUMB_LIST = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    {position: 1, name: 'Home', item: 'https://example.com/'},
    {position: 2, name: 'Widgets', item: 'https://example.com/widgets'},
  ],
});

const BREADCRUMB_LIST_MISSING_ITEM_NAME = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    {position: 1, name: 'Home', item: 'https://example.com/'},
    {position: 2, item: 'https://example.com/widgets'},
  ],
});

// Flat-only type, no nested sub-objects.
const VALID_RECIPE = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Soup',
  image: 'https://example.com/soup.jpg',
  author: 'Chef',
  recipeIngredient: ['water', 'salt'],
  recipeInstructions: 'Boil it.',
});

const RECIPE_MISSING_INGREDIENT = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Soup',
  image: 'https://example.com/soup.jpg',
  author: 'Chef',
  recipeInstructions: 'Boil it.',
});

// Single nested object.
const VALID_EVENT = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Event',
  name: 'Conference',
  startDate: '2026-11-01',
  location: {name: 'Convention Center', address: '123 Main St'},
});

const EVENT_MISSING_LOCATION_ADDRESS = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Event',
  name: 'Conference',
  startDate: '2026-11-01',
  location: {name: 'Convention Center'},
});

// Multiple distinct nested objects on one type.
const JOB_POSTING_MISSING_JOB_LOCATION_ADDRESS = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Engineer',
  description: 'Build things.',
  datePosted: '2026-09-01',
  hiringOrganization: {name: 'Acme'},
  jobLocation: {},
});

// FAQPage: shallow nesting only checks acceptedAnswer's *presence*, not its own .text.
const FAQ_PAGE_ACCEPTED_ANSWER_MISSING_TEXT = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [{name: 'Question?', acceptedAnswer: {}}],
});

describe('structured-data-schema-properties audit', () => {
  it('passes a Product with all required properties including nested offers', async () => {
    const result = await runAudit([{content: VALID_PRODUCT}]);
    expect(result.score).toBe(1);
  }, 30000);

  it('only recommends offers.availability and priceCurrency, which Google does not require', async () => {
    const result = await runAudit([{content: PRODUCT_MISSING_AVAILABILITY}]);
    expect(result.score).toBe(1);
    const note = result.details.items.find(
      /** @param {any} item */ item => item.namespace === 'google-requirements'
    );
    expect(note.property).toBe('offers.availability');
    expect(note.message).toMatch(/^Recommended/);
  }, 30000);

  it('passes a review-only product snippet, and fails a product with no offers, review or rating', async () => {
    const base = {'@context': 'https://schema.org', '@type': 'Product', name: 'Widget'};
    const reviewOnly = await runAudit([
      {content: JSON.stringify({...base, review: {'@type': 'Review'}})},
    ]);
    expect(reviewOnly.score).toBe(1);
    const bare = await runAudit([{content: JSON.stringify(base)}]);
    expect(bare.score).toBe(0);
    expect(bare.details.items[0].property).toBe('offers or review or aggregateRating');
  }, 30000);

  it('fails an offer with no price at all, and accepts priceSpecification or lowPrice', async () => {
    const product = (/** @type {any} */ offers) =>
      JSON.stringify({'@context': 'https://schema.org', '@type': 'Product', name: 'W', offers});
    expect((await runAudit([{content: product({priceCurrency: 'USD'})}])).score).toBe(0);
    expect((await runAudit([{content: product({priceSpecification: {price: 5}})}])).score).toBe(1);
    expect((await runAudit([{content: product({lowPrice: 5, priceCurrency: 'USD'})}])).score).toBe(
      1
    );
  }, 30000);

  it('passes an Article with all required flat properties', async () => {
    const result = await runAudit([{content: VALID_ARTICLE}]);
    expect(result.score).toBe(1);
  }, 30000);

  it('passes an Article missing datePublished: Google lists no required Article properties', async () => {
    const result = await runAudit([{content: ARTICLE_MISSING_DATE}]);
    expect(result.score).toBe(1);
    const note = result.details.items.find(
      /** @param {any} item */ item => item.namespace === 'google-requirements'
    );
    expect(note.property).toBe('datePublished');
    expect(note.message).toMatch(/^Recommended/);
  }, 30000);

  it('passes the minimum Google requires for Organization, VideoObject, LocalBusiness and a breadcrumb', async () => {
    const block = (/** @type {any} */ data) => [
      {content: JSON.stringify({'@context': 'https://schema.org', ...data})},
    ];
    expect((await runAudit(block({'@type': 'Organization'}))).score).toBe(1);
    expect(
      (
        await runAudit(
          block({
            '@type': 'VideoObject',
            name: 'V',
            thumbnailUrl: 'https://example.com/t.jpg',
            uploadDate: '2026-09-01',
          })
        )
      ).score
    ).toBe(1);
    expect(
      (await runAudit(block({'@type': 'LocalBusiness', name: 'Shop', address: {}}))).score
    ).toBe(1);
    // the last breadcrumb item has no `item` URL, which Google allows
    expect(
      (
        await runAudit(
          block({
            '@type': 'BreadcrumbList',
            itemListElement: [
              {position: 1, name: 'Home', item: 'https://example.com/'},
              {position: 2, name: 'Shoes'},
            ],
          })
        )
      ).score
    ).toBe(1);
  }, 30000);

  it('is not applicable when no block has a tracked type', async () => {
    const result = await runAudit([
      {content: JSON.stringify({'@context': 'https://schema.org', '@type': 'WebSite'})},
    ]);
    expect(result.score).toBeNull();
    expect(result.notApplicable).toBe(true);
  }, 30000);

  it('reports a hedged eligibility row alongside a passing Product, never affecting score', async () => {
    const result = await runAudit([{content: VALID_PRODUCT}]);
    expect(result.score).toBe(1);
    const eligibilityRow = result.details.items.find(
      /** @param {any} item */ item => item.namespace === 'eligibility'
    );
    expect(eligibilityRow).toBeDefined();
    expect(eligibilityRow.message).toContain('does not guarantee');
  }, 30000);

  it('stamps rulesetVersions for both namespaces into details for reproducibility', async () => {
    const result = await runAudit([{content: VALID_PRODUCT}]);
    expect(result.details.rulesetVersions).toEqual({
      googleStructuredData: '2026-10',
      eligibility: '2026-10',
    });
  }, 30000);

  it('passes a BreadcrumbList with all itemListElement entries complete', async () => {
    const result = await runAudit([{content: VALID_BREADCRUMB_LIST}]);
    expect(result.score).toBe(1);
  }, 30000);

  it('fails a BreadcrumbList when one itemListElement entry is missing name, naming its index', async () => {
    const result = await runAudit([{content: BREADCRUMB_LIST_MISSING_ITEM_NAME}]);
    expect(result.score).toBe(0);
    const failure = result.details.items.find(
      /** @param {any} item */ item => item.namespace === 'google-requirements'
    );
    expect(failure.property).toBe('itemListElement[1].name');
  }, 30000);

  it('passes a Recipe with all required flat properties', async () => {
    const result = await runAudit([{content: VALID_RECIPE}]);
    expect(result.score).toBe(1);
  }, 30000);

  it('only recommends recipeIngredient, and fails a Recipe with no image', async () => {
    const note = await runAudit([{content: RECIPE_MISSING_INGREDIENT}]);
    expect(note.score).toBe(1);
    expect(note.details.items[0].property).toBe('recipeIngredient');
    const noImage = JSON.parse(VALID_RECIPE);
    delete noImage.image;
    const failed = await runAudit([{content: JSON.stringify(noImage)}]);
    expect(failed.score).toBe(0);
    expect(failed.details.items[0].property).toBe('image');
  }, 30000);

  it('passes an Event with a complete nested location', async () => {
    const result = await runAudit([{content: VALID_EVENT}]);
    expect(result.score).toBe(1);
  }, 30000);

  it('fails an Event missing a nested location property (location.address)', async () => {
    const result = await runAudit([{content: EVENT_MISSING_LOCATION_ADDRESS}]);
    expect(result.score).toBe(0);
    const failure = result.details.items.find(
      /** @param {any} item */ item =>
        item.namespace === 'google-requirements' && item.message.startsWith('Missing')
    );
    expect(failure.property).toBe('location.address');
  }, 30000);

  it('fails a JobPosting missing properties across two distinct nested objects', async () => {
    const result = await runAudit([{content: JOB_POSTING_MISSING_JOB_LOCATION_ADDRESS}]);
    expect(result.score).toBe(0);
    const failures = result.details.items
      .filter(/** @param {any} item */ item => item.namespace === 'google-requirements')
      .map(/** @param {any} item */ item => item.property);
    expect(failures).toEqual(expect.arrayContaining(['jobLocation.address']));
  }, 30000);

  it('does not flag FAQPage.mainEntity.acceptedAnswer.text — one level of nesting only', async () => {
    const result = await runAudit([{content: FAQ_PAGE_ACCEPTED_ANSWER_MISSING_TEXT}]);
    // acceptedAnswer is present (just empty), so the shallow check passes — this is the
    // documented, accepted limitation from docs/audit-specs/structured-data-remaining-types.md,
    // not a bug: the engine only verifies mainEntity[].acceptedAnswer is present, never
    // recurses into acceptedAnswer.text.
    expect(result.score).toBe(1);
  }, 30000);

  it('reports FAQPage and HowTo eligibility as unsupported, not hedged-supported', async () => {
    const result = await runAudit([
      {
        content: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: [{name: 'Q', acceptedAnswer: {text: 'A'}}],
        }),
      },
    ]);
    const eligibilityRow = result.details.items.find(
      /** @param {any} item */ item => item.namespace === 'eligibility'
    );
    expect(eligibilityRow).toBeDefined();
    expect(eligibilityRow.message).toContain('not currently documented as supported');
  }, 30000);

  it('unwraps @graph and checks each entity independently (Phase 2 item 5)', async () => {
    const graphBlock = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        JSON.parse(VALID_PRODUCT),
        JSON.parse(ARTICLE_MISSING_DATE),
        {'@type': 'Recipe', name: 'Soup'},
      ],
    });
    const result = await runAudit([{content: graphBlock}]);
    expect(result.score).toBe(0); // The Recipe inside the graph has no image.
    const failure = result.details.items.find(
      /** @param {any} item */ item =>
        item.namespace === 'google-requirements' && item.type === 'Recipe'
    );
    expect(failure).toEqual(expect.objectContaining({type: 'Recipe', property: 'image'}));
  }, 30000);

  it('resolves an @id reference to a sibling @graph entity before checking nested properties', async () => {
    const graphBlock = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@id': '#offer1',
          '@type': 'Offer',
          price: '9.99',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Product',
          name: 'Widget',
          image: 'https://example.com/widget.jpg',
          offers: {'@id': '#offer1'},
        },
      ],
    });
    const result = await runAudit([{content: graphBlock}]);
    // Without reference resolution, `offers` would be the bare {"@id": "#offer1"} stub — none
    // of price/priceCurrency/availability present, so all three nested-required checks would
    // fail. With resolution, the referenced Offer's real data is used, so this passes.
    expect(result.score).toBe(1);
  }, 30000);
});
