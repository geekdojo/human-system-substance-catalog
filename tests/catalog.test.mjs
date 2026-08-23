// Catalog integrity tests. These are the gate: if any of them fail the bundle is not
// publishable, and CI will not let it near a release.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  ROOT, LICENCE_ALLOWLIST, SCHEMA_VERSION,
  canonical, sha256, readJSON, defaultVersion, compareVersions,
  loadSubstances, makeValidator, validate, checkPlacement, buildBundle, attribution, main,
} from '../tools/build.mjs';

const substances = loadSubstances();
const markerKeys = readJSON(path.join(ROOT, 'data', 'marker-keys.json'));
const placementRules = readJSON(path.join(ROOT, 'data', 'placement-rules.json'));
const validator = makeValidator();
const rows = substances.map(s => s.data);

const SYSTEM_KEYS = ['brain', 'pituitary', 'thyroid', 'heart', 'liver', 'pancreas',
  'kidneys', 'blood', 'gonads', 'prostate', 'body'];

// ── coverage ──────────────────────────────────────────────────────────────────

test('the catalog covers at least 120 substances', () => {
  assert.ok(rows.length >= 120, `expected >= 120 substances, found ${rows.length}`);
});

test('every required product area is represented', () => {
  const byCategory = {};
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  for (const c of ['glp1', 'peptide', 'hormone', 'serm', 'prescription', 'supplement', 'nootropic', 'antiviral']) {
    assert.ok(byCategory[c] > 0, `no substances in category "${c}"`);
  }
});

// ── the whole validator, end to end ───────────────────────────────────────────

test('every data file passes full validation', () => {
  const errors = validate(substances, markerKeys, placementRules, validator);
  assert.deepEqual(errors, [], `validation errors:\n${errors.join('\n')}`);
});

test('every data file validates against the JSON Schema individually', () => {
  for (const { basename, data } of substances) {
    assert.ok(validator(data), `${basename}: ${JSON.stringify(validator.errors)}`);
  }
});

// ── keys and vocabulary ───────────────────────────────────────────────────────

test('substance keys are unique', () => {
  const keys = rows.map(r => r.key);
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  assert.deepEqual(dupes, [], `duplicate keys: ${dupes.join(', ')}`);
});

test('substance keys match the app slug pattern and the filename', () => {
  for (const { basename, data } of substances) {
    assert.match(data.key, /^[a-z0-9][a-z0-9_]*$/, `${basename}: key is not a valid slug`);
    assert.equal(basename, `${data.key}.json`);
  }
});

test('every monitors[].marker_key resolves against data/marker-keys.json', () => {
  const known = new Set(markerKeys.markers.map(m => m.key));
  const missing = new Set();
  for (const r of rows) for (const m of r.monitors) if (!known.has(m.marker_key)) missing.add(`${r.key}:${m.marker_key}`);
  assert.deepEqual([...missing], [], `unresolved marker keys: ${[...missing].join(', ')}`);
});

test('marker-keys.json is itself internally consistent', () => {
  const keys = markerKeys.markers.map(m => m.key);
  assert.deepEqual([...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))], [], 'duplicate marker keys');
  for (const m of markerKeys.markers) {
    assert.match(m.key, /^[a-z0-9][a-z0-9_]*$/, `${m.key}: not a valid slug`);
    assert.ok(SYSTEM_KEYS.includes(m.system), `${m.key}: system "${m.system}" is not one of the eleven`);
    assert.ok(m.name && m.unit !== undefined, `${m.key}: missing name or unit`);
  }
  assert.deepEqual(markerKeys.system_keys, SYSTEM_KEYS);
});

test('marker-keys.json publishes no LOINC codes and no reference intervals', () => {
  // SPEC 1.3 binds a LOINC code to a verbatim approved display name. LOINC is not on this
  // repo's licence allowlist and was not retrieved, so the app owns that binding, not us.
  for (const m of markerKeys.markers) {
    for (const forbidden of ['loinc_code', 'loinc_display_name', 'loinc_display_name_type', 'ref_low', 'ref_high']) {
      assert.ok(!(forbidden in m), `${m.key}: must not publish "${forbidden}"`);
    }
  }
});

