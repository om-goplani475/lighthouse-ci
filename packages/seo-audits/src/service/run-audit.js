/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Runs one audit for the webhook service: re-checks the address, starts the guard proxy, runs `lhci collect` in a child
 * process that only sees a short list of environment variables, scores the report with the project's own severities, and
 * compares it with the baseline run. Everything that touches the outside world is passed in, so tests run it without
 * Chrome or the network.
 *
 * Safety, in the order it applies:
 * 1. the URL is checked against the project's allow-list again (the list may have changed since queueing);
 * 2. its host must resolve to public addresses only (a clear early failure; the proxy enforces it again for Chrome);
 * 3. Chrome is forced through the guard proxy (`guard-proxy.js`), so redirects and subresources are checked too;
 * 4. the child gets no secrets: its environment is built from an allow-list, never copied from the server's, and
 *    `LHCI_SEO_ALLOW_PRIVATE_NETWORK` can never reach it;
 * 5. each run has its own temp folder and its own crawl cache (a shared cache would show an earlier push's pages);
 * 6. the child and Chrome are killed when the run is aborted or times out.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {spawn} from 'child_process';
import {checkAuditUrl} from './host-allow-list.js';
import {createGuardProxy, assertPublicHost} from './guard-proxy.js';
import {resolveAssertions} from './project-config.js';
import {summarizeRun} from '../summary/run-summary.js';
import {compareRuns} from '../summary/compare.js';
import {reviveSerpPreview, compareSerpPreviews} from '../lib/serp-preview.js';
import {reviveTemplates} from '../lib/templates.js';
import {loadLhrs} from '../summary/load.js';
import {serializeRun, reviveRun} from './run-result.js';
import {SIGNAL_IDS} from './notifier.js';

const PASS_THROUGH = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'TZ',
  'CHROME_PATH',
  'SYSTEMROOT',
  'WINDIR',
];
// Settings that must never reach the child, even though they start with the allowed prefix.
const NEVER_PASS = new Set(['LHCI_SEO_ALLOW_PRIVATE_NETWORK']);
const DEFAULT_LIMITS = {
  LHCI_SEO_CRAWL_MAX_PAGES: '30',
  LHCI_SEO_CRAWL_TIME_BUDGET_SECONDS: '60',
};
const FORBIDDEN_FLAG = /^--(proxy-server|proxy-bypass-list|proxy-pac-url|host-resolver-rules)\b/;
// Chrome flags are joined into one string that Lighthouse splits on spaces again, so a flag must be one plain token.
const WELL_FORMED_FLAG = /^--[a-z0-9-]+(=\S*)?$/i;
const STDERR_TAIL = 2000;

/**
 * @param {Record<string, string | undefined>} env The server's environment.
 * @param {{cacheDir: string}} extra
 * @return {Record<string, string>} The environment for the audit child.
 */
function buildChildEnv(env, {cacheDir}) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of PASS_THROUGH) {
    if (env[name] !== undefined) out[name] = /** @type {string} */ (env[name]);
  }
  for (const [name, value] of Object.entries(env)) {
    if (
      name.startsWith('LHCI_SEO_') &&
      !NEVER_PASS.has(name) &&
      !name.startsWith('LHCI_SEO_SERVICE')
    ) {
      if (value !== undefined) out[name] = value;
    }
  }
  for (const [name, value] of Object.entries(DEFAULT_LIMITS)) if (!(name in out)) out[name] = value;
  out.LHCI_SEO_CRAWL_CACHE_DIR = cacheDir;
  return out;
}

/**
 * @param {string | undefined} extra Operator-supplied Chrome flags (for example `--no-sandbox` inside a container).
 * @return {string[]} The flags minus any that could undo the guard.
 */
function sanitizeExtraFlags(extra) {
  return String(extra || '')
    .split(/\s+/)
    .filter(flag => WELL_FORMED_FLAG.test(flag) && !FORBIDDEN_FLAG.test(flag));
}

