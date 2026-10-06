/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {twitterContent, ogContent, twitterResolved} = require('../../src/lib/social-meta.js');

describe('twitterContent', () => {
  it('finds a twitter: meta tag by name', () => {
    expect(twitterContent([{name: 'twitter:card', content: 'summary'}], 'twitter:card')).toBe(
      'summary'
    );
  });

  it('returns undefined when absent', () => {
    expect(twitterContent([], 'twitter:card')).toBeUndefined();
  });

  it('treats an empty-content tag as absent', () => {
    expect(twitterContent([{name: 'twitter:card', content: ''}], 'twitter:card')).toBeUndefined();
  });
});

describe('ogContent', () => {
  it('finds an og: meta tag by property', () => {
    expect(ogContent([{property: 'og:title', content: 'Widget'}], 'og:title')).toBe('Widget');
  });

  it('also matches an og: tag written with name (some sites do), and ignores other names', () => {
    expect(ogContent([{name: 'og:title', content: 'Widget'}], 'og:title')).toBe('Widget');
    expect(ogContent([{name: 'title', content: 'Widget'}], 'og:title')).toBeUndefined();
  });
});

describe('twitterResolved', () => {
  it('prefers the twitter: tag over the og: fallback when both are present', () => {
    const tags = [
      {name: 'twitter:title', content: 'Twitter Title'},
      {property: 'og:title', content: 'OG Title'},
    ];
    expect(twitterResolved(tags, 'title')).toBe('Twitter Title');
  });

  it('falls back to the og: equivalent when the twitter: tag is absent', () => {
    const tags = [{property: 'og:title', content: 'OG Title'}];
    expect(twitterResolved(tags, 'title')).toBe('OG Title');
  });

  it('returns undefined when neither is present', () => {
    expect(twitterResolved([], 'title')).toBeUndefined();
  });
});
