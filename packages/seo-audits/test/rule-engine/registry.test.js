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
const SERP_PIXEL_BUDGETS_SCHEMA = path.join(
  __dirname,
  '../../rules/schema/serp-pixel-budgets-ruleset.schema.json'
);
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
      import {resolveSchemaOrgRuleset, resolveGoogleRequirementsRuleset, resolveEligibilityRuleset, resolveTypeConflictsRuleset, resolveSerpPixelBudgetsRuleset} from '${REGISTRY_PATH}';
      console.log(JSON.stringify({
        schemaOrg: resolveSchemaOrgRuleset(),
        google: resolveGoogleRequirementsRuleset(),
        eligibility: resolveEligibilityRuleset(),
        typeConflicts: resolveTypeConflictsRuleset(),
        serpPixelBudgets: resolveSerpPixelBudgetsRuleset(),
      }));
    `;
    const {schemaOrg, google, eligibility, typeConflicts, serpPixelBudgets} = JSON.parse(
      await runScript(script)
    );

    expect(schemaOrg.version).toBe('2026-09');
    expect(schemaOrg.universal.required).toEqual(['@context', '@type']);

    expect(Object.keys(google.types).sort()).toEqual([
      'Article',
      'BreadcrumbList',
      'Event',
      'FAQPage',
      'HowTo',
      'JobPosting',
      'LocalBusiness',
      'Organization',
      'Product',
      'Recipe',
      'Review',
      'VideoObject',
    ]);
    // Verified against Google's documentation on 2026-10-06: a product snippet needs a name plus one of
    // offers, review or aggregateRating, and an offer needs a price; currency and availability are recommended.
    expect(google.types.Product.required).toEqual(['name', 'offers|review|aggregateRating']);
    expect(google.types.Product.nested.offers.required).toEqual([
      'price|priceSpecification|lowPrice',
    ]);
    expect(google.types.Product.nested.offers.recommended).toEqual([
      'priceCurrency',
      'availability',
    ]);
    expect(google.types.Article.required).toEqual([]);
    expect(google.types.Recipe.required).toEqual(['name', 'image']);
    // Array-nested property (structured-data-remaining-types) — BreadcrumbList.itemListElement
    // is a list of ListItem, not a single object; confirms the engine's one-level nesting check
    // applies per-instance, same as a single nested object.
    expect(google.types.BreadcrumbList.nested.itemListElement.required).toEqual([
      'position',
      'name',
      'item',
    ]);

    expect(eligibility.types.Product.supported).toBe(true);
    expect(eligibility.types.Article.supported).toBe(true);
    // FAQPage/HowTo are deliberately marked unsupported — Google restricts both to a narrow
    // authoritative-site category the current boolean eligibility schema can't express as
    // "restricted" rather than "not supported" (see docs/audit-specs/structured-data-remaining-types.md).
    expect(eligibility.types.FAQPage.supported).toBe(false);
    expect(eligibility.types.HowTo.supported).toBe(false);

    expect(typeConflicts.singularTypes.sort()).toEqual([
      'BreadcrumbList',
      'Organization',
      'WebSite',
    ]);
    expect(typeConflicts.identityFields.Product).toEqual(['sku', 'gtin', 'gtin13', 'gtin8', 'mpn']);
    // BreadcrumbList is a singular type but deliberately has no identityFields entry — it's
    // checked for duplicate count, never for entity conflicts. Confirms the two lists are kept
    // genuinely separate, not accidentally conflated.
    expect(typeConflicts.identityFields.BreadcrumbList).toBeUndefined();

    expect(serpPixelBudgets.version).toBe('2026-10');
    expect(serpPixelBudgets.title).toEqual({
      font: '400 20px Arial, sans-serif',
      maxWidthPx: {desktop: 600, mobile: 580},
    });
    expect(serpPixelBudgets.description).toEqual({
      font: '400 14px Arial, sans-serif',
      maxWidthPx: {desktop: 920, mobile: 680},
    });
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
      {
        dir: path.join(__dirname, '../../rules/type-conflicts'),
        schema: path.join(__dirname, '../../rules/schema/type-conflicts-ruleset.schema.json'),
      },
      {
        dir: path.join(__dirname, '../../rules/serp-pixel-budgets'),
        schema: SERP_PIXEL_BUDGETS_SCHEMA,
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

describe('rule registry — serp-pixel-budgets namespace', () => {
  it('throws a clear error when a requested version does not exist', async () => {
    const script = `
      import {resolveSerpPixelBudgetsRuleset} from '${REGISTRY_PATH}';
      resolveSerpPixelBudgetsRuleset('9999-99');
    `;
    const stderr = await runScriptExpectingThrow(script);
    expect(stderr).toMatch(/could not read/);
  }, 30000);

  it('throws a clear error when a serp-pixel-budgets ruleset fails schema validation', async () => {
    // A fixture with title.maxWidthPx missing the required "mobile" key — syntactically valid
    // JSON, but schema-invalid, same discipline as the generic resolveRuleset error-handling
    // cases above, applied to this namespace specifically.
    const script = `
      import {resolveRuleset} from '${REGISTRY_PATH}';
      resolveRuleset('${path.join(
        FIXTURES_ROOT,
        'serp-pixel-budgets-invalid'
      )}', '${SERP_PIXEL_BUDGETS_SCHEMA}', '2026-10');
    `;
    const stderr = await runScriptExpectingThrow(script);
    expect(stderr).toMatch(/failed schema validation/);
  }, 30000);
});