test('every marker key is actually used by at least one substance', () => {
  const used = new Set(rows.flatMap(r => r.monitors.map(m => m.marker_key)));
  const orphans = markerKeys.markers.map(m => m.key).filter(k => !used.has(k));
  assert.deepEqual(orphans, [], `marker keys defined but never referenced: ${orphans.join(', ')}`);
});

test('every system key is one of the eleven the app accepts', () => {
  for (const r of rows) for (const s of r.systems) {
    assert.ok(SYSTEM_KEYS.includes(s.key), `${r.key}: unknown system "${s.key}"`);
  }
});

// ── THE LICENCE GATE ──────────────────────────────────────────────────────────

test('every sources[].license is on the allowlist', () => {
  const bad = [];
  for (const r of rows) for (const s of r.sources) {
    if (!LICENCE_ALLOWLIST.includes(s.license)) bad.push(`${r.key}: ${s.id} -> ${s.license}`);
  }
  assert.deepEqual(bad, [], `off-allowlist licences:\n${bad.join('\n')}`);
});

test('NEGATIVE: the licence gate fails a row carrying a forbidden licence', () => {
  // This is the test that proves the gate is load-bearing rather than decorative.
  // Every one of these is a licence this repo has decided it cannot ship.
  const forbidden = ['CC-BY-NC-4.0', 'CC-BY-SA-4.0', 'GPL-3.0', 'proprietary', 'WHO-ATC', 'unknown', ''];
  for (const licence of forbidden) {
    const poisoned = structuredClone(substances[0]);
    poisoned.data.sources.push({
      id: 'openfda:tainted-row', kind: 'openfda_spl', license: licence,
      url: 'https://example.invalid/', retrieved: '2026-08-23',
    });
    const errors = validate([poisoned], markerKeys, placementRules, makeValidator());
    assert.ok(
      errors.some(e => /LICENCE GATE|schema/.test(e)),
      `licence "${licence}" was accepted — the gate is not holding. Errors: ${JSON.stringify(errors)}`,
    );
  }
});

test('NEGATIVE: the build-level gate holds even if the schema enum is loosened', () => {
  // Two independent layers guard the allowlist: the schema enum, and the explicit check in
  // validate(). Normally the schema fires first, which would leave the second layer
  // untested. This removes the enum to prove the second layer stands on its own — so a
  // future schema edit cannot silently open the gate.
  const drifted = readJSON(path.join(ROOT, 'schema', 'substance.schema.json'));
  drifted.$defs.source.properties.license = { type: 'string' };
  const poisoned = structuredClone(substances[0]);
  poisoned.data.sources.push({
    id: 'curation:atc_import', kind: 'own_curation', license: 'CC-BY-NC-SA-3.0',
    url: 'https://www.whocc.no/atc_ddd_index/', retrieved: '2026-08-23',
  });
  const errors = validate([poisoned], markerKeys, placementRules, makeValidator(drifted));
  assert.ok(
    errors.some(e => e.includes('LICENCE GATE') && e.includes('CC-BY-NC-SA-3.0')),
    `the build-level gate did not fire: ${JSON.stringify(errors)}`,
  );
});

test('NEGATIVE: a WHO ATC or DrugBank derived source cannot enter the bundle', () => {
  // ATC is non-commercial-only and DrugBank is closed. Neither has an allowlisted licence,
  // so a row sourced from either is rejected on its licence, whatever it calls its `kind`.
  const poisoned = structuredClone(substances[0]);
  poisoned.data.sources.push({
    id: 'curation:atc_import', kind: 'own_curation', license: 'CC-BY-NC-SA-3.0',
    url: 'https://www.whocc.no/atc_ddd_index/', retrieved: '2026-08-23',
  });
  const errors = validate([poisoned], markerKeys, placementRules, makeValidator());
  assert.ok(errors.length > 0, 'a non-commercial-licensed source was accepted');
});

