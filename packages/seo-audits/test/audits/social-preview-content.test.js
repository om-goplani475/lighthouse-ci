/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: SocialPreviewContent} = require('../../src/audits/social-preview-content.js');

/**
 * This audit only imports `lighthouse/core/audits/audit.js` and `../lib/social-meta.js` (which
 * itself has no `import.meta.url`) — no shell-out workaround needed.
 * @param {Array<{name?: string, content?: string, property?: string}>} tags
 */
function runAudit(tags) {
  return SocialPreviewContent.audit({MetaElements: tags});
}

describe('social-preview-content audit', () => {
  it('is notApplicable when there is no og:* or twitter:* content at all', () => {
    const result = runAudit([]);
    expect(result.score).toBeNull();
    expect(result.notApplicable).toBe(true);
  });

  it('is purely informational — score is always null, scoreDisplayMode is informative', () => {
    const result = runAudit([{property: 'og:title', content: 'Widget Store'}]);
    expect(result.score).toBeNull();
    expect(SocialPreviewContent.meta.scoreDisplayMode).toBe('informative');
  });

  it('reports the Facebook/OG row straight from og:* tags, with no Twitter fallback involved', () => {
    const result = runAudit([
      {property: 'og:title', content: 'Widget Store'},
      {property: 'og:description', content: 'Buy widgets'},
      {property: 'og:image', content: 'https://example.com/image.png'},
    ]);
    const facebookRow = result.details.items.find(item => item.platform.startsWith('Facebook'));
    expect(facebookRow).toEqual(
      expect.objectContaining({
        title: 'Widget Store',
        description: 'Buy widgets',
        image: 'https://example.com/image.png',
      })
    );
  });

  it('reports the Twitter row using twitter: tags directly when present', () => {
    const result = runAudit([
      {name: 'twitter:title', content: 'Twitter Title'},
      {name: 'twitter:description', content: 'Twitter description'},
      {name: 'twitter:image', content: 'https://example.com/twitter.png'},
    ]);
    const twitterRow = result.details.items.find(item => item.platform.startsWith('Twitter'));
    expect(twitterRow).toEqual(
      expect.objectContaining({
        title: 'Twitter Title',
        description: 'Twitter description',
        image: 'https://example.com/twitter.png',
      })
    );
  });

  it('falls back to og:* for the Twitter row when twitter:* tags are absent', () => {
    const result = runAudit([
      {property: 'og:title', content: 'Widget Store'},
      {property: 'og:description', content: 'Buy widgets'},
      {property: 'og:image', content: 'https://example.com/image.png'},
    ]);
    const twitterRow = result.details.items.find(item => item.platform.startsWith('Twitter'));
    expect(twitterRow).toEqual(
      expect.objectContaining({
        title: 'Widget Store',
        description: 'Buy widgets',
        image: 'https://example.com/image.png',
      })
    );
  });

  it('reports an empty string, not undefined, for a field with nothing to resolve on either platform', () => {
    const result = runAudit([{property: 'og:title', content: 'Widget Store'}]);
    const twitterRow = result.details.items.find(item => item.platform.startsWith('Twitter'));
    expect(twitterRow.description).toBe('');
    expect(twitterRow.image).toBe('');
  });

  it('always reports exactly two rows (Facebook/OG and Twitter), even when only one platform has content', () => {
    const result = runAudit([{property: 'og:title', content: 'Widget Store'}]);
    expect(result.details.items).toHaveLength(2);
  });
});
