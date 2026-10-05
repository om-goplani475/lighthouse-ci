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

import zlib from 'zlib';
import {SaxesParser} from 'saxes';
import {looseKey} from './url-key.js';

/**
 * Caps and limits — module constants, deliberately not user-configurable (a knob that loosens a
 * resource bound is a security decision, not a preference).
 */
const LIMITS = {
  MAX_DECLARED: 5,
  MAX_DOCUMENTS: 10,
  // Same cap as the decompressed size, not smaller: a plain (non-gzip) sitemap is legitimately up
  // to 50 MiB on the wire, and a smaller wire cap would report a valid 20 MiB sitemap as a fetch
  // failure. Memory and time stay bounded by this cap plus the fetcher's total deadline.
  MAX_COMPRESSED_BYTES: 52_428_801,
  // 50 MiB + 1: one byte over the sitemaps.org limit, so "over the limit" is detectable without
  // reading an unbounded amount.
  MAX_UNCOMPRESSED_BYTES: 52_428_801,
  // 50,000 (the sitemaps.org per-file URL limit) + 1, for the same reason.
  MAX_ENTRIES_STORED: 50_001,
  MAX_LOC_LENGTH: 2048,
  // Real sitemaps nest 4-6 levels (urlset > url > image:image > image:loc). saxes' cost per opening
  // tag grows with the current depth, so an unbounded depth is a quadratic-time denial of service:
  // measured, a 96 KB document of nested tags took 17 s and a 1 MiB one would run for many minutes,
  // with parsing synchronous so no timeout can interrupt it.
  MAX_DEPTH: 32,
  MAX_INVALID_LOC_EXAMPLES: 20,
  REQUEST_TIMEOUT_MS: 10_000,
  // One shared budget for discovering and fetching the sitemap files (robots.txt included). Without
  // it the worst case was ~105 s (a robots.txt plus ten documents that each use their full request
  // timeout). Past it, remaining documents are not fetched and `documentsTruncated` is set. The page
  // sample has its own, separate 30 s budget (see sitemap-url-sample.js).
  DOCUMENTS_BUDGET_MS: 40_000,
  // A request given less time than this would only time out, so it is not started.
  MIN_REQUEST_MS: 1_000,
};

class StopParsing extends Error {}

const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const CHUNK_BYTES = 64 * 1024;
const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const MAX_TARGET_ALTERNATES = 100;

/**
 * The `<url>` entry of one chosen page (the audited URL), with the `<xhtml:link rel="alternate" hreflang>`
 * alternates listed under it. Only recorded for the page asked for, so a huge sitemap never grows the artifact.
 * @typedef {{alternates: Array<{hreflang: string, href: string}>, alternatesTruncated: boolean}} SitemapTargetEntry
 */
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
 *   targetEntry: SitemapTargetEntry | null,
 * }} SitemapDocument
 */
/**
 * @typedef {{
 *   url: string,
 *   status: number | null,
 *   redirectLocation: string | null,
 *   error: string | null,
 *   notChecked: boolean,
 *   contentType: string | null,
 *   xRobotsTag: string[],
 *   bodyRead: 'html' | 'skipped-status' | 'skipped-not-html' | 'skipped-compressed' | null,
 *   truncated: boolean,
 *   metas: Array<{name: string, content: string}>,
 *   canonicals: string[],
 *   headComplete: boolean,
 * }} SampledPage
 * One sampled sitemap URL: what `sitemap-url-status` needs (`status`, `redirectLocation`, `error`,
 * `notChecked`, exactly `UrlCheck`'s fields) plus the indexability signals read from its response
 * (`contentType`, `xRobotsTag`, the extracted `metas` and `canonicals`, and whether the `<head>` was
 * read in full). Never holds raw HTML.
 */
/**
 * @typedef {{
 *   sampleSize: number,
 *   eligibleCount: number,
 *   skippedCrossOrigin: number,
 *   pages: SampledPage[],
 * }} UrlSample
 * `sampleSize` is the resolved `LHCI_SEO_SITEMAP_SAMPLE_SIZE`; `eligibleCount` is how many same-origin
 * listed URLs the sample was drawn from.
 */
/**
 * @typedef {{
 *   discovery: 'robots-txt' | 'default-location' | 'none' | 'unavailable',
 *   unavailableReason: string | null,
 *   ignoredSitemapLines: string[],
 *   documentsTruncated: boolean,
 *   documents: SitemapDocument[],
 *   urlSample?: UrlSample | null,
 * }} SitemapDocumentsArtifact
 * `urlSample` is `null` when no sample was taken (discovery `none`/`unavailable`, or no eligible URL)
 * and may be absent on an older artifact; both audits that read it treat absent as `null`.
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
    targetEntry: null,
  };
}

/**
 * Parses the XML of a sitemap. Fills `kind`, `namespaceOk`, `parseError`, `locs`, `entryCount`,
 * `entriesTruncated`, `invalidLocs` and `invalidLocCount` on `doc`.
 * @param {Buffer} xml
 * @param {SitemapDocument} doc
 * @param {string | null} [target] The page whose `<xhtml:link>` alternates are recorded in `targetEntry`.
 */
