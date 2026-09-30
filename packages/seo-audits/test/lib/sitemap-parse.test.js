/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const zlib = require('zlib');
const {LIMITS, SITEMAP_NAMESPACE, parseSitemapBytes} = require('../../src/lib/sitemap-parse.js');

const NS = SITEMAP_NAMESPACE;

/**
 * @param {string} xml
 */
const parse = xml =>
  parseSitemapBytes({
    url: 'https://example.com/sitemap.xml',
    source: 'declared',
    parentUrl: null,
    status: 200,
    body: Buffer.from(xml, 'utf-8'),
  });

const urlset = (...entries) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="${NS}">${entries.join('')}</urlset>`;
const url = loc => `<url><loc>${loc}</loc></url>`;

describe('parseSitemapBytes — uncompressed XML', () => {
  it('parses a valid urlset', () => {
    const doc = parse(urlset(url('https://example.com/a'), url('https://example.com/b')));
    expect(doc).toMatchObject({
      outcome: 'ok',
      status: 200,
      kind: 'urlset',
      namespaceOk: true,
      parseError: null,
      locs: ['https://example.com/a', 'https://example.com/b'],
      entryCount: 2,
      entriesTruncated: false,
      invalidLocs: [],
      invalidLocCount: 0,
      gzip: false,
    });
    expect(doc.compressedBytes).toBeGreaterThan(0);
  });

  it('parses a sitemap index and collects the child sitemap locs', () => {
    const doc = parse(
      `<sitemapindex xmlns="${NS}"><sitemap><loc>https://example.com/s1.xml</loc><lastmod>2026-01-01</lastmod></sitemap></sitemapindex>`
    );
    expect(doc.kind).toBe('sitemapindex');
    expect(doc.locs).toEqual(['https://example.com/s1.xml']);
  });

  it('flags a wrong root element as invalid without collecting anything', () => {
    const doc = parse(
      `<html xmlns="${NS}"><body><url><loc>https://example.com/a</loc></url></body></html>`
    );
    expect(doc.kind).toBe('invalid');
    expect(doc.locs).toEqual([]);
    expect(doc.parseError).toBeNull();
  });

  it('reports a missing namespace and a wrong namespace as namespaceOk: false', () => {
    const none = parse('<urlset><url><loc>https://example.com/a</loc></url></urlset>');
    expect(none.kind).toBe('urlset');
    expect(none.namespaceOk).toBe(false);
    // A urlset with no namespace has no sitemap-namespaced <url>, so nothing is collected.
    expect(none.locs).toEqual([]);

    const wrong = parse('<urlset xmlns="http://example.com/other"></urlset>');
    expect(wrong.namespaceOk).toBe(false);
  });

  it('reports an unclosed tag as a parse error with a line and column', () => {
    const doc = parse(`<urlset xmlns="${NS}">\n<url>\n<loc>https://example.com/a</loc>\n</urlset>`);
    expect(doc.parseError).not.toBeNull();
    expect(doc.parseError.line).toBe(4);
    expect(doc.parseError.column).toBeGreaterThan(0);
    expect(doc.parseError.message).not.toMatch(/^\d+:\d+/);
  });

  it('reports a truncated document (no closing root) as a parse error', () => {
    const doc = parse(`<urlset xmlns="${NS}"><url><loc>https://example.com/a</loc></url>`);
    expect(doc.parseError).not.toBeNull();
  });

  it.each([
    ['an empty body', ''],
    ['plain text', 'this is not xml'],
    ['whitespace only', '  \n '],
  ])('treats %s as invalid with a parse error', (_label, body) => {
    const doc = parse(body);
    expect(doc.kind).toBe('invalid');
    expect(doc.locs).toEqual([]);
  });

  it('does not report an undefined DTD entity as a value (no entity expansion)', () => {
    const doc = parse(
      `<?xml version="1.0"?><!DOCTYPE urlset [<!ENTITY x "https://example.com/&y;">]><urlset xmlns="${NS}"><url><loc>&x;</loc></url></urlset>`
    );
    expect(doc.locs).toEqual([]);
  });

  it('ignores image/video/news/xhtml extension elements without reporting them', () => {
    const doc = parse(
      `<urlset xmlns="${NS}" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">` +
        `<url><loc>https://example.com/a</loc>` +
        `<image:image><image:loc>https://example.com/img.png</image:loc></image:image>` +
        `<xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr/a"/></url></urlset>`
    );
    expect(doc.parseError).toBeNull();
    expect(doc.locs).toEqual(['https://example.com/a']);
    expect(doc.entryCount).toBe(1);
  });

  it('trims whitespace, and handles CDATA and XML entities in a loc', () => {
    const doc = parse(
      urlset(
        '<url><loc>\n  https://example.com/a  \n</loc></url>',
        '<url><loc><![CDATA[https://example.com/b?x=1&y=2]]></loc></url>',
        '<url><loc>https://example.com/c?x=1&amp;y=2</loc></url>'
      )
    );
    expect(doc.locs).toEqual([
      'https://example.com/a',
      'https://example.com/b?x=1&y=2',
      'https://example.com/c?x=1&y=2',
    ]);
  });

  it('records invalid locs with a reason, still counting them as entries', () => {
    const doc = parse(
      urlset(
        url('https://example.com/ok'),
        url(''),
        url('/relative'),
        url('ftp://example.com/a'),
        url(`https://example.com/${'x'.repeat(2100)}`)
      )
    );
    expect(doc.locs).toEqual(['https://example.com/ok']);
    expect(doc.entryCount).toBe(5);
    expect(doc.invalidLocCount).toBe(4);
    expect(doc.invalidLocs.map(l => l.reason)).toEqual([
      'empty',
      'not an absolute http(s) URL',
      'not an absolute http(s) URL',
      'longer than 2048 characters',
    ]);
    expect(doc.invalidLocs[3].value.length).toBeLessThanOrEqual(200);
  });

  it('caps the invalid-loc examples but keeps the true count', () => {
    const doc = parse(urlset(...Array.from({length: 30}, () => url('/bad'))));
    expect(doc.invalidLocs).toHaveLength(LIMITS.MAX_INVALID_LOC_EXAMPLES);
    expect(doc.invalidLocCount).toBe(30);
  });

  it('stops at the stored-entry cap and flags truncation, without a parse error', () => {
    const cap = LIMITS.MAX_ENTRIES_STORED;
    const entries = Array.from({length: cap + 500}, (_, i) => url(`https://example.com/${i}`));
    const doc = parse(urlset(...entries));
    expect(doc.entriesTruncated).toBe(true);
    expect(doc.entryCount).toBe(cap);
    expect(doc.locs).toHaveLength(cap);
    expect(doc.parseError).toBeNull();
  });

  it('does not flag truncation at exactly the protocol limit of 50,000', () => {
    const entries = Array.from({length: 50_000}, (_, i) => url(`https://example.com/${i}`));
    const doc = parse(urlset(...entries));
    expect(doc.entriesTruncated).toBe(false);
    expect(doc.entryCount).toBe(50_000);
  });

  it('handles a UTF-8 multi-byte character split across parse chunks', () => {
    // Pad with a comment so the 3-byte "€" starts one byte before the 64 KiB chunk boundary and
    // straddles it, while the loc itself stays short.
    const head = `<urlset xmlns="${NS}"><!--`;
    const tail = `--><url><loc>https://example.com/`;
    const pad = 'a'.repeat(64 * 1024 - 1 - Buffer.byteLength(head + tail));
    const xml = `${head}${pad}${tail}€</loc></url></urlset>`;
    const bytes = Buffer.from(xml, 'utf-8');
    expect(bytes[64 * 1024 - 1]).toBe(0xe2); // first byte of "€"; the next two are past the boundary
    const doc = parse(xml);
    expect(doc.parseError).toBeNull();
    expect(doc.locs).toEqual(['https://example.com/€']);
  });
});

