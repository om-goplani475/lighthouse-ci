/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Validates a parsed JSON-LD block against schema.org / JSON-LD structural requirements —
 * v1 only checks the "universal" required fields (context and type), which apply to every
 * block regardless of its schema type. Does not know about Google-specific requirements or
 * rich-result eligibility — those are separate engines, deliberately kept apart.
 *
 * Also recognizes the graph-container shape (Phase 2 item 5) — a context field plus a graph
 * array of entities, a standard pattern real-world emitters like Yoast SEO commonly use, which
 * has no top-level type by design since it wraps multiple entities rather than being one itself.
 * Before this, a container block was wrongly flagged as missing its type field — a real false
 * positive, not just an unscoped gap.
 */

/**
 * @param {Record<string, unknown>} container
 * @param {unknown[]} graph
 * @param {import('./types.js').SchemaOrgRuleSet} ruleset
 * @return {import('./types.js').Finding[]}
 */
function validateGraphContainer(container, graph, ruleset) {
  /** @type {import('./types.js').Finding[]} */
  const findings = [];

  // "@context" is conventionally hoisted to the container and inherited by every entry — still
  // required somewhere, just at the container level, not on each individual entry.
  if (!('@context' in container)) {
    findings.push({
      namespace: 'schema-org',
      type: 'universal',
      property: '@context',
      severity: 'error',
      message: 'Missing @context',
    });
  }

  if (graph.length === 0) {
    findings.push({
      namespace: 'schema-org',
      type: 'universal',
      property: '@graph',
      severity: 'error',
      message: '@graph is empty',
    });
    return findings;
  }

  // Every other universal property (currently just "@type") is checked per graph entry, not at
  // the container level — a @graph wrapper doesn't have its own single type, but each entity
  // inside it still needs one, same as a standalone block would.
  const perEntryRequired = ruleset.universal.required.filter(property => property !== '@context');
  graph.forEach((node, index) => {
    const isValidNode = typeof node === 'object' && node !== null;
    for (const property of perEntryRequired) {
      if (!isValidNode || !(property in /** @type {Record<string, unknown>} */ (node))) {
        findings.push({
          namespace: 'schema-org',
          type: 'universal',
          property: `@graph[${index}].${property}`,
          severity: 'error',
          message: `Missing ${property} on @graph[${index}]`,
        });
      }
    }
  });

  return findings;
}

/**
 * @param {Record<string, unknown>} parsedBlock
 * @param {import('./types.js').SchemaOrgRuleSet} ruleset
 * @return {import('./types.js').Finding[]}
 */
export function validate(parsedBlock, ruleset) {
  const graph = parsedBlock['@graph'];
  if (Array.isArray(graph)) {
    return validateGraphContainer(parsedBlock, graph, ruleset);
  }

  /** @type {import('./types.js').Finding[]} */
  const findings = [];

  for (const property of ruleset.universal.required) {
    if (!(property in parsedBlock)) {
      findings.push({
        namespace: 'schema-org',
        type: 'universal',
        property,
        severity: 'error',
        message: `Missing ${property}`,
      });
    }
  }

  return findings;
}
