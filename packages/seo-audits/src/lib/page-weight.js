/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builders for two informational audits about how heavy the page is to fetch and render, which
 * matters for search engine crawling on large, script-heavy sites: `render-blocking-report` (the scripts and
 * stylesheets in the head that stop the browser painting) and `request-weight-report` (how many requests and
 * how many bytes, by type and by host). Google documents no threshold for either, so neither ever fails.
 * Reads the raw HTML and the page-load network log; makes no request. No I/O, never throws.
 *
 * "Render-blocking" here is read from the HTML: an external `<script src>` in the head with no `async`, `defer` or
 * `type=module`, and a `<link rel=stylesheet>` in the head that is not print-only or speech-only (a media query such as `(min-width: 800px)` is counted: it blocks whenever it matches). It is an approximation of what
 * the browser does (it does not model the preload scanner or `<link rel=preload>`).
 */

import {Parser} from 'htmlparser2';
import {Audit} from 'lighthouse/core/audits/audit.js';
import {normalizeUrl} from './crawl-snapshot.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {{url: string, kind: 'script' | 'stylesheet'}} BlockingResource */

const MAX_BLOCKING = 100;
const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;
const TOP_REQUESTS = 10;
const MAX_HTML_CHARS = 2 * 1024 * 1024;

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_CELL_CHARS ? text : `${text.slice(0, MAX_CELL_CHARS)}...`;
}

/**
 * @param {number} bytes
 * @return {string}
 */
