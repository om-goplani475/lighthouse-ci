/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pulls the fields the cross-page audits need out of one page's HTML: no I/O, never throws, linear in
 * the size of the input. Uses `htmlparser2`'s streaming tokenizer with callbacks only (no tree), because
 * the tree-building `parse5` parser is quadratic in how deeply block elements nest: measured at 512 KiB
 * of nested `<div>` it took about 109 s for one page, against 46 ms here (docs/audit-specs/site-crawler.md).
 *
 * `htmlparser2` is a tokenizer, not an HTML5 tree builder, which is enough here because only text, links
 * and head fields are read. Script, style, noscript, template and `hidden` content is skipped by tracking
 * which open elements are skipping. Text is read from `<body>` content only (the head contributes the
 * title, description, canonical and robots fields instead).
 *
 * Known simplifications, accepted: `<base href>` is ignored (links resolve against the page URL); the body
 * is decoded as UTF-8 whatever its declared charset (the hash only has to be consistent); text is
 * separated at every element boundary except common inline elements, so `<p>a</p><p>b</p>` is two words
 * and `<b>wor</b>d` is one.
 */

import {createHash} from 'crypto';
import {Parser} from 'htmlparser2';
import {
  normalizeUrl,
  sameOrigin,
  MAX_TEXT_CHARS,
  MAX_LINKS_PER_PAGE,
  MAX_H1,
  MAX_CANONICALS,
} from './crawl-snapshot.js';

/** @typedef {import('./crawl-snapshot.js').CrawlLink} CrawlLink */
/**
 * @typedef {{
 *   title: string | null,
 *   description: string | null,
 *   canonicals: string[],
 *   robotsMetas: Array<{name: string, content: string}>,
 *   h1: string[],
 *   textHash: string,
 *   textLength: number,
 *   wordCount: number,
 *   links: CrawlLink[],
 * }} PageExtract
 */

const MAX_H1_CHARS = 300;
const MAX_ROBOTS_METAS = 20;
const MAX_URL_CHARS = 2_000;
const MAX_TEXT_BUFFER_CHARS = 4 * 1024 * 1024;
const ROBOTS_META_NAMES = new Set(['robots', 'googlebot', 'bingbot']);
const NOT_VISIBLE = new Set(['script', 'style', 'noscript', 'template']);
// Elements that do not break a word when they start or end.
const INLINE = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'cite',
  'code',
  'del',
  'dfn',
  'em',
  'font',
  'i',
  'ins',
  'kbd',
  'label',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
]);

/**
 * @param {string} value
 * @param {number} max
 * @return {string}
 */
function clip(value, max) {
  return value.length <= max ? value : value.slice(0, max);
}

/**
 * @param {string} value
 * @return {string}
 */
