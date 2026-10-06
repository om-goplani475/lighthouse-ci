/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Small builders shared by the tests of the vertical audits (local, news, video, entity): JSON-LD entities, crawled pages,
 * crawl snapshots, crawl artifacts and sitemap artifacts.
 */

const {projectEntities} = require('../../src/lib/structured-facts.js');

/** @param {...object} objs JSON-LD objects, one block each. */
const ents = (...objs) => projectEntities(objs.map(o => JSON.stringify(o)));

const page = (url, over = {}) => ({
  url,
  finalUrl: url,
  redirects: [],
  status: 200,
  contentType: 'text/html',
  bytes: 1000,
  truncated: false,
  title: null,
  description: null,
  canonicals: [],
  robotsMetas: [],
  xRobotsTag: [],
  h1: [],
  textHash: 'h',
  textLength: 500,
  wordCount: 100,
  links: [],
  externalLinks: [],
  pagination: {next: [], prev: []},
  entities: [],
  depth: 1,
  source: 'link',
  extraction: 'ok',
  ...over,
});

const link = url => ({url, nofollow: false, sponsored: false, ugc: false, anchor: 'x'});

const snapshot = (pages, over = {}) => ({
  version: 3,
  origin: 'https://site.example',
  createdAt: new Date().toISOString(),
  bounds: {pages: 50, depth: 3, budgetMs: 1000, robots: 'honour', userAgent: 'x'},
  robots: {state: 'present'},
  seeds: {audited: 1, home: 0, links: 0, sitemap: 0},
  sitemapUrls: [],
  pages,
  skipped: [],
  stats: {
    requests: pages.length,
    elapsedMs: 10,
    truncatedByBudget: false,
    overPageCap: false,
    cutByDepth: false,
  },
  ...over,
});

const artifact = (snap, state = 'crawled') => ({
  state,
  auditedUrl: 'https://site.example/',
  reason: null,
  snapshot: snap,
  auditedRenderedTextLength: null,
  linkChecks: null,
  externalChecks: null,
});

const sitemaps = (locs, over = {}) => ({
  discovery: 'robots-txt',
  unavailableReason: null,
  ignoredSitemapLines: [],
  documentsTruncated: false,
  documents: [
    {
      url: 'https://site.example/sitemap.xml',
      outcome: 'ok',
      kind: 'urlset',
      entriesTruncated: false,
      locs,
      entryCount: locs.length,
    },
  ],
  ...over,
});

module.exports = {ents, page, link, snapshot, artifact, sitemaps};
