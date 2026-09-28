/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const path = require('path');
const fs = require('fs');
const Ajv = require('ajv');
const {promisify} = require('util');
const {exec} = require('child_process');

const execAsync = promisify(exec);

const REGISTRY_PATH = path.join(__dirname, '../../src/rule-engine/registry.js');
const SCHEMA_ORG_SCHEMA = path.join(__dirname, '../../rules/schema/schema-org-ruleset.schema.json');
const FIXTURES_ROOT = path.join(__dirname, '../fixtures/rules');

/**
 * registry.js uses `import.meta.url` at module scope, which Jest's transform can't handle
 * (same "Jest does a bad job with esm" issue as packages/utils/test/presets.test.js and
 * packages/seo-audits/test/lighthouse-config.test.js) — importing it directly inside the
 * Jest process fails to even load the module. Shell out to real node instead, same pattern.
 * @param {string} script
 * @return {Promise<string>}
 */
async function runScript(script) {
  const {stdout} = await execAsync(`node --input-type=module -e "${script.replace(/"/g, '\\"')}"`);
  return stdout;
}

/**
 * @param {string} script
 * @return {Promise<string>} the child process's stderr, asserting it actually threw
 */
async function runScriptExpectingThrow(script) {
  try {
    await execAsync(`node --input-type=module -e "${script.replace(/"/g, '\\"')}"`);
  } catch (err) {
    return /** @type {{stderr: string}} */ (err).stderr;
  }
  throw new Error('Expected the script to throw, but it exited successfully');
}

describe('rule registry — real production rulesets', () => {
  it('resolves the current schema-org, google-requirements, and eligibility rulesets', async () => {
    const script = `
      import {resolveSchemaOrgRuleset, resolveGoogleRequirementsRuleset, resolveEligibilityRuleset} from '${REGISTRY_PATH}';
      console.log(JSON.stringify({
        schemaOrg: resolveSchemaOrgRuleset(),
        google: resolveGoogleRequirementsRuleset(),
        eligibility: resolveEligibilityRuleset(),
      }));
    `;
    const {schemaOrg, google, eligibility} = JSON.parse(await runScript(script));

    expect(schemaOrg.version).toBe('2026-09');
    expect(schemaOrg.universal.required).toEqual(['@context', '@type']);

    expect(Object.keys(google.types).sort()).toEqual(['Article', 'Product']);
    expect(google.types.Product.nested.offers.required).toEqual([
      'price',
      'priceCurrency',
      'availability',
    ]);

    expect(eligibility.types.Product.supported).toBe(true);
    expect(eligibility.types.Article.supported).toBe(true);
  }, 30000);

  it('every checked-in ruleset file under rules/ validates against its own schema', () => {
    const ajv = new Ajv();
    const cases = [
      {
        dir: path.join(__dirname, '../../rules/schema-org'),
        schema: path.join(__dirname, '../../rules/schema/schema-org-ruleset.schema.json'),
      },
      {
        dir: path.join(__dirname, '../../rules/google/structured-data'),
        schema: path.join(
          __dirname,
          '../../rules/schema/google-structured-data-ruleset.schema.json'
        ),
      },
      {
        dir: path.join(__dirname, '../../rules/eligibility'),
        schema: path.join(__dirname, '../../rules/schema/eligibility-ruleset.schema.json'),
      },
    ];

    for (const {dir, schema} of cases) {
      const validateFn = ajv.compile(JSON.parse(fs.readFileSync(schema, 'utf-8')));
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'current.json');
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        const valid = validateFn(data);
        if (!valid) {
          throw new Error(
            `${dir}/${file} failed schema validation: ${ajv.errorsText(validateFn.errors)}`
          );
        }
      }
    }
  });
});

describe('rule registry — error handling', () => {
  it('resolves a valid ruleset by explicit version', async () => {
    const script = `
      import {resolveRuleset} from '${REGISTRY_PATH}';
      console.log(JSON.stringify(resolveRuleset('${path.join(
        FIXTURES_ROOT,
        'valid-schema-org'
      )}', '${SCHEMA_ORG_SCHEMA}', '2026-09')));
    `;
    const ruleset = JSON.parse(await runScript(script));
    expect(ruleset.version).toBe('2026-09');
  }, 30000);

  it('resolves "current" via the manifest', async () => {
    const script = `
      import {resolveRuleset} from '${REGISTRY_PATH}';
      console.log(JSON.stringify(resolveRuleset('${path.join(
        FIXTURES_ROOT,
        'valid-schema-org'
      )}', '${SCHEMA_ORG_SCHEMA}', 'current')));
    `;
    const ruleset = JSON.parse(await runScript(script));
    expect(ruleset.version).toBe('2026-09');
  }, 30000);

  it('throws a clear error when the ruleset directory does not exist', async () => {
    const script = `
      import {resolveRuleset} from '${REGISTRY_PATH}';
      resolveRuleset('${path.join(
        FIXTURES_ROOT,
        'does-not-exist'
      )}', '${SCHEMA_ORG_SCHEMA}', 'current');
    `;
    const stderr = await runScriptExpectingThrow(script);
    expect(stderr).toMatch(/could not read/);
  }, 30000);

  it('throws a clear error when the ruleset file is malformed JSON', async () => {
    const script = `
      import {resolveRuleset} from '${REGISTRY_PATH}';
      resolveRuleset('${path.join(
        FIXTURES_ROOT,
        'malformed-json'
      )}', '${SCHEMA_ORG_SCHEMA}', '2026-09');
    `;
    const stderr = await runScriptExpectingThrow(script);
    expect(stderr).toMatch(/is not valid JSON/);
  }, 30000);

  it('throws a clear error when the ruleset file fails schema validation', async () => {
    const script = `
      import {resolveRuleset} from '${REGISTRY_PATH}';
      resolveRuleset('${path.join(
        FIXTURES_ROOT,
        'schema-invalid'
      )}', '${SCHEMA_ORG_SCHEMA}', '2026-09');
    `;
    const stderr = await runScriptExpectingThrow(script);
    expect(stderr).toMatch(/failed schema validation/);
  }, 30000);
});