function collapse(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/** @return {PageExtract} */
function emptyExtract() {
  return {
    title: null,
    description: null,
    canonicals: [],
    robotsMetas: [],
    h1: [],
    textHash: createHash('sha256').update('').digest('hex'),
    textLength: 0,
    wordCount: 0,
    links: [],
  };
}

/**
 * @param {Buffer | string} body
 * @param {string} pageUrl The final URL of the page (links are resolved against it).
 * @param {{truncated: boolean}} options `truncated`: the body was cut at the size cap, so the last
 *   (possibly half-written) tag and anything after it is dropped before parsing.
 * @return {PageExtract}
 */
function extractPage(body, pageUrl, {truncated}) {
  try {
    let html = typeof body === 'string' ? body : body.toString('utf8');
    if (html.charCodeAt(0) === 0xfeff) html = html.slice(1);
    if (truncated) {
      const lastTagEnd = html.lastIndexOf('>');
      html = lastTagEnd === -1 ? '' : html.slice(0, lastTagEnd + 1);
    }
    return parse(html, pageUrl);
  } catch {
    return emptyExtract();
  }
}

/**
 * @param {string} html
 * @param {string} pageUrl
 * @return {PageExtract}
 */
function parse(html, pageUrl) {
  /** @type {Array<{hidden: boolean, head: boolean}>} */
  const stack = [];
  /** @type {Array<{hidden: boolean, head: boolean}>} */
  const openHeads = [];
  let hiddenDepth = 0;
  let headDepth = 0;
  let bodySeen = false;

  /** @type {string | null} */
  let title = null;
  let inTitle = false;
  let titleDone = false;
  let titleBuffer = '';
  /** @type {string | null} */
  let description = null;
  /** @type {string[]} */
  const canonicals = [];
  /** @type {Array<{name: string, content: string}>} */
  const robotsMetas = [];
  /** @type {string[]} */
  const h1 = [];
  let h1Depth = 0;
  let h1Buffer = '';
  /** @type {CrawlLink[]} */
  const links = [];
  const seenLinks = new Set();
  /** @type {string[]} */
  const textParts = [];
  let textChars = 0;

  /** @param {string} text */
  const addText = text => {
    if (textChars >= MAX_TEXT_BUFFER_CHARS) return;
    textParts.push(text);
    textChars += text.length;
  };

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const hidden =
          NOT_VISIBLE.has(name) || Object.prototype.hasOwnProperty.call(attrs, 'hidden');
        const head = name === 'head';
        if (name === 'body') {
          bodySeen = true;
          // A <head> that was never closed ends where the body starts. Only the still-open heads are
          // visited (never the whole stack), so a page of repeated <body> tags stays linear.
          for (const open of openHeads) {
            if (open.head) {
              open.head = false;
              headDepth--;
            }
          }
          openHeads.length = 0;
        }
        const entry = {hidden, head};
        stack.push(entry);
        if (head) {
          openHeads.push(entry);
          headDepth++;
        }
        if (hidden) hiddenDepth++;
        if (hiddenDepth > 0) return;
        if (headDepth === 0 && !INLINE.has(name)) addText(' ');

        if (name === 'title' && !titleDone && !bodySeen) {
          inTitle = true;
        } else if (name === 'meta' && !bodySeen) {
          const metaName = (attrs.name || '').toLowerCase().trim();
          const content = attrs.content;
          if (typeof content === 'string') {
            if (metaName === 'description' && description === null) {
              description = clip(collapse(content), MAX_TEXT_CHARS);
            } else if (ROBOTS_META_NAMES.has(metaName) && robotsMetas.length < MAX_ROBOTS_METAS) {
              robotsMetas.push({name: metaName, content: clip(content.trim(), MAX_TEXT_CHARS)});
            }
          }
        } else if (name === 'link' && !bodySeen) {
          const rel = (attrs.rel || '').toLowerCase().split(/\s+/);
          const href = (attrs.href || '').trim();
          if (
            rel.includes('canonical') &&
            href &&
            href.length <= MAX_URL_CHARS &&
            canonicals.length < MAX_CANONICALS
          ) {
            canonicals.push(href);
          }
        } else if (name === 'h1') {
          h1Depth++;
        } else if (name === 'a' && attrs.href && links.length < MAX_LINKS_PER_PAGE) {
          if (attrs.href.length <= MAX_URL_CHARS) {
            const url = normalizeUrl(attrs.href.trim(), pageUrl);
            if (
              url &&
              url.length <= MAX_URL_CHARS &&
              sameOrigin(url, pageUrl) &&
              !seenLinks.has(url)
            ) {
              seenLinks.add(url);
              const nofollow = (attrs.rel || '').toLowerCase().split(/\s+/).includes('nofollow');
              links.push({url, nofollow});
            }
          }
        }
      },

      ontext(text) {
        if (inTitle) {
          if (titleBuffer.length < MAX_TEXT_CHARS * 2) titleBuffer += text;
          return;
        }
        if (hiddenDepth > 0) return;
        if (h1Depth > 0 && h1Buffer.length < MAX_H1_CHARS * 4) h1Buffer += text;
        if (headDepth === 0) addText(text);
      },

      onclosetag(name) {
        const entry = stack.pop();
        if (!entry) return;
        if (entry.hidden) hiddenDepth--;
        if (entry.head) {
          headDepth--;
          entry.head = false;
        }
        if (hiddenDepth > 0) return;
        if (name === 'title' && inTitle) {
          inTitle = false;
          titleDone = true;
          title = clip(collapse(titleBuffer), MAX_TEXT_CHARS);
        } else if (name === 'h1' && h1Depth > 0) {
          h1Depth--;
          if (h1Depth === 0) {
            const text = collapse(h1Buffer);
            h1Buffer = '';
            if (text && h1.length < MAX_H1) h1.push(clip(text, MAX_H1_CHARS));
          }
        }
        if (headDepth === 0 && !INLINE.has(name)) addText(' ');
      },

      onerror() {
        // A tokenizer error is not fatal: whatever was read so far is kept.
      },
    },
    {decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true}
  );
  parser.write(html);
  parser.end();

  const text = collapse(textParts.join('')).toLowerCase();
  return {
    title,
    description,
    canonicals,
    robotsMetas,
    h1,
    textHash: createHash('sha256').update(text).digest('hex'),
    textLength: text.length,
    wordCount: text ? text.split(' ').length : 0,
    links,
  };
}

export {extractPage, emptyExtract};
