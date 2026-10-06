/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  validateNotifications,
  mergeNotifications,
  publicNotifications,
  criticalRegressions,
  dispatchRun,
  redact,
} = require('../../src/service/notifier.js');
const {markerFor} = require('../../src/service/pr-comment.js');

const TOKEN = 'ghp_supersecret_token_value';
const HOOK = 'https://hooks.slack.com/services/T000/B000/SECRETPART';

describe('validateNotifications', () => {
  it('accepts a full valid config and an empty one', () => {
    expect(validateNotifications(undefined)).toEqual([]);
    expect(validateNotifications({})).toEqual([]);
    expect(
      validateNotifications({
        github: {token: TOKEN},
        gitlab: {token: 'glpat-abcdefgh', apiBase: 'https://git.example.com'},
        slack: {webhookUrl: HOOK},
        teams: {webhookUrl: 'https://acme.webhook.office.com/webhookb2/abc'},
        alerts: {audits: ['canonical-https'], includePullRequests: true},
        comment: false,
      })
    ).toEqual([]);
    expect(validateNotifications({github: null, slack: null})).toEqual([]);
  });

  it.each([
    [
      'slack on another host',
      {slack: {webhookUrl: 'https://evil.example.com/services/x'}},
      /hooks\.slack\.com/,
    ],
    [
      'slack look-alike host',
      {slack: {webhookUrl: 'https://hooks.slack.com.evil.net/x'}},
      /hooks\.slack\.com/,
    ],
    [
      'slack over http',
      {slack: {webhookUrl: 'http://hooks.slack.com/services/x'}},
      /hooks\.slack\.com/,
    ],
    [
      'slack with credentials',
      {slack: {webhookUrl: 'https://u:p@hooks.slack.com/x'}},
      /hooks\.slack\.com/,
    ],
    ['slack with no url', {slack: {}}, /hooks\.slack\.com/],
    [
      'teams on another host',
      {teams: {webhookUrl: 'https://webhook.office.com.evil.net/x'}},
      /Teams/,
    ],
    ['teams private address', {teams: {webhookUrl: 'https://169.254.169.254/'}}, /Teams/],
    ['github apiBase private ip', {github: {token: TOKEN, apiBase: 'https://10.0.0.1'}}, /apiBase/],
    [
      'github apiBase over http',
      {github: {token: TOKEN, apiBase: 'http://git.example.com'}},
      /apiBase/,
    ],
    ['github apiBase localhost', {github: {token: TOKEN, apiBase: 'https://localhost'}}, /apiBase/],
    [
      'gitlab apiBase with query',
      {gitlab: {token: TOKEN, apiBase: 'https://git.example.com/?x=1'}},
      /apiBase/,
    ],
    ['token with a space', {github: {token: 'abc def ghi jkl'}}, /token/],
    ['token too short', {github: {token: 'abc'}}, /token/],
    ['token with a newline', {github: {token: 'abcdefgh\nX-Evil: 1'}}, /token/],
    ['unknown setting', {webhook: 1}, /unknown setting "webhook"/],
    ['unknown alert audit', {alerts: {audits: ['no-such-audit']}}, /unknown audit/],
    ['wrong type for includePullRequests', {alerts: {includePullRequests: 'yes'}}, /true or false/],
    ['wrong type for comment', {comment: 'no'}, /comment must be/],
  ])('rejects %s', (_, config, pattern) => {
    expect(validateNotifications(config).join('|')).toMatch(pattern);
  });

  it('rejects wrong shapes', () => {
    expect(validateNotifications([])).toEqual(['notifications must be an object']);
    expect(validateNotifications({github: 'x'})).toEqual(['github must be an object']);
  });
});

