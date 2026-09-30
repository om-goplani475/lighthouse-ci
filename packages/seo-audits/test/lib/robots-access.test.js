/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {simulateCrawlerAccess, buildAccessResult} = require('../../src/lib/robots-access.js');

const PAGE = 'https://example.com/products/shoe';

/**
 * @param {string} content
 * @param {Array<{url: string, type: string}>} [resources]
 * @param {string} [page]
 */
const run = (content, resources = [], page = PAGE) =>
  simulateCrawlerAccess({status: 200, content}, page, resources);

const row = (sim, name) => sim.rows.find(r => r.crawler === name);

describe('simulateCrawlerAccess', () => {
  it('passes with a permissive robots.txt', () => {
    const sim = run('User-agent: *\nDisallow:');
    expect(sim.failures).toEqual([]);
    expect(sim.rows).toHaveLength(7);
    expect(sim.rows.every(r => r.page === 'Allowed')).toBe(true);
  });

  it('fails when a search engine is blocked from the page', () => {
    const sim = run('User-agent: Googlebot\nDisallow: /products/');
    expect(sim.failures).toEqual(['Googlebot is blocked from this page']);
    expect(row(sim, 'Googlebot').page).toBe('Blocked');
    expect(row(sim, 'Bingbot').page).toBe('Allowed');
  });

  it('never fails for a blocked AI crawler, but reports it', () => {
    const sim = run('User-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /');
    expect(sim.failures).toEqual([]);
    expect(row(sim, 'GPTBot').page).toBe('Blocked');
    expect(row(sim, 'ClaudeBot').page).toBe('Blocked');
    expect(row(sim, 'CCBot').page).toBe('Allowed');
  });

  it('flags blocked same-origin CSS/JS and lists them', () => {
    const sim = run('User-agent: *\nDisallow: /assets/', [
      {url: 'https://example.com/assets/app.js', type: 'Script'},
      {url: 'https://example.com/assets/site.css', type: 'Stylesheet'},
      {url: 'https://example.com/other.js', type: 'Script'},
    ]);
    expect(sim.failures).toContain('Googlebot is blocked from 2 CSS/JS file(s)');
    expect(row(sim, 'Googlebot').assets).toContain('https://example.com/assets/app.js');
    expect(row(sim, 'Googlebot').page).toBe('Allowed');
  });

  it('ignores cross-origin resources, images and other non-rendering types', () => {
    const sim = run('User-agent: *\nDisallow: /assets/', [
      {url: 'https://cdn.other.com/assets/app.js', type: 'Script'},
      {url: 'https://example.com/assets/hero.png', type: 'Image'},
      {url: 'data:text/css,body{}', type: 'Stylesheet'},
    ]);
    expect(sim.failures).toEqual([]);
    expect(row(sim, 'Googlebot').assets).toBe('None blocked');
  });

  it('applies the most specific group over *', () => {
    const sim = run('User-agent: *\nDisallow: /\nUser-agent: Googlebot\nAllow: /');
    expect(row(sim, 'Googlebot').page).toBe('Allowed');
    expect(row(sim, 'Bingbot').page).toBe('Blocked');
  });

  it('makes Googlebot-Image follow the googlebot group when it has none of its own', () => {
    const sim = run('User-agent: *\nDisallow:\nUser-agent: Googlebot\nDisallow: /products/');
    expect(row(sim, 'Googlebot-Image').page).toBe('Blocked');
  });

  it('prefers an explicit googlebot-image group over the googlebot fallback', () => {
    const sim = run(
      'User-agent: Googlebot\nDisallow: /products/\nUser-agent: Googlebot-Image\nAllow: /'
    );
    expect(row(sim, 'Googlebot-Image').page).toBe('Allowed');
  });

  it('never scores Googlebot-Image', () => {
    expect(run('User-agent: Googlebot-Image\nDisallow: /').failures).toEqual([]);
  });

  it('lists at most three blocked URLs but reports the full count', () => {
    const resources = [1, 2, 3, 4, 5].map(n => ({
      url: `https://example.com/a/${n}.js`,
      type: 'Script',
    }));
    const assets = row(run('User-agent: *\nDisallow: /a/', resources), 'Googlebot').assets;
    expect(assets.startsWith('5 blocked:')).toBe(true);
    expect(assets.split(', ')).toHaveLength(3);
  });
});

describe('buildAccessResult', () => {
  it('scores 0 with an explanation when there are failures, else 1, always with a table', () => {
    const bad = buildAccessResult(run('User-agent: *\nDisallow: /'));
    expect(bad.score).toBe(0);
    expect(bad.explanation).toContain('Googlebot is blocked from this page');
    expect(bad.details.items).toHaveLength(7);

    const good = buildAccessResult(run('User-agent: *\nDisallow:'));
    expect(good.score).toBe(1);
    expect(good.details.items).toHaveLength(7);
  });
});
