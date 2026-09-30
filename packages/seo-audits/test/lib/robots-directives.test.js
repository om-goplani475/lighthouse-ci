/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {parseDirectives, blocksIndexing, noindexFor} = require('../../src/lib/robots-directives.js');

describe('parseDirectives', () => {
  it('parses a simple comma-separated list, case-insensitively, with explanations', () => {
    const directives = parseDirectives('NOINDEX, nofollow');
    expect(directives).toEqual([
      expect.objectContaining({raw: 'NOINDEX', key: 'noindex', explanation: expect.any(String)}),
      expect.objectContaining({raw: 'nofollow', key: 'nofollow', explanation: expect.any(String)}),
    ]);
  });

  it('parses value-bearing directives (max-snippet etc.) and includes the value in the explanation', () => {
    const [directive] = parseDirectives('max-snippet:-1');
    expect(directive.key).toBe('max-snippet');
    expect(directive.value).toBe('-1');
    expect(directive.explanation).toContain('-1');
  });

  it('returns null explanation for an unrecognized token', () => {
    const [directive] = parseDirectives('no-index');
    expect(directive.explanation).toBeNull();
  });

  it('returns an empty array for absent/empty content', () => {
    expect(parseDirectives(undefined)).toEqual([]);
    expect(parseDirectives(null)).toEqual([]);
    expect(parseDirectives('')).toEqual([]);
    expect(parseDirectives('   ')).toEqual([]);
  });
});

describe('blocksIndexing', () => {
  it('is true for noindex', () => {
    expect(blocksIndexing(parseDirectives('noindex'))).toBe(true);
  });

  it('is true for none', () => {
    expect(blocksIndexing(parseDirectives('none'))).toBe(true);
  });

  it('is false for index, follow', () => {
    expect(blocksIndexing(parseDirectives('index, follow'))).toBe(false);
  });

  it('is false for an empty directive list', () => {
    expect(blocksIndexing([])).toBe(false);
  });
});

describe('noindexFor', () => {
  const BOTH = ['googlebot', 'bingbot'];
  const run = (signals, crawlers = BOTH) =>
    noindexFor(crawlers, {metas: [], xRobotsTag: [], ...signals});

  it('reports nothing for a page with no signals or only non-blocking directives', () => {
    expect(run({})).toEqual([]);
    expect(
      run({
        metas: [{name: 'robots', content: 'index, follow, max-snippet: 20'}],
        xRobotsTag: ['nosnippet'],
      })
    ).toEqual([]);
  });

  it('applies a <meta name="robots"> to every crawler', () => {
    expect(run({metas: [{name: 'robots', content: 'noindex, follow'}]})).toEqual([
      {crawler: 'googlebot', via: ['<meta name="robots">']},
      {crawler: 'bingbot', via: ['<meta name="robots">']},
    ]);
  });

  it('applies a crawler-named <meta> only to that crawler', () => {
    expect(run({metas: [{name: 'googlebot', content: 'noindex'}]})).toEqual([
      {crawler: 'googlebot', via: ['<meta name="googlebot">']},
    ]);
    expect(run({metas: [{name: 'bingbot', content: 'none'}]})).toEqual([
      {crawler: 'bingbot', via: ['<meta name="bingbot">']},
    ]);
  });

  it('treats `none` as noindex, case-insensitively', () => {
    expect(run({metas: [{name: 'robots', content: 'NONE'}]})).toHaveLength(2);
    expect(run({xRobotsTag: ['NoIndex']})).toHaveLength(2);
  });

  it('applies an unscoped X-Robots-Tag to every crawler', () => {
    expect(run({xRobotsTag: ['noindex']})).toEqual([
      {crawler: 'googlebot', via: ['X-Robots-Tag header']},
      {crawler: 'bingbot', via: ['X-Robots-Tag header']},
    ]);
  });

  it('applies a scoped X-Robots-Tag only to the named crawler (`googlebot: noindex`)', () => {
    expect(run({xRobotsTag: ['googlebot: noindex']})).toEqual([
      {crawler: 'googlebot', via: ['X-Robots-Tag header']},
    ]);
    expect(run({xRobotsTag: ['BingBot: none, nofollow']})).toEqual([
      {crawler: 'bingbot', via: ['X-Robots-Tag header']},
    ]);
  });

  it('ignores a scope for a crawler that is not being evaluated, or an unrelated one', () => {
    expect(run({xRobotsTag: ['otherbot: noindex']})).toEqual([]);
    expect(run({xRobotsTag: ['googlebot-news: noindex']})).toEqual([]);
    expect(run({xRobotsTag: ['googlebot: noindex']}, ['bingbot'])).toEqual([]);
  });

  it('does not mistake a directive that takes a value for a user-agent scope', () => {
    // `max-snippet: 20` and `unavailable_after: <date>` have the same `word: ...` shape as
    // `googlebot: noindex`; only the known-directive list tells them apart.
    expect(run({xRobotsTag: ['max-snippet: 20']})).toEqual([]);
    expect(run({xRobotsTag: ['unavailable_after: 25 Jun 2010 15:00:00 PST']})).toEqual([]);
    expect(run({xRobotsTag: ['max-snippet: 20, noindex']})).toHaveLength(2);
  });

  it('evaluates each header occurrence on its own', () => {
    const result = run({
      xRobotsTag: ['googlebot: nofollow', 'bingbot: noindex', 'max-image-preview: large'],
    });
    expect(result).toEqual([{crawler: 'bingbot', via: ['X-Robots-Tag header']}]);
  });

  it('reports every source that blocks a crawler once, meta and header together', () => {
    const result = run({
      metas: [
        {name: 'robots', content: 'noindex'},
        {name: 'googlebot', content: 'noindex'},
      ],
      xRobotsTag: ['noindex', 'googlebot: none'],
    });
    expect(result[0]).toEqual({
      crawler: 'googlebot',
      via: ['<meta name="robots">', '<meta name="googlebot">', 'X-Robots-Tag header'],
    });
    expect(result[1]).toEqual({
      crawler: 'bingbot',
      via: ['<meta name="robots">', 'X-Robots-Tag header'],
    });
  });

  it('only recognizes a scope at the start of a value (documented limitation)', () => {
    // Read as an unscoped list: "googlebot: nofollow" is not treated as a scope here, but the
    // leading `noindex` still blocks every crawler.
    expect(run({xRobotsTag: ['noindex, googlebot: nofollow']})).toHaveLength(2);
    expect(run({xRobotsTag: ['nofollow, googlebot: noindex']})).toEqual([]);
  });

  it('does not throw on empty or odd input', () => {
    expect(
      run({metas: [{name: 'robots', content: ''}], xRobotsTag: ['', ':', '::', 'googlebot:']})
    ).toEqual([]);
    expect(noindexFor([], {metas: [], xRobotsTag: []})).toEqual([]);
  });
});
