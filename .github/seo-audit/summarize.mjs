/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prints a markdown summary of the LHRs in `.lighthouseci` (for $GITHUB_STEP_SUMMARY): whether the fork's audits
 * ran, what failed or warned, how long the gatherers that send requests took, and the crawl coverage line.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || '.lighthouseci';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const recommended = JSON.parse(
  fs.readFileSync(path.join(repo, 'packages/seo-audits/src/recommended-assertions.json'), 'utf8')
);
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^lhr-.*\.json$/.test(f)) : [];
if (files.length === 0) {
  console.log(
    '## SEO audit\n\n**No report was produced** (the collect step failed before writing one).'
  );
  process.exit(0);
}

const slow =
  /HreflangData|SiteCrawl|DeviceFetches|AmpPage|FieldData|SitemapDocuments|RobotsTxt|UrlVariants|Soft404Probe/;
for (const file of files) {
  const lhr = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const category = lhr.categories['seo-extended'];
  const ids = Object.keys(recommended);
  const present = ids.filter(id => lhr.audits[id]);
  const errorRows = [];
  let passed = 0;
  let notApplicable = 0;
  for (const id of present) {
    const a = lhr.audits[id];
    if (a.scoreDisplayMode === 'notApplicable') notApplicable++;
    else if (a.scoreDisplayMode === 'error')
      errorRows.push(`- **${id}**: audit error: ${a.errorMessage}`);
    else if (a.score === 1) passed++;
    else {
      const level = recommended[id][0] === 'error' ? 'FAIL' : 'WARN';
      errorRows.push(
        `- **${level}** \`${id}\`: ${a.displayValue || a.explanation || `score ${a.score}`}`
      );
    }
  }
  console.log(`## ${lhr.finalDisplayedUrl}`);
  console.log(
    `\nLighthouse ${lhr.lighthouseVersion}, "Extended SEO (fork)" category: **${
      category ? 'present' : 'MISSING'
    }**.`
  );
  console.log(
    `Scored audits found: ${present.length} of ${ids.length}; passed ${passed}, not applicable ${notApplicable}.`
  );
  console.log(`Runtime error: ${lhr.runtimeError ? lhr.runtimeError.code : 'none'}.\n`);
  console.log(errorRows.length ? errorRows.join('\n') : 'Nothing failed or warned.');
  const coverage = lhr.audits['crawl-coverage'];
  if (coverage)
    console.log(`\n**crawl-coverage:** ${coverage.displayValue || coverage.explanation || ''}`);
  const timing = (lhr.timing?.entries || []).filter(
    e => /^lh:gather:getArtifact:/.test(e.name) && slow.test(e.name)
  );
  console.log(`\n| Gatherer | Time |\n|---|---|`);
  for (const e of timing) {
    console.log(
      `| ${e.name.replace('lh:gather:getArtifact:', '')} | ${Math.round(e.duration)} ms |`
    );
  }
  console.log(`\nTotal run: ${Math.round(lhr.timing?.total || 0)} ms.\n`);
}