describe('mergeNotifications and publicNotifications', () => {
  it('keeps a stored token when only another field changes, and null removes', () => {
    const merged = mergeNotifications(
      {github: {token: TOKEN}, slack: {webhookUrl: HOOK}},
      {github: {apiBase: 'https://ghe.example.com'}, slack: null}
    );
    expect(merged).toEqual({github: {token: TOKEN, apiBase: 'https://ghe.example.com'}});
    expect(
      mergeNotifications({github: {token: TOKEN, apiBase: 'x'}}, {github: {apiBase: null}})
    ).toEqual({github: {token: TOKEN}});
    expect(mergeNotifications(undefined, {comment: false})).toEqual({comment: false});
  });

  it('never shows a token or the secret part of a webhook url', () => {
    const shown = JSON.stringify(
      publicNotifications({
        github: {token: TOKEN},
        gitlab: {token: 'glpat-abcdefgh'},
        slack: {webhookUrl: HOOK},
        teams: {webhookUrl: 'https://acme.webhook.office.com/webhookb2/SECRET'},
      })
    );
    for (const secret of [TOKEN, 'glpat-abcdefgh', 'SECRETPART', 'T000', 'SECRET']) {
      expect(shown).not.toContain(secret);
    }
    expect(JSON.parse(shown)).toMatchObject({
      github: {tokenSet: true},
      slack: {webhookHost: 'hooks.slack.com'},
      comment: true,
    });
  });
});

describe('criticalRegressions', () => {
  const error = id => ({id, title: `T ${id}`, tier: 'error', status: 'fail', displayValue: 'bad'});
  const withNew = (newIssues, extra = {}) => ({comparison: {newIssues}, ...extra});

  it('lists new error-tier issues among the critical audits only', () => {
    const out = criticalRegressions(
      withNew([
        error('robots-directives-conflict'),
        error('url-length'),
        {...error('canonical-https'), tier: 'warn'},
      ])
    );
    expect(out).toEqual([
      {id: 'robots-directives-conflict', title: 'T robots-directives-conflict', detail: 'bad'},
    ]);
  });

  it("uses the project's own list of audits", () => {
    expect(criticalRegressions(withNew([error('url-length')]), ['url-length'])).toHaveLength(1);
  });

  it('says nothing without a baseline (nothing is "new" on a first audit)', () => {
    expect(criticalRegressions({comparison: null})).toEqual([]);
    expect(criticalRegressions(null)).toEqual([]);
  });

  it('catches a page that stopped being crawlable, and ignores one that was already not', () => {
    const signal = score => ({
      'is-crawlable': {score, title: 'Page is blocked from indexing', displayValue: ''},
    });
    expect(
      criticalRegressions(withNew([], {signals: signal(0), baselineSignals: signal(1)}))
    ).toEqual([{id: 'is-crawlable', title: 'Page is blocked from indexing', detail: undefined}]);
    expect(
      criticalRegressions(withNew([], {signals: signal(0), baselineSignals: signal(0)}))
    ).toEqual([]);
    expect(criticalRegressions(withNew([], {signals: signal(0), baselineSignals: null}))).toEqual(
      []
    );
  });
});

/** A fake `send` that answers from a script and records every request. */
function fakeSend(responses) {
  const calls = [];
  const queue = [...responses];
  const send = async request => {
    calls.push(request);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return {status: 200, headers: {}, json: null, text: '', ...(next || {})};
  };
  return {send, calls};
}

const run = {
  provider: 'github',
  repo: 'acme/site',
  prNumber: 7,
  url: 'https://pr-7.example.com/',
  sha: 'abcdef1234',
  branch: 'feat',
  baseBranch: 'main',
};
const result = {
  url: run.url,
  summary: {overall: {score: 80, grade: 'B'}, categories: [], audits: []},
  comparison: null,
  baselineNote: 'none',
};
const noSleep = async () => {};
const base = {projectId: 'p1', result, sleep: noSleep};

