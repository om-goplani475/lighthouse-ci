/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turns a verified webhook body from GitHub, GitLab or our own generic form into one shape, or says why the event is
 * not one to audit. Pure. Every field that survives is checked and bounded here, because later stages put them in
 * database rows, log lines, comments and URLs.
 *
 * Handled events:
 * - github `pull_request` (opened, reopened, synchronize, ready_for_review) and `deployment_status` (state success)
 * - gitlab `Merge Request Hook` (open, reopen, update with new commits) and `Deployment Hook` (status success)
 * - lhci: `{repo, sha, url, prNumber?, branch?, baseBranch?}`
 * A pull-request event carries no preview address, so its `url` is null and the project's default URL is used.
 */

/**
 * @typedef {{
 *   provider: string, repo: string, sha: string, prNumber: number | null,
 *   branch: string | null, baseBranch: string | null, url: string | null,
 * }} AuditRequest
 */
/** @typedef {{kind: 'audit', request: AuditRequest} | {kind: 'ignore', reason: string} | {kind: 'invalid', reason: string}} Outcome */

const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}(\/[A-Za-z0-9_.-]{1,100}){1,9}$/;
const SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
const GITHUB_PR_ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review']);

/**
 * @param {unknown} value
 * @return {Record<string, any>}
 */
function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {any} */ (value)
    : {};
}

/**
 * @param {unknown} value
 * @return {string | null} A branch name, or null when absent; undefined-like junk becomes null, unsafe names throw.
 */
function branchOf(value) {
  if (value === undefined || value === null || value === '') return null;
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('branch is not a valid branch name');
  }
  return value;
}

/**
 * @param {unknown} value
 * @return {number | null}
 */
function prOf(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('pull request number must be a positive integer');
  }
  return value;
}

/**
 * @param {unknown} value
 * @return {string | null}
 */
function urlOf(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw new Error('url is not valid');
  return value;
}

/**
 * @param {string} provider
 * @param {{repo: unknown, sha: unknown, prNumber?: unknown, branch?: unknown, baseBranch?: unknown, url?: unknown}} f
 * @return {Outcome}
 */
function build(provider, f) {
  try {
    if (
      typeof f.repo !== 'string' ||
      !REPO_PATTERN.test(f.repo) ||
      f.repo.split('/').some(p => /^\.+$/.test(p))
    ) {
      throw new Error('repository name is not valid');
    }
    if (typeof f.sha !== 'string' || !SHA_PATTERN.test(f.sha)) {
      throw new Error('commit sha is not valid');
    }
    return {
      kind: 'audit',
      request: {
        provider,
        repo: f.repo,
        sha: f.sha.toLowerCase(),
        prNumber: prOf(f.prNumber),
        branch: branchOf(f.branch),
        baseBranch: branchOf(f.baseBranch),
        url: urlOf(f.url),
      },
    };
  } catch (err) {
    return {kind: 'invalid', reason: /** @type {Error} */ (err).message};
  }
}

/**
 * @param {string} event the `X-GitHub-Event` header
 * @param {unknown} body
 * @return {Outcome}
 */
function fromGithub(event, body) {
  const b = obj(body);
  if (event === 'ping') return {kind: 'ignore', reason: 'ping'};
  const repo = obj(b.repository).full_name;
  if (event === 'pull_request') {
    if (!GITHUB_PR_ACTIONS.has(b.action)) {
      return {kind: 'ignore', reason: `pull_request action "${b.action}"`};
    }
    const pr = obj(b.pull_request);
    if (pr.draft === true && b.action !== 'ready_for_review') {
      return {kind: 'ignore', reason: 'draft pull request'};
    }
    return build('github', {
      repo,
      sha: obj(pr.head).sha,
      prNumber: b.number,
      branch: obj(pr.head).ref,
      baseBranch: obj(pr.base).ref,
    });
  }
  if (event === 'deployment_status') {
    const status = obj(b.deployment_status);
    if (status.state !== 'success') {
      return {kind: 'ignore', reason: `deployment state "${status.state}"`};
    }
    const deployment = obj(b.deployment);
    return build('github', {
      repo,
      sha: deployment.sha,
      branch: deployment.ref,
      url: status.environment_url || status.target_url,
    });
  }
  return {kind: 'ignore', reason: `event "${event}" is not audited`};
}

/**
 * @param {string} event the `X-Gitlab-Event` header
 * @param {unknown} body
 * @return {Outcome}
 */
function fromGitlab(event, body) {
  const b = obj(body);
  const repo = obj(b.project).path_with_namespace;
  if (event === 'Merge Request Hook') {
    const attrs = obj(b.object_attributes);
    const opened = attrs.action === 'open' || attrs.action === 'reopen';
    // `update` fires for title edits too; only an update that brings a new commit is worth an audit.
    const newCommit =
      attrs.action === 'update' && obj(obj(b.changes).last_commit).current !== undefined;
    if (!opened && !newCommit) {
      return {kind: 'ignore', reason: `merge request action "${attrs.action}"`};
    }
    if (attrs.work_in_progress === true || attrs.draft === true) {
      return {kind: 'ignore', reason: 'draft merge request'};
    }
    return build('gitlab', {
      repo,
      sha: obj(attrs.last_commit).id,
      prNumber: attrs.iid,
      branch: attrs.source_branch,
      baseBranch: attrs.target_branch,
    });
  }
  if (event === 'Deployment Hook') {
    if (b.status !== 'success') return {kind: 'ignore', reason: `deployment status "${b.status}"`};
    return build('gitlab', {repo, sha: b.sha, branch: b.ref, url: b.environment_external_url});
  }
  return {kind: 'ignore', reason: `event "${event}" is not audited`};
}

/**
 * @param {unknown} body
 * @return {Outcome}
 */
function fromLhci(body) {
  const b = obj(body);
  return build('lhci', {
    repo: b.repo,
    sha: b.sha,
    prNumber: b.prNumber,
    branch: b.branch,
    baseBranch: b.baseBranch,
    url: b.url,
  });
}

/**
 * @param {{provider: string, event?: string, body: unknown}} input `event` is the provider's event header.
 * @return {Outcome}
 */
function normalizeWebhook({provider, event = '', body}) {
  if (provider === 'github') return fromGithub(event, body);
  if (provider === 'gitlab') return fromGitlab(event, body);
  if (provider === 'lhci') return fromLhci(body);
  return {kind: 'invalid', reason: `unknown provider "${provider}"`};
}

export {normalizeWebhook};
