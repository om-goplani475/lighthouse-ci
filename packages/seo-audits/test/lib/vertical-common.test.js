/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {clip, count, notApplicable, MAX_CELL_CHARS} = require('../../src/lib/vertical-common.js');

describe('vertical helpers', () => {
  it('pluralises: -y after a consonant becomes -ies, and one is singular', () => {
    expect(count(1, 'news entry')).toBe('1 news entry');
    expect(count(2, 'news entry')).toBe('2 news entries');
    expect(count(3, 'inconsistency')).toBe('3 inconsistencies');
    expect(count(2, 'day')).toBe('2 days');
    expect(count(0, 'page')).toBe('0 pages');
    expect(count(5, 'identifier problem')).toBe('5 identifier problems');
    expect(count(9, 'address')).toBe('9 addresses');
    expect(count(2, 'sameAs address')).toBe('2 sameAs addresses');
    expect(count(3, 'match')).toBe('3 matches');
    expect(count(2, 'business')).toBe('2 businesses');
    expect(count(1, 'address')).toBe('1 address');
  });

  it('clips long text and builds a not-applicable product', () => {
    expect(clip('short')).toBe('short');
    expect(clip('x'.repeat(500))).toHaveLength(MAX_CELL_CHARS + 3);
    expect(notApplicable('why')).toEqual({score: 1, notApplicable: true, explanation: 'why'});
  });
});

describe('unreadSitemapsNote', () => {
  const {unreadSitemapsNote} = require('../../src/lib/vertical-common.js');
  it('is empty when every sitemap file was read', () => {
    expect(unreadSitemapsNote(null)).toBe('');
    expect(unreadSitemapsNote({documents: [{outcome: 'ok'}], documentsTruncated: false})).toBe('');
  });

  it('says how many could not be read, mentions redirects, and a truncated set', () => {
    const note = unreadSitemapsNote({
      documents: [{outcome: 'ok'}, {outcome: 'redirect'}, {outcome: 'http-error'}],
      documentsTruncated: false,
    });
    expect(note).toMatch(/2 sitemap files could not be read \(1 answered with a redirect/);
    expect(note).toMatch(/one may exist that was not seen\.$/);
    expect(unreadSitemapsNote({documents: [{outcome: 'ok'}], documentsTruncated: true})).toMatch(
      /more files than the audits read/
    );
  });
});

describe('probeStatuses', () => {
  const {probeStatuses} = require('../../src/lib/vertical-common.js');
  const siteOf = host => host.split('.').slice(-2).join('.');
  const run = (urls, fetchStatus, max = 5) =>
    probeStatuses({urls, pageUrl: 'https://www.x.example/p', max, fetchStatus, siteOf});

  it('keeps only non-2xx answers, with the package policy: 404, 410 and a missing host are defects, the rest are notes', async () => {
    const answers = {
      'https://x.example/ok': 200,
      'https://x.example/gone': 404,
      'https://x.example/old': 410,
      'https://x.example/forbidden': 403,
      'https://x.example/down': 503,
    };
    const {rows, checked} = await run(Object.keys(answers), async url => ({status: answers[url]}));
    expect(checked).toBe(5);
    expect(rows.map(r => [r.url.split('/').pop(), r.kind, r.severity])).toEqual([
      ['gone', 'gone', 'problem'],
      ['old', 'gone', 'problem'],
      ['forbidden', 'status', 'note'],
      ['down', 'status', 'note'],
    ]);
  });

  it('treats a missing host as a defect and any other failure as a note', async () => {
    const {rows} = await run(
      ['https://a.example/', 'https://b.example/', 'https://c.example/'],
      async url => {
        if (url.includes('a.')) throw new Error('getaddrinfo ENOTFOUND a.example');
        if (url.includes('b.')) throw new Error('connect ECONNREFUSED');
        throw new Error('the request timed out');
      }
    );
    expect(rows.map(r => [r.kind, r.severity])).toEqual([
      ['missing-host', 'problem'],
      ['missing-host', 'problem'],
      ['failed', 'note'],
    ]);
  });

  it("marks addresses on the audited page's own site as first party, deduplicates, and respects the budget", async () => {
    const seen = [];
    const out = await run(
      [
        'https://cdn.x.example/a',
        'https://cdn.x.example/a',
        'https://other.example/b',
        'https://x.example/c',
      ],
      async (url, firstParty) => {
        seen.push([url, firstParty]);
        return {status: 200};
      },
      2
    );
    expect(seen).toEqual([
      ['https://cdn.x.example/a', true],
      ['https://other.example/b', false],
    ]);
    expect(out).toMatchObject({checked: 2, notChecked: 1});
    expect((await run(['https://x.example/a'], async () => ({status: 200}), 0)).checked).toBe(0);
  });

  it('survives a non-error throw and a page address that cannot be parsed', async () => {
    const {rows} = await probeStatuses({
      urls: ['https://x.example/a'],
      pageUrl: 'nope',
      max: 3,
      siteOf,
      fetchStatus: async () => Promise.reject(new Error('boom')),
    });
    expect(rows[0]).toMatchObject({kind: 'failed', severity: 'note'});
  });
});
