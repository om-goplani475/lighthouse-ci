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
