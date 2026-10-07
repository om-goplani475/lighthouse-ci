/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict';

/* eslint-env jest */

const {
  describeOutcome,
  describeRunStatus,
  hasActiveRun,
  scoreTone,
  formatScore,
  formatDelta,
  formatDuration,
  shortSha,
  shortUrl,
  safeLink,
  hostsToText,
  textToHosts,
  configToForm,
  formToConfig,
  formToNotifications,
  runPagePath,
  seoRequest,
  chartGeometry,
} = require('../../../src/ui/routes/seo/seo-model.js');

describe('labels', () => {
  it('describes outcomes and statuses, and never throws on an unknown one', () => {
    expect(describeOutcome('comment-posted')).toEqual({label: 'Comment posted', tone: 'pass'});
    expect(describeOutcome('rejected').tone).toBe('fail');
    expect(describeOutcome('something-new')).toEqual({label: 'something-new', tone: 'neutral'});
    expect(describeOutcome(undefined).label).toBe('Unknown');
    expect(describeRunStatus({status: 'running'}).tone).toBe('pending');
    expect(describeRunStatus({status: 'failed'}).tone).toBe('fail');
    expect(describeRunStatus(null).label).toBe('Unknown');
  });

  it('knows when to keep refreshing', () => {
    expect(hasActiveRun([{status: 'done'}, {status: 'queued'}])).toBe(true);
    expect(hasActiveRun([{status: 'done'}, {status: 'failed'}])).toBe(false);
    expect(hasActiveRun(undefined)).toBe(false);
  });

  it('formats scores, changes and durations', () => {
    expect(scoreTone(95)).toBe('pass');
    expect(scoreTone(75)).toBe('pending');
    expect(scoreTone(10)).toBe('fail');
    expect(scoreTone(null)).toBe('neutral');
    expect(formatScore(90.04)).toBe('90.0');
    expect(formatScore(null)).toBe('n/a');
    expect(formatDelta(2.5)).toBe('+2.5');
    expect(formatDelta(-1)).toBe('-1.0');
    expect(formatDelta(0)).toBe('±0');
    expect(formatDelta(null)).toBe('');
    expect(formatDuration('2026-10-06T10:00:00Z', '2026-10-06T10:00:42Z')).toBe('42s');
    expect(formatDuration('2026-10-06T10:00:00Z', '2026-10-06T10:02:05Z')).toBe('2m 5s');
    expect(formatDuration(null, 'x')).toBe('');
    expect(formatDuration('2026-10-06T10:00:10Z', '2026-10-06T10:00:00Z')).toBe('');
    expect(formatDuration('nope', 'nada')).toBe('');
  });

  it('shortens shas and urls, and only links http(s) addresses', () => {
    expect(shortSha('ABCDEF1234567')).toBe('abcdef1');
    expect(shortSha('<script>')).toBe('');
    expect(shortUrl('https://pr-1.example.com/blog/post')).toBe('pr-1.example.com/blog/post');
    expect(shortUrl('https://example.com/')).toBe('example.com');
    expect(shortUrl('not a url')).toBe('not a url');
    expect(safeLink('https://example.com/a')).toBe('https://example.com/a');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://x.com',
      'nope',
      null,
      '',
    ]) {
      expect(safeLink(bad)).toBeNull();
    }
    expect(runPagePath('a/b', 'c d')).toBe('/app/seo/a%2Fb/runs/c%20d');
  });
});

describe('settings form', () => {
  it('turns the allowed hosts text into a clean list and back', () => {
    expect(
      textToHosts('A.example.com, b.example.com\n\n  *.Stage.example.org  a.example.com')
    ).toEqual(['a.example.com', 'b.example.com', '*.stage.example.org']);
    expect(textToHosts('')).toEqual([]);
    expect(
      textToHosts(Array.from({length: 80}, (_, i) => `h${i}.example.com`).join('\n'))
    ).toHaveLength(50);
    expect(hostsToText(['a.example.com', 'b.example.com'])).toBe('a.example.com\nb.example.com');
    expect(hostsToText(undefined)).toBe('');
  });

  it('round-trips a config, and sends only the overrides that were chosen', () => {
    const form = configToForm(
      {preset: 'ecommerce', categories: {Images: 'warn'}, audits: {'broken-images': 'off'}},
      'seo:recommended'
    );
    expect(form).toEqual({
      preset: 'ecommerce',
      categories: {Images: 'warn'},
      audits: {'broken-images': 'off'},
    });
    expect(configToForm({}, 'seo:recommended').preset).toBe('seo:recommended');
    expect(configToForm(null, 'seo:recommended').audits).toEqual({});
    form.categories.Images = '';
    form.categories['Page metadata'] = 'bogus';
    form.audits['sitemap-valid'] = 'error';
    expect(formToConfig(form)).toEqual({
      preset: 'ecommerce',
      categories: {},
      audits: {'broken-images': 'off', 'sitemap-valid': 'error'},
    });
  });

  describe('notifications', () => {
    const blank = () => ({
      comment: true,
      includePullRequests: false,
      github: {token: '', apiBase: '', remove: false},
      gitlab: {token: '', apiBase: '', remove: false},
      slack: {webhookUrl: '', remove: false},
      teams: {webhookUrl: '', remove: false},
    });

    it('leaves empty secret fields out, so a stored secret is kept', () => {
      const patch = formToNotifications(blank());
      expect(patch).toEqual({
        comment: true,
        alerts: {includePullRequests: false},
        github: {apiBase: null},
        gitlab: {apiBase: null},
      });
      expect(patch.slack).toBeUndefined();
      expect(JSON.stringify(patch)).not.toContain('token');
    });

    it('sends what was typed, trimmed, and null for a destination marked for removal', () => {
      const form = blank();
      form.github.token = '  ghp_abcdefghij  ';
      form.github.apiBase = ' https://ghe.example.com ';
      form.slack.webhookUrl = ' https://hooks.slack.com/services/x ';
      form.teams.remove = true;
      form.gitlab.remove = true;
      form.includePullRequests = true;
      const patch = formToNotifications(form);
      expect(patch.github).toEqual({token: 'ghp_abcdefghij', apiBase: 'https://ghe.example.com'});
      expect(patch.slack).toEqual({webhookUrl: 'https://hooks.slack.com/services/x'});
      expect(patch.teams).toBeNull();
      expect(patch.gitlab).toBeNull();
      expect(patch.alerts.includePullRequests).toBe(true);
    });
  });
});