test('NEGATIVE: an evidence id with no matching source is rejected', () => {
  const poisoned = structuredClone(substances[0]);
  poisoned.data.systems[0].evidence.push('openfda:does-not-exist');
  const errors = validate([poisoned], markerKeys, placementRules, makeValidator());
  assert.ok(errors.some(e => e.includes('does not resolve to a declared source')), JSON.stringify(errors));
});

test('NEGATIVE: an unknown marker key is rejected', () => {
  const poisoned = structuredClone(substances[0]);
  poisoned.data.monitors[0].marker_key = 'not_a_real_marker';
  const errors = validate([poisoned], markerKeys, placementRules, makeValidator());
  assert.ok(errors.some(e => e.includes('is not in data/marker-keys.json')), JSON.stringify(errors));
});

test('NEGATIVE: a duplicate slug is rejected', () => {
  const a = structuredClone(substances[0]);
  const b = structuredClone(substances[0]);
  const errors = validate([a, b], markerKeys, placementRules, makeValidator());
  assert.ok(errors.some(e => e.includes('duplicate key')), JSON.stringify(errors));
});

test('NEGATIVE: an unknown system key or relation is rejected by the schema', () => {
  for (const [field, value] of [['key', 'spleen'], ['relation', 'monitors']]) {
    const poisoned = structuredClone(substances[0]);
    poisoned.data.systems[0][field] = value;
    const errors = validate([poisoned], markerKeys, placementRules, makeValidator());
    assert.ok(errors.some(e => e.startsWith(`${poisoned.basename}: schema`)), `${field}=${value} was accepted`);
  }
});

// ── evidence integrity ────────────────────────────────────────────────────────

test('every evidence id resolves to a declared source', () => {
  for (const r of rows) {
    const ids = new Set(r.sources.map(s => s.id));
    for (const rel of [...r.systems, ...r.monitors]) {
      for (const ev of rel.evidence) assert.ok(ids.has(ev), `${r.key}: dangling evidence "${ev}"`);
    }
  }
});

test('every source id namespace matches its kind', () => {
  const expected = {
    openfda_spl: 'openfda', unitox: 'unitox', dilirank: 'dilirank',
    livertox: 'livertox', pubmed: 'pubmed', own_curation: 'curation',
  };
  for (const r of rows) for (const s of r.sources) {
    assert.equal(s.id.split(':')[0], expected[s.kind], `${r.key}: source "${s.id}" has kind "${s.kind}"`);
  }
});

test('every source carries a retrieval date and a URL', () => {
  for (const r of rows) for (const s of r.sources) {
    assert.match(s.retrieved, /^\d{4}-\d{2}-\d{2}$/, `${r.key}/${s.id}: bad retrieved date`);
    assert.ok(s.url, `${r.key}/${s.id}: no url`);
  }
});

test('a recorded source gap is never also a cited source of the same kind', () => {
  // A gap means "we looked and there was nothing". Carrying both would be a contradiction.
  for (const r of rows) {
    for (const g of r.source_gaps || []) {
      const kind = g.source === 'openfda_spl' ? 'openfda_spl' : g.source;
      assert.ok(!r.sources.some(s => s.kind === kind),
        `${r.key}: records a ${g.source} gap but also cites a ${kind} source`);
    }
  }
});

test('every substance carries its own curation source', () => {
  for (const r of rows) {
    assert.ok(r.sources.some(s => s.id === `curation:${r.key}`), `${r.key}: no own-curation source row`);
  }
});

// ── regulatory honesty ────────────────────────────────────────────────────────