describe('dispatchRun: pull request comment', () => {
  const github = {github: {token: TOKEN}};

  it('posts a new comment when none carries the marker', async () => {
    const {send, calls} = fakeSend([{json: [{id: 1, body: 'someone else'}]}, {status: 201}]);
    const actions = await dispatchRun({...base, run, notifications: github, send});
    expect(actions).toEqual([
      {kind: 'comment', target: 'github', ok: true, detail: 'comment posted'},
    ]);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      url: 'https://api.github.com/repos/acme/site/issues/7/comments?per_page=100&page=1',
    });
    expect(calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[1]).toMatchObject({
      method: 'POST',
      url: 'https://api.github.com/repos/acme/site/issues/7/comments',
    });
    expect(calls[1].body.body.startsWith(markerFor('p1'))).toBe(true);
  });

  it('edits the marked comment in place', async () => {
    const {send, calls} = fakeSend([
      {json: [{id: 5, body: `${markerFor('p1')}\nold`}]},
      {status: 200},
    ]);
    const actions = await dispatchRun({...base, run, notifications: github, send});
    expect(actions[0]).toMatchObject({ok: true, detail: 'comment updated'});
    expect(calls[1]).toMatchObject({
      method: 'PATCH',
      url: 'https://api.github.com/repos/acme/site/issues/comments/5',
    });
    expect(calls).toHaveLength(2);
  });

  it("ignores another project's marker, and posts its own when the marked comment cannot be edited", async () => {
    let {send, calls} = fakeSend([{json: [{id: 5, body: markerFor('other')}]}, {status: 201}]);
    await dispatchRun({...base, run, notifications: github, send});
    expect(calls[1].method).toBe('POST');

    ({send, calls} = fakeSend([
      {json: [{id: 5, body: markerFor('p1')}]},
      {status: 403},
      {status: 201},
    ]));
    const actions = await dispatchRun({...base, run, notifications: github, send});
    expect(actions[0]).toMatchObject({ok: true, detail: 'comment posted'});
    expect(calls.map(c => c.method)).toEqual(['GET', 'PATCH', 'POST']);
  });

  it('pages through the comments, at most five pages', async () => {
    const full = Array.from({length: 100}, (_, i) => ({id: i, body: 'x'}));
    const {send, calls} = fakeSend([
      {json: full},
      {json: full},
      {json: full},
      {json: full},
      {json: full},
      {status: 201},
    ]);
    await dispatchRun({...base, run, notifications: github, send});
    expect(calls.filter(c => c.method === 'GET')).toHaveLength(5);
    expect(calls[5].method).toBe('POST');
  });

  it('retries once after a 500 and then succeeds', async () => {
    const {send, calls} = fakeSend([{status: 500}, {json: []}, {status: 201}]);
    const actions = await dispatchRun({...base, run, notifications: github, send});
    expect(actions[0].ok).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('reports a refused token without ever echoing it', async () => {
    const {send} = fakeSend([{status: 401, text: `bad credentials ${TOKEN}`}]);
    const actions = await dispatchRun({...base, run, notifications: github, send});
    expect(actions[0].ok).toBe(false);
    expect(actions[0].detail).toMatch(/GitHub answered 401/);
    expect(JSON.stringify(actions)).not.toContain(TOKEN);
  });

  it('redacts a secret that an error message happens to contain', async () => {
    const {send} = fakeSend([
      new Error(`connect failed for ${TOKEN}`),
      new Error(`connect failed for ${TOKEN}`),
    ]);
    const actions = await dispatchRun({...base, run, notifications: github, send});
    expect(actions[0]).toMatchObject({ok: false});
    expect(actions[0].detail).toContain('[redacted]');
    expect(actions[0].detail).not.toContain(TOKEN);
  });

  it("uses GitLab's API: private-token header, PUT to edit, encoded project path", async () => {
    const {send, calls} = fakeSend([
      {json: [{id: 9, body: markerFor('p1'), system: false}]},
      {status: 200},
    ]);
    const actions = await dispatchRun({
      ...base,
      run: {...run, provider: 'gitlab', repo: 'group/sub/site'},
      notifications: {gitlab: {token: 'glpat-abcdefgh', apiBase: 'https://git.example.com/'}},
      send,
    });
    expect(actions[0]).toMatchObject({target: 'gitlab', ok: true, detail: 'comment updated'});
    expect(calls[0].url).toBe(
      'https://git.example.com/api/v4/projects/group%2Fsub%2Fsite/merge_requests/7/notes?per_page=100&page=1'
    );
    expect(calls[0].headers['private-token']).toBe('glpat-abcdefgh');
    expect(calls[1]).toMatchObject({
      method: 'PUT',
      url: 'https://git.example.com/api/v4/projects/group%2Fsub%2Fsite/merge_requests/7/notes/9',
    });
  });

  it('does nothing when there is no pull request, comments are off, or the provider has no token', async () => {
    for (const [r, n] of [
      [{...run, prNumber: null}, github],
      [run, {...github, comment: false}],
      [run, {gitlab: {token: 'glpat-abcdefgh'}}],
      [{...run, provider: 'lhci'}, github],
    ]) {
      const {send, calls} = fakeSend([]);
      expect(await dispatchRun({...base, run: r, notifications: n, send})).toEqual([]);
      expect(calls).toHaveLength(0);
    }
  });
});

