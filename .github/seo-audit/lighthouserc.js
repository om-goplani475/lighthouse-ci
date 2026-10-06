/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * LHCI config for the manual "SEO audit (A3 check)" workflow: runs the fork's 99 audits against one URL and
 * asserts them with the recommended error and warn tiers. The URL comes from SEO_AUDIT_URL.
 */

const path = require('path');

const repo = path.join(__dirname, '..', '..');
const url = process.env.SEO_AUDIT_URL;
if (!url) throw new Error('Set SEO_AUDIT_URL to the page to audit.');

module.exports = {
  ci: {
    collect: {
      url: [url],
      numberOfRuns: Number(process.env.SEO_AUDIT_RUNS || 1),
      settings: {
        configPath: path.join(repo, 'packages/seo-audits/src/lighthouse-config.js'),
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: require(path.join(repo, 'packages/seo-audits/src/recommended-assertions.json')),
    },
    upload: {target: 'filesystem', outputDir: path.join(repo, '.lighthouseci', 'reports')},
  },
};
