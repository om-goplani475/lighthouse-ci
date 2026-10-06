/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {normalizeWebhook} = require('../../src/service/webhook-payload.js');

const SHA = 'a'.repeat(40);

const ghPr = (overrides = {}, action = 'opened') => ({
  action,
  number: 7,
  repository: {full_name: 'acme/site'},
  pull_request: {
    draft: false,
    head: {sha: SHA.toUpperCase(), ref: 'feat/x'},
    base: {ref: 'main'},
    ...overrides,
  },
});

describe('normalizeWebhook: github', () => {
  const run = (event, body) => normalizeWebhook({provider: 'github', event, body});

  it('maps a pull_request to an audit request (sha lower-cased, no url)', () => {
    expect(run('pull_request', ghPr())).toEqual({
      kind: 'audit',
      request: {
        provider: 'github',
        repo: 'acme/site',
        sha: SHA,
        prNumber: 7,
        branch: 'feat/x',
        baseBranch: 'main',
        url: null,
      },
    });
  });

  it('audits opened, reopened, synchronize and ready_for_review, and ignores the rest', () => {
    for (const a of ['opened', 'reopened', 'synchronize', 'ready_for_review']) {
      expect(run('pull_request', ghPr({}, a)).kind).toBe('audit');
    }
    for (const a of ['closed', 'labeled', 'edited']) {
      expect(run('pull_request', ghPr({}, a)).kind).toBe('ignore');
    }
  });

  it('ignores a draft pull request until it is ready for review', () => {
    expect(run('pull_request', ghPr({draft: true}, 'synchronize')).kind).toBe('ignore');
    expect(run('pull_request', ghPr({draft: true}, 'ready_for_review')).kind).toBe('audit');
  });

  it('maps a successful deployment_status to an audit of the deployed url', () => {
    const body = {
      repository: {full_name: 'acme/site'},
      deployment: {sha: SHA, ref: 'feat/x'},
      deployment_status: {state: 'success', environment_url: 'https://pr-7.stage.example.org/'},
    };
    const out = run('deployment_status', body);
    expect(out.kind).toBe('audit');
    expect(out.request.url).toBe('https://pr-7.stage.example.org/');
    expect(out.request.prNumber).toBeNull();
    expect(run('deployment_status', {...body, deployment_status: {state: 'pending'}}).kind).toBe(
      'ignore'
    );
  });

  it('answers ping and unknown events with "ignore", never an error', () => {
    expect(run('ping', {zen: 'x'}).kind).toBe('ignore');
    expect(run('push', {}).kind).toBe('ignore');
  });
});

describe('normalizeWebhook: gitlab', () => {
  const run = (event, body) => normalizeWebhook({provider: 'gitlab', event, body});
  const mr = (action, extra = {}, changes) => ({
    project: {path_with_namespace: 'acme/group/site'},
    object_attributes: {
      action,
      iid: 3,
      source_branch: 'feat',
      target_branch: 'main',
      last_commit: {id: SHA},
      ...extra,
    },
    changes,
  });

  it('maps an opened merge request, with nested group paths', () => {
    const out = run('Merge Request Hook', mr('open'));
    expect(out.kind).toBe('audit');
    expect(out.request).toMatchObject({repo: 'acme/group/site', prNumber: 3, baseBranch: 'main'});
  });

  it('audits an update only when it brings a new commit', () => {
    expect(run('Merge Request Hook', mr('update')).kind).toBe('ignore');
    expect(run('Merge Request Hook', mr('update', {}, {last_commit: {current: {}}})).kind).toBe(
      'audit'
    );
    expect(run('Merge Request Hook', mr('merge')).kind).toBe('ignore');
    expect(run('Merge Request Hook', mr('open', {draft: true})).kind).toBe('ignore');
  });

  it('maps a successful deployment', () => {
    const body = {
      project: {path_with_namespace: 'acme/site'},
      status: 'success',
      sha: SHA,
      ref: 'main',
      environment_external_url: 'https://www.example.com/',
    };
    expect(run('Deployment Hook', body).request.url).toBe('https://www.example.com/');
    expect(run('Deployment Hook', {...body, status: 'failed'}).kind).toBe('ignore');
  });
});

describe('normalizeWebhook: lhci and validation', () => {
  const run = body => normalizeWebhook({provider: 'lhci', body});
  const good = {
    repo: 'acme/site',
    sha: SHA,
    url: 'https://pr-1.example.com/',
    prNumber: 1,
    branch: 'x',
    baseBranch: 'main',
  };

  it('accepts the generic form', () => {
    expect(run(good)).toMatchObject({
      kind: 'audit',
      request: {url: 'https://pr-1.example.com/', prNumber: 1},
    });
    expect(run({repo: 'acme/site', sha: SHA}).request).toMatchObject({
      prNumber: null,
      branch: null,
      url: null,
    });
  });

  it.each([
    ['repo with a path trick', {...good, repo: '../etc/passwd'}],
    ['repo with a space', {...good, repo: 'acme/my site'}],
    ['repo without owner', {...good, repo: 'site'}],
    ['non-string repo', {...good, repo: {a: 1}}],
    ['short sha', {...good, sha: 'abc'}],
    ['non-hex sha', {...good, sha: 'z'.repeat(40)}],
    ['pr as string', {...good, prNumber: '1'}],
    ['negative pr', {...good, prNumber: -1}],
    ['fractional pr', {...good, prNumber: 1.5}],
    ['branch with newline', {...good, branch: 'a\nb'}],
    ['branch too long', {...good, branch: 'a'.repeat(256)}],
    ['url too long', {...good, url: 'https://x.com/' + 'a'.repeat(2100)}],
    ['url as object', {...good, url: {href: 'x'}}],
  ])('rejects %s', (_, body) => {
    expect(run(body).kind).toBe('invalid');
  });

  it('survives hostile shapes without throwing', () => {
    for (const body of [null, undefined, 5, 'x', [], {repository: 5}]) {
      expect(() =>
        normalizeWebhook({provider: 'github', event: 'pull_request', body})
      ).not.toThrow();
      expect(() =>
        normalizeWebhook({provider: 'gitlab', event: 'Merge Request Hook', body})
      ).not.toThrow();
      expect(run(body).kind).toBe('invalid');
    }
    expect(normalizeWebhook({provider: 'x', body: {}}).kind).toBe('invalid');
  });
});