describe('seoRequest', () => {
  const answer = (status, body) => async () => ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const run = (fetch, extra = {}) =>
    seoRequest({fetch, projectId: 'p/1', adminToken: 'tok', path: '/runs', ...extra});

  it('does not even send a request without a token', async () => {
    let called = false;
    const res = await seoRequest({
      fetch: async () => (called = true),
      projectId: 'p',
      adminToken: '',
      path: '/x',
    });
    expect(res.state).toBe('no-token');
    expect(called).toBe(false);
  });

  it('sends the token as a header, encodes the project id, and sends JSON bodies', async () => {
    let seen;
    const res = await run(
      async (url, init) => {
        seen = {url, init};
        return answer(202, {runId: 'r'})();
      },
      {method: 'POST', body: {url: 'https://x.test/'}}
    );
    expect(res).toMatchObject({state: 'ok', status: 202, data: {runId: 'r'}});
    expect(seen.url).toBe('/api/v1/seo/projects/p%2F1/runs');
    expect(seen.init.headers).toEqual({
      'x-lhci-admin-token': 'tok',
      'content-type': 'application/json',
    });
    expect(seen.init.body).toBe('{"url":"https://x.test/"}');
  });

  it('sorts failures into states a screen can act on', async () => {
    expect((await run(answer(403, {}))).state).toBe('unauthorized');
    expect((await run(answer(404, {message: 'not set up'}))).message).toBe('not set up');
    const invalid = await run(answer(422, {message: 'invalid settings', problems: ['a', 'b']}));
    expect(invalid).toMatchObject({state: 'invalid', message: 'invalid settings a; b'});
    expect((await run(answer(429, {message: 'slow down'}))).state).toBe('busy');
    expect((await run(answer(503, {}))).state).toBe('busy');
    expect((await run(answer(500, 'not json'))).state).toBe('error');
    expect((await run(answer(204, ''))).state).toBe('ok');
  });

  it('turns a network failure into an error state instead of throwing', async () => {
    const res = await run(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(res).toMatchObject({state: 'error', message: 'Could not reach the server.'});
  });
});

describe('chartGeometry', () => {
  const pt = (runId, score) => ({runId, score, at: '2026-10-01T00:00:00Z'});

  it('puts 100 at the top and 0 at the bottom, oldest on the left', () => {
    const g = chartGeometry([pt('a', 0), pt('b', 100)], {width: 200, height: 100, pad: 10});
    expect(g.dots.map(d => [d.x, d.y])).toEqual([
      [10, 90],
      [190, 10],
    ]);
    expect(g.segments).toEqual(['10,90 190,10']);
    expect(g.ticks.map(t => t.label)).toEqual(['0', '50', '100']);
    expect(g.ticks[0].y).toBe(90);
    expect(g.ticks[2].y).toBe(10);
  });

  it('leaves a gap for a run with no score instead of dropping to zero', () => {
    const g = chartGeometry([pt('a', 80), pt('b', null), pt('c', 90)]);
    expect(g.segments).toHaveLength(2);
    expect(g.dots.map(d => d.runId)).toEqual(['a', 'c']);
  });

  it('centres a single point, copes with no points, and clamps wild scores', () => {
    expect(chartGeometry([pt('a', 50)], {width: 200}).dots[0].x).toBe(100);
    expect(chartGeometry([])).toMatchObject({segments: [], dots: []});
    const g = chartGeometry([pt('a', 500), pt('b', -40)], {width: 200, height: 100, pad: 10});
    expect(g.dots.map(d => d.y)).toEqual([10, 90]);
    expect(chartGeometry([pt('a', NaN)]).dots).toEqual([]);
  });
});