test('the peptide tier carries a non-fda_approved status', () => {
  // The brief's hard requirement: BPC-157, TB-500/thymosin, CJC-1295, ipamorelin,
  // sermorelin and enclomiphene have no FDA label and must never imply they do.
  const tier = ['bpc_157', 'tb_500', 'thymosin_alpha_1', 'cjc_1295', 'ipamorelin', 'sermorelin', 'enclomiphene'];
  for (const key of tier) {
    const r = rows.find(x => x.key === key);
    assert.ok(r, `${key} is missing from the catalog`);
    assert.notEqual(r.regulatory_status, 'fda_approved', `${key} claims FDA approval it does not have`);
    assert.ok(!r.sources.some(s => s.kind === 'openfda_spl'), `${key} cites an FDA label`);
  }
});

test('the peptide tier is recorded as returning zero rows in the approved-drug datasets', () => {
  // Independently verified: these compounds return nothing from openFDA, UniTox,
  // DILIrank or LiverTox. The absence is recorded in the data, not merely assumed.
  for (const key of ['bpc_157', 'tb_500', 'cjc_1295', 'ipamorelin', 'sermorelin', 'enclomiphene']) {
    const r = rows.find(x => x.key === key);
    const gaps = new Set((r.source_gaps || []).map(g => g.source));
    assert.ok(gaps.has('openfda_spl'), `${key}: no recorded openFDA gap`);
    for (const s of r.sources) {
      assert.ok(['own_curation', 'pubmed'].includes(s.kind),
        `${key}: carries a "${s.kind}" source, which contradicts the recorded absence`);
    }
  }
});

test('a non-approved substance states so in its dose shape', () => {
  for (const r of rows) {
    if (r.regulatory_status === 'fda_approved') continue;
    assert.match(r.typical_dose_shape.note ?? '', /No FDA-approved dosing reference/,
      `${r.key}: dose shape does not disclaim the absence of an approved reference`);
  }
});

test('descriptions are descriptive, never advisory', () => {
  const advisory = /\b(you should|should take|we recommend|recommended dose|is advised|consult your|start with|titrate to)\b/i;
  for (const r of rows) {
    assert.doesNotMatch(r.description, advisory, `${r.key}: description reads as advice`);
  }
});

test('the catalog contains no personal or health data fields', () => {
  const forbidden = /\b(patient|bryce|his |her |my |diagnos(is|ed)|prescribed to)\b/i;
  for (const r of rows) {
    const blob = JSON.stringify({ d: r.description, s: r.systems, m: r.monitors });
    assert.doesNotMatch(blob, forbidden, `${r.key}: reads as person-specific`);
  }
});

// ── placement rule ────────────────────────────────────────────────────────────

test('no substance violates the placement rules', () => {
  for (const r of rows) {
    assert.deepEqual(checkPlacement(r, placementRules), [], `${r.key} violates a placement rule`);
  }
});

test('NEGATIVE: placing a statin acts_on the liver is rejected', () => {
  const statin = structuredClone(rows.find(r => /HMG-CoA/.test(r.class)));
  statin.systems.push({ key: 'liver', relation: 'acts_on', note: 'the enzyme is here', evidence: [statin.sources[0].id] });
  const out = checkPlacement(statin, placementRules);
  assert.ok(out.some(m => m.includes('statin_acts_on_heart')), JSON.stringify(out));
});

test('NEGATIVE: placing a GH secretagogue off the pituitary is rejected', () => {
  const gh = structuredClone(rows.find(r => r.key === 'ipamorelin'));
  gh.systems = gh.systems.filter(s => !(s.key === 'pituitary' && s.relation === 'acts_on'));
  const out = checkPlacement(gh, placementRules);
  assert.ok(out.some(m => m.includes('gh_axis_acts_on_pituitary')), JSON.stringify(out));
});

test('NEGATIVE: an acts_on note describing clearance is rejected', () => {
  const poisoned = structuredClone(rows[0]);
  poisoned.systems.push({
    key: 'kidneys', relation: 'acts_on',
    note: 'The compound is renally cleared and accumulates in impairment.',
    evidence: [poisoned.sources[0].id],
  });
  const out = checkPlacement(poisoned, placementRules);
  assert.ok(out.some(m => m.includes('clearance_organ_is_never_acts_on')), JSON.stringify(out));
});

