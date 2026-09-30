/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure extraction of the two indexability signals that live in an HTML `<head>`: the robots-style
 * `<meta>` tags and the `<link rel="canonical">`. Input is a *prefix* of a page (the fetch reads at
 * most 64 KiB), so it must cope with a document cut off mid-tag.
 *
 * Uses `parse5`, the spec-compliant HTML parser (already in the dependency tree via jsdom), not a
 * hand-written scanner: correctness here decides whether a noindex page is reported as fine. It
 * gets, for free, what a scanner gets wrong: comments, `<script>`/`<style>` text that merely
 * contains "<meta", unquoted attributes, entities in an href (`&amp;`), and error recovery. The tree
 * is built with scripting enabled (parse5's default), so `<noscript>` content is plain text and
 * ignored, as it is for a crawler that runs JavaScript. It fetches nothing and executes nothing.
 *
 * Only children of `<head>` count: a `<meta>` or `<link>` that ends up in the body is not honored
 * by search engines either.
 */

import {parse} from 'parse5';

const META_NAMES = new Set(['robots', 'googlebot', 'bingbot']);
const MAX_METAS = 20;
const MAX_CANONICALS = 5;
const MAX_CONTENT_LENGTH = 1000;
// parse5's cost grows with the square of the nesting depth of block elements (ul, ol, div, dl, nav,
// pre, menu, main, ... measured: 64 KiB of `<div>` took 1.6 s, and nothing about it is specific to
// div), and parsing is synchronous, so no fetch timeout can interrupt it. A real page has under a
// hundred tags in its head and a few hundred in the first screen of body, so the parser is only given
// the text up to the 2,000th "<": at that size the worst case is tens of milliseconds.
const MAX_TAG_OPENINGS = 2000;

/**
 * @typedef {{name: string, content: string}} MetaSignal
 * @typedef {{metas: MetaSignal[], canonicals: string[], headComplete: boolean}} HeadSignals
 */

/**
 * @param {import('parse5').DefaultTreeAdapterMap['element']} node
 * @param {string} name
 * @return {string | null}
 */
function attr(node, name) {
  const found = node.attrs.find(a => a.name === name);
  return found ? found.value : null;
}

/**
 * @param {import('parse5').DefaultTreeAdapterMap['parentNode']} parent
 * @param {string} tagName
 * @return {import('parse5').DefaultTreeAdapterMap['element'] | undefined}
 */
function childElement(parent, tagName) {
  return /** @type {any} */ (parent.childNodes.find(node => node.nodeName === tagName));
}

/**
 * Whether the parser has moved past the head: the body holds an element or non-blank text. An
 * empty body on a complete (untruncated) document is handled by the caller.
 * @param {import('parse5').DefaultTreeAdapterMap['element'] | undefined} body
 * @return {boolean}
 */
function bodyHasContent(body) {
  if (!body) return false;
  return body.childNodes.some(node => {
    if (node.nodeName === '#text') return /\S/.test(/** @type {any} */ (node).value);
    return node.nodeName !== '#comment';
  });
}

/**
 * @param {string} text
 * @return {{text: string, cut: boolean}}
 */
function limitTagOpenings(text) {
  let position = -1;
  for (let count = 0; count < MAX_TAG_OPENINGS; count++) {
    position = text.indexOf('<', position + 1);
    if (position === -1) return {text, cut: false};
  }
  // The 2,000th "<" was found: everything from the next one on is not given to the parser.
  const next = text.indexOf('<', position + 1);
  return next === -1 ? {text, cut: false} : {text: text.slice(0, next), cut: true};
}

/**
 * @param {Buffer | string} body A prefix of an HTML document.
 * @param {{truncated: boolean}} options `truncated`: the prefix stops before the document ends.
 * @return {HeadSignals}
 */
function extractHeadSignals(body, {truncated}) {
  /** @type {HeadSignals} */
  let signals = {metas: [], canonicals: [], headComplete: !truncated};
  try {
    const full = typeof body === 'string' ? body : body.toString('utf-8');
    const {text, cut} = limitTagOpenings(full);
    // Text withheld from the parser is truncation too: the head is only known complete if the
    // parser reaches the body.
    const incomplete = truncated || cut;
    signals = {metas: [], canonicals: [], headComplete: !incomplete};
    const document = parse(text);
    const html = childElement(document, 'html');
    if (!html) return signals;
    const head = childElement(html, 'head');
    const bodyElement = childElement(html, 'body');

    if (incomplete && bodyHasContent(bodyElement)) signals.headComplete = true;
    if (!head) return signals;

    for (const node of head.childNodes) {
      if (node.nodeName === 'meta' && signals.metas.length < MAX_METAS) {
        const name = (attr(/** @type {any} */ (node), 'name') || '').trim().toLowerCase();
        if (META_NAMES.has(name)) {
          const content = attr(/** @type {any} */ (node), 'content') || '';
          signals.metas.push({name, content: content.slice(0, MAX_CONTENT_LENGTH)});
        }
      } else if (node.nodeName === 'link' && signals.canonicals.length < MAX_CANONICALS) {
        const rel = (attr(/** @type {any} */ (node), 'rel') || '').toLowerCase().split(/\s+/);
        const href = (attr(/** @type {any} */ (node), 'href') || '').trim();
        if (rel.includes('canonical') && href) signals.canonicals.push(href);
      }
    }
  } catch {
    // Unparseable input yields whatever was gathered so far; the caller reads `headComplete`.
  }
  return signals;
}

export {extractHeadSignals};
