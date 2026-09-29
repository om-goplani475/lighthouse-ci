/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Two independent checks over parsed JSON-LD blocks, deliberately kept as separate exported
 * functions rather than one combined pass: `findDuplicates` is a simple, low-false-positive
 * count check that drives score; `findConflicts` is a fuzzier entity-matching heuristic that
 * never affects score. Conflating them would make that severity split harder to keep clean at
 * the audit layer.
 */

/**
 * @param {unknown} value
 * @return {boolean}
 */
function isTruthyValue(value) {
  return value !== undefined && value !== null && value !== '';
}

/**
 * @param {Record<string, number>} typeCounts
 * @param {import('./types.js').TypeConflictsRuleSet} ruleset
 * @return {import('./types.js').Finding[]}
 */
export function findDuplicates(typeCounts, ruleset) {
  /** @type {import('./types.js').Finding[]} */
  const findings = [];

  for (const type of ruleset.singularTypes) {
    const count = typeCounts[type] || 0;
    if (count > 1) {
      findings.push({
        namespace: 'duplicate-count',
        type,
        property: '',
        severity: 'error',
        message: `${count} ${type} blocks found on this page (expected at most 1).`,
      });
    }
  }

  return findings;
}

/**
 * Groups a type's blocks by the first identity field (in the ruleset's listed order) each
 * block has a truthy value for. A block matching none of the listed fields is excluded from
 * every group — never a wildcard match. This is the "strong identity fields only" behavior
 * decided at Gate 0: it's a deliberate false-negative bias (misses conflicts it has no
 * reliable signal for) over a false-positive one.
 * @param {Record<string, unknown>[]} blocks
 * @param {string[]} fields
 * @return {Map<string, {field: string, blocks: Record<string, unknown>[]}>}
 */
function groupByIdentity(blocks, fields) {
  /** @type {Map<string, {field: string, blocks: Record<string, unknown>[]}>} */
  const groups = new Map();

  for (const block of blocks) {
    const field = fields.find(f => isTruthyValue(block[f]));
    if (!field) continue;

    const key = `${field}:${JSON.stringify(block[field])}`;
    const existing = groups.get(key);
    if (existing) {
      existing.blocks.push(block);
    } else {
      groups.set(key, {field, blocks: [block]});
    }
  }

  return groups;
}

/**
 * @param {Record<string, Record<string, unknown>[]>} parsedBlocksByType
 * @param {import('./types.js').TypeConflictsRuleSet} ruleset
 * @return {import('./types.js').Finding[]}
 */
export function findConflicts(parsedBlocksByType, ruleset) {
  /** @type {import('./types.js').Finding[]} */
  const findings = [];

  for (const [type, fields] of Object.entries(ruleset.identityFields)) {
    const blocks = parsedBlocksByType[type];
    if (!blocks || blocks.length < 2) continue;

    const groups = groupByIdentity(blocks, fields);

    for (const {field, blocks: group} of groups.values()) {
      if (group.length < 2) continue;

      // Top-level comparison only, no recursion into nested objects — same "not a generic
      // recursive validator" principle as google-requirements-engine.js's one-level nesting.
      const keysToCompare = new Set();
      for (const block of group) {
        for (const key of Object.keys(block)) {
          if (key === '@context' || key === '@type' || key === field) continue;
          keysToCompare.add(key);
        }
      }

      for (const key of keysToCompare) {
        const values = group.map(block => JSON.stringify(block[key]));
        if (new Set(values).size > 1) {
          findings.push({
            namespace: 'conflicting-entity',
            type,
            property: key,
            severity: 'info',
            message:
              `${type} blocks matching on ${field} disagree on ${key} (${values.join(' vs ')}) ` +
              '— may indicate inconsistent data, not necessarily an error.',
          });
        }
      }
    }
  }

  return findings;
}
