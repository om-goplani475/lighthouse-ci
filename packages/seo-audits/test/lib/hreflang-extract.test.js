/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {extractHreflangHead, MAX_ALTERNATES} = require('../../src/lib/hreflang-extract.js');

const URL_ = 'https://example.com/en/page';
const page = (/** @type {string} */ head, body = '<p>hi</p>') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('extractHreflangHead', () => {
  it('reads alternates, canonical and robots metas, resolving relative URLs', () => {
    const head = extractHreflangHead(
      page(
        '<link rel="canonical" href="/en/page"><link rel="alternate" hreflang="fr" href="/fr/page">' +
          '<LINK REL="Alternate" HREFLANG="x-default" HREF="https://example.com/"><meta name="Robots" content="noindex, follow">' +
          '<meta name="googlebot" content="nofollow">'
      ),
      URL_
    );
    expect(head.canonicals).toEqual(['https://example.com/en/page']);
    expect(head.alternates).toEqual([
      {hreflang: 'fr', href: 'https://example.com/fr/page'},
      {hreflang: 'x-default', href: 'https://example.com/'},
    ]);
    expect(head.robotsMetas).toEqual([
      {name: 'robots', content: 'noindex, follow'},
      {name: 'googlebot', content: 'nofollow'},
    ]);
  });

  it('ignores alternates without hreflang or href, other rels, and anything in the body', () => {
    const head = extractHreflangHead(
      page(
        '<link rel="alternate" href="/feed"><link rel="alternate" hreflang="fr"><link rel="stylesheet" hreflang="de" href="/a.css">',
        '<link rel="alternate" hreflang="es" href="/es"><meta name="robots" content="noindex">'
      ),
      URL_
    );
    expect(head.alternates).toEqual([]);
    expect(head.robotsMetas).toEqual([]);
  });

  it('dedupes the same alternate, caps the list, and keeps an unparseable href as written', () => {
    const many = Array.from(
      {length: MAX_ALTERNATES + 20},
      (_, i) => `<link rel="alternate" hreflang="en" href="/p${i}">`
    ).join('');
    expect(extractHreflangHead(page(many), URL_).alternates).toHaveLength(MAX_ALTERNATES);
    const dup =
      '<link rel="alternate" hreflang="fr" href="/fr"><link rel="alternate" hreflang="FR" href="/fr">';
    expect(extractHreflangHead(page(dup), URL_).alternates).toHaveLength(1);
    expect(
      extractHreflangHead(page('<link rel="alternate" hreflang="fr" href="http://[bad">'), URL_)
        .alternates[0].href
    ).toBe('http://[bad');
  });

  it('drops a half-written last tag of a truncated body, and survives garbage', () => {
    const cut =
      '<html><head><link rel="alternate" hreflang="fr" href="/fr"><link rel="alternate" hreflang="de" hre';
    expect(extractHreflangHead(cut, URL_, {truncated: true}).alternates).toHaveLength(1);
    expect(extractHreflangHead('', URL_, {truncated: true}).alternates).toEqual([]);
    expect(
      extractHreflangHead('﻿<head><link rel=canonical href=/x></head>', URL_).canonicals
    ).toEqual(['https://example.com/x']);
    // @ts-expect-error - deliberately wrong input
    expect(extractHreflangHead(null, URL_).alternates).toEqual([]);
    expect(extractHreflangHead(Buffer.from([0xff, 0xfe, 0x00, 0x3c]), URL_).alternates).toEqual([]);
  });

  it('stays fast on a large head', () => {
    const start = Date.now();
    extractHreflangHead(
      `<html><head>${'<meta name="x" content="y">'.repeat(40000)}</head></html>`,
      URL_
    );
    extractHreflangHead(`<html><head>${'<div>'.repeat(100000)}</head></html>`, URL_);
    expect(Date.now() - start).toBeLessThan(1500);
  });
});
