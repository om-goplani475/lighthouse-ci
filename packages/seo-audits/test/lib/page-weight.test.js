/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  buildRenderBlockingProduct,
  buildRequestWeightProduct,
  blockingResourcesOf,
  MAX_BLOCKING,
  TOP_REQUESTS,
} = require('../../src/lib/page-weight.js');

const PAGE = 'https://example.com/page';
const page = (/** @type {string} */ head, body = '<p>x</p>') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const rec = (
  /** @type {string} */ url,
  /** @type {number} */ transferSize,
  resourceType = 'Script'
) => ({url, transferSize, resourceType});

describe('blockingResourcesOf', () => {
  it('counts a bare media-query stylesheet as blocking and skips print and speech ones', () => {
    const found = blockingResourcesOf(
      '<link rel="stylesheet" href="/w.css" media="(min-width: 800px)">' +
        '<link rel="stylesheet" href="/p.css" media="print and (color)">' +
        '<link rel="stylesheet" href="/v.css" media="speech">',
      'https://example.com/'
    );
    expect(found.map(f => f.url)).toEqual(['https://example.com/w.css']);
  });

  it('finds sync scripts and screen stylesheets in the head, resolving URLs', () => {
    const found = blockingResourcesOf(
      page(
        '<script src="/a.js"></script><link rel="stylesheet" href="/s.css"><link rel="stylesheet" href="https://cdn.example.net/p.css" media="screen and (min-width: 1px)">'
      ),
      PAGE
    );
    expect(found).toEqual([
      {url: 'https://example.com/a.js', kind: 'script'},
      {url: 'https://example.com/s.css', kind: 'stylesheet'},
      {url: 'https://cdn.example.net/p.css', kind: 'stylesheet'},
    ]);
  });

  it('ignores async, defer and module scripts, inline scripts, print and disabled styles, other links and the body', () => {
    const found = blockingResourcesOf(
      page(
        '<script async src="/a.js"></script><script defer src="/b.js"></script><script type="module" src="/c.js"></script>' +
          '<script>var x=1</script><link rel="stylesheet" href="/p.css" media="print"><link rel="stylesheet" href="/d.css" disabled>' +
          '<link rel="preload" href="/f.css" as="style"><link rel="icon" href="/i.png">',
        '<script src="/body.js"></script><link rel="stylesheet" href="/body.css">'
      ),
      PAGE
    );
    expect(found).toEqual([]);
  });

  it('caps the list and survives garbage', () => {
    const many = Array.from(
      {length: MAX_BLOCKING + 30},
      (_, i) => `<script src="/s${i}.js"></script>`
    ).join('');
    expect(blockingResourcesOf(page(many), PAGE)).toHaveLength(MAX_BLOCKING);
    expect(blockingResourcesOf('<<<>>>', PAGE)).toEqual([]);
  });
});

describe('buildRenderBlockingProduct (informational)', () => {
  it('reports resources with sizes and where they are served from, never failing', () => {
    const p = buildRenderBlockingProduct(
      page(
        '<script src="/a.js"></script><link rel="stylesheet" href="https://cdn.example.net/p.css">'
      ),
      [
        rec('https://example.com/a.js', 20 * 1024),
        rec('https://cdn.example.net/p.css', 5 * 1024, 'Stylesheet'),
      ],
      PAGE
    );
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('2 render-blocking resources (1 script, 1 stylesheet, 25 KiB)');
    expect(p.details.items[0]).toMatchObject({
      kind: 'script (stops HTML parsing)',
      size: '20 KiB',
      host: 'this site',
    });
    expect(p.details.items[1]).toMatchObject({host: 'another host'});
  });
  it('says so when there are none, marks an unknown size, and is not applicable without HTML', () => {
    expect(buildRenderBlockingProduct(page(''), [], PAGE).displayValue).toMatch(
      /No render-blocking/
    );
    expect(
      buildRenderBlockingProduct(page('<script src="/a.js"></script>'), [], PAGE).details.items[0]
        .size
    ).toBe('unknown');
    expect(buildRenderBlockingProduct('', [], PAGE).notApplicable).toBe(true);
    // @ts-expect-error - deliberately wrong input
    expect(buildRenderBlockingProduct(undefined, undefined, undefined).notApplicable).toBe(true);
  });
  it('caps the table rows', () => {
    const many = Array.from({length: 70}, (_, i) => `<script src="/s${i}.js"></script>`).join('');
    const p = buildRenderBlockingProduct(page(many), [], PAGE);
    expect(p.details.items).toHaveLength(51);
    expect(p.details.items[50].url).toBe('20 more not shown');
  });
});

describe('buildRequestWeightProduct (informational)', () => {
  const records = [
    rec('https://example.com/', 40 * 1024, 'Document'),
    rec('https://example.com/a.js', 300 * 1024),
    rec('https://example.com/i.png', 2 * 1024 * 1024, 'Image'),
    rec('https://ads.example.net/t.js', 80 * 1024),
    rec('data:image/png;base64,AAAA', 100, 'Image'),
  ];
  it('totals requests and bytes by type and host, and lists the largest', () => {
    const p = buildRequestWeightProduct(records, PAGE);
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe('4 requests, 2.4 MiB, 1 from other hosts');
    const items = p.details.items;
    expect(items[0]).toEqual({item: 'Total', requests: '4', size: '2.4 MiB'});
    expect(items[1].item).toBe('  Image');
    expect(
      items.some(
        (/** @type {any} */ i) => i.item === 'Served from other hosts' && i.requests === '1'
      )
    ).toBe(true);
    expect(items[items.length - 1].item).toMatch(/^Largest: /);
    expect(
      items.filter((/** @type {any} */ i) => /^Largest/.test(i.item)).length
    ).toBeLessThanOrEqual(TOP_REQUESTS);
  });
  it('omits the other-host phrase when everything is first-party, and is not applicable without data', () => {
    expect(
      buildRequestWeightProduct([rec('https://example.com/a.js', 1024)], PAGE).displayValue
    ).toBe('1 request, 1 KiB');
    expect(buildRequestWeightProduct([], PAGE).notApplicable).toBe(true);
    expect(buildRequestWeightProduct([null, {url: 5}], PAGE).notApplicable).toBe(true);
    expect(buildRequestWeightProduct(null, PAGE).notApplicable).toBe(true);
  });
});
