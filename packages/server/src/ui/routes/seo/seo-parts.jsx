/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {h, Fragment} from 'preact';
import {useState} from 'preact/hooks';
import clsx from 'clsx';
import {Paper} from '../../components/paper';
import {LoadingSpinner} from '../../components/loading-spinner';
import {formatScore, formatDelta, scoreTone} from './seo-model.js';
import '../project-settings/project-settings.css';
import './seo.css';

/**
 * The upstream `Paper` only types strings and elements as children; the dashboard often passes `null` for "nothing here".
 * @param {{children?: any, className?: string}} props
 */
export const Panel = ({children, className}) => <Paper className={className}>{children}</Paper>;

/** @param {{tone?: 'pass' | 'fail' | 'pending' | 'neutral', children: any}} props */
export const Tag = ({tone = 'neutral', children}) => (
  <span className={clsx('seo-tag', `seo-tag--${tone}`)}>{children}</span>
);

/** @param {{tone: 'pass' | 'fail' | 'info', children: any}} props */
export const Notice = ({tone, children}) => (
  <Panel className={clsx('seo-notice', `seo-notice--${tone}`)}>{children}</Panel>
);

/**
 * Asks for the project's admin token, which the SEO API needs for everything.
 * @param {{message?: string, onSave: (token: string) => void}} props
 */
export const TokenBox = ({message, onSave}) => {
  const [value, setValue] = useState('');
  return (
    <Panel>
      <h2>Admin token needed</h2>
      <p className="text--smaller">
        {message ||
          'The SEO service is managed with the project admin token (the one used in project settings).'}
      </p>
      <label className="form-item">
        <div className="text--smaller">Admin token</div>
        <input
          type="password"
          autoComplete="off"
          style={{minWidth: 250}}
          value={value}
          onInput={e => setValue(/** @type {HTMLInputElement} */ (e.target).value)}
        />
      </label>
      <div className="form-item">
        <button type="button" disabled={!value.trim()} onClick={() => onSave(value.trim())}>
          Use this token
        </button>
      </div>
    </Panel>
  );
};

/**
 * Shows what a failed request means, and asks for the token again when it was refused.
 * @param {{result: {state: string, message: string}, onToken: (token: string) => void}} props
 */
export const RequestProblem = ({result, onToken}) => {
  if (result.state === 'no-token') return <TokenBox onSave={onToken} />;
  if (result.state === 'unauthorized')
    return (
      <TokenBox
        message="That admin token was not accepted. Paste the right one."
        onSave={onToken}
      />
    );
  if (result.state === 'loading') return <LoadingSpinner />;
  return <Notice tone="fail">{result.message || 'Something went wrong.'}</Notice>;
};

/** @param {{score: number | null | undefined, grade?: string, delta?: number | null}} props */
export const ScoreBadge = ({score, grade, delta}) => (
  <div className={clsx('seo-score', `seo-score--${scoreTone(score)}`)}>
    <span className="seo-score__number">{formatScore(score)}</span>
    {grade ? <span className="seo-score__grade">{grade}</span> : null}
    {typeof delta === 'number' ? (
      <span className={clsx('seo-score__delta', {'seo-score__delta--down': delta < 0})}>
        {formatDelta(delta)}
      </span>
    ) : null}
  </div>
);

/** @param {{title: string, items: any[] | undefined}} props */
export const IssueList = ({title, items}) => {
  if (!items || items.length === 0) return null;
  return (
    <Fragment>
      <h3>
        {title} ({items.length})
      </h3>
      <ul className="seo-issues">
        {items.map(item => (
          <li key={item.id}>
            <Tag tone={item.tier === 'error' ? 'fail' : 'pending'}>
              {item.tier === 'error' ? 'Error' : 'Warning'}
            </Tag>{' '}
            <strong>{item.title}</strong> <code>{item.id}</code>
            {item.displayValue || item.explanation ? (
              <div className="text--smaller">{item.displayValue || item.explanation}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </Fragment>
  );
};

/** @param {{categories: any[] | undefined, comparison?: any}} props */
export const CategoryTable = ({categories, comparison}) => {
  const moved = new Map(
    ((comparison && comparison.categories) || []).map((/** @type {any} */ c) => [c.name, c.delta])
  );
  return (
    <table className="seo-table">
      <thead>
        <tr>
          <th>Category</th>
          <th>Score</th>
          {comparison ? <th>Change</th> : null}
          <th>Failing</th>
        </tr>
      </thead>
      <tbody>
        {(categories || [])
          .filter(c => c.applicable > 0)
          .map(c => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td>
                {formatScore(c.score)} <Tag tone={scoreTone(c.score)}>{c.grade}</Tag>
              </td>
              {comparison ? <td>{formatDelta(moved.get(c.name))}</td> : null}
              <td>{c.failures + c.warnings}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
};
