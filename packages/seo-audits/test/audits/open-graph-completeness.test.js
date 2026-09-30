/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: OpenGraphCompleteness} = require('../../src/audits/open-graph-completeness.js');

/**
 * This audit only imports `lighthouse/core/audits/audit.js` — no `import.meta.url` at module
 * scope, so it loads directly inside Jest, no shell-out workaround needed.
 * @param {Array<{property: string, content: string}>} tags
 */
function runAudit(tags) {
  return OpenGraphCompleteness.audit({MetaElements: tags});
}

const FULL_TAGS = [
  {property: 'og:title', content: 'Widget Store'},
  {property: 'og:type', content: 'website'},
  {property: 'og:image', content: 'https://example.com/image.png'},
  {property: 'og:url', content: 'https://example.com/'},
  {property: 'og:description', content: 'Buy widgets'},
  {property: 'og:site_name', content: 'Widget Store'},
  {property: 'og:image:alt', content: 'A widget'},
];

describe('open-graph-completeness audit', () => {
  it('scores 1 with zero rows when every required and recommended tag is present', () => {
    const result = runAudit(FULL_TAGS);
    expect(result.score).toBe(1);
    expect(result.details).toBeUndefined();
  });

  it('fails when a required tag is missing', () => {
    const tags = FULL_TAGS.filter(tag => tag.property !== 'og:title');
    const result = runAudit(tags);
    expect(result.score).toBe(0);
    expect(result.details.items).toEqual([
      expect.objectContaining({property: 'og:title', severity: 'error'}),
    ]);
  });

  it('reports every missing required tag on a page with none of the four', () => {
    const result = runAudit([]);
    expect(result.score).toBe(0);
    const errorProperties = result.details.items
      .filter(item => item.severity === 'error')
      .map(item => item.property);
    expect(errorProperties.sort()).toEqual(['og:image', 'og:title', 'og:type', 'og:url']);
  });

  it('does not fail the audit when only a recommended tag is missing', () => {
    const tags = FULL_TAGS.filter(tag => tag.property !== 'og:description');
    const result = runAudit(tags);
    expect(result.score).toBe(1);
    expect(result.details.items).toEqual([
      expect.objectContaining({property: 'og:description', severity: 'info'}),
    ]);
  });

  it('recommends og:image:alt only when og:image is present', () => {
    const withoutAlt = FULL_TAGS.filter(tag => tag.property !== 'og:image:alt');
    const result = runAudit(withoutAlt);
    expect(result.details.items).toEqual([
      expect.objectContaining({property: 'og:image:alt', severity: 'info'}),
    ]);
  });

  it('does not recommend og:image:alt when there is no og:image at all', () => {
    const withoutImageOrAlt = FULL_TAGS.filter(
      tag => tag.property !== 'og:image' && tag.property !== 'og:image:alt'
    );
    const result = runAudit(withoutImageOrAlt);
    const altRows = result.details.items.filter(item => item.property === 'og:image:alt');
    expect(altRows).toEqual([]);
  });

  it('ignores an og: meta tag with empty content, treating it as absent', () => {
    const tags = FULL_TAGS.map(tag => (tag.property === 'og:title' ? {...tag, content: ''} : tag));
    const result = runAudit(tags);
    expect(result.score).toBe(0);
  });

  it('is never notApplicable — every page is evaluated', () => {
    const result = runAudit([]);
    expect(result.notApplicable).toBeUndefined();
  });
});
