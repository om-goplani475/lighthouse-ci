/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * One run: the page the pull request comment links to (`/app/seo/<project>/runs/<run>`). It only needs the project id,
 * so the link works without knowing the project's slug.
 */

import {h} from 'preact';
import {Page} from '../../layout/page';
import {DocumentTitle} from '../../components/document-title';
import {useAdminToken} from '../../hooks/use-api-data';
import {useSeoResource} from '../../hooks/use-seo-resource';
import {
  Panel,
  Tag,
  Notice,
  RequestProblem,
  ScoreBadge,
  IssueList,
  CategoryTable,
  SerpPreview,
} from './seo-parts.jsx';
import {describeRunStatus, formatDuration, shortSha, safeLink} from './seo-model.js';

/** @param {{projectId: string, runId: string}} props */
export const SeoRun = ({projectId, runId}) => {
  const [adminToken, saveAdminToken] = useAdminToken(projectId);
  const [result] = useSeoResource(projectId, adminToken, `/runs/${encodeURIComponent(runId)}`, {
    pollMs: 3000,
    shouldPoll: run => !!run && (run.status === 'queued' || run.status === 'running'),
  });

  return (
    <Page>
      <DocumentTitle title="SEO run" />
      <div className="seo container">
        <p className="text--smaller">
          <a href="/app/projects">Projects</a>
        </p>
        {result.state !== 'ok' ? (
          <RequestProblem result={result} onToken={saveAdminToken} />
        ) : (
          <RunDetail run={result.data} />
        )}
      </div>
    </Page>
  );
};

/** @param {{run: any}} props */
const RunDetail = ({run}) => {
  const status = describeRunStatus(run);
  const link = safeLink(run.url);
  const summary = run.result && run.result.summary;
  const comparison = run.result && run.result.comparison;
  return (
    <div>
      <Panel>
        <h2>
          SEO audit <Tag tone={status.tone}>{status.label}</Tag>
        </h2>
        <p>
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer">
              {run.url}
            </a>
          ) : (
            run.url
          )}
        </p>
        <p className="text--smaller">
          {run.repo ? `${run.repo} · ` : ''}
          {run.prNumber ? `PR #${run.prNumber} · ` : ''}
          {run.branch ? `${run.branch} · ` : ''}
          {shortSha(run.sha) ? `${shortSha(run.sha)} · ` : ''}
          {run.trigger === 'manual' ? 'run by hand' : 'from a webhook'}
          {formatDuration(run.startedAt, run.finishedAt)
            ? ` · took ${formatDuration(run.startedAt, run.finishedAt)}`
            : ''}
        </p>
        {run.status === 'failed' ? (
          <Notice tone="fail">{run.error || 'The run failed.'}</Notice>
        ) : null}
        {summary ? (
          <ScoreBadge
            score={summary.overall.score}
            grade={summary.overall.grade}
            delta={comparison ? comparison.overallDelta : null}
          />
        ) : null}
        {run.result && run.result.baselineNote ? (
          <p className="text--smaller">{run.result.baselineNote}</p>
        ) : null}
        {run.result && run.result.blockedHosts && run.result.blockedHosts.length ? (
          <Notice tone="info">
            Chrome was blocked from reaching private addresses: {run.result.blockedHosts.join(', ')}
          </Notice>
        ) : null}
      </Panel>
      {run.result && run.result.serp ? (
        <Panel>
          <h2>Search result preview</h2>
          <SerpPreview serp={run.result.serp} change={run.result.serpChange} />
        </Panel>
      ) : null}
      {summary ? (
        <Panel>
          <h2>Categories</h2>
          <CategoryTable categories={summary.categories} comparison={comparison} />
        </Panel>
      ) : null}
      {summary ? (
        <Panel>
          {comparison ? (
            <div>
              <IssueList title="New issues" items={comparison.newIssues} />
              <IssueList title="Fixed" items={comparison.fixed} />
              <IssueList title="Still failing" items={comparison.stillFailing} />
              {comparison.newIssues.length +
                comparison.fixed.length +
                comparison.stillFailing.length ===
              0 ? (
                <p>No issues.</p>
              ) : null}
            </div>
          ) : (
            <div>
              <IssueList
                title="Issues"
                items={(summary.audits || []).filter(
                  (/** @type {any} */ a) => a.status === 'fail' || a.status === 'warn'
                )}
              />
              {(summary.audits || []).every(
                (/** @type {any} */ a) => a.status !== 'fail' && a.status !== 'warn'
              ) ? (
                <p>No issues.</p>
              ) : null}
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
};
