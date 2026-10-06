/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The SEO service for one project: run an audit by hand, see the runs and the webhook deliveries, and edit the rules,
 * hosts and notification destinations. Everything here talks to `/api/v1/seo/...` with the project's admin token.
 */

import {h, Fragment} from 'preact';
import {useState, useEffect} from 'preact/hooks';
import clsx from 'clsx';
import {Link} from 'preact-router';
import {Page} from '../../layout/page';
import {DocumentTitle} from '../../components/document-title';
import {AsyncLoader} from '../../components/async-loader';
import {LoadingSpinner} from '../../components/loading-spinner';
import {useProjectBySlug, useAdminToken} from '../../hooks/use-api-data';
import {useSeoResource} from '../../hooks/use-seo-resource';
import {Panel, Tag, Notice, RequestProblem} from './seo-parts.jsx';
import {
  describeOutcome,
  describeRunStatus,
  hasActiveRun,
  formatDelta,
  formatScore,
  scoreTone,
  shortUrl,
  shortSha,
  hostsToText,
  textToHosts,
  configToForm,
  formToConfig,
  formToNotifications,
  runPagePath,
  seoRequest,
} from './seo-model.js';

/** @param {string | undefined} iso */
const when = iso => (iso ? new Date(iso).toLocaleString() : '');

/** @param {{projectSlug: string}} props */
export const SeoProject = props => {
  const [loadingState, project] = useProjectBySlug(props.projectSlug);
  return (
    <Page>
      <DocumentTitle title="SEO service" />
      <div className="seo container">
        <AsyncLoader
          loadingState={loadingState}
          asyncData={project}
          render={project => <SeoProject_ project={project} />}
        />
      </div>
    </Page>
  );
};

