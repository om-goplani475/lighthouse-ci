/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reads the hreflang-relevant parts of one page's `<head>`: its `rel=alternate hreflang` links, canonical
 * links and robots meta tags. No I/O, never throws, linear in the size of the input: the streaming
 * `htmlparser2` tokenizer (callbacks only, no tree), run on the part of the document before `<body>`.
 * HTTP `Link` headers are not read here (the alternate pages are fetched with a prefix request that does
 * not keep that header).
 */

import {Parser} from 'htmlparser2';
import {normalizeUrl} from './crawl-snapshot.js';

/**
 * @typedef {{
 *   alternates: Array<{hreflang: string, href: string}>,
 *   canonicals: string[],
 *   robotsMetas: Array<{name: string, content: string}>,
 * }} HreflangHead
 */

const MAX_ALTERNATES = 100;
const MAX_CANONICALS = 5;
const MAX_ROBOTS_METAS = 20;
const MAX_HREFLANG_CHARS = 40;
const MAX_URL_CHARS = 2000;
const ROBOTS_NAMES = new Set(['robots', 'googlebot', 'bingbot']);

/** @return {HreflangHead} */
function emptyHead() {
  return {alternates: [], canonicals: [], robotsMetas: []};
}

/**
 * @param {Buffer | string} body
 * @param {string} pageUrl The final URL of the page (relative links resolve against it).
 * @param {{truncated?: boolean}} [options] `truncated`: the body was cut at the size cap, so the last
 *   (possibly half-written) tag is dropped before parsing.
 * @return {HreflangHead}
 */
function extractHreflangHead(body, pageUrl, {truncated = false} = {}) {
  try {
    let html = typeof body === 'string' ? body : body.toString('utf8');
    if (html.charCodeAt(0) === 0xfeff) html = html.slice(1);
    if (truncated) {
      const lastTagEnd = html.lastIndexOf('>');
      html = lastTagEnd === -1 ? '' : html.slice(0, lastTagEnd + 1);
    }
    const bodyAt = html.search(/<body[\s>]/i);
    if (bodyAt !== -1) html = html.slice(0, bodyAt);

    const head = emptyHead();
    const seenAlternates = new Set();
    const parser = new Parser(
      {
        onopentag(name, attrs) {
          if (name === 'link') {
            const rel = (attrs.rel || '').toLowerCase().split(/\s+/);
            const href =
              typeof attrs.href === 'string' ? attrs.href.trim().slice(0, MAX_URL_CHARS) : '';
            if (rel.includes('canonical') && href && head.canonicals.length < MAX_CANONICALS) {
              const abs = normalizeUrl(href, pageUrl);
              if (abs) head.canonicals.push(abs);
            } else if (rel.includes('alternate') && attrs.hreflang && href) {
              const abs = normalizeUrl(href, pageUrl);
              const hreflang = attrs.hreflang.trim().slice(0, MAX_HREFLANG_CHARS);
              const key = `${hreflang.toLowerCase()}\n${abs || href}`;
              if (head.alternates.length < MAX_ALTERNATES && !seenAlternates.has(key)) {
                seenAlternates.add(key);
                head.alternates.push({hreflang, href: abs || href});
              }
            }
          } else if (name === 'meta') {
            const metaName = (attrs.name || '').toLowerCase();
            if (ROBOTS_NAMES.has(metaName) && head.robotsMetas.length < MAX_ROBOTS_METAS) {
              head.robotsMetas.push({name: metaName, content: (attrs.content || '').slice(0, 300)});
            }
          }
        },
      },
      {decodeEntities: true}
    );
    parser.write(html);
    parser.end();
    return head;
  } catch {
    return emptyHead();
  }
}

export {extractHreflangHead, emptyHead, MAX_ALTERNATES};