describe('parseSitemapBytes — gzip', () => {
  const xml = urlset(url('https://example.com/a'), url('https://example.com/b'));

  /**
   * @param {Buffer} body
   * @param {{maxUncompressedBytes?: number}} [options]
   */
  const parseBytes = (body, options) =>
    parseSitemapBytes(
      {
        url: 'https://example.com/sitemap.xml',
        source: 'declared',
        parentUrl: null,
        status: 200,
        body,
      },
      options
    );

  it('decompresses and parses a gzip sitemap, recording both sizes', () => {
    const gz = zlib.gzipSync(Buffer.from(xml));
    const doc = parseBytes(gz);
    expect(doc).toMatchObject({
      outcome: 'ok',
      gzip: true,
      kind: 'urlset',
      locs: ['https://example.com/a', 'https://example.com/b'],
      compressedBytes: gz.length,
      uncompressedBytes: Buffer.byteLength(xml),
      exceededUncompressedLimit: false,
    });
  });

  it('detects gzip by magic bytes regardless of the URL (a plain .xml URL served gzipped)', () => {
    const doc = parseSitemapBytes({
      url: 'https://example.com/plain-name.xml',
      source: 'declared',
      parentUrl: null,
      status: 200,
      body: zlib.gzipSync(Buffer.from(xml)),
    });
    expect(doc.gzip).toBe(true);
    expect(doc.kind).toBe('urlset');
  });

  it('does not treat plain XML as gzip', () => {
    expect(parseBytes(Buffer.from(xml)).gzip).toBe(false);
  });

  it('reports corrupt gzip data as a decompression error, not a throw', () => {
    const gz = zlib.gzipSync(Buffer.from(xml));
    const corrupt = Buffer.concat([
      gz.subarray(0, 12),
      Buffer.from('garbage-garbage'),
      gz.subarray(20),
    ]);
    const doc = parseBytes(corrupt);
    expect(doc.outcome).toBe('decompression-error');
    expect(doc.errorMessage).toMatch(/could not decompress gzip/);
    expect(doc.kind).toBeNull();
    expect(doc.gzip).toBe(true);
  });

  it('reports a truncated gzip stream as a decompression error', () => {
    const gz = zlib.gzipSync(Buffer.from(xml));
    const doc = parseBytes(gz.subarray(0, gz.length - 10));
    expect(doc.outcome).toBe('decompression-error');
  });

  it('stops inflating at the output cap and flags it, instead of expanding a gzip bomb', () => {
    // 200 KB of zeros compresses to a few hundred bytes; the cap is 10 KB.
    const bomb = zlib.gzipSync(Buffer.alloc(200 * 1024));
    expect(bomb.length).toBeLessThan(1000);
    const doc = parseBytes(bomb, {maxUncompressedBytes: 10 * 1024});
    expect(doc.exceededUncompressedLimit).toBe(true);
    expect(doc.uncompressedBytes).toBe(10 * 1024);
    expect(doc.outcome).toBe('ok');
    expect(doc.kind).toBeNull();
    expect(doc.compressedBytes).toBe(bomb.length);
  });

  it('flags a plain body at or over the size limit but still parses what it has', () => {
    const doc = parseBytes(Buffer.from(xml), {maxUncompressedBytes: 50});
    expect(doc.exceededUncompressedLimit).toBe(true);
    expect(doc.kind).toBe('urlset');
  });

  it('keeps the wire cap at least as large as the decompressed cap', () => {
    expect(LIMITS.MAX_COMPRESSED_BYTES).toBeGreaterThanOrEqual(LIMITS.MAX_UNCOMPRESSED_BYTES);
  });
});
