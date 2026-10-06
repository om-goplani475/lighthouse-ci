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

describe('parseSitemapBytes — nesting depth (security review finding: quadratic-time DoS)', () => {
  it('stops with a parse error when elements nest deeper than the cap', () => {
    const doc = parse(`<urlset xmlns="${NS}">` + '<a>'.repeat(LIMITS.MAX_DEPTH + 5));
    expect(doc.parseError).not.toBeNull();
    expect(doc.parseError.message).toContain(`deeper than ${LIMITS.MAX_DEPTH} levels`);
    expect(doc.kind).toBe('urlset');
  });

  it('parses a hostile deeply-nested 1 MiB document in well under a second, not minutes', () => {
    const body = `<urlset xmlns="${NS}">` + '<a>'.repeat(350_000);
    const started = Date.now();
    const doc = parse(body);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(doc.parseError).not.toBeNull();
  });

  it('is not slowed by a deep document that also closes every tag', () => {
    const n = 100_000;
    const started = Date.now();
    const doc = parse(`<urlset xmlns="${NS}">` + '<a>'.repeat(n) + '</a>'.repeat(n) + '</urlset>');
    expect(Date.now() - started).toBeLessThan(4000);
    expect(doc.parseError).not.toBeNull();
  });

  it('accepts exactly MAX_DEPTH nested elements and rejects one more', () => {
    // <urlset> is the first element, so it plus (MAX_DEPTH - 1) `<a>` is MAX_DEPTH deep.
    const nested = n => `<urlset xmlns="${NS}">` + '<a>'.repeat(n) + '</a>'.repeat(n) + '</urlset>';
    expect(parse(nested(LIMITS.MAX_DEPTH - 1)).parseError).toBeNull();
    expect(parse(nested(LIMITS.MAX_DEPTH)).parseError).not.toBeNull();
  });

  it('still accepts realistic sitemap nesting with extension elements', () => {
    const doc = parse(
      `<urlset xmlns="${NS}" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">` +
        '<url><loc>https://example.com/a</loc><image:image><image:loc>https://example.com/i.png</image:loc></image:image></url></urlset>'
    );
    expect(doc.parseError).toBeNull();
    expect(doc.locs).toEqual(['https://example.com/a']);
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

describe('targetEntry (xhtml:link alternates of one page)', () => {
  const {parseSitemapBytes} = require('../../src/lib/sitemap-parse.js');
  const NS =
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"';
  const parse = (/** @type {string} */ body, /** @type {string | null} */ target) =>
    parseSitemapBytes(
      {
        url: 'https://e.com/sitemap.xml',
        source: 'declared',
        parentUrl: null,
        status: 200,
        body: Buffer.from(body),
      },
      {target}
    );
  const urlset = (/** @type {string} */ inner) =>
    `<?xml version="1.0"?><urlset ${NS}>${inner}</urlset>`;
  const alt = (/** @type {string} */ l, /** @type {string} */ h) =>
    `<xhtml:link rel="alternate" hreflang="${l}" href="${h}"/>`;

  it('records the alternates of the target page only', () => {
    const doc = parse(
      urlset(
        `<url><loc>https://e.com/en/</loc>${alt('en', 'https://e.com/en/')}${alt(
          'fr',
          'https://e.com/fr/'
        )}</url>` +
          `<url><loc>https://e.com/other</loc>${alt('de', 'https://e.com/de/other')}</url>`
      ),
      'https://e.com/en'
    );
    expect(doc.targetEntry).toEqual({
      alternates: [
        {hreflang: 'en', href: 'https://e.com/en/'},
        {hreflang: 'fr', href: 'https://e.com/fr/'},
      ],
      alternatesTruncated: false,
    });
    expect(doc.entryCount).toBe(2);
  });

  it('finds the entry when <loc> comes after the links', () => {
    const doc = parse(
      urlset(`<url>${alt('fr', 'https://e.com/fr/')}<loc>https://e.com/en/</loc></url>`),
      'https://e.com/en/'
    );
    expect(doc.targetEntry && doc.targetEntry.alternates).toHaveLength(1);
  });

  it('is null when the page is not listed, when no target is asked for, and for an index', () => {
    const xml = urlset(`<url><loc>https://e.com/a</loc>${alt('fr', 'https://e.com/fr/a')}</url>`);
    expect(parse(xml, 'https://e.com/b').targetEntry).toBeNull();
    expect(parse(xml, null).targetEntry).toBeNull();
    expect(
      parse(
        `<sitemapindex ${NS}><sitemap><loc>https://e.com/s.xml</loc></sitemap></sitemapindex>`,
        'https://e.com/s.xml'
      ).targetEntry
    ).toBeNull();
  });

  it('keeps an entry with no alternates, ignores non-alternate and incomplete links, and caps the list', () => {
    const none = parse(urlset('<url><loc>https://e.com/a</loc></url>'), 'https://e.com/a');
    expect(none.targetEntry).toEqual({alternates: [], alternatesTruncated: false});
    const odd = parse(
      urlset(
        '<url><loc>https://e.com/a</loc><xhtml:link rel="canonical" hreflang="fr" href="https://e.com/x"/><xhtml:link rel="alternate" href="https://e.com/y"/></url>'
      ),
      'https://e.com/a'
    );
    expect(odd.targetEntry && odd.targetEntry.alternates).toEqual([]);
    const many = parse(
      urlset(
        `<url><loc>https://e.com/a</loc>${Array.from({length: 130}, (_, i) =>
          alt('en', `https://e.com/${i}`)
        ).join('')}</url>`
      ),
      'https://e.com/a'
    );
    expect(many.targetEntry && many.targetEntry.alternates).toHaveLength(100);
    expect(many.targetEntry && many.targetEntry.alternatesTruncated).toBe(true);
  });
});

describe('news and video extensions', () => {
  const {parseSitemapBytes: parse, LIMITS: L} = require('../../src/lib/sitemap-parse.js');
  const NS =
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"';
  const doc = body =>
    parse({
      url: 'https://example.com/sitemap.xml',
      source: 'declared',
      parentUrl: null,
      status: 200,
      body: Buffer.from(`<?xml version="1.0"?><urlset ${NS}>${body}</urlset>`),
    });

  it('reads a news entry with its publication, date and title, in any element order', () => {
    const d = doc(
      `<url><news:news><news:title>Big story</news:title><news:publication><news:language>en</news:language><news:name>The Times</news:name></news:publication><news:publication_date>2026-10-06T08:00:00+00:00</news:publication_date></news:news><loc>https://example.com/story</loc></url>`
    );
    expect(d.news).toEqual([
      {
        loc: 'https://example.com/story',
        publicationName: 'The Times',
        language: 'en',
        publicationDate: '2026-10-06T08:00:00+00:00',
        title: 'Big story',
      },
    ]);
    expect(d.entryCount).toBe(1);
    expect(d.locs).toEqual(['https://example.com/story']);
    expect(d.videos).toEqual([]);
  });

  it('keeps missing news tags as null, so an audit can say which is missing', () => {
    const d = doc(
      '<url><loc>https://example.com/a</loc><news:news><news:publication><news:name>X</news:name></news:publication></news:news></url>'
    );
    expect(d.news[0]).toEqual({
      loc: 'https://example.com/a',
      publicationName: 'X',
      language: null,
      publicationDate: null,
      title: null,
    });
  });

  it('reads every video of a url, with its fields and tag count', () => {
    const d = doc(`<url><loc>https://example.com/watch</loc>
      <video:video><video:thumbnail_loc>https://example.com/t.jpg</video:thumbnail_loc><video:title>One</video:title><video:description>Desc</video:description><video:content_loc>https://example.com/v.mp4</video:content_loc><video:duration>120</video:duration><video:rating>4.5</video:rating><video:publication_date>2026-10-01</video:publication_date><video:tag>a</video:tag><video:tag>b</video:tag></video:video>
      <video:video><video:title>Two</video:title><video:player_loc>https://example.com/p</video:player_loc></video:video></url>`);
    expect(d.videos).toHaveLength(2);
    expect(d.videos[0]).toEqual({
      loc: 'https://example.com/watch',
      thumbnailLoc: 'https://example.com/t.jpg',
      title: 'One',
      description: 'Desc',
      contentLoc: 'https://example.com/v.mp4',
      playerLoc: null,
      duration: '120',
      rating: '4.5',
      publicationDate: '2026-10-01',
      expirationDate: null,
      tags: 2,
    });
    expect(d.videos[1]).toMatchObject({
      title: 'Two',
      playerLoc: 'https://example.com/p',
      thumbnailLoc: null,
      tags: 0,
    });
  });

  it('ignores extension elements in the wrong namespace and in a sitemap index, and plain sitemaps have none', () => {
    const plain = doc('<url><loc>https://example.com/a</loc></url>');
    expect(plain.news).toEqual([]);
    expect(plain.videos).toEqual([]);
    const wrong = parse({
      url: 'u',
      source: 'declared',
      parentUrl: null,
      status: 200,
      body: Buffer.from(
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://example.com/other"><url><loc>https://example.com/a</loc><news:news><news:title>x</news:title></news:news></url></urlset>'
      ),
    });
    expect(wrong.news).toEqual([]);
    const index = parse({
      url: 'u',
      source: 'declared',
      parentUrl: null,
      status: 200,
      body: Buffer.from(
        `<sitemapindex ${NS}><sitemap><loc>https://example.com/s.xml</loc></sitemap></sitemapindex>`
      ),
    });
    expect(index.news).toEqual([]);
  });

  it('is bounded: at most 1,001 news entries and 2,000 videos, and text is clipped', () => {
    const news = Array.from(
      {length: 1100},
      (_, i) =>
        `<url><loc>https://example.com/${i}</loc><news:news><news:title>t${i}</news:title></news:news></url>`
    ).join('');
    const d = doc(news);
    expect(d.news).toHaveLength(1001);
    expect(d.newsTruncated).toBe(true);
    const videos = Array.from(
      {length: 2100},
      (_, i) =>
        `<url><loc>https://example.com/${i}</loc><video:video><video:title>t</video:title></video:video></url>`
    ).join('');
    const v = doc(videos);
    expect(v.videos).toHaveLength(2000);
    expect(v.videosTruncated).toBe(true);
    const long = doc(
      `<url><loc>https://example.com/a</loc><video:video><video:description>${'x'.repeat(
        50000
      )}</video:description></video:video></url>`
    );
    expect(long.videos[0].description.length).toBeLessThanOrEqual(2100);
    expect(L.MAX_ENTRIES_STORED).toBeGreaterThan(1000);
  });

  it('survives malformed extension XML and a video outside any url', () => {
    expect(() =>
      doc('<url><loc>https://example.com/a</loc><video:video><video:title>unclosed</url>')
    ).not.toThrow();
    const stray = doc(
      '<video:video><video:title>stray</video:title></video:video><url><loc>https://example.com/a</loc></url>'
    );
    expect(stray.videos).toEqual([]);
  });
});
