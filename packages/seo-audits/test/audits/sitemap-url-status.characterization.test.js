/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Characterization test: pins the EXACT output of `sitemap-url-status` (Phase 4 item 5) so the
 * refactor that moves its requests into the `SitemapDocuments` gatherer cannot change what it
 * reports. The expected values below were captured from the audit BEFORE the refactor and must not
 * be edited to make a refactor pass: if one fails, the refactor is wrong. Only `runStatusAudit`
 * (how a scenario is fed to the audit) is allowed to change.
 */

/* eslint-env jest */

jest.mock('../../src/lib/safe-fetch.js', () => ({
  safeFetchStatus: jest.fn(),
}));

const {safeFetchStatus} = require('../../src/lib/safe-fetch.js');
const {default: SitemapUrlStatus} = require('../../src/audits/sitemap-url-status.js');
const {emptyDocument} = require('../../src/lib/sitemap-parse.js');
const {SAMPLE_SIZE_ENV} = require('../../src/lib/sitemap-url-sample.js');

const doc = (url, locs, overrides = {}) => ({
  ...emptyDocument({url, source: 'declared', parentUrl: null}),
  status: 200,
  kind: 'urlset',
  locs,
  entryCount: locs.length,
  ...overrides,
});
const pages = (n, base = 'https://example.com') =>
  Array.from({length: n}, (_, i) => `${base}/p${i}`);

/**
 * How a scenario is fed to the audit. Before the refactor: mock the audit's own status fetcher.
 * `fetch(url, attempt)` returns `{status, redirectLocation?}` or throws.
 */
async function runStatusAudit({documents, discovery = 'robots-txt', sampleSize, fetch, clock}) {
  safeFetchStatus.mockReset();
  const counts = new Map();
  safeFetchStatus.mockImplementation(async url => {
    counts.set(url, (counts.get(url) || 0) + 1);
    return fetch(url, counts.get(url));
  });
  if (sampleSize === undefined) delete process.env[SAMPLE_SIZE_ENV];
  else process.env[SAMPLE_SIZE_ENV] = String(sampleSize);
  const spy = clock ? jest.spyOn(Date, 'now').mockImplementation(() => clock.now) : null;
  try {
    return await SitemapUrlStatus.audit({
      SitemapDocuments: {
        discovery,
        unavailableReason: null,
        ignoredSitemapLines: [],
        documentsTruncated: false,
        documents,
      },
    });
  } finally {
    if (spy) spy.mockRestore();
    delete process.env[SAMPLE_SIZE_ENV];
  }
}

const ok = async () => ({status: 200});

/** name -> scenario input. Expected outputs live in EXPECTED, keyed by the same names. */
const SCENARIOS = {
  'all 2xx, small sitemap': {
    documents: [doc('https://example.com/sitemap.xml', pages(3))],
    fetch: ok,
  },
  'nodejs-style: 5 of 10 sampled return 404': (() => {
    const bad = new Set(['p2', 'p6', 'p11', 'p15', 'p19']);
    return {
      documents: [doc('https://example.com/sitemap.xml', pages(20))],
      fetch: async url => ({status: bad.has(url.split('/').pop()) ? 404 : 200}),
    };
  })(),
  'a redirect is a failure and shows its target': {
    documents: [
      doc('https://example.com/sitemap.xml', ['https://example.com/old', 'https://example.com/ok']),
    ],
    fetch: async url =>
      url.endsWith('old')
        ? {status: 301, redirectLocation: 'https://example.com/new'}
        : {status: 200},
  },
  'network error after a retry, and a flaky URL that recovers on the retry': {
    documents: [
      doc('https://example.com/sitemap.xml', [
        'https://example.com/dead',
        'https://example.com/flaky',
        'https://example.com/fine',
      ]),
    ],
    fetch: async (url, attempt) => {
      if (url.endsWith('dead')) throw new Error('ECONNREFUSED');
      if (url.endsWith('flaky') && attempt === 1) throw new Error('ECONNRESET');
      return {status: 200};
    },
  },
  '5xx and other 2xx statuses': {
    documents: [
      doc('https://example.com/sitemap.xml', [
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/c',
      ]),
    ],
    fetch: async url => ({status: url.endsWith('a') ? 503 : url.endsWith('b') ? 204 : 200}),
  },
  'time budget runs out: the rest are not checked': (() => {
    const clock = {now: 1_000_000};
    return {
      documents: [doc('https://example.com/sitemap.xml', pages(10))],
      clock,
      fetch: async () => {
        clock.now += 40_000; // the first request "takes" longer than the whole 30 s budget
        return {status: 200};
      },
    };
  })(),
  'other-host, other-scheme and other-port URLs are skipped and counted': {
    documents: [
      doc('https://example.com/sitemap.xml', [
        'https://example.com/a',
        'https://other.test/b',
        'http://example.com/c',
        'https://example.com:8443/d',
        'https://example.com/e',
      ]),
    ],
    fetch: ok,
  },
  'the same URL in two sitemap files is sampled once': {
    documents: [
      doc('https://example.com/s1.xml', ['https://example.com/a', 'https://example.com/b']),
      doc('https://example.com/s2.xml', ['https://example.com/b', 'https://example.com/c']),
    ],
    fetch: ok,
  },
  'sample size 4 out of 100': {
    documents: [doc('https://example.com/sitemap.xml', pages(100))],
    sampleSize: 4,
    fetch: ok,
  },
  'sample size 500 is capped at 25': {
    documents: [doc('https://example.com/sitemap.xml', pages(100))],
    sampleSize: 500,
    fetch: ok,
  },
  'a non-numeric sample size falls back to 10': {
    documents: [doc('https://example.com/sitemap.xml', pages(30))],
    sampleSize: 'lots',
    fetch: ok,
  },
  'not applicable: discovery none': {documents: [], discovery: 'none', fetch: ok},
  'not applicable: discovery unavailable': {documents: [], discovery: 'unavailable', fetch: ok},
  'not applicable: only a sitemap index': {
    documents: [
      doc('https://example.com/i.xml', ['https://example.com/c.xml'], {kind: 'sitemapindex'}),
    ],
    fetch: ok,
  },
  'not applicable: every URL is on another host': {
    documents: [doc('https://example.com/sitemap.xml', ['https://other.test/a'])],
    fetch: ok,
  },
  'not applicable: the only sitemap failed to fetch': {
    documents: [doc('https://example.com/sitemap.xml', [], {outcome: 'http-error', kind: null})],
    fetch: ok,
  },
};

