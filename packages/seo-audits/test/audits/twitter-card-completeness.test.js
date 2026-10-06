/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: TwitterCardCompleteness} = require('../../src/audits/twitter-card-completeness.js');

/**
 * @param {Array<{name?: string, content?: string, property?: string}>} tags
 */
function runAudit(tags) {
  return TwitterCardCompleteness.audit({MetaElements: tags});
}

const FULL_TWITTER_TAGS = [
  {name: 'twitter:card', content: 'summary_large_image'},
  {name: 'twitter:title', content: 'Widget Store'},
  {name: 'twitter:description', content: 'Buy widgets'},
  {name: 'twitter:image', content: 'https://example.com/image.png'},
  {name: 'twitter:site', content: '@widgetstore'},
  {name: 'twitter:creator', content: '@widgetstore'},
  {name: 'twitter:image:alt', content: 'A widget'},
];

describe('twitter-card-completeness audit', () => {
  it('scores 1 with zero rows when every twitter: tag is present', () => {
    const result = runAudit(FULL_TWITTER_TAGS);
    expect(result.score).toBe(1);
    expect(result.details).toBeUndefined();
  });

  it('only notes a missing twitter:card, because X falls back to the og: tags', () => {
    const tags = FULL_TWITTER_TAGS.filter(tag => tag.name !== 'twitter:card');
    const result = runAudit(tags);
    expect(result.score).toBe(1);
    expect(result.displayValue).toContain('No twitter:card');
  });

  it('falls back to og:title/og:description/og:image when the twitter: equivalents are absent', () => {
    const result = runAudit([
      {name: 'twitter:card', content: 'summary'},
      {property: 'og:title', content: 'Widget Store'},
      {property: 'og:description', content: 'Buy widgets'},
      {property: 'og:image', content: 'https://example.com/image.png'},
    ]);
    expect(result.score).toBe(1);
  });

  it('fails a field when neither the twitter: tag nor its og: fallback is present', () => {
    const result = runAudit([{name: 'twitter:card', content: 'summary'}]);
    expect(result.score).toBe(0);
    const errorProperties = result.details.items
      .filter(item => item.severity === 'error')
      .map(item => item.property);
    expect(errorProperties.sort()).toEqual([
      'twitter:description',
      'twitter:image',
      'twitter:title',
    ]);
  });

  it('does not fail when only twitter:site/twitter:creator are missing (recommended only)', () => {
    const tags = FULL_TWITTER_TAGS.filter(
      tag => tag.name !== 'twitter:site' && tag.name !== 'twitter:creator'
    );
    const result = runAudit(tags);
    expect(result.score).toBe(1);
    const infoProperties = result.details.items.map(item => item.property).sort();
    expect(infoProperties).toEqual(['twitter:creator', 'twitter:site']);
  });

  it('recommends twitter:image:alt only when an image (twitter: or og: fallback) is present', () => {
    const withoutAlt = FULL_TWITTER_TAGS.filter(tag => tag.name !== 'twitter:image:alt');
    const result = runAudit(withoutAlt);
    expect(result.details.items).toEqual([
      expect.objectContaining({property: 'twitter:image:alt', severity: 'info'}),
    ]);
  });

  it('does not recommend twitter:image:alt when there is no image at all', () => {
    const withoutImage = FULL_TWITTER_TAGS.filter(
      tag => tag.name !== 'twitter:image' && tag.name !== 'twitter:image:alt'
    );
    const result = runAudit(withoutImage);
    const altRows = result.details.items.filter(item => item.property === 'twitter:image:alt');
    expect(altRows).toEqual([]);
  });
});
