/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: FaviconPresence} = require('../../src/audits/favicon-presence.js');

function runAudit(faviconLinks) {
  return FaviconPresence.audit({FaviconLinks: faviconLinks});
}

describe('favicon-presence audit', () => {
  it('scores 1 when an icon link is present', () => {
    const result = runAudit([
      {rel: 'icon', href: 'https://example.com/icon.png', sizes: null, type: null},
    ]);
    expect(result.score).toBe(1);
  });

  it('scores 1 for a shortcut icon link', () => {
    const result = runAudit([
      {rel: 'shortcut icon', href: 'https://example.com/favicon.ico', sizes: null, type: null},
    ]);
    expect(result.score).toBe(1);
  });

  it('scores 0 with an explanation when there is no favicon link', () => {
    const result = runAudit([]);
    expect(result.score).toBe(0);
    expect(result.explanation).toContain('No <link rel="icon">');
  });

  it('scores 0 when other unrelated links are present but no favicon', () => {
    const result = runAudit([
      {rel: 'manifest', href: 'https://example.com/manifest.json', sizes: null, type: null},
      {rel: 'apple-touch-icon', href: 'https://example.com/apple.png', sizes: null, type: null},
    ]);
    expect(result.score).toBe(0);
  });

  it('scores 0 when the only icon link has no href (invalid)', () => {
    const result = runAudit([{rel: 'icon', href: null, sizes: null, type: null}]);
    expect(result.score).toBe(0);
  });
});
