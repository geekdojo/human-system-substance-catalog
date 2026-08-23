#!/usr/bin/env node
// Build the versioned catalog bundle.
//
//   node tools/build.mjs [--version 2026.08.1] [--out dist] [--check]
//
// Validates every data file against schema/substance.schema.json, resolves every
// monitors[].marker_key against data/marker-keys.json, enforces the placement rules in
// data/placement-rules.json, enforces the licence allowlist, and emits
// dist/catalog-<version>.json plus a .sha256 sidecar.
//
// --check validates and reports but writes nothing.
//
// The build is DETERMINISTIC: the same data directory always produces the same sha256.
// published_at is excluded from the hashed body precisely so that stays true.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const LICENCE_ALLOWLIST = Object.freeze(['CC0-1.0', 'CC-BY-4.0', 'public-domain', 'own-curation']);
export const SCHEMA_VERSION = 1;
const CALVER = /^20\d{2}\.(0[1-9]|1[0-2])\.\d+$/;

// ── helpers ───────────────────────────────────────────────────────────────────

/** Recursively sort object keys so JSON.stringify is a canonical form. */
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function defaultVersion(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}.${m}.1`;
}

/** CalVer comparison: returns <0, 0 or >0. The app uses the same ordering to refuse a downgrade. */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// ── loading ───────────────────────────────────────────────────────────────────

export function loadSubstances(dir = path.join(ROOT, 'data', 'substances')) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => ({ file: path.join(dir, f), basename: f, data: readJSON(path.join(dir, f)) }));
}

export function makeValidator(schema = readJSON(path.join(ROOT, 'schema', 'substance.schema.json'))) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

// ── validation ────────────────────────────────────────────────────────────────

/**
 * Validate a loaded catalog. Returns a flat array of human-readable error strings.
 * An empty array means the catalog is publishable.
 */
export function validate(substances, markerKeys, placementRules, validator = makeValidator()) {
  const errors = [];
  const markerSet = new Set(markerKeys.markers.map(m => m.key));
  const seenKeys = new Map();

  for (const { basename, data } of substances) {
    const where = `${basename}`;

    // 1. schema
    if (!validator(data)) {
      for (const e of validator.errors) errors.push(`${where}: schema ${e.instancePath || '/'} ${e.message}`);
      continue; // downstream checks assume a well-formed shape
    }

    // 2. filename must equal the key, so a file move can never silently orphan a slug
    if (basename !== `${data.key}.json`) errors.push(`${where}: filename does not match key "${data.key}"`);

    // 3. duplicate slugs
    if (seenKeys.has(data.key)) errors.push(`${where}: duplicate key "${data.key}", also in ${seenKeys.get(data.key)}`);
    seenKeys.set(data.key, basename);

    // 4. THE LICENCE GATE
    for (const s of data.sources) {
      if (!LICENCE_ALLOWLIST.includes(s.license)) {
        errors.push(`${where}: LICENCE GATE — source "${s.id}" has licence "${s.license}", which is not on the allowlist (${LICENCE_ALLOWLIST.join(', ')})`);
      }
    }

    // 5. every evidence id resolves to a declared source
    const sourceIds = new Set(data.sources.map(s => s.id));
    const dupSources = data.sources.map(s => s.id).filter((id, i, arr) => arr.indexOf(id) !== i);
    for (const id of new Set(dupSources)) errors.push(`${where}: duplicate source id "${id}"`);
    for (const rel of [...data.systems, ...data.monitors]) {
      for (const ev of rel.evidence) {
        if (!sourceIds.has(ev)) errors.push(`${where}: evidence "${ev}" does not resolve to a declared source`);
      }
    }

    // 6. every marker_key resolves against the controlled vocabulary
    for (const m of data.monitors) {
      if (!markerSet.has(m.marker_key)) errors.push(`${where}: monitor marker_key "${m.marker_key}" is not in data/marker-keys.json`);
    }
    const dupMarkers = data.monitors.map(m => m.marker_key).filter((k, i, arr) => arr.indexOf(k) !== i);
    for (const k of new Set(dupMarkers)) errors.push(`${where}: duplicate monitor for marker "${k}"`);

    // 7. one relation per (system, relation) pair
    const pairs = data.systems.map(s => `${s.key}/${s.relation}`);
    for (const p of new Set(pairs.filter((x, i) => pairs.indexOf(x) !== i))) {
      errors.push(`${where}: duplicate system relation "${p}"`);
    }

    // 8. `fda_approved` may never be asserted without having actually looked for a label.
    //    A hit becomes a source; a genuine miss (a discontinued product, or a BLA biologic
    //    that openFDA's drug/label endpoint does not carry) becomes a recorded source_gap.
    //    What is forbidden is claiming approval without checking either way.
    if (data.regulatory_status === 'fda_approved') {
      const hasLabel = data.sources.some(s => s.kind === 'openfda_spl');
      const checkedLabel = (data.source_gaps || []).some(g => g.source === 'openfda_spl');
      if (!hasLabel && !checkedLabel) {
        errors.push(`${where}: regulatory_status is fda_approved but no openfda_spl source and no recorded openfda_spl lookup exist — the approval claim is unverified`);
      }
    }

    // 9. effectivity window
    if (data.valid_to !== null && !(data.valid_to > data.valid_from)) {
      errors.push(`${where}: valid_to "${data.valid_to}" is not after valid_from "${data.valid_from}"`);
    }

    // 10. placement rules
    errors.push(...checkPlacement(data, placementRules).map(m => `${where}: ${m}`));
  }

  return errors;
}

/** Enforce data/placement-rules.json against one substance. */
export function checkPlacement(data, placementRules) {
  const out = [];
  const actsOn = data.systems.filter(s => s.relation === 'acts_on');
  const confounds = data.systems.filter(s => s.relation === 'confounds');

  for (const rule of placementRules.rules) {
    const w = rule.when || {};
    let applies = !!w.any_substance;
    if (w.category_in) applies = applies || w.category_in.includes(data.category);
    if (w.class_matches) applies = applies || new RegExp(w.class_matches, 'i').test(data.class);
    if (!applies) continue;

    if (rule.require_acts_on) {
      for (const sys of rule.require_acts_on) {
        if (!actsOn.some(s => s.key === sys)) {
          out.push(`PLACEMENT [${rule.id}] requires acts_on "${sys}" — ${rule.reason}`);
        }
      }
    }
    if (rule.forbid_acts_on) {
      for (const sys of rule.forbid_acts_on) {
        if (actsOn.some(s => s.key === sys)) {
          out.push(`PLACEMENT [${rule.id}] forbids acts_on "${sys}" — ${rule.reason}`);
        }
      }
    }
    if (rule.forbid_acts_on_note_matching) {
      const re = new RegExp(rule.forbid_acts_on_note_matching, 'i');
      for (const s of actsOn) {
        if (re.test(s.note)) {
          out.push(`PLACEMENT [${rule.id}] acts_on "${s.key}" has a note reading as ${rule.forbid_acts_on_note_matching.split('|')[0]} — ${rule.reason}`);
        }
      }
    }
    if (rule.require_confounds_note_matching) {
      const re = new RegExp(rule.require_confounds_note_matching, 'i');
      for (const s of confounds) {
        if (!re.test(s.note)) {
          out.push(`PLACEMENT [${rule.id}] confounds "${s.key}" note does not describe a reading — ${rule.reason}`);
        }
      }
    }
  }
  return out;
}

// ── bundle assembly ───────────────────────────────────────────────────────────

export function buildBundle(substances, markerKeys, version, publishedAt) {
  const rows = substances.map(s => {
    const { $schema, ...rest } = s.data;
    return rest;
  }).sort((a, b) => a.key.localeCompare(b.key));

  const validFrom = rows.map(r => r.valid_from).sort()[0];
  const openTo = rows.some(r => r.valid_to === null);
  const validTo = openTo ? null : rows.map(r => r.valid_to).sort().at(-1);

  const body = {
    schema_version: SCHEMA_VERSION,
    version,
    valid_from: validFrom,
    valid_to: validTo,
    substance_count: rows.length,
    marker_keys: markerKeys.markers.map(m => m.key).sort(),
    markers: markerKeys.markers.slice().sort((a, b) => a.key.localeCompare(b.key)),
    substances: rows,
    attribution: attribution(rows),
  };

  const digest = sha256(JSON.stringify(canonical(body)));
  return { ...body, published_at: publishedAt, sha256: digest };
}

/** Attribution block, derived from the licences actually present in the data. */
export function attribution(rows) {
  const kinds = new Set(rows.flatMap(r => r.sources.map(s => s.kind)));
  const notices = {
    openfda_spl: {
      source: 'openFDA / DailyMed Structured Product Labeling',
      license: 'CC0-1.0',
      url: 'https://open.fda.gov/license/',
      notice: 'Data from the openFDA drug label endpoint, published by the U.S. Food and Drug Administration. openFDA states that its data are in the public domain and may be used without restriction. openFDA is not to be relied upon to make decisions regarding medical care; all results are unvalidated.',
    },
    unitox: {
      source: 'UniTox: Unified Dataset of Drug-Induced Toxicity from FDA Labels',
      license: 'CC-BY-4.0',
      url: 'https://doi.org/10.5281/zenodo.14042913',
      notice: 'UniTox by Jake Silberg, Elana Simon, Kyle Swanson and James Zou (Stanford University), distributed via Zenodo under the Creative Commons Attribution 4.0 International licence. UniTox toxicity ratings were generated by an LLM from FDA label text; ratings are cited here with their original row identity and are not restated as clinical fact.',
    },
    dilirank: {
      source: 'DILIrank 2.0 — Drug Induced Liver Injury Rank dataset',
      license: 'public-domain',
      url: 'https://www.fda.gov/science-research/liver-toxicity-knowledge-base-ltkb/drug-induced-liver-injury-rank-dilirank-20-dataset',
      notice: 'DILIrank 2.0, produced by the U.S. Food and Drug Administration National Center for Toxicological Research. A work of the United States Government, in the public domain.',
    },
    livertox: {
      source: 'LiverTox: Clinical and Research Information on Drug-Induced Liver Injury',
      license: 'public-domain',
      url: 'https://www.ncbi.nlm.nih.gov/books/NBK547852/',
      notice: 'LiverTox is produced by the National Institute of Diabetes and Digestive and Kidney Diseases (NIDDK) and hosted on the NCBI Bookshelf. This publication is in the public domain.',
    },
    pubmed: {
      source: 'PubMed bibliographic citations',
      license: 'own-curation',
      url: 'https://pubmed.ncbi.nlm.nih.gov/',
      notice: 'PMIDs identify literature consulted during hand curation. No article text or abstract is reproduced; the catalog values are original curation by this repository.',
    },
    own_curation: {
      source: 'geekdojo/substance-catalog hand curation',
      license: 'own-curation',
      url: 'https://github.com/geekdojo/substance-catalog',
      notice: 'System placement, relation type, monitoring marker selection and cadence are original curation, proprietary to Geekdojo and licensed only as part of this bundle.',
    },
  };
  return {
    bundle_license: 'Proprietary — see LICENSE. The curation is the product.',
    disclaimer: 'Reference data about compounds. This bundle describes no person, contains no health data, and is not medical advice.',
    sources: Object.fromEntries(Object.entries(notices).filter(([k]) => kinds.has(k))),
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

export function main(argv = process.argv.slice(2)) {
  const arg = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const check = argv.includes('--check');
  const version = arg('version') || process.env.CATALOG_VERSION || defaultVersion();
  const outDir = path.resolve(ROOT, arg('out') || 'dist');

  if (!CALVER.test(version)) {
    console.error(`FAIL: version "${version}" is not CalVer YYYY.MM.MICRO`);
    return 1;
  }

  const substances = loadSubstances();
  const markerKeys = readJSON(path.join(ROOT, 'data', 'marker-keys.json'));
  const placementRules = readJSON(path.join(ROOT, 'data', 'placement-rules.json'));

  console.log(`substance-catalog build ${version}`);
  console.log(`  data files      : ${substances.length}`);
  console.log(`  marker keys     : ${markerKeys.markers.length}`);
  console.log(`  placement rules : ${placementRules.rules.length}`);
  console.log(`  licence allowlist: ${LICENCE_ALLOWLIST.join(', ')}`);

  const errors = validate(substances, markerKeys, placementRules);
  if (errors.length) {
    console.error(`\nFAIL: ${errors.length} validation error(s)\n`);
    for (const e of errors.slice(0, 60)) console.error(`  - ${e}`);
    if (errors.length > 60) console.error(`  ... and ${errors.length - 60} more`);
    return 1;
  }
  console.log('  validation      : OK');

  const bundle = buildBundle(substances, markerKeys, version, new Date().toISOString());

  const counts = {};
  for (const r of bundle.substances) counts[r.category] = (counts[r.category] || 0) + 1;
  console.log(`  substances      : ${bundle.substance_count}`);
  console.log(`  by category     : ${Object.entries(counts).sort().map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  effectivity     : ${bundle.valid_from} -> ${bundle.valid_to ?? 'open'}`);
  console.log(`  sha256          : ${bundle.sha256}`);

  if (check) { console.log('\n--check: nothing written.'); return 0; }

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `catalog-${version}.json`);
  fs.writeFileSync(file, JSON.stringify(bundle, null, 2) + '\n');

  // TWO DIFFERENT HASHES, deliberately:
  //   bundle.sha256  — over the canonical body, with sha256 and published_at removed.
  //                    Reproducible: the same data always yields the same value.
  //   the sidecar    — over the written FILE, so `sha256sum -c` works on the downloaded
  //                    artifact. It necessarily covers published_at, so it changes on
  //                    every build even when the data has not.
  const fileDigest = sha256(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(`${file}.sha256`, `${fileDigest}  catalog-${version}.json\n`);

  console.log(`\nwrote ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KiB)`);
  console.log(`  body sha256 (reproducible) : ${bundle.sha256}`);
  console.log(`  file sha256 (sidecar)      : ${fileDigest}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}
