/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure logic for the security-header audits (`x-content-type-options`, `referrer-policy`,
 * `content-security-policy-report`): reads the response headers of the main document, which Lighthouse already
 * has, so there is no request and no new gatherer. No I/O, never throws.
 *
 * These are hygiene signals, not Google ranking requirements, so they are advice (a partial score) or a report,
 * never a failure that blocks a build. A missing `Referrer-Policy` is not even advice: every current browser
 * already defaults to `strict-origin-when-cross-origin`.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {{severity: 'problem' | 'note', finding: string}} HeaderFinding */
/** @typedef {{value: string, findings: HeaderFinding[], hasProblem: boolean}} HeaderResult */

const MAX_VALUE_CHARS = 300;

const REFERRER_POLICIES = new Set([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

/**
 * @param {Array<{name: string, value: string}> | undefined} headers
 * @param {string} name Lower case.
 * @return {string[]} Every value of the header, in order.
 */
function headerValues(headers, name) {
  return (headers || [])
    .filter(h => h && h.name && h.name.toLowerCase() === name)
    .map(h => String(h.value));
}

/** @param {string} value @return {string} */
function clip(value) {
  return value.length <= MAX_VALUE_CHARS ? value : `${value.slice(0, MAX_VALUE_CHARS)}...`;
}

/**
 * `X-Content-Type-Options`: browsers read only the first value of a comma-separated list, and only `nosniff`
 * means anything.
 * @param {string[]} values
 * @return {HeaderResult}
 */
function evaluateContentTypeOptions(values) {
  if (values.length === 0) {
    return {
      value: '',
      hasProblem: true,
      findings: [
        {
          severity: 'problem',
          finding:
            'The header is missing. Send `X-Content-Type-Options: nosniff` so browsers do not guess a file type that differs from the declared one.',
        },
      ],
    };
  }
  const first = values[0].split(',')[0].trim().toLowerCase();
  if (first === 'nosniff') return {value: clip(values.join(', ')), hasProblem: false, findings: []};
  return {
    value: clip(values.join(', ')),
    hasProblem: true,
    findings: [
      {
        severity: 'problem',
        finding: `The first value is "${clip(
          first
        )}". The only value browsers act on is \`nosniff\`.`,
      },
    ],
  };
}

/**
 * `Referrer-Policy`: the value may be a list of fallbacks; a browser uses the last one it understands.
 * @param {string[]} values
 * @return {HeaderResult}
 */
function evaluateReferrerPolicy(values) {
  if (values.length === 0) {
    return {
      value: '',
      hasProblem: false,
      findings: [
        {
          severity: 'note',
          finding:
            'No header. Browsers then use their default, `strict-origin-when-cross-origin`, which is a sound choice.',
        },
      ],
    };
  }
  const tokens = values
    .join(',')
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);
  const recognised = tokens.filter(t => REFERRER_POLICIES.has(t));
  const value = clip(values.join(', '));
  if (recognised.length === 0) {
    return {
      value,
      hasProblem: false,
      findings: [
        {
          severity: 'note',
          finding:
            'No recognised policy value, so browsers ignore the header and use their default.',
        },
      ],
    };
  }
  const effective = recognised[recognised.length - 1];
  if (effective === 'unsafe-url') {
    return {
      value,
      hasProblem: true,
      findings: [
        {
          severity: 'problem',
          finding:
            '`unsafe-url` sends the full address of this page, path and query included, to every other site, even over plain HTTP. Use `strict-origin-when-cross-origin` or stricter.',
        },
      ],
    };
  }
  if (effective === 'no-referrer-when-downgrade') {
    return {
      value,
      hasProblem: false,
      findings: [
        {
          severity: 'note',
          finding:
            '`no-referrer-when-downgrade` is the old default: it sends the full address to other HTTPS sites. `strict-origin-when-cross-origin` is the current default.',
        },
      ],
    };
  }
  return {value, hasProblem: false, findings: []};
}

/**
 * @param {string} policy One Content-Security-Policy value.
 * @return {Map<string, string[]>} Directive name (lower case) to its source list. The first occurrence of a directive wins.
 */
function parseCsp(policy) {
  /** @type {Map<string, string[]>} */
  const directives = new Map();
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const name = tokens[0].toLowerCase();
    if (!directives.has(name)) directives.set(name, tokens.slice(1));
  }
  return directives;
}

