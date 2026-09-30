/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared entity extraction for the three audits that need *typed* JSON-LD entities
 * (structured-data-schema-properties, structured-data-rich-result-eligibility,
 * structured-data-type-conflicts) — replaces each one's previous inline
 * `typeof parsed['@type'] !== 'string'` check, which silently skipped every entity inside a
 * `{"@context": ..., "@graph": [...]}` container (Phase 2 item 5's "invisible to audits" gap;
 * see schema-org-engine.js's module doc for the sibling false-positive this shares a cause with).
 *
 * Also resolves `{"@id": "..."}` reference properties against sibling entities in the same
 * `@graph` — real-world @graph emitters (Yoast SEO and others) commonly link entities this way
 * rather than always inlining them (e.g. an Article's `author` given as a reference to an
 * Organization entity defined elsewhere in the same graph). One level deep only — a resolved
 * node's own references are not themselves chased — matching this codebase's existing "no deep
 * recursion" scope limit (see google-requirements-engine.js's one-level nested-property checks).
 */

/**
 * @param {unknown} value
 * @return {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A bare JSON-LD node reference: an object whose *only* key is "@id". A node that has "@id"
 * alongside other properties is an inline node definition with an identifier, not a reference,
 * and is used as-is.
 * @param {unknown} value
 * @return {value is {'@id': string}}
 */
function isBareIdReference(value) {
  return (
    isPlainObject(value) && typeof value['@id'] === 'string' && Object.keys(value).length === 1
  );
}

/**
 * @param {unknown[]} nodes
 * @return {Map<string, Record<string, unknown>>}
 */
function buildIdMap(nodes) {
  /** @type {Map<string, Record<string, unknown>>} */
  const map = new Map();
  for (const node of nodes) {
    if (isPlainObject(node) && typeof node['@id'] === 'string') {
      map.set(node['@id'], node);
    }
  }
  return map;
}

/**
 * @param {unknown} value
 * @param {Map<string, Record<string, unknown>>} idMap
 * @return {unknown}
 */
function resolveValue(value, idMap) {
  if (isBareIdReference(value)) {
    return idMap.get(value['@id']) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveValue(item, idMap));
  }
  return value;
}

/**
 * Resolves bare `{"@id": ...}` reference values among `entity`'s own direct properties (and
 * within array-valued properties), one level deep only.
 * @param {Record<string, unknown>} entity
 * @param {Map<string, Record<string, unknown>>} idMap
 * @return {Record<string, unknown>}
 */
function resolveReferences(entity, idMap) {
  if (idMap.size === 0) return entity;

  /** @type {Record<string, unknown>} */
  const resolved = {};
  for (const [key, value] of Object.entries(entity)) {
    resolved[key] = resolveValue(value, idMap);
  }
  return resolved;
}

/**
 * @typedef {{type: string, data: Record<string, unknown>}} TypedEntity
 */

/**
 * @param {string} content raw text content of one `<script type="application/ld+json">` block
 * @return {TypedEntity[]}
 */
export function extractTypedEntities(content) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (!isPlainObject(parsed)) return [];

  const graph = parsed['@graph'];
  if (Array.isArray(graph)) {
    const idMap = buildIdMap(graph);
    return graph
      .filter(node => isPlainObject(node) && typeof node['@type'] === 'string')
      .map(node => ({
        type: /** @type {string} */ (/** @type {Record<string, unknown>} */ (node)['@type']),
        data: resolveReferences(/** @type {Record<string, unknown>} */ (node), idMap),
      }));
  }

  if (typeof parsed['@type'] !== 'string') return [];

  // No @graph — a degenerate one-node id map, in case the block self-references its own @id
  // (unusual, but cheap to support the same way rather than special-casing it away).
  const idMap = typeof parsed['@id'] === 'string' ? buildIdMap([parsed]) : new Map();
  return [{type: parsed['@type'], data: resolveReferences(parsed, idMap)}];
}
