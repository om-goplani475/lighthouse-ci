/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  classifyMixedContent,
  mixedContentProduct,
  MAX_ROWS,
} = require('../../src/lib/transport-security.js');

const PAGE = 'https://example.com/';

/**
 * @param {string} url
 * @param {string} resourceType
 * @param {string} [resolutionStatus]
 */
const issue = (url, resourceType, resolutionStatus = 'MixedContentBlocked') => ({
  insecureURL: url,
  resourceType,
  resolutionStatus,
});

/**
 * @param {Array<any>} issues
 * @param {Array<any>} [records]
 * @param {string} [pageUrl]
 */
const classify = (issues, records = [], pageUrl = PAGE) =>
  classifyMixedContent({issues, records, pageUrl});

describe('classifyMixedContent', () => {
  it('is null for a page that is not https', () => {
    expect(classify([issue('http://a.test/x.js', 'Script')], [], 'http://example.com/')).toBeNull();
    expect(classify([], [], 'not a url')).toBeNull();
  });

  it('is empty for a page with no insecure resources', () => {
    expect(classify([])).toEqual({items: [], failing: 0, notes: 0});
  });

  it.each(['Script', 'Stylesheet', 'Frame', 'XMLHttpRequest', 'Font', 'Form', 'Worker', 'Import'])(
    'treats %s as active',
    type => {
      const result = classify([issue('http://a.test/r', type, 'MixedContentWarning')]);
      expect(result.items[0].kind).toBe('active');
      expect(result.failing).toBe(1);
    }
  );

  it.each(['Image', 'Audio', 'Video', 'Track', 'Favicon', 'PluginData'])(
    'treats %s as passive',
    type => {
      const result = classify([issue('http://a.test/r', type, 'MixedContentWarning')]);
      expect(result.items[0].kind).toBe('passive');
      expect(result.failing).toBe(0);
      expect(result.notes).toBe(1);
    }
  );

  it('treats a type it does not know as active, and a missing type as Unknown', () => {
    const odd = classify([issue('http://a.test/r', 'BrandNewThing', 'MixedContentWarning')]);
    expect(odd.items[0].kind).toBe('active');
    const none = classify([
      {insecureURL: 'http://a.test/r', resolutionStatus: 'MixedContentWarning'},
    ]);
    expect(none.items[0]).toMatchObject({type: 'Unknown', kind: 'active'});
  });

  it('maps the three Chrome resolutions', () => {
    const result = classify([
      issue('http://a.test/1', 'Image', 'MixedContentBlocked'),
      issue('http://a.test/2', 'Image', 'MixedContentAutomaticallyUpgraded'),
      issue('http://a.test/3', 'Image', 'MixedContentWarning'),
    ]);
    const by = Object.fromEntries(result.items.map(i => [i.url, i.resolution]));
    expect(by).toEqual({
      'http://a.test/1': 'blocked',
      'http://a.test/2': 'auto-upgraded',
      'http://a.test/3': 'allowed',
    });
  });

  it('fails on a blocked passive resource, but not on an upgraded or warned one', () => {
    expect(classify([issue('http://a.test/i.png', 'Image', 'MixedContentBlocked')]).failing).toBe(
      1
    );
    expect(
      classify([issue('http://a.test/i.png', 'Image', 'MixedContentAutomaticallyUpgraded')]).failing
    ).toBe(0);
    expect(classify([issue('http://a.test/i.png', 'Image', 'MixedContentWarning')]).failing).toBe(
      0
    );
  });

  it('picks up an http request that raised no issue, as allowed', () => {
    const result = classify([], [{url: 'http://a.test/s.js', resourceType: 'Script'}]);
    expect(result.items).toEqual([
      {url: 'http://a.test/s.js', type: 'Script', kind: 'active', resolution: 'allowed'},
    ]);
    expect(result.failing).toBe(1);
  });

  it('understands the network record vocabulary too (Media, XHR, Document)', () => {
    const result = classify(
      [],
      [
        {url: 'http://a.test/v.mp4', resourceType: 'Media'},
        {url: 'http://a.test/api', resourceType: 'XHR'},
        {url: 'http://a.test/frame', resourceType: 'Document'},
      ]
    );
    const kinds = Object.fromEntries(result.items.map(i => [i.url, i.kind]));
    expect(kinds).toEqual({
      'http://a.test/v.mp4': 'passive',
      'http://a.test/api': 'active',
      'http://a.test/frame': 'active',
    });
  });

  it('lets the issue win when a URL is in both sources, and counts it once', () => {
    const result = classify(
      [issue('http://a.test/i.png', 'Image', 'MixedContentAutomaticallyUpgraded')],
      [{url: 'http://a.test/i.png', resourceType: 'Image'}]
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].resolution).toBe('auto-upgraded');
  });

  it('ignores https and data: records', () => {
    const result = classify(
      [issue('data:image/png;base64,AAAA', 'Image', 'MixedContentWarning')],
      [
        {url: 'https://a.test/ok.png', resourceType: 'Image'},
        {url: 'data:image/png;base64,AAAA', resourceType: 'Image'},
      ]
    );
    expect(result.items).toEqual([]);
  });

  it('lists active items first, then by URL', () => {
    const result = classify([
      issue('http://a.test/b.png', 'Image', 'MixedContentWarning'),
      issue('http://a.test/z.js', 'Script', 'MixedContentBlocked'),
      issue('http://a.test/a.png', 'Image', 'MixedContentWarning'),
      issue('http://a.test/c.css', 'Stylesheet', 'MixedContentBlocked'),
    ]);
    expect(result.items.map(i => i.url)).toEqual([
      'http://a.test/c.css',
      'http://a.test/z.js',
      'http://a.test/a.png',
      'http://a.test/b.png',
    ]);
  });
});