function kib(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MiB`
    : `${Math.round(bytes / 1024)} KiB`;
}

/**
 * @param {unknown} url
 * @return {string | null}
 */
function hostOf(url) {
  try {
    return new URL(/** @type {string} */ (url)).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * @param {string} html
 * @param {string} pageUrl
 * @return {BlockingResource[]}
 */
function blockingResourcesOf(html, pageUrl) {
  /** @type {BlockingResource[]} */
  const found = [];
  try {
    const text = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
    const bodyAt = text.search(/<body[\s>]/i);
    const head = bodyAt === -1 ? text : text.slice(0, bodyAt);
    const parser = new Parser({
      onopentag(name, attrs) {
        if (found.length >= MAX_BLOCKING) return;
        if (name === 'script' && attrs.src) {
          const type = (attrs.type || '').toLowerCase();
          const blocks = !('async' in attrs) && !('defer' in attrs) && type !== 'module';
          const url = normalizeUrl(attrs.src.trim(), pageUrl);
          if (blocks && url) found.push({url, kind: 'script'});
        } else if (name === 'link' && attrs.href) {
          const rel = (attrs.rel || '').toLowerCase().split(/\s+/);
          const media = (attrs.media || '').toLowerCase().trim();
          // Only a print or speech stylesheet is skipped; a bare media query such as (min-width: 800px) can match a screen.
          const appliesToScreen =
            media === '' || /\b(screen|all)\b/.test(media) || !/\b(print|speech)\b/.test(media);
          const url = normalizeUrl(attrs.href.trim(), pageUrl);
          if (rel.includes('stylesheet') && !('disabled' in attrs) && appliesToScreen && url) {
            found.push({url, kind: 'stylesheet'});
          }
        }
      },
    });
    parser.write(head);
    parser.end();
  } catch {
    // keep what was read
  }
  return found;
}

/**
 * @param {any[] | null | undefined} records
 * @return {Map<string, number>} url to transfer size in bytes
 */
function sizesByUrl(records) {
  /** @type {Map<string, number>} */
  const sizes = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    if (r && typeof r.url === 'string' && typeof r.transferSize === 'number') {
      sizes.set(r.url.split('#')[0], r.transferSize);
    }
  }
  return sizes;
}

/**
 * @param {unknown} html MainDocumentContent
 * @param {any[] | null | undefined} records
 * @param {string} pageUrl
 * @return {Product}
 */
function buildRenderBlockingProduct(html, records, pageUrl) {
  if (typeof html !== 'string' || html.trim() === '' || typeof pageUrl !== 'string') {
    return {
      score: 1,
      notApplicable: true,
      explanation: 'The raw HTML of the page was not collected.',
    };
  }
  const resources = blockingResourcesOf(html, pageUrl);
  if (resources.length === 0) {
    return {score: 1, displayValue: 'No render-blocking script or stylesheet found in the head'};
  }
  const sizes = sizesByUrl(records);
  const pageHost = hostOf(pageUrl);
  const total = resources.reduce((sum, r) => sum + (sizes.get(r.url) || 0), 0);
  const scripts = resources.filter(r => r.kind === 'script').length;
  const rows = resources.slice(0, MAX_ROWS).map(r => ({
    url: clip(r.url),
    kind: r.kind === 'script' ? 'script (stops HTML parsing)' : 'stylesheet (stops painting)',
    size: sizes.has(r.url) ? kib(/** @type {number} */ (sizes.get(r.url))) : 'unknown',
    host: hostOf(r.url) === pageHost ? 'this site' : 'another host',
  }));
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'url', valueType: 'text', label: 'Resource'},
    {key: 'kind', valueType: 'text', label: 'Kind'},
    {key: 'size', valueType: 'text', label: 'Transfer size'},
    {key: 'host', valueType: 'text', label: 'Served from'},
  ];
  const items = [...rows];
  if (resources.length > rows.length) {
    items.push({
      url: `${resources.length - rows.length} more not shown`,
      kind: '',
      size: '',
      host: '',
    });
  }
  return {
    score: 1,
    displayValue: `${resources.length} render-blocking ${
      resources.length === 1 ? 'resource' : 'resources'
    } (${scripts} ${scripts === 1 ? 'script' : 'scripts'}, ${resources.length - scripts} ${
      resources.length - scripts === 1 ? 'stylesheet' : 'stylesheets'
    }, ${kib(total)})`,
    details: Audit.makeTableDetails(headings, items),
  };
}

/**
 * @param {any[] | null | undefined} records
 * @param {string} pageUrl
 * @return {Product}
 */
function buildRequestWeightProduct(records, pageUrl) {
  if (!Array.isArray(records) || typeof pageUrl !== 'string') {
    return {score: 1, notApplicable: true, explanation: 'The network log was not collected.'};
  }
  const requests = records.filter(
    r =>
      r &&
      typeof r.url === 'string' &&
      !r.url.startsWith('data:') &&
      typeof r.transferSize === 'number'
  );
  if (requests.length === 0) {
    return {
      score: 1,
      notApplicable: true,
      explanation: 'The page made no network requests to report.',
    };
  }
  const pageHost = hostOf(pageUrl);
  /** @type {Map<string, {count: number, bytes: number}>} */
  const byType = new Map();
  let total = 0;
  let otherCount = 0;
  let otherBytes = 0;
  for (const r of requests) {
    const type = String(r.resourceType || 'Other');
    const entry = byType.get(type) || {count: 0, bytes: 0};
    entry.count++;
    entry.bytes += r.transferSize;
    byType.set(type, entry);
    total += r.transferSize;
    if (hostOf(r.url) !== pageHost) {
      otherCount++;
      otherBytes += r.transferSize;
    }
  }
  /** @type {Array<{item: string, requests: string, size: string}>} */
  const rows = [{item: 'Total', requests: String(requests.length), size: kib(total)}];
  for (const [type, e] of [...byType].sort((a, b) => b[1].bytes - a[1].bytes)) {
    rows.push({item: `  ${type}`, requests: String(e.count), size: kib(e.bytes)});
  }
  rows.push({item: 'Served from other hosts', requests: String(otherCount), size: kib(otherBytes)});
  for (const r of [...requests]
    .sort((a, b) => b.transferSize - a.transferSize)
    .slice(0, TOP_REQUESTS)) {
    rows.push({item: `Largest: ${clip(r.url)}`, requests: '', size: kib(r.transferSize)});
  }
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'item', valueType: 'text', label: 'Item'},
    {key: 'requests', valueType: 'text', label: 'Requests'},
    {key: 'size', valueType: 'text', label: 'Transfer size'},
  ];
  return {
    score: 1,
    displayValue: `${requests.length} ${requests.length === 1 ? 'request' : 'requests'}, ${kib(
      total
    )}${otherCount ? `, ${otherCount} from other hosts` : ''}`,
    details: Audit.makeTableDetails(headings, rows),
  };
}

export {
  buildRenderBlockingProduct,
  buildRequestWeightProduct,
  blockingResourcesOf,
  MAX_BLOCKING,
  TOP_REQUESTS,
};