/**
 * @param {string} proxyUrl
 * @param {string | undefined} extra
 * @return {string} The value of `--settings.chromeFlags`. The guard flags come last, so nothing earlier can override them.
 */
function chromeFlagsFor(proxyUrl, extra) {
  return [
    ...sanitizeExtraFlags(extra),
    `--proxy-server=${proxyUrl}`,
    '--proxy-bypass-list=<-loopback>',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--no-pings',
  ].join(' ');
}

/**
 * The real collect step: `lhci collect` as a child process, killed with its whole process group on abort.
 * @param {{
 *   lhciCli: string, lighthouseConfig: string, url: string, cwd: string, env: Record<string, string>,
 *   chromeFlags: string, signal: AbortSignal,
 * }} job
 * @return {Promise<void>}
 */
function spawnCollect({lhciCli, lighthouseConfig, url, cwd, env, chromeFlags, signal}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        lhciCli,
        'collect',
        `--url=${url}`,
        '--numberOfRuns=1',
        `--settings.configPath=${lighthouseConfig}`,
        `--settings.chromeFlags=${chromeFlags}`,
      ],
      {cwd, env, detached: true, stdio: ['ignore', 'ignore', 'pipe']}
    );
    let tail = '';
    if (child.stderr) {
      child.stderr.on('data', chunk => {
        tail = (tail + chunk.toString()).slice(-STDERR_TAIL);
      });
    }
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch (_) {
        child.kill('SIGKILL');
      }
    };
    signal.addEventListener('abort', kill, {once: true});
    child.on('error', reject);
    child.on('exit', code => {
      signal.removeEventListener('abort', kill);
      // Kill what the run left behind (a Chrome that outlived lighthouse).
      kill();
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `lhci collect failed (exit ${code}): ${tail.trim().split('\n').slice(-3).join(' | ')}`
          )
        );
      }
    });
  });
}

/**
 * @param {any} lhr
 * @return {import('../lib/serp-preview.js').SerpPreview | null} The search snippet model the `pixel-width-truncation` audit
 *   put in its details, or null when the page has neither a title nor a description (or the shape is not the expected one).
 */
function serpOf(lhr) {
  const a = lhr && lhr.audits && lhr.audits['pixel-width-truncation'];
  return reviveSerpPreview(a && a.details && a.details.serpPreview);
}

/**
 * @param {any} lhr
 * @return {import('../lib/templates.js').Template[]} The template groups the `template-groups-report` audit found (empty
 *   when the crawl saw none, or the shape is not the expected one).
 */
function templatesOf(lhr) {
  const a = lhr && lhr.audits && lhr.audits['template-groups-report'];
  return reviveTemplates(a && a.details && a.details.templates);
}

/**
 * @param {any} lhr
 * @return {Record<string, {score: number | null, title: string, displayValue: string}>}
 */
function signalsOf(lhr) {
  /** @type {Record<string, {score: number | null, title: string, displayValue: string}>} */
  const out = {};
  for (const id of SIGNAL_IDS) {
    const a = lhr.audits && lhr.audits[id];
    if (a) {
      out[id] = {
        score: typeof a.score === 'number' ? a.score : null,
        title: String(a.title || id).slice(0, 200),
        displayValue: String(a.displayValue || '').slice(0, 200),
      };
    }
  }
  return out;
}

/**
 * @param {{
 *   recommended: Record<string, [string, {minScore: number}]>,
 *   lhciCli: string,
 *   lighthouseConfig: string,
 *   env?: Record<string, string | undefined>,
 *   tmpRoot?: string,
 *   collect?: typeof spawnCollect,
 *   startProxy?: typeof createGuardProxy,
 *   assertPublic?: typeof assertPublicHost,
 * }} deps
 * @return {(input: {
 *   run: any, project: any, config: any, allowedHosts: string[], signal: AbortSignal,
 *   findBaseline?: (criteria: {projectId: string, branch: string | null, baseBranch: string | null, url: string, excludeRunId: string}) => Promise<any>,
 * }) => Promise<object>}
 */