function parseXmlInto(xml, doc, target = null) {
  const targetKey = target ? looseKey(target) : null;
  /** @type {Array<{hreflang: string, href: string}>} */
  let urlAlternates = [];
  let urlAlternatesTruncated = false;
  /** @type {string | null} */
  let urlLoc = null;
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

    if (stack.length >= LIMITS.MAX_DEPTH) {
      doc.parseError = {
        message: `elements are nested deeper than ${LIMITS.MAX_DEPTH} levels`,
        line: parser.line,
        column: parser.column,
      };
      stopped = true;
      // Throw rather than just flagging: saxes would otherwise keep processing the rest of the
      // current chunk, and its per-tag cost is what makes deep nesting expensive.
      throw new StopParsing();
    }

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
    if (targetKey && doc.kind === 'urlset') {
      if (stack.length === 1 && local === 'url' && uri === SITEMAP_NAMESPACE) {
        urlAlternates = [];
        urlAlternatesTruncated = false;
        urlLoc = null;
      } else if (
        stack.length === 2 &&
        local === 'link' &&
        uri === XHTML_NAMESPACE &&
        stack[1].local === 'url'
      ) {
        const attrs = /** @type {Record<string, {value: string}>} */ (tag.attributes);
        const rel = attrs.rel ? attrs.rel.value.toLowerCase().split(/\s+/) : [];
        if (rel.includes('alternate') && attrs.hreflang && attrs.href) {
          if (urlAlternates.length < MAX_TARGET_ALTERNATES) {
            urlAlternates.push({
              hreflang: attrs.hreflang.value.trim().slice(0, 40),
              href: attrs.href.value.trim().slice(0, 2000),
            });
          } else {
            urlAlternatesTruncated = true;
          }
        }
      }
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
    if (
      targetKey &&
      tag.local === 'url' &&
      stack.length === 1 &&
      doc.targetEntry === null &&
      urlLoc !== null &&
      looseKey(urlLoc) === targetKey
    ) {
      doc.targetEntry = {alternates: urlAlternates, alternatesTruncated: urlAlternatesTruncated};
    }
    if (!(inLoc && tag.local === 'loc' && stack.length === 2)) return;
    inLoc = false;

    const value = locText.trim();
    if (targetKey && doc.kind === 'urlset') urlLoc = value;
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
  try {
    while (!stopped && offset < xml.length) {
      const end = Math.min(offset + CHUNK_BYTES, xml.length);
      parser.write(decoder.decode(xml.subarray(offset, end), {stream: true}));
      offset = end;
    }
  } catch (err) {
    if (!(err instanceof StopParsing)) throw err;
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
 * @param {Buffer} body
 * @return {boolean}
 */
function isGzip(body) {
  // Detected by magic bytes, not the URL: a server may gzip a plain `.xml` URL.
  return body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b;
}

/**
 * Builds a `SitemapDocument` from a successfully fetched (2xx) response body. Non-2xx and network
 * failures are recorded by the caller (gatherer) directly as documents with the matching
 * `outcome`; this function only handles bytes it was given.
 *
 * Gzip bodies are decompressed with a hard cap on the *output*: zlib stops at
 * `maxUncompressedBytes` instead of inflating further, so a small "gzip bomb" cannot exhaust
 * memory. Hitting the cap sets `exceededUncompressedLimit` and leaves `kind` null (the document
 * was not parsed). `maxUncompressedBytes` exists so tests need not allocate 50 MiB; callers in
 * production never pass it.
 * @param {{
 *   url: string,
 *   source: SitemapDocument['source'],
 *   parentUrl: string | null,
 *   status: number,
 *   body: Buffer,
 * }} input
 * @param {{maxUncompressedBytes?: number, target?: string | null}} [options] `target`: the page whose
 *   `<xhtml:link>` alternates are recorded in `targetEntry`.
 * @return {SitemapDocument}
 */
function parseSitemapBytes(
  {url, source, parentUrl, status, body},
  {maxUncompressedBytes = LIMITS.MAX_UNCOMPRESSED_BYTES, target = null} = {}
) {
  const doc = emptyDocument({url, source, parentUrl});
  doc.status = status;
  doc.compressedBytes = body.length;

  let xml = body;
  if (isGzip(body)) {
    doc.gzip = true;
    try {
      // `maxOutputLength` is a real zlib option (Node 14+; throws ERR_BUFFER_TOO_LARGE), just
      // missing from this monorepo's pinned, 2019-era @types/node.
      xml = zlib.gunzipSync(
        body,
        /** @type {import('zlib').ZlibOptions} */ ({maxOutputLength: maxUncompressedBytes})
      );
    } catch (err) {
      if (err && err.code === 'ERR_BUFFER_TOO_LARGE') {
        doc.exceededUncompressedLimit = true;
        doc.uncompressedBytes = maxUncompressedBytes;
      } else {
        doc.outcome = 'decompression-error';
        doc.errorMessage = `could not decompress gzip data: ${
          err instanceof Error ? err.message : err
        }`;
      }
      return doc;
    }
  }

  doc.uncompressedBytes = xml.length;
  doc.exceededUncompressedLimit = xml.length >= maxUncompressedBytes;
  parseXmlInto(xml, doc, target);
  return doc;
}

export {LIMITS, SITEMAP_NAMESPACE, locProblem, emptyDocument, parseSitemapBytes};
