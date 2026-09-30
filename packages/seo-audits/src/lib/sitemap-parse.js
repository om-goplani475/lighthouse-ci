/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure sitemap parsing: bytes in, a `SitemapDocument` out. No I/O and no `import.meta`, so it
 * loads directly under Jest. Never throws on bad input — a malformed document is data
 * (`kind: 'invalid'` plus a `parseError`), because the audits need to report it, not crash on it.
 *
 * Uses `saxes` in strict mode with XML namespaces. Strictness is the point: "well-formed" is only
 * a claim a strict parser can make. `saxes` does not expand custom DTD entities (an undefined
 * entity is a parse error), so entity-expansion ("billion laughs") documents cannot balloon.
 * It also recovers after an error unless told to stop, so this module feeds it in chunks and
 * stops at the first error or when the stored-entry cap is reached.
 */

import {SaxesParser} from 'saxes';

/**
 * Caps and limits — module constants, deliberately not user-configurable (a knob that loosens a
 * resource bound is a security decision, not a preference).
 */
const LIMITS = {
  MAX_DECLARED: 5,
  MAX_DOCUMENTS: 10,
  MAX_COMPRESSED_BYTES: 15 * 1024 * 1024,
  // 50 MiB + 1: one byte over the sitemaps.org limit, so "over the limit" is detectable without
  // reading an unbounded amount.
  MAX_UNCOMPRESSED_BYTES: 52_428_801,
  // 50,000 (the sitemaps.org per-file URL limit) + 1, for the same reason.
  MAX_ENTRIES_STORED: 50_001,
  MAX_LOC_LENGTH: 2048,
  MAX_INVALID_LOC_EXAMPLES: 20,
  REQUEST_TIMEOUT_MS: 10_000,
};

const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const CHUNK_BYTES = 64 * 1024;

/**
 * @typedef {{message: string, line: number, column: number}} SitemapParseError
 * @typedef {{value: string, reason: string}} InvalidLoc
 */
/**
 * `entryCount` counts every `<loc>` seen (valid or not), so `locs.length + invalidLocCount ===
 * entryCount`; `locs` holds only the values that passed validation.
 * @typedef {{
 *   url: string,
 *   source: 'declared' | 'default-location' | 'index-child',
 *   parentUrl: string | null,
 *   outcome: 'ok' | 'http-error' | 'redirect' | 'network-error' | 'decompression-error',
 *   status: number | null,
 *   redirectLocation: string | null,
 *   errorMessage: string | null,
 *   gzip: boolean,
 *   compressedBytes: number,
 *   uncompressedBytes: number,
 *   exceededUncompressedLimit: boolean,
 *   kind: 'urlset' | 'sitemapindex' | 'invalid' | null,
 *   namespaceOk: boolean,
 *   parseError: SitemapParseError | null,
 *   locs: string[],
 *   entryCount: number,
 *   entriesTruncated: boolean,
 *   invalidLocs: InvalidLoc[],
 *   invalidLocCount: number,
 * }} SitemapDocument
 */
/**
 * @typedef {{
 *   discovery: 'robots-txt' | 'default-location' | 'none' | 'unavailable',
 *   ignoredSitemapLines: string[],
 *   documentsTruncated: boolean,
 *   documents: SitemapDocument[],
 * }} SitemapDocumentsArtifact
 */

/**
 * @param {string} value
 * @return {string | null} The reason the value is not a valid sitemap `<loc>`, or null if valid.
 */
function locProblem(value) {
  if (!value) return 'empty';
  if (value.length > LIMITS.MAX_LOC_LENGTH) {
    return `longer than ${LIMITS.MAX_LOC_LENGTH} characters`;
  }
  try {
    const {protocol} = new URL(value);
    if (protocol !== 'http:' && protocol !== 'https:') return 'not an absolute http(s) URL';
  } catch {
    return 'not an absolute http(s) URL';
  }
  return null;
}

/**
 * @param {{url: string, source: SitemapDocument['source'], parentUrl: string | null}} base
 * @return {SitemapDocument}
 */
function emptyDocument(base) {
  return {
    url: base.url,
    source: base.source,
    parentUrl: base.parentUrl,
    outcome: 'ok',
    status: null,
    redirectLocation: null,
    errorMessage: null,
    gzip: false,
    compressedBytes: 0,
    uncompressedBytes: 0,
    exceededUncompressedLimit: false,
    kind: null,
    namespaceOk: false,
    parseError: null,
    locs: [],
    entryCount: 0,
    entriesTruncated: false,
    invalidLocs: [],
    invalidLocCount: 0,
  };
}

