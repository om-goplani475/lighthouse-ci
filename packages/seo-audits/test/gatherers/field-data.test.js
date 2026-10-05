/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  default: FieldData,
  collectFieldData,
  isPublicHostname,
  KEY_ENV,
} = require('../../src/gatherers/field-data.js');

const KEY = 'AIzaSyFAKEKEY-1234567890';
const env = {[KEY_ENV]: KEY};
const histogram = (/** @type {number[]} */ d) => d.map(density => ({density}));
const record = {
  metrics: {
    largest_contentful_paint: {histogram: histogram([0.7, 0.2, 0.1]), percentiles: {p75: 2300}},
    interaction_to_next_paint: {histogram: histogram([0.8, 0.1, 0.1]), percentiles: {p75: 180}},
    cumulative_layout_shift: {histogram: histogram([0.9, 0.05, 0.05]), percentiles: {p75: '0.04'}},
  },
  collectionPeriod: {
    firstDate: {year: 2026, month: 9, day: 8},
    lastDate: {year: 2026, month: 10, day: 5},
  },
};
const answer =
  (/** @type {any} */ body, status = 200) =>
  async () => ({status, body: JSON.stringify(body)});

describe('collectFieldData', () => {
  it('is off without a key and sends nothing', async () => {
    const post = jest.fn();
    const result = await collectFieldData('https://example.com/a', 'mobile', {env: {}, post});
    expect(result.state).toBe('disabled');
    expect(result.reason).toContain(KEY_ENV);
    expect(post).not.toHaveBeenCalled();
  });

  it('queries the URL (query string and fragment dropped) with the form factor and parses the metrics', async () => {
    const post = jest.fn(answer({record}));
    const result = await collectFieldData('https://example.com/a?token=secret#x', 'desktop', {
      env,
      post,
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.parse(post.mock.calls[0][0].body)).toMatchObject({
      url: 'https://example.com/a',
      formFactor: 'DESKTOP',
    });
    expect(JSON.stringify(post.mock.calls[0][0])).not.toContain('secret');
    expect(result).toMatchObject({
      state: 'ok',
      source: 'url',
      target: 'https://example.com/a',
      formFactor: 'DESKTOP',
      collectionPeriod: {first: '2026-09-08', last: '2026-10-05'},
    });
    expect(result.metrics.lcp).toEqual({p75: 2300, good: 0.7, needsImprovement: 0.2, poor: 0.1});
    expect(result.metrics.cls.p75).toBe(0.04);
    expect(result.metrics.fcp).toBeUndefined();
  });

  it('falls back to the origin when the URL has no data, and says so; uses PHONE for mobile', async () => {
    const post = jest.fn(async (/** @type {any} */ options) =>
      JSON.parse(options.body).url
        ? {status: 404, body: '{}'}
        : {status: 200, body: JSON.stringify({record})}
    );
    const result = await collectFieldData('https://example.com/a', 'mobile', {env, post});
    expect(post).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      state: 'ok',
      source: 'origin',
      target: 'https://example.com',
      formFactor: 'PHONE',
    });
  });

  it('reports no data when neither the URL nor the origin is known', async () => {
    const result = await collectFieldData('https://example.com/a', 'mobile', {
      env,
      post: answer({}, 404),
    });
    expect(result.state).toBe('no-data');
  });

  it('stops at an API error and never includes the key', async () => {
    const post = jest.fn(async () => ({status: 403, body: KEY}));
    const result = await collectFieldData('https://example.com/a', 'mobile', {env, post});
    expect(post).toHaveBeenCalledTimes(1);
    expect(result.state).toBe('error');
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('never sends a non-public address to Google', async () => {
    const post = jest.fn();
    for (const url of [
      'http://localhost:3000/',
      'http://127.0.0.1/',
      'http://[::1]/',
      'https://8.8.8.8/',
      'https://intranet/page',
      'https://app.internal/',
      'https://printer.local/',
      'ftp://example.com/',
    ]) {
      const result = await collectFieldData(url, 'mobile', {env, post});
      expect(result.state).toBe('unavailable');
    }
    expect((await collectFieldData('not a url', 'mobile', {env, post})).state).toBe('unavailable');
    expect(post).not.toHaveBeenCalled();
  });

  it('treats a record with no usable metric as no data', async () => {
    const result = await collectFieldData('https://example.com/a', 'mobile', {
      env,
      post: answer({record: {metrics: {unknown: {}}}}),
    });
    expect(result.state).toBe('no-data');
  });
});

describe('isPublicHostname', () => {
  it('accepts ordinary domains only', () => {
    expect(isPublicHostname('www.example.co.uk')).toBe(true);
    expect(isPublicHostname('EXAMPLE.com')).toBe(true);
    expect(isPublicHostname('localhost')).toBe(false);
    expect(isPublicHostname('')).toBe(false);
    expect(isPublicHostname('site.test')).toBe(false);
  });
});

describe('FieldData gatherer class', () => {
  it('is navigation-only and reads the final URL and the form factor', async () => {
    const gatherer = new FieldData();
    expect(gatherer.meta.supportedModes).toEqual(['navigation']);
    const previous = process.env[KEY_ENV];
    delete process.env[KEY_ENV];
    // @ts-expect-error - partial pass context
    const artifact = await gatherer.getArtifact({
      baseArtifacts: {URL: {finalDisplayedUrl: 'https://example.com/'}},
      settings: {formFactor: 'mobile'},
    });
    if (previous !== undefined) process.env[KEY_ENV] = previous;
    expect(artifact.state).toBe('disabled');
  });
});