describe('mixedContentProduct', () => {
  it('is not applicable when the page is not https', () => {
    expect(mixedContentProduct(null)).toEqual({score: 1, notApplicable: true});
  });

  it('passes with nothing to report', () => {
    expect(mixedContentProduct({items: [], failing: 0, notes: 0})).toEqual({score: 1});
  });

  it('fails on an active item and explains each row', () => {
    const product = mixedContentProduct(
      classify([
        issue('http://a.test/app.js', 'Script', 'MixedContentBlocked'),
        issue('http://a.test/i.png', 'Image', 'MixedContentAutomaticallyUpgraded'),
      ])
    );
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('2 insecure resources');
    expect(product.explanation).toMatch(/1 active or blocked/);
    const items = /** @type {any} */ (product.details).items;
    expect(items[0]).toMatchObject({kind: 'Active', resolution: 'Blocked'});
    expect(items[0].impact).toMatch(/did not load/);
    expect(items[1]).toMatchObject({kind: 'Passive', resolution: 'Auto-upgraded'});
    expect(items[1].impact).toMatch(/upgraded it to https/);
  });

  it('passes, with the rows shown as notes, when only passive content was upgraded or warned', () => {
    const product = mixedContentProduct(
      classify([
        issue('http://a.test/i.png', 'Image', 'MixedContentAutomaticallyUpgraded'),
        issue('http://a.test/j.png', 'Image', 'MixedContentWarning'),
      ])
    );
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('2 insecure resources');
    expect(product.explanation).toBeUndefined();
  });

  it('uses the singular for one resource', () => {
    const product = mixedContentProduct(
      classify([issue('http://a.test/i.png', 'Image', 'MixedContentWarning')])
    );
    expect(product.displayValue).toBe('1 insecure resource');
  });

  it(`caps the table at ${MAX_ROWS} rows and says how many were left out`, () => {
    const issues = Array.from({length: MAX_ROWS + 7}, (_, i) =>
      issue(`http://a.test/${String(i).padStart(3, '0')}.js`, 'Script', 'MixedContentBlocked')
    );
    const product = mixedContentProduct(classify(issues));
    const items = /** @type {any} */ (product.details).items;
    expect(items).toHaveLength(MAX_ROWS + 1);
    expect(items[MAX_ROWS].url).toBe('7 more not shown');
    expect(product.displayValue).toBe(`${MAX_ROWS + 7} insecure resources`);
  });
});
