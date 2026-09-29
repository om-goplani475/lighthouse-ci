/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Loads a versioned ruleset file, schema-validates it, and returns it. The only module in
 * the rule engine that touches the filesystem. A missing, unparseable, or schema-invalid
 * ruleset file throws a clear, specific error here — at config-resolution time — rather
 * than failing silently or producing an audit that mysteriously always passes/fails.
 */

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import Ajv from 'ajv';

const ajv = new Ajv();
// @ts-expect-error - `import.meta` is valid ESM syntax (this file runs as real ESM, per
// packages/seo-audits's "type": "module"), but the root tsconfig.json's `module: "commonjs"`
// setting — shared across the whole monorepo, every other package is CJS — doesn't allow it
// for type-checking purposes. Type-check-time-only limitation, not a runtime issue; changing
// the root tsconfig for one file would be a monorepo-wide change, out of scope here.
const RULES_ROOT = fileURLToPath(new URL('../../rules', import.meta.url));

/**
 * @param {string} filePath
 * @return {unknown}
 */
function readJson(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`structured-data rule registry: could not read "${filePath}": ${err.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `structured-data rule registry: "${filePath}" is not valid JSON: ${err.message}`
    );
  }
}

/**
 * @param {string} rulesDir
 * @return {string}
 */
function readCurrentVersion(rulesDir) {
  const manifestPath = path.join(rulesDir, 'current.json');
  const manifest = /** @type {{version?: unknown}} */ (readJson(manifestPath));
  if (typeof manifest.version !== 'string') {
    throw new Error(
      `structured-data rule registry: "${manifestPath}" is missing a "version" string`
    );
  }
  return manifest.version;
}

/**
 * @param {string} rulesDir absolute path to the namespace's rules directory
 * @param {string} schemaPath absolute path to that namespace's JSON Schema file
 * @param {string} versionOrCurrent
 * @return {object} the parsed, schema-validated ruleset
 */
export function resolveRuleset(rulesDir, schemaPath, versionOrCurrent) {
  const version = versionOrCurrent === 'current' ? readCurrentVersion(rulesDir) : versionOrCurrent;
  const filePath = path.join(rulesDir, `${version}.json`);
  const ruleset = readJson(filePath);

  const schema = readJson(schemaPath);
  const validateFn = ajv.compile(/** @type {object} */ (schema));
  if (!validateFn(ruleset)) {
    const errors = ajv.errorsText(validateFn.errors, {separator: '; '});
    throw new Error(
      `structured-data rule registry: "${filePath}" failed schema validation: ${errors}`
    );
  }

  return /** @type {object} */ (ruleset);
}

/**
 * @param {string} [versionOrCurrent]
 * @return {import('./types.js').SchemaOrgRuleSet}
 */
export function resolveSchemaOrgRuleset(versionOrCurrent = 'current') {
  return /** @type {import('./types.js').SchemaOrgRuleSet} */ (
    resolveRuleset(
      path.join(RULES_ROOT, 'schema-org'),
      path.join(RULES_ROOT, 'schema', 'schema-org-ruleset.schema.json'),
      versionOrCurrent
    )
  );
}

/**
 * @param {string} [versionOrCurrent]
 * @return {import('./types.js').GoogleRequirementsRuleSet}
 */
export function resolveGoogleRequirementsRuleset(versionOrCurrent = 'current') {
  return /** @type {import('./types.js').GoogleRequirementsRuleSet} */ (
    resolveRuleset(
      path.join(RULES_ROOT, 'google', 'structured-data'),
      path.join(RULES_ROOT, 'schema', 'google-structured-data-ruleset.schema.json'),
      versionOrCurrent
    )
  );
}

/**
 * @param {string} [versionOrCurrent]
 * @return {import('./types.js').EligibilityRuleSet}
 */
export function resolveEligibilityRuleset(versionOrCurrent = 'current') {
  return /** @type {import('./types.js').EligibilityRuleSet} */ (
    resolveRuleset(
      path.join(RULES_ROOT, 'eligibility'),
      path.join(RULES_ROOT, 'schema', 'eligibility-ruleset.schema.json'),
      versionOrCurrent
    )
  );
}

/**
 * @param {string} [versionOrCurrent]
 * @return {import('./types.js').TypeConflictsRuleSet}
 */
export function resolveTypeConflictsRuleset(versionOrCurrent = 'current') {
  return /** @type {import('./types.js').TypeConflictsRuleSet} */ (
    resolveRuleset(
      path.join(RULES_ROOT, 'type-conflicts'),
      path.join(RULES_ROOT, 'schema', 'type-conflicts-ruleset.schema.json'),
      versionOrCurrent
    )
  );
}
