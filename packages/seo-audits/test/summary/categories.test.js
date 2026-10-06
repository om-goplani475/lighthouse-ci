/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const path = require('path');
const {promisify} = require('util');
const {exec} = require('child_process');
const {CATEGORIES, categoryOf} = require('../../src/summary/categories.js');
const recommended = require('../../src/recommended-assertions.json');

const execAsync = promisify(exec);
const CONFIG_PATH = path.join(__dirname, '../../src/lighthouse-config.js');

describe('summary categories', () => {
  it('lists every audit of the fork exactly once, and no audit that does not exist', async () => {
    // Jest cannot import the ESM config (see lighthouse-config.test.js), so read it in a child process.
    const script = `import config from '${CONFIG_PATH}'; console.log(JSON.stringify(config.categories['seo-extended'].auditRefs.map(r => r.id)));`;
    const {stdout} = await execAsync(
      `node --input-type=module -e "${script.replace(/"/g, '\\"')}"`
    );
    const configured = JSON.parse(stdout);
    const mapped = CATEGORIES.flatMap(c => c.audits);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped].sort()).toEqual([...configured].sort());
  }, 60000);

  it('puts every recommended audit in a category and names no empty category', () => {
    for (const id of Object.keys(recommended)) expect(categoryOf(id)).not.toBeNull();
    for (const c of CATEGORIES) expect(c.audits.length).toBeGreaterThan(0);
    expect(categoryOf('not-an-audit')).toBeNull();
  });
});