describe('dispatchRun: alerts', () => {
  const regressed = {
    ...result,
    comparison: {
      newIssues: [
        {
          id: 'canonical-https',
          title: 'Canonical',
          tier: 'error',
          status: 'fail',
          displayValue: 'x',
        },
      ],
    },
  };
  const deploy = {...run, prNumber: null, branch: 'main'};
  const slack = {slack: {webhookUrl: HOOK}};

  it('posts to Slack for a new critical regression on a deployment', async () => {
    const {send, calls} = fakeSend([{status: 200}]);
    const actions = await dispatchRun({
      ...base,
      run: deploy,
      result: regressed,
      notifications: slack,
      send,
    });
    expect(actions).toEqual([{kind: 'alert', target: 'slack', ok: true, detail: 'alert sent (1)'}]);
    expect(calls[0].url).toBe(HOOK);
    expect(calls[0].body.text).toContain('SEO regression');
  });

  it('stays quiet for a pull request unless asked, for no baseline, and for no regression', async () => {
    const quiet = async (r, res, n) => {
      const {send, calls} = fakeSend([{status: 200}]);
      const actions = await dispatchRun({...base, run: r, result: res, notifications: n, send});
      return {actions, calls};
    };
    expect((await quiet(run, regressed, slack)).calls).toHaveLength(0);
    expect(
      (await quiet(run, regressed, {...slack, alerts: {includePullRequests: true}})).calls
    ).toHaveLength(1);
    expect((await quiet(deploy, result, slack)).calls).toHaveLength(0);
    expect(
      (await quiet(deploy, {...result, comparison: {newIssues: []}}, slack)).calls
    ).toHaveLength(0);
  });

  it('sends to both Slack and Teams, picks the card format by host, and one failing does not stop the other', async () => {
    const {send, calls} = fakeSend([{status: 500}, {status: 500}, {status: 202}]);
    const actions = await dispatchRun({
      ...base,
      run: deploy,
      result: regressed,
      notifications: {
        ...slack,
        teams: {webhookUrl: 'https://acme.webhook.office.com/webhookb2/SECRET'},
      },
      send,
    });
    expect(actions.map(a => [a.target, a.ok])).toEqual([
      ['slack', false],
      ['teams', true],
    ]);
    expect(calls[2].body['@type']).toBe('MessageCard');

    const workflows = fakeSend([{status: 202}]);
    await dispatchRun({
      ...base,
      run: deploy,
      result: regressed,
      notifications: {teams: {webhookUrl: 'https://prod-1.westus.logic.azure.com/workflows/abc'}},
      send: workflows.send,
    });
    expect(workflows.calls[0].body.type).toBe('message');
  });

  it('never puts the webhook url in a result', async () => {
    const {send} = fakeSend([
      new Error(`failed to reach ${HOOK}`),
      new Error(`failed to reach ${HOOK}`),
    ]);
    const actions = await dispatchRun({
      ...base,
      run: deploy,
      result: regressed,
      notifications: slack,
      send,
    });
    expect(JSON.stringify(actions)).not.toContain('SECRETPART');
  });

  it("honours the project's own list of alert audits", async () => {
    const {send, calls} = fakeSend([{status: 200}]);
    await dispatchRun({
      ...base,
      run: deploy,
      result: regressed,
      notifications: {...slack, alerts: {audits: ['url-length']}},
      send,
    });
    expect(calls).toHaveLength(0);
  });
});

describe('redact', () => {
  it('removes secrets, ignores very short ones, and clips', () => {
    expect(redact('a SECRETVALUE b SECRETVALUE', ['SECRETVALUE'])).toBe(
      'a [redacted] b [redacted]'
    );
    expect(redact('abc', ['a'])).toBe('abc');
    expect(redact('x'.repeat(500), []).length).toBe(300);
  });
});