/**
 * Parses the XML of a sitemap. Fills `kind`, `namespaceOk`, `parseError`, `locs`, `entryCount`,
 * `entriesTruncated`, `invalidLocs` and `invalidLocCount` on `doc`.
 * @param {Buffer} xml
 * @param {SitemapDocument} doc
 */
function parseXmlInto(xml, doc) {
  const parser = new SaxesParser({xmlns: true, position: true});
  const decoder = new TextDecoder('utf-8');

  let stopped = false;
  /** @type {Array<{local: string, uri: string}>} */
  const stack = [];
  let locText = '';
  let inLoc = false;

  doc.kind = null;

  parser.on('error', err => {
    if (stopped) return;
    stopped = true;
    doc.parseError = {
      // saxes prefixes its messages with "line:column: "; those are reported as fields instead.
      message: err.message.replace(/^\d+:\d+:\s*/, ''),
      line: parser.line,
      column: parser.column,
    };
  });

  // saxes keeps emitting events for the remainder of the chunk it is already processing after we
  // decide to stop, so every handler must be a no-op once `stopped` is set.
  parser.on('opentag', tag => {
    if (stopped) return;
    const local = tag.local;
    const uri = tag.uri;

    if (stack.length === 0) {
      doc.kind =
        local === 'urlset' ? 'urlset' : local === 'sitemapindex' ? 'sitemapindex' : 'invalid';
      doc.namespaceOk = uri === SITEMAP_NAMESPACE;
      // Nothing to collect from a document that is not a sitemap at all.
      if (doc.kind === 'invalid') stopped = true;
    } else if (
      stack.length === 2 &&
      local === 'loc' &&
      uri === SITEMAP_NAMESPACE &&
      stack[1].uri === SITEMAP_NAMESPACE &&
      stack[1].local === (doc.kind === 'urlset' ? 'url' : 'sitemap')
    ) {
      inLoc = true;
      locText = '';
    }
    stack.push({local, uri});
  });

  /** @param {string} text */
  const onText = text => {
    if (!stopped && inLoc) locText += text;
  };
  parser.on('text', onText);
  parser.on('cdata', onText);

  parser.on('closetag', tag => {
    if (stopped) return;
    stack.pop();
    if (!(inLoc && tag.local === 'loc' && stack.length === 2)) return;
    inLoc = false;

    const value = locText.trim();
    doc.entryCount += 1;
    const problem = locProblem(value);
    if (problem) {
      doc.invalidLocCount += 1;
      if (doc.invalidLocs.length < LIMITS.MAX_INVALID_LOC_EXAMPLES) {
        doc.invalidLocs.push({value: value.slice(0, 200), reason: problem});
      }
    } else {
      doc.locs.push(value);
    }

    if (doc.entryCount >= LIMITS.MAX_ENTRIES_STORED) {
      doc.entriesTruncated = true;
      stopped = true;
    }
  });

  let offset = 0;
  while (!stopped && offset < xml.length) {
    const end = Math.min(offset + CHUNK_BYTES, xml.length);
    parser.write(decoder.decode(xml.subarray(offset, end), {stream: true}));
    offset = end;
  }
  if (!stopped) {
    // Flush the decoder and let saxes report an unexpected end of document (no root, unclosed
    // tags) as a parse error, rather than silently treating a truncated file as fine.
    const tail = decoder.decode();
    if (tail) parser.write(tail);
    parser.close();
  }

  // A document that never opened a root element (empty, or plain text) is not a valid sitemap.
  if (doc.kind === null) doc.kind = 'invalid';
}

/**
 * Builds a `SitemapDocument` from a successfully fetched (2xx) response body. Non-2xx and network
 * failures are recorded by the caller (gatherer) directly as documents with the matching
 * `outcome`; this function only handles bytes it was given.
 * @param {{
 *   url: string,
 *   source: SitemapDocument['source'],
 *   parentUrl: string | null,
 *   status: number,
 *   body: Buffer,
 * }} input
 * @return {SitemapDocument}
 */
function parseSitemapBytes({url, source, parentUrl, status, body}) {
  const doc = emptyDocument({url, source, parentUrl});
  doc.status = status;
  doc.compressedBytes = body.length;
  doc.uncompressedBytes = body.length;
  parseXmlInto(body, doc);
  return doc;
}

export {LIMITS, SITEMAP_NAMESPACE, locProblem, emptyDocument, parseSitemapBytes};
