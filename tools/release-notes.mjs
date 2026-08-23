#!/usr/bin/env node
// Generate release notes by diffing this build's data against the previous release's.
//
//   node tools/release-notes.mjs --version 2026.08.2 \
//        --previous 2026.08.1 --previous-dir /tmp/prev/data/substances
//
// With no readable previous directory it emits first-release notes. It never invents a
// comparison it could not make — if the previous tree is missing, it says so.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadSubstances, readJSON, buildBundle, canonical, sha256 } from './build.mjs';

const arg = n => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };

/** Fields whose change is worth naming in release notes. */
const TRACKED = ['name', 'class', 'category', 'regulatory_status', 'routes', 'description',
  'systems', 'monitors', 'typical_dose_shape', 'aka', 'valid_from', 'valid_to'];

export function fingerprint(row) {
  return JSON.stringify(canonical(Object.fromEntries(TRACKED.filter(k => k in row).map(k => [k, row[k]]))));
}

export function describeChange(before, after) {
  const bits = [];
  for (const f of ['name', 'class', 'category', 'regulatory_status']) {
    if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) bits.push(`${f}: ${JSON.stringify(before[f])} -> ${JSON.stringify(after[f])}`);
  }
  const rel = r => r.systems.map(s => `${s.key}/${s.relation}`).sort().join(',');
  if (rel(before) !== rel(after)) bits.push(`systems: ${rel(before)} -> ${rel(after)}`);
  const mk = r => r.monitors.map(m => m.marker_key).sort();
  const [mb, ma] = [mk(before), mk(after)];
  const added = ma.filter(x => !mb.includes(x));
  const removed = mb.filter(x => !ma.includes(x));
  if (added.length) bits.push(`monitors added: ${added.join(', ')}`);
  if (removed.length) bits.push(`monitors removed: ${removed.join(', ')}`);
  if (JSON.stringify(before.typical_dose_shape) !== JSON.stringify(after.typical_dose_shape)) bits.push('dose shape revised');
  if (before.description !== after.description) bits.push('description revised');
  if (!bits.length) bits.push('evidence or wording revised');
  return bits.join('; ');
}

export function diff(currentRows, previousRows) {
  const prev = new Map(previousRows.map(r => [r.key, r]));
  const cur = new Map(currentRows.map(r => [r.key, r]));
  const added = currentRows.filter(r => !prev.has(r.key)).map(r => r.key).sort();
  const removed = previousRows.filter(r => !cur.has(r.key)).map(r => r.key).sort();
  const changed = currentRows
    .filter(r => prev.has(r.key) && fingerprint(prev.get(r.key)) !== fingerprint(r))
    .map(r => ({ key: r.key, detail: describeChange(prev.get(r.key), r) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { added, removed, changed };
}

export function render({ version, previous, bundle, delta, previousDirRead }) {
  const L = [];
  const byCategory = {};
  for (const s of bundle.substances) byCategory[s.category] = (byCategory[s.category] || 0) + 1;

  L.push(`## substance-catalog ${version}`, '');
  L.push('Versioned compound reference data for the `human-system` app. **Reference data only — this bundle describes no person and contains no health data.**', '');
  L.push('| | |', '|---|---|');
  L.push(`| Substances | **${bundle.substance_count}** |`);
  L.push(`| Marker keys | ${bundle.marker_keys.length} |`);
  L.push(`| Schema version | ${bundle.schema_version} |`);
  L.push(`| Effectivity | \`${bundle.valid_from}\` → ${bundle.valid_to ? `\`${bundle.valid_to}\`` : '_open_'} |`);
  L.push(`| sha256 | \`${bundle.sha256}\` |`);
  L.push('');
  L.push(`By category: ${Object.entries(byCategory).sort().map(([k, v]) => `\`${k}\` ${v}`).join(' · ')}`, '');

  L.push('### Changes', '');
  if (!previous) {
    L.push('First release. Every substance below is new.', '');
  } else if (!previousDirRead) {
    L.push(`> Could not read the data tree for \`${previous}\`, so no substance-level diff is available for this release. The counts above are still accurate.`, '');
  } else {
    L.push(`Compared against \`${previous}\`.`, '');
    L.push(`**Added (${delta.added.length})**`, '');
    L.push(delta.added.length ? delta.added.map(k => `- \`${k}\``).join('\n') : '- _none_', '');
    L.push(`**Changed (${delta.changed.length})**`, '');
    L.push(delta.changed.length ? delta.changed.map(c => `- \`${c.key}\` — ${c.detail}`).join('\n') : '- _none_', '');
    L.push(`**Removed (${delta.removed.length})**`, '');
    L.push(delta.removed.length
      ? delta.removed.map(k => `- \`${k}\` — the key is retired. Consumers holding this key should treat it as no longer in force.`).join('\n')
      : '- _none_', '');
  }

  L.push('### Verifying this bundle', '');
  L.push('```sh');
  L.push(`sha256sum -c catalog-${version}.json.sha256`);
  L.push('```', '');
  L.push('That sidecar is a plain checksum of the downloaded **file**.', '');
  L.push(`The \`sha256\` **inside** the bundle (\`${bundle.sha256}\`) is a different hash: it covers the canonical, recursively key-sorted body with \`sha256\` and \`published_at\` excluded. That exclusion is what makes the build reproducible — rebuilding from the same \`data/\` always produces the same value, so a rebuild is verifiable rather than merely plausible.`, '');

  L.push('### Attribution', '');
  for (const [, s] of Object.entries(bundle.attribution.sources)) {
    L.push(`- **${s.source}** — ${s.license} — ${s.url}`);
  }
  L.push('', `Bundle licence: ${bundle.attribution.bundle_license}`, '');
  L.push('Full notices in `docs/ATTRIBUTION.md`.');
  return L.join('\n');
}

export function main() {
  const version = arg('version');
  const previous = arg('previous') || null;
  const previousDir = arg('previous-dir');
  if (!version) { console.error('--version is required'); return 2; }

  const substances = loadSubstances();
  const markerKeys = readJSON(path.join(ROOT, 'data', 'marker-keys.json'));
  const bundle = buildBundle(substances, markerKeys, version, new Date().toISOString());

  let previousRows = [];
  let previousDirRead = false;
  if (previous && previousDir && fs.existsSync(previousDir)) {
    try {
      previousRows = loadSubstances(previousDir).map(s => s.data);
      previousDirRead = previousRows.length > 0;
    } catch { previousDirRead = false; }
  }

  const delta = diff(bundle.substances, previousRows);
  console.log(render({ version, previous, bundle, delta, previousDirRead }));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}

export { sha256 };
