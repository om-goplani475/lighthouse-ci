/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Raw artifact returned by the StructuredDataJsonLd gatherer — one entry per
 * <script type="application/ld+json"> block found on the page. No parsing here;
 * parsing/validation happens in the audit. `node` is Lighthouse's own NodeDetails
 * shape (from `getNodeDetails`) — treated opaquely here since we only forward it
 * to the report, never destructure it, so we don't couple our typecheck to
 * Lighthouse's internal ambient types (which aren't part of this repo's `LH`
 * namespace in types/lighthouse.d.ts and can change between lighthouse versions).
 * @typedef {{content: string, node: object}} StructuredDataJsonLdEntry
 */

/** @typedef {StructuredDataJsonLdEntry[]} StructuredDataJsonLdArtifact */

/**
 * One row of the audit's details table — one per block found.
 * @typedef {{index: number, valid: boolean, reason: string, snippet: string}} StructuredDataBlockResult
 */

export {};