/* EXPECTED:START */
// Captured from the audit before the refactor. DO NOT EDIT to make a refactor pass.
const EXPECTED = {
  'all 2xx, small sitemap': {
    score: 1,
    details: {
      type: 'table',
      headings: [
        {
          key: 'url',
          valueType: 'text',
          label: 'URL',
        },
        {
          key: 'result',
          valueType: 'text',
          label: 'Result',
        },
      ],
      items: [
        {
          url: 'https://example.com/p0',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p1',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p2',
          result: 'HTTP 200',
        },
      ],
    },
    displayValue: 'Checked 3 of 3 listed URLs (a sample).',
  },
  'nodejs-style: 5 of 10 sampled return 404': {
    score: 0,
    explanation:
      '5 of 10 sampled URL(s) did not return 200. Checked 10 of 20 listed URLs (a sample).',
    details: {
      type: 'table',
      headings: [
        {
          key: 'url',
          valueType: 'text',
          label: 'URL',
        },
        {
          key: 'result',
          valueType: 'text',
          label: 'Result',
        },
      ],
      items: [
        {
          url: 'https://example.com/p0',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p2',
          result: 'HTTP 404',
        },
        {
          url: 'https://example.com/p4',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p6',
          result: 'HTTP 404',
        },
        {
          url: 'https://example.com/p8',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p11',
          result: 'HTTP 404',
        },
        {
          url: 'https://example.com/p13',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p15',
          result: 'HTTP 404',
        },
        {
          url: 'https://example.com/p17',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p19',
          result: 'HTTP 404',
        },
      ],
    },
  },
  'a redirect is a failure and shows its target': {
    score: 0,
    explanation: '1 of 2 sampled URL(s) did not return 200. Checked 2 of 2 listed URLs (a sample).',
    details: {
      type: 'table',
      headings: [
        {
          key: 'url',
          valueType: 'text',
          label: 'URL',
        },
        {
          key: 'result',
          valueType: 'text',
          label: 'Result',
        },
      ],
      items: [
        {
          url: 'https://example.com/old',
          result: 'HTTP 301, redirects to https://example.com/new',
        },
        {
          url: 'https://example.com/ok',
          result: 'HTTP 200',
        },
      ],
    },
  },
  'network error after a retry, and a flaky URL that recovers on the retry': {
    score: 0,
    explanation: '1 of 3 sampled URL(s) did not return 200. Checked 3 of 3 listed URLs (a sample).',
    details: {
      type: 'table',
      headings: [
        {
          key: 'url',
          valueType: 'text',
          label: 'URL',
        },
        {
          key: 'result',
          valueType: 'text',
          label: 'Result',
        },
      ],
      items: [
        {
          url: 'https://example.com/dead',
          result: 'could not be fetched: ECONNREFUSED',
        },
        {
          url: 'https://example.com/flaky',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/fine',
          result: 'HTTP 200',
        },
      ],
    },
  },
  '5xx and other 2xx statuses': {
    score: 0,
    explanation: '1 of 3 sampled URL(s) did not return 200. Checked 3 of 3 listed URLs (a sample).',
    details: {
      type: 'table',
      headings: [
        {
          key: 'url',
          valueType: 'text',
          label: 'URL',
        },
        {
          key: 'result',
          valueType: 'text',
          label: 'Result',
        },
      ],
      items: [
        {
          url: 'https://example.com/a',
          result: 'HTTP 503',
        },
        {
          url: 'https://example.com/b',
          result: 'HTTP 204',
        },
        {
          url: 'https://example.com/c',
          result: 'HTTP 200',
        },
      ],
    },
  },
  'time budget runs out: the rest are not checked': {
    score: 1,
    details: {
      type: 'table',
      headings: [
        {
          key: 'url',
          valueType: 'text',
          label: 'URL',
        },
        {
          key: 'result',
          valueType: 'text',
          label: 'Result',
        },
      ],
      items: [
        {
          url: 'https://example.com/p0',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p1',
          result: 'not checked (time budget used up)',
        },
        {
          url: 'https://example.com/p2',
          result: 'not checked (time budget used up)',
        },
        {
          url: 'https://example.com/p3',
          result: 'not checked (time budget used up)',
        },
        {
          url: 'https://example.com/p4',
          result: 'not checked (time budget used up)',
        },
        {
          url: 'https://example.com/p5',
          result: 'not checked (time budget used up)',
        },
        {
          url: 'https://example.com/p6',
          result: 'not checked (time budget used up)',
        },
        {
          url: 'https://example.com/p7',
          result: 'not checked (time budget used up)',
        },
        {
          url: 'https://example.com/p8',
          result: 'not checked (time budget used up)',
        },
        {
          url: 'https://example.com/p9',
          result: 'not checked (time budget used up)',
        },
      ],
    },
    displayValue: 'Checked 1 of 10 listed URLs (a sample). 9 not checked: the time budget ran out.',
  },
  'other-host, other-scheme and other-port URLs are skipped and counted': {
    score: 1,
    details: {
      type: 'table',
      headings: [
        {
          key: 'url',
          valueType: 'text',
          label: 'URL',
        },
        {
          key: 'result',
          valueType: 'text',
          label: 'Result',
        },
      ],
      items: [
        {
          url: 'https://example.com/a',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/e',
          result: 'HTTP 200',
        },
      ],
    },
    displayValue:
      'Checked 2 of 2 listed URLs (a sample). 3 listed on another host were not requested.',
  },
  'the same URL in two sitemap files is sampled once': {
    score: 1,
    details: {
      type: 'table',
      headings: [
        {
          key: 'url',
          valueType: 'text',
          label: 'URL',
        },
        {
          key: 'result',
          valueType: 'text',
          label: 'Result',
        },
      ],
      items: [
        {
          url: 'https://example.com/a',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/b',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/c',
          result: 'HTTP 200',
        },
      ],
    },
    displayValue: 'Checked 3 of 3 listed URLs (a sample).',
  },
  'sample size 4 out of 100': {
    score: 1,
    details: {
      type: 'table',
      headings: [
        {
          key: 'url',
          valueType: 'text',
          label: 'URL',
        },
        {
          key: 'result',
          valueType: 'text',
          label: 'Result',
        },
      ],
      items: [
        {
          url: 'https://example.com/p0',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p33',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p66',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p99',
          result: 'HTTP 200',
        },
      ],
    },
    displayValue: 'Checked 4 of 100 listed URLs (a sample).',
  },
  'sample size 500 is capped at 25': {
    score: 1,
    details: {
      type: 'table',
      headings: [
        {
          key: 'url',
          valueType: 'text',
          label: 'URL',
        },
        {
          key: 'result',
          valueType: 'text',
          label: 'Result',
        },
      ],
      items: [
        {
          url: 'https://example.com/p0',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p4',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p8',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p12',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p17',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p21',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p25',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p29',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p33',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p37',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p41',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p45',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p50',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p54',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p58',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p62',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p66',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p70',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p74',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p78',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p83',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p87',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p91',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p95',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p99',
          result: 'HTTP 200',
        },
      ],
    },
    displayValue: 'Checked 25 of 100 listed URLs (a sample).',
  },
  'a non-numeric sample size falls back to 10': {
    score: 1,
    details: {
      type: 'table',
      headings: [
        {
          key: 'url',
          valueType: 'text',
          label: 'URL',
        },
        {
          key: 'result',
          valueType: 'text',
          label: 'Result',
        },
      ],
      items: [
        {
          url: 'https://example.com/p0',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p3',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p6',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p10',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p13',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p16',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p19',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p23',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p26',
          result: 'HTTP 200',
        },
        {
          url: 'https://example.com/p29',
          result: 'HTTP 200',
        },
      ],
    },
    displayValue: 'Checked 10 of 30 listed URLs (a sample).',
  },
  'not applicable: discovery none': {
    score: null,
    notApplicable: true,
  },
  'not applicable: discovery unavailable': {
    score: null,
    notApplicable: true,
  },
  'not applicable: only a sitemap index': {
    score: null,
    notApplicable: true,
  },
  'not applicable: every URL is on another host': {
    score: null,
    notApplicable: true,
  },
  'not applicable: the only sitemap failed to fetch': {
    score: null,
    notApplicable: true,
  },
};
/* EXPECTED:END */

describe('sitemap-url-status characterization (exact output, captured before the refactor)', () => {
  it.each(Object.keys(SCENARIOS))('%s', async name => {
    const result = await runStatusAudit(SCENARIOS[name]);
    expect(result).toEqual(EXPECTED[name]);
  });

  it('covers every scenario with an expectation (no silent gaps)', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(SCENARIOS).sort());
  });
});