test('NEGATIVE: an acts_on note describing toxicity is rejected', () => {
  const poisoned = structuredClone(rows[0]);
  poisoned.systems.push({
    key: 'liver', relation: 'acts_on',
    note: 'Marked hepatotoxicity with a boxed warning.',
    evidence: [poisoned.sources[0].id],
  });
  const out = checkPlacement(poisoned, placementRules);
  assert.ok(out.some(m => m.includes('toxicity_language_is_never_acts_on')), JSON.stringify(out));
});

test('acts_on is reserved for intended effect: no substance acts_on more than three systems', () => {
  for (const r of rows) {
    const n = r.systems.filter(s => s.relation === 'acts_on').length;
    assert.ok(n >= 1 && n <= 3, `${r.key}: ${n} acts_on relations — the load cap makes this expensive, so it must be deliberate`);
  }
});

// ── build determinism and bundle shape ────────────────────────────────────────

test('the build is deterministic: same input, same sha256', () => {
  const a = buildBundle(substances, markerKeys, '2026.08.1', '2026-08-23T00:00:00.000Z');
  const b = buildBundle(substances, markerKeys, '2026.08.1', '2099-01-01T12:34:56.789Z');
  assert.equal(a.sha256, b.sha256, 'published_at must not affect the hash');
  const c = buildBundle(loadSubstances(), markerKeys, '2026.08.1', new Date().toISOString());
  assert.equal(a.sha256, c.sha256, 'a fresh load produced a different hash');
});

test('the sha256 covers the body and changes when the data changes', () => {
  const base = buildBundle(substances, markerKeys, '2026.08.1', '2026-08-23T00:00:00.000Z');
  const mutated = structuredClone(substances);
  mutated[0].data.description += ' One more sentence.';
  const after = buildBundle(mutated, markerKeys, '2026.08.1', '2026-08-23T00:00:00.000Z');
  assert.notEqual(base.sha256, after.sha256);
});

test('the published sha256 verifies against a recomputation of the body', () => {
  const bundle = buildBundle(substances, markerKeys, '2026.08.1', '2026-08-23T00:00:00.000Z');
  const { sha256: published, published_at, ...body } = bundle;
  assert.equal(sha256(JSON.stringify(canonical(body))), published);
});

test('the version changes the hash', () => {
  const a = buildBundle(substances, markerKeys, '2026.08.1', '2026-08-23T00:00:00.000Z');
  const b = buildBundle(substances, markerKeys, '2026.08.2', '2026-08-23T00:00:00.000Z');
  assert.notEqual(a.sha256, b.sha256);
});