/** @param {{project: LHCI.ServerCommand.Project}} props */
const SeoProject_ = ({project}) => {
  const [adminToken, saveAdminToken] = useAdminToken(project.id);
  const [tab, setTab] = useState('runs');
  const [config, reloadConfig] = useSeoResource(project.id, adminToken, '/config');
  const [created, setCreated] = useState(
    /** @type {{webhookUrl: string, secret: string} | null} */ (null)
  );

  const header = (
    <Fragment>
      <h1>SEO service: {project.name}</h1>
      <p className="text--smaller">
        <Link href={`/app/projects/${project.slug}`}>Dashboard</Link> ·{' '}
        <Link href={`/app/projects/${project.slug}/settings`}>Project settings</Link>
      </p>
    </Fragment>
  );

  if (config.state === 'not-found') {
    return (
      <Fragment>
        {header}
        {created ? (
          <SecretBox
            created={created}
            onDone={() => {
              setCreated(null);
              reloadConfig();
            }}
          />
        ) : (
          <SetupForm
            project={project}
            adminToken={adminToken}
            onCreated={(webhookUrl, secret) => setCreated({webhookUrl, secret})}
          />
        )}
      </Fragment>
    );
  }
  if (config.state !== 'ok') {
    return (
      <Fragment>
        {header}
        <RequestProblem result={config} onToken={saveAdminToken} />
      </Fragment>
    );
  }

  return (
    <Fragment>
      {header}
      <div className="seo-tabs">
        {[
          ['runs', 'Runs'],
          ['webhooks', 'Webhook log'],
          ['settings', 'Rules and destinations'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={clsx('seo-tab', {'seo-tab--active': tab === id})}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'runs' ? (
        <RunsTab project={project} adminToken={adminToken} config={config.data} />
      ) : null}
      {tab === 'webhooks' ? <WebhooksTab project={project} adminToken={adminToken} /> : null}
      {tab === 'settings' ? (
        <SettingsTab
          project={project}
          adminToken={adminToken}
          config={config.data}
          onSaved={reloadConfig}
          onDisabled={reloadConfig}
        />
      ) : null}
    </Fragment>
  );
};

/** The webhook address and secret, shown once. @param {{created: {webhookUrl: string, secret: string}, onDone: () => void}} props */
const SecretBox = ({created, onDone}) => (
  <Panel>
    <h2>Connect your repository</h2>
    <p>
      Send a signed webhook to this address. The secret is shown <strong>only now</strong>; copy it
      before you continue.
    </p>
    <label className="form-item">
      <div className="text--smaller">Webhook URL</div>
      <input
        readOnly
        style={{minWidth: 420}}
        value={created.webhookUrl}
        onFocus={e => /** @type {HTMLInputElement} */ (e.target).select()}
      />
    </label>
    <label className="form-item">
      <div className="text--smaller">Webhook secret</div>
      <input
        readOnly
        style={{minWidth: 420}}
        value={created.secret}
        onFocus={e => /** @type {HTMLInputElement} */ (e.target).select()}
      />
    </label>
    <p className="text--smaller">
      GitHub: Settings, Webhooks, content type <code>application/json</code>, this secret. GitLab:
      Webhooks, this secret as the token.
    </p>
    <div className="form-item">
      <button type="button" onClick={onDone}>
        I have copied the secret
      </button>
    </div>
  </Panel>
);

/** @param {{project: LHCI.ServerCommand.Project, adminToken: string | undefined, onCreated: (webhookUrl: string, secret: string) => void}} props */
const SetupForm = ({project, adminToken, onCreated}) => {
  const [provider, setProvider] = useState('github');
  const [hosts, setHosts] = useState('');
  const [defaultUrl, setDefaultUrl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setMessage('');
    const res = await seoRequest({
      fetch: window.fetch.bind(window),
      projectId: project.id,
      adminToken,
      method: 'PUT',
      path: '/config',
      body: {
        provider,
        allowedHosts: textToHosts(hosts),
        ...(defaultUrl.trim() && {defaultUrl: defaultUrl.trim()}),
      },
    });
    setBusy(false);
    if (res.state === 'ok')
      onCreated(`${window.location.origin}${res.data.webhookPath}`, res.data.webhookSecret);
    else setMessage(res.message);
  };

  return (
    <Panel>
      <h2>Set up the SEO service</h2>
      <p className="text--smaller">
        Other repositories send a webhook with a preview URL; this server audits it, comments on the
        pull request and can alert Slack or Teams. Only hosts you list here can be audited.
      </p>
      {message ? <Notice tone="fail">{message}</Notice> : null}
      <label className="form-item">
        <div className="text--smaller">Sends webhooks from</div>
        <select
          value={provider}
          onChange={e => setProvider(/** @type {HTMLSelectElement} */ (e.target).value)}
        >
          <option value="github">GitHub</option>
          <option value="gitlab">GitLab</option>
          <option value="lhci">A CI job (signed JSON)</option>
        </select>
      </label>
      <label className="form-item">
        <div className="text--smaller">
          Hosts that may be audited (one per line, <code>*.stage.example.org</code> for subdomains)
        </div>
        <textarea
          rows={4}
          style={{minWidth: 420}}
          value={hosts}
          onInput={e => setHosts(/** @type {HTMLTextAreaElement} */ (e.target).value)}
        />
      </label>
      <label className="form-item">
        <div className="text--smaller">Default URL, used when an event carries none (optional)</div>
        <input
          style={{minWidth: 420}}
          placeholder="https://staging.example.org/"
          value={defaultUrl}
          onInput={e => setDefaultUrl(/** @type {HTMLInputElement} */ (e.target).value)}
        />
      </label>
      <div className="form-item">
        <button type="button" disabled={busy || !textToHosts(hosts).length} onClick={save}>
          Create
        </button>
      </div>
    </Panel>
  );
};

/** @param {{project: LHCI.ServerCommand.Project, adminToken: string | undefined, config: any}} props */
const RunsTab = ({project, adminToken, config}) => {
  const [runs, reload] = useSeoResource(project.id, adminToken, '/runs?limit=25', {
    pollMs: 3000,
    shouldPoll: hasActiveRun,
  });
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setMessage('');
    const res = await seoRequest({
      fetch: window.fetch.bind(window),
      projectId: project.id,
      adminToken,
      method: 'POST',
      path: '/runs',
      body: {url: url.trim()},
    });
    setBusy(false);
    if (res.state === 'ok') {
      setUrl('');
      reload();
    } else setMessage(res.message);
  };

  return (
    <Fragment>
      <Panel>
        <h2>Run an audit now</h2>
        <p className="text--smaller">
          Allowed hosts: {(config.allowedHosts || []).join(', ') || 'none'}
        </p>
        {message ? <Notice tone="fail">{message}</Notice> : null}
        <div className="form-item">
          <input
            style={{minWidth: 360}}
            placeholder="https://pr-12.stage.example.org/"
            value={url}
            onInput={e => setUrl(/** @type {HTMLInputElement} */ (e.target).value)}
          />
          <span className="h-spacer" />
          <button type="button" disabled={busy || !url.trim()} onClick={start}>
            Run
          </button>
        </div>
      </Panel>
      <Panel>
        <h2>Runs</h2>
        {runs.state !== 'ok' ? (
          <RequestProblem result={runs} onToken={() => {}} />
        ) : runs.data.length === 0 ? (
          <p>No runs yet. Run one above, or send a webhook.</p>
        ) : (
          <table className="seo-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Page</th>
                <th>From</th>
                <th>Status</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((/** @type {any} */ run) => {
                const status = describeRunStatus(run);
                return (
                  <tr key={run.id}>
                    <td>{when(run.createdAt)}</td>
                    <td>
                      <a href={runPagePath(project.id, run.id)}>{shortUrl(run.url)}</a>
                    </td>
                    <td>
                      {[run.branch, run.prNumber ? `#${run.prNumber}` : '', shortSha(run.sha)]
                        .filter(Boolean)
                        .join(' · ') || (run.trigger === 'manual' ? 'by hand' : '')}
                    </td>
                    <td>
                      <Tag tone={status.tone}>{status.label}</Tag>
                      {run.status === 'failed' && run.error ? (
                        <div className="text--smaller">{run.error}</div>
                      ) : null}
                    </td>
                    <td>
                      {typeof run.score === 'number' ? (
                        <span>
                          {formatScore(run.score)}{' '}
                          <Tag tone={scoreTone(run.score)}>{run.grade}</Tag>{' '}
                          {formatDelta(run.delta)}
                        </span>
                      ) : (
                        ''
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </Fragment>
  );
};

/** @param {{project: LHCI.ServerCommand.Project, adminToken: string | undefined}} props */
const WebhooksTab = ({project, adminToken}) => {
  const [logs, reload] = useSeoResource(project.id, adminToken, '/webhook-logs?limit=50');
  return (
    <Panel>
      <h2>Webhook log</h2>
      <p className="text--smaller">
        Every delivery and what was done with it. Kept for 30 days. Headers and bodies are never
        stored.
      </p>
      <div className="form-item">
        <button type="button" onClick={reload}>
          Refresh
        </button>
      </div>
      {logs.state !== 'ok' ? (
        <RequestProblem result={logs} onToken={() => {}} />
      ) : logs.data.length === 0 ? (
        <p>No deliveries yet.</p>
      ) : (
        <table className="seo-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Outcome</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {logs.data.map((/** @type {any} */ log) => {
              const outcome = describeOutcome(log.outcome);
              return (
                <tr key={log.id}>
                  <td>{when(log.createdAt)}</td>
                  <td>{[log.provider, log.event].filter(Boolean).join(' / ')}</td>
                  <td>
                    <Tag tone={outcome.tone}>{outcome.label}</Tag>
                  </td>
                  <td>
                    {log.runId ? (
                      <a href={runPagePath(project.id, log.runId)}>
                        {log.reason || 'open the run'}
                      </a>
                    ) : (
                      log.reason
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
};

/** @param {{value: string, onChange: (v: string) => void, inheritLabel?: string}} props */
const SeveritySelect = ({value, onChange, inheritLabel = 'from the preset'}) => (
  <select
    value={value || ''}
    onChange={e => onChange(/** @type {HTMLSelectElement} */ (e.target).value)}
  >
    <option value="">{inheritLabel}</option>
    <option value="error">error</option>
    <option value="warn">warn</option>
    <option value="off">off</option>
  </select>
);

/** @param {{project: LHCI.ServerCommand.Project, adminToken: string | undefined, config: any, onSaved: () => void, onDisabled: () => void}} props */
const SettingsTab = ({project, adminToken, config, onSaved, onDisabled}) => {
  const [meta] = useSeoResource(project.id, adminToken, '/meta');
  const [form, setForm] = useState(() => configToForm(config.config, 'seo:recommended'));
  const [provider, setProvider] = useState(config.provider);
  const [hosts, setHosts] = useState(hostsToText(config.allowedHosts));
  const [defaultUrl, setDefaultUrl] = useState(config.defaultUrl || '');
  const [message, setMessage] = useState({tone: /** @type {'pass'|'fail'} */ ('pass'), text: ''});
  const [newSecret, setNewSecret] = useState('');

  const send = async (
    /** @type {string} */ method,
    /** @type {string} */ path,
    /** @type {any} */ body
  ) =>
    seoRequest({
      fetch: window.fetch.bind(window),
      projectId: project.id,
      adminToken,
      method,
      path,
      body,
    });

  const save = async () => {
    const res = await send('PUT', '/config', {
      provider,
      config: formToConfig(form),
      allowedHosts: textToHosts(hosts),
      defaultUrl: defaultUrl.trim() || null,
    });
    setMessage(
      res.state === 'ok' ? {tone: 'pass', text: 'Saved.'} : {tone: 'fail', text: res.message}
    );
    if (res.state === 'ok') onSaved();
  };

  if (meta.state !== 'ok') return <RequestProblem result={meta} onToken={() => {}} />;
  const options = meta.data;

  return (
    <Fragment>
      {message.text ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Panel>
        <h2>Rules</h2>
        <label className="form-item">
          <div className="text--smaller">Preset</div>
          <select
            value={form.preset}
            onChange={e =>
              setForm({...form, preset: /** @type {HTMLSelectElement} */ (e.target).value})
            }
          >
            {options.presets.map((/** @type {any} */ p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="text--smaller">
            {
              (options.presets.find((/** @type {any} */ p) => p.name === form.preset) || {})
                .description
            }
          </div>
        </label>
        <p className="text--smaller">
          Override a whole category, or open it to change single audits. <strong>error</strong>{' '}
          fails the check, <strong>warn</strong> reports it, <strong>off</strong> skips it.
        </p>
        {options.categories.map((/** @type {any} */ category) => (
          <details key={category.name} className="seo-category">
            <summary>
              {category.name}
              <span className="h-spacer" />
              <SeveritySelect
                value={form.categories[category.name]}
                onChange={v =>
                  setForm({...form, categories: {...form.categories, [category.name]: v}})
                }
              />
            </summary>
            <table className="seo-table">
              <tbody>
                {category.audits.map((/** @type {any} */ audit) => (
                  <tr key={audit.id}>
                    <td>
                      <code>{audit.id}</code>
                    </td>
                    <td className="text--smaller">
                      now {options.effective[audit.id]}, recommended {audit.recommended}
                    </td>
                    <td>
                      <SeveritySelect
                        value={form.audits[audit.id]}
                        inheritLabel="no override"
                        onChange={v => setForm({...form, audits: {...form.audits, [audit.id]: v}})}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </Panel>
      <Panel>
        <h2>Webhook and hosts</h2>
        <p className="text--smaller">
          Webhook address: <code>{`${window.location.origin}${config.webhookPath}`}</code>
        </p>
        <label className="form-item">
          <div className="text--smaller">Sends webhooks from</div>
          <select
            value={provider}
            onChange={e => setProvider(/** @type {HTMLSelectElement} */ (e.target).value)}
          >
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="lhci">A CI job (signed JSON)</option>
          </select>
        </label>
        <label className="form-item">
          <div className="text--smaller">Hosts that may be audited (one per line)</div>
          <textarea
            rows={4}
            style={{minWidth: 420}}
            value={hosts}
            onInput={e => setHosts(/** @type {HTMLTextAreaElement} */ (e.target).value)}
          />
        </label>
        <label className="form-item">
          <div className="text--smaller">Default URL (optional)</div>
          <input
            style={{minWidth: 420}}
            value={defaultUrl}
            onInput={e => setDefaultUrl(/** @type {HTMLInputElement} */ (e.target).value)}
          />
        </label>
        <div className="form-item">
          <button type="button" onClick={save}>
            Save rules and hosts
          </button>
          <button
            type="button"
            onClick={async () => {
              if (
                !confirm(
                  'Rotate the webhook secret? Deliveries signed with the old secret will be rejected until you update the repository.'
                )
              )
                return;
              const res = await send('POST', '/rotate-secret');
              if (res.state === 'ok') setNewSecret(res.data.webhookSecret);
              else setMessage({tone: 'fail', text: res.message});
            }}
          >
            Rotate secret
          </button>
        </div>
        {newSecret ? (
          <Notice tone="info">
            New secret (shown only now):{' '}
            <input
              readOnly
              style={{minWidth: 420}}
              value={newSecret}
              onFocus={e => /** @type {HTMLInputElement} */ (e.target).select()}
            />
          </Notice>
        ) : null}
      </Panel>
      <NotificationsForm project={project} adminToken={adminToken} />
      <Panel>
        <h2>Turn off</h2>
        <p className="text--smaller">
          Removes the webhook, the rules and the stored tokens. Past runs stay until they expire.
        </p>
        <div className="form-item">
          <button
            type="button"
            onClick={async () => {
              if (
                !confirm(
                  'Turn off the SEO service for this project? This removes its webhook secret and notification tokens.'
                )
              )
                return;
              const res = await send('DELETE', '/config');
              if (res.state === 'ok') onDisabled();
              else setMessage({tone: 'fail', text: res.message});
            }}
          >
            Turn off the SEO service
          </button>
        </div>
      </Panel>
    </Fragment>
  );
};

/** @param {{project: LHCI.ServerCommand.Project, adminToken: string | undefined}} props */
const NotificationsForm = ({project, adminToken}) => {
  const [current, reload] = useSeoResource(project.id, adminToken, '/notifications');
  const [form, setForm] = useState({
    comment: true,
    includePullRequests: false,
    github: {token: '', apiBase: '', remove: false},
    gitlab: {token: '', apiBase: '', remove: false},
    slack: {webhookUrl: '', remove: false},
    teams: {webhookUrl: '', remove: false},
  });
  const [message, setMessage] = useState({tone: /** @type {'pass'|'fail'} */ ('pass'), text: ''});

  useEffect(() => {
    if (current.state !== 'ok') return;
    const n = current.data;
    setForm(f => ({
      ...f,
      comment: n.comment !== false,
      includePullRequests: !!(n.alerts && n.alerts.includePullRequests),
      github: {token: '', apiBase: (n.github && n.github.apiBase) || '', remove: false},
      gitlab: {token: '', apiBase: (n.gitlab && n.gitlab.apiBase) || '', remove: false},
      slack: {webhookUrl: '', remove: false},
      teams: {webhookUrl: '', remove: false},
    }));
  }, [current.state === 'ok' ? current.data : null]);

  if (current.state === 'loading') return <LoadingSpinner />;
  if (current.state !== 'ok') return <RequestProblem result={current} onToken={() => {}} />;
  const n = current.data;

  /** @param {'github' | 'gitlab'} kind @param {string} label */
  const tokenField = (kind, label) => (
    <Fragment>
      <h3>{label}</h3>
      <label className="form-item">
        <div className="text--smaller">
          Access token{' '}
          {n[kind] && n[kind].tokenSet ? '(one is stored; leave empty to keep it)' : '(not set)'}
        </div>
        <input
          type="password"
          autoComplete="off"
          style={{minWidth: 360}}
          value={form[kind].token}
          onInput={e =>
            setForm({
              ...form,
              [kind]: {...form[kind], token: /** @type {HTMLInputElement} */ (e.target).value},
            })
          }
        />
      </label>
      <label className="form-item">
        <div className="text--smaller">Self-hosted API address (optional)</div>
        <input
          style={{minWidth: 360}}
          placeholder={
            kind === 'github' ? 'https://github.example.com/api/v3' : 'https://gitlab.example.com'
          }
          value={form[kind].apiBase}
          onInput={e =>
            setForm({
              ...form,
              [kind]: {...form[kind], apiBase: /** @type {HTMLInputElement} */ (e.target).value},
            })
          }
        />
      </label>
      {n[kind] ? (
        <label className="form-item">
          <input
            type="checkbox"
            checked={form[kind].remove}
            onChange={e =>
              setForm({
                ...form,
                [kind]: {...form[kind], remove: /** @type {HTMLInputElement} */ (e.target).checked},
              })
            }
          />{' '}
          Remove {label}
        </label>
      ) : null}
    </Fragment>
  );

  /** @param {'slack' | 'teams'} kind @param {string} label */
  const hookField = (kind, label) => (
    <Fragment>
      <h3>{label}</h3>
      <label className="form-item">
        <div className="text--smaller">
          Webhook URL{' '}
          {n[kind]
            ? `(one is stored for ${n[kind].webhookHost}; leave empty to keep it)`
            : '(not set)'}
        </div>
        <input
          type="password"
          autoComplete="off"
          style={{minWidth: 420}}
          value={form[kind].webhookUrl}
          onInput={e =>
            setForm({
              ...form,
              [kind]: {...form[kind], webhookUrl: /** @type {HTMLInputElement} */ (e.target).value},
            })
          }
        />
      </label>
      {n[kind] ? (
        <label className="form-item">
          <input
            type="checkbox"
            checked={form[kind].remove}
            onChange={e =>
              setForm({
                ...form,
                [kind]: {...form[kind], remove: /** @type {HTMLInputElement} */ (e.target).checked},
              })
            }
          />{' '}
          Remove {label}
        </label>
      ) : null}
    </Fragment>
  );

  return (
    <Panel>
      <h2>Pull request comments and alerts</h2>
      <p className="text--smaller">
        Tokens and webhook URLs are stored on this server and are never shown again.
      </p>
      {message.text ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <label className="form-item">
        <input
          type="checkbox"
          checked={form.comment}
          onChange={e =>
            setForm({...form, comment: /** @type {HTMLInputElement} */ (e.target).checked})
          }
        />{' '}
        Post one comment per pull request and update it on each push
      </label>
      {tokenField('github', 'GitHub')}
      {tokenField('gitlab', 'GitLab')}
      <p className="text--smaller">
        Alerts go out when a deployment run introduces a new critical problem, such as a page that
        can no longer be indexed.
      </p>
      {hookField('slack', 'Slack')}
      {hookField('teams', 'Microsoft Teams')}
      <label className="form-item">
        <input
          type="checkbox"
          checked={form.includePullRequests}
          onChange={e =>
            setForm({
              ...form,
              includePullRequests: /** @type {HTMLInputElement} */ (e.target).checked,
            })
          }
        />{' '}
        Also alert for pull request runs
      </label>
      <div className="form-item">
        <button
          type="button"
          onClick={async () => {
            const res = await seoRequest({
              fetch: window.fetch.bind(window),
              projectId: project.id,
              adminToken,
              method: 'PUT',
              path: '/notifications',
              body: formToNotifications(form),
            });
            setMessage(
              res.state === 'ok'
                ? {tone: 'pass', text: 'Saved.'}
                : {tone: 'fail', text: res.message}
            );
            if (res.state === 'ok') reload();
          }}
        >
          Save destinations
        </button>
      </div>
    </Panel>
  );
};
