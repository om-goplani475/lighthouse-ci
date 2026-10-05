/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {buildAiCrawlerProduct, AI_CRAWLERS} = require('../../src/lib/ai-crawlers.js');

const PAGE = 'https://example.com/article';
const robots = (/** @type {string} */ content, status = 200) => ({status, content});
const run = (/** @type {any} */ r) => buildAiCrawlerProduct(r, PAGE);
const row = (/** @type {any} */ p, /** @type {string} */ name) =>
  p.details.items.find((/** @type {any} */ i) => i.crawler === name);

describe('buildAiCrawlerProduct (informational)', () => {
  it('reports every crawler as allowed with no robots.txt', () => {
    const p = run(robots('', 404));
    expect(p.score).toBe(1);
    expect(p.displayValue).toBe(`All ${AI_CRAWLERS.length} AI crawlers are allowed on this page`);
    expect(row(p, 'GPTBot')).toMatchObject({page: 'Allowed', rule: 'no robots.txt'});
  });

  it('reports blocked crawlers by their own rule and never fails', () => {
    const p = run(
      robots(
        'User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /article\n\nUser-agent: *\nAllow: /\n'
      )
    );
    expect(p.score).toBe(1);
    expect(row(p, 'GPTBot')).toMatchObject({page: 'Blocked', rule: 'its own rule'});
    expect(row(p, 'ClaudeBot')).toMatchObject({page: 'Blocked'});
    expect(row(p, 'PerplexityBot')).toMatchObject({page: 'Allowed', rule: 'the * rule'});
    expect(p.displayValue).toBe(
      `${AI_CRAWLERS.length - 2} of ${
        AI_CRAWLERS.length
      } AI crawlers are allowed on this page (2 blocked)`
    );
  });

  it('applies a wildcard block to every crawler without its own rule', () => {
    const p = run(robots('User-agent: *\nDisallow: /\n\nUser-agent: Google-Extended\nAllow: /\n'));
    expect(row(p, 'GPTBot')).toMatchObject({page: 'Blocked', rule: 'the * rule'});
    expect(row(p, 'Google-Extended')).toMatchObject({page: 'Allowed', rule: 'its own rule'});
  });

  it('is case-insensitive about the crawler names', () => {
    expect(row(run(robots('User-agent: gptbot\nDisallow: /\n')), 'GPTBot').page).toBe('Blocked');
  });

  it('ends with a note that blocking is legitimate', () => {
    const items = run(robots('')).details.items;
    expect(items[items.length - 1].purpose).toMatch(/legitimate choice/);
  });

  it('is not applicable when robots.txt is missing from the data or unreadable', () => {
    expect(run(null).notApplicable).toBe(true);
    expect(run(robots('', 503)).notApplicable).toBe(true);
    expect(run({status: null, content: null}).notApplicable).toBe(true);
    // @ts-expect-error - deliberately wrong input
    expect(buildAiCrawlerProduct(robots(''), undefined).notApplicable).toBe(true);
  });

  it('lists each crawler once, under unique names', () => {
    const names = AI_CRAWLERS.map(c => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