function createRunAudit(deps) {
  const {
    recommended,
    lhciCli,
    lighthouseConfig,
    env = process.env,
    tmpRoot = os.tmpdir(),
    collect = spawnCollect,
    startProxy = createGuardProxy,
    assertPublic = assertPublicHost,
  } = deps;

  return async function runAudit({run, config, allowedHosts, signal, findBaseline}) {
    const started = Date.now();
    const checked = checkAuditUrl(run.url, allowedHosts);
    if (!checked.ok) throw new Error(`url refused: ${checked.reason}`);
    const url = checked.url;
    try {
      await assertPublic(new URL(url).hostname);
    } catch (err) {
      throw new Error(`url refused: ${/** @type {Error} */ (err).message}`);
    }

    // Resolve the project's rules before spending a Chrome run on them.
    const assertions = resolveAssertions(config, recommended);
    /** @type {Record<string, [string, unknown]>} */
    const tiers = {};
    for (const [id, entry] of Object.entries(assertions)) if (entry !== 'off') tiers[id] = entry;

    const dir = fs.mkdtempSync(path.join(tmpRoot, 'lhci-seo-run-'));
    const proxy = await startProxy();
    try {
      await collect({
        lhciCli,
        lighthouseConfig,
        url,
        cwd: dir,
        env: buildChildEnv(env, {cacheDir: path.join(dir, 'crawl-cache')}),
        chromeFlags: chromeFlagsFor(proxy.url, env.LHCI_SEO_SERVICE_CHROME_FLAGS),
        signal,
      });

      const {lhrs, skipped} = loadLhrs(path.join(dir, '.lighthouseci'));
      const lhr = lhrs[0];
      const blockedNote = proxy.blocked.length
        ? ` The page tried to reach ${[...new Set(proxy.blocked.map(b => b.host))]
            .slice(0, 5)
            .join(', ')}, which is a private or reserved address, and was blocked.`
        : '';
      if (!lhr) {
        throw new Error(
          `the audit produced no report${skipped.length ? ` (${skipped[0]})` : ''}.${blockedNote}`
        );
      }
      if (lhr.runtimeError) {
        throw new Error(
          `Lighthouse could not load the page (${lhr.runtimeError.code}).${blockedNote}`
        );
      }

      const summary = summarizeRun(lhr, /** @type {any} */ (tiers));
      const serp = serpOf(lhr);
      /** @type {object | null} */
      let comparison = null;
      let baselineNote = 'no earlier run to compare with';
      /** @type {any} */
      let baselineSignals = null;
      /** @type {any} */
      let baselineSerp = null;
      if (findBaseline) {
        try {
          const found = await findBaseline({
            projectId: run.projectId,
            branch: run.branch,
            baseBranch: run.baseBranch,
            url,
            excludeRunId: run.id,
          });
          const earlier = found ? reviveRun(found.summary || found) : null;
          if (earlier) {
            comparison = compareRuns(earlier, summary);
            baselineSignals = found.signals || null;
            baselineSerp = reviveSerpPreview(found.serp);
            baselineNote = '';
          }
        } catch (_) {
          baselineNote = 'the earlier run could not be read';
        }
      }
      return {
        version: 1,
        url,
        finalUrl: summary.url,
        durationMs: Date.now() - started,
        summary: serializeRun(summary),
        // Lighthouse's own crawlability and status audits, for the "page stopped being crawlable" alert.
        signals: signalsOf(lhr),
        // How the page may look in search results, and what changed since the baseline run.
        // Pages grouped by the shape of their address, with the problems each group shares.
        templates: templatesOf(lhr),
        serp,
        serpChange: compareSerpPreviews(baselineSerp, serp),
        baselineSignals,
        comparison,
        baselineNote,
        blockedHosts: [...new Set(proxy.blocked.map(b => b.host))].slice(0, 20),
      };
    } finally {
      await proxy.close();
      /** @type {any} */ (fs).rmSync(dir, {recursive: true, force: true});
    }
  };
}

export {createRunAudit, buildChildEnv, chromeFlagsFor, sanitizeExtraFlags, spawnCollect};