/**
 * @param {string[]} enforcing Values of `Content-Security-Policy`.
 * @param {string[]} reportOnly Values of `Content-Security-Policy-Report-Only`.
 * @return {{present: boolean, reportOnly: boolean, rows: Array<{check: string, result: string}>}}
 */
function describeCsp(enforcing, reportOnly) {
  if (enforcing.length === 0) {
    return {
      present: false,
      reportOnly: reportOnly.length > 0,
      rows: [
        {
          check: 'Content-Security-Policy',
          result: reportOnly.length
            ? 'Only a report-only policy is sent: it reports violations but blocks nothing.'
            : 'No policy is sent.',
        },
      ],
    };
  }
  // Several policies all apply; what one allows another can still block. Report on the union of what is risky.
  const policies = enforcing.map(parseCsp);
  /** @param {Map<string, string[]>} p @param {string} token */
  const scriptHas = (p, token) =>
    (p.get('script-src') || p.get('default-src') || []).map(s => s.toLowerCase()).includes(token);
  const unsafeInline = policies.some(p => scriptHas(p, "'unsafe-inline'"));
  const unsafeEval = policies.some(p => scriptHas(p, "'unsafe-eval'"));
  const frameAncestors = policies.some(p => p.has('frame-ancestors'));
  const hasScriptControl = policies.some(p => p.has('script-src') || p.has('default-src'));
  return {
    present: true,
    reportOnly: reportOnly.length > 0,
    rows: [
      {
        check: 'Content-Security-Policy',
        result: `Sent (${policies.length} polic${policies.length === 1 ? 'y' : 'ies'}).`,
      },
      {
        check: 'Script sources',
        result: !hasScriptControl
          ? 'No `script-src` or `default-src`, so scripts are not restricted.'
          : unsafeInline
          ? "Allows `'unsafe-inline'` scripts, which weakens protection against injected script."
          : 'Inline scripts are not allowed.',
      },
      {check: 'Eval', result: unsafeEval ? "Allows `'unsafe-eval'`." : 'Not allowed.'},
      {
        check: 'frame-ancestors',
        result: frameAncestors
          ? 'Set (controls who may frame the page).'
          : 'Not set (the page can be framed by any site unless `X-Frame-Options` says otherwise).',
      },
    ],
  };
}

/**
 * @param {HeaderResult} result
 * @param {string} headerName
 * @return {Product}
 */
function headerProduct(result, headerName) {
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'header', valueType: 'text', label: 'Header'},
    {key: 'value', valueType: 'text', label: 'Value'},
    {key: 'finding', valueType: 'text', label: 'Finding'},
  ];
  const rows = result.findings.length
    ? result.findings.map(f => ({
        header: headerName,
        value: result.value || '(missing)',
        finding: f.severity === 'note' ? `Note: ${f.finding}` : f.finding,
      }))
    : [{header: headerName, value: result.value, finding: 'Present and correct.'}];
  /** @type {Product} */
  const product = {
    // Advice, not a failure: a partial score, as the other warn-tier audits.
    score: result.hasProblem ? 0.5 : 1,
    details: Audit.makeTableDetails(headings, rows),
  };
  const problems = result.findings.filter(f => f.severity === 'problem');
  if (problems.length) {
    product.displayValue = result.value ? 'Needs attention' : 'Missing';
    product.explanation = problems.map(f => f.finding).join(' ');
  }
  return product;
}

/**
 * @param {ReturnType<typeof describeCsp>} csp
 * @return {Product}
 */
function cspProduct(csp) {
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'check', valueType: 'text', label: 'Check'},
    {key: 'result', valueType: 'text', label: 'Result'},
  ];
  return {
    score: 1,
    displayValue: csp.present ? 'Policy sent' : csp.reportOnly ? 'Report-only' : 'No policy',
    details: Audit.makeTableDetails(headings, csp.rows),
  };
}

export {
  headerValues,
  evaluateContentTypeOptions,
  evaluateReferrerPolicy,
  describeCsp,
  parseCsp,
  headerProduct,
  cspProduct,
};