test('the bundle has the shape the app expects', () => {
  const bundle = buildBundle(substances, markerKeys, '2026.08.1', '2026-08-23T00:00:00.000Z');
  assert.equal(bundle.schema_version, SCHEMA_VERSION);
  assert.equal(bundle.version, '2026.08.1');
  assert.equal(bundle.substance_count, rows.length);
  assert.equal(bundle.substances.length, rows.length);
  assert.match(bundle.valid_from, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(bundle.valid_to, null, 'every row is open-ended, so the bundle window is open');
  assert.match(bundle.sha256, /^[0-9a-f]{64}$/);
  assert.ok(bundle.published_at);
  assert.deepEqual(bundle.marker_keys, markerKeys.markers.map(m => m.key).sort());
  assert.ok(bundle.attribution.sources.openfda_spl);
  assert.ok(bundle.attribution.bundle_license.includes('Proprietary'));
});

test('bundle substances are sorted by key and carry no $schema pointer', () => {
  const bundle = buildBundle(substances, markerKeys, '2026.08.1', '2026-08-23T00:00:00.000Z');
  const keys = bundle.substances.map(s => s.key);
  assert.deepEqual(keys, [...keys].sort());
  for (const s of bundle.substances) assert.ok(!('$schema' in s));
});

test('attribution only names sources actually present in the data', () => {
  const only = attribution([{ sources: [{ kind: 'own_curation' }] }]);
  assert.deepEqual(Object.keys(only.sources), ['own_curation']);
  assert.ok(!only.sources.unitox, 'UniTox attribution appeared without any UniTox row');
});

test('every source kind present in the data has an attribution notice', () => {
  const bundle = buildBundle(substances, markerKeys, '2026.08.1', '2026-08-23T00:00:00.000Z');
  const kinds = new Set(rows.flatMap(r => r.sources.map(s => s.kind)));
  for (const k of kinds) assert.ok(bundle.attribution.sources[k], `no attribution notice for "${k}"`);
});

// ── versioning ────────────────────────────────────────────────────────────────

test('CalVer comparison orders versions so the app can refuse a downgrade', () => {
  assert.ok(compareVersions('2026.08.2', '2026.08.1') > 0);
  assert.ok(compareVersions('2026.09.1', '2026.08.9') > 0);
  assert.ok(compareVersions('2027.01.1', '2026.12.1') > 0);
  assert.equal(compareVersions('2026.08.1', '2026.08.1'), 0);
  assert.ok(compareVersions('2026.08.1', '2026.08.10') < 0, 'MICRO must compare numerically, not as a string');
});

test('defaultVersion is CalVer for the current UTC month', () => {
  assert.equal(defaultVersion(new Date('2026-08-23T00:00:00Z')), '2026.08.1');
  assert.equal(defaultVersion(new Date('2027-01-02T00:00:00Z')), '2027.01.1');
});

test('canonical() sorts keys recursively so hashing is stable', () => {
  const a = canonical({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 3 } });
  const b = canonical({ a: { c: 3, d: [{ y: 2, z: 1 }] }, b: 1 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(a), '{"a":{"c":3,"d":[{"y":2,"z":1}]},"b":1}');
});

// ── CLI ───────────────────────────────────────────────────────────────────────

test('main() --check succeeds and writes nothing', () => {
  const out = path.join(ROOT, 'dist-test-check');
  fs.rmSync(out, { recursive: true, force: true });
  assert.equal(main(['--check', '--out', 'dist-test-check', '--version', '2026.08.1']), 0);
  assert.equal(fs.existsSync(out), false);
});

test('main() rejects a version that is not CalVer', () => {
  for (const bad of ['1.2.3', '2026.13.1', '26.08.1', 'v2026.08.1', '2026.8.1']) {
    assert.equal(main(['--check', '--version', bad]), 1, `"${bad}" was accepted as CalVer`);
  }
});

test('main() writes the bundle and a matching .sha256 sidecar', () => {
  const rel = 'dist-test-build';
  const out = path.join(ROOT, rel);
  fs.rmSync(out, { recursive: true, force: true });
  try {
    assert.equal(main(['--out', rel, '--version', '2026.08.1']), 0);
    const file = path.join(out, 'catalog-2026.08.1.json');
    const bundle = readJSON(file);
    assert.ok(bundle.substance_count >= 120);
    // The sidecar hashes the FILE, so `sha256sum -c` works on the download.
    const sidecar = fs.readFileSync(`${file}.sha256`, 'utf8');
    const fileDigest = sha256(fs.readFileSync(file, 'utf8'));
    assert.ok(sidecar.startsWith(fileDigest), 'sidecar does not match the file digest — sha256sum -c would fail');
    assert.ok(sidecar.includes('catalog-2026.08.1.json'));
    assert.match(sidecar, /^[0-9a-f]{64} {2}catalog-2026\.08\.1\.json\n$/, 'sidecar is not in coreutils format');

    // The in-bundle sha256 covers the canonical BODY, and is the reproducible one.
    const { sha256: published, published_at, ...body } = bundle;
    assert.equal(sha256(JSON.stringify(canonical(body))), published, 'written bundle fails its own hash');
    assert.notEqual(fileDigest, published, 'the file digest and the body digest must be distinct hashes');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
