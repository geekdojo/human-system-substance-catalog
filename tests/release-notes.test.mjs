// Release-notes generation. These notes are how a consumer finds out a substance key was
// retired, so a wrong or silently-empty diff is a real problem, not a cosmetic one.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ROOT, loadSubstances, readJSON, buildBundle } from '../tools/build.mjs';
import { fingerprint, describeChange, diff, render, main } from '../tools/release-notes.mjs';

const substances = loadSubstances();
const markerKeys = readJSON(path.join(ROOT, 'data', 'marker-keys.json'));
const bundle = buildBundle(substances, markerKeys, '2026.08.2', '2026-08-23T00:00:00.000Z');
const rows = bundle.substances;

test('fingerprint ignores fields that are not worth a release note', () => {
  const a = structuredClone(rows[0]);
  const b = structuredClone(rows[0]);
  b.sources[0].note = 'reworded provenance note';
  assert.equal(fingerprint(a), fingerprint(b), 'a source note rewrite should not read as a change');
});

test('fingerprint notices a change that IS worth a release note', () => {
  const a = structuredClone(rows[0]);
  const b = structuredClone(rows[0]);
  b.regulatory_status = 'study_only';
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test('fingerprint is insensitive to key order', () => {
  const a = rows[0];
  const b = Object.fromEntries(Object.entries(rows[0]).reverse());
  assert.equal(fingerprint(a), fingerprint(b));
});

test('diff reports added, changed and removed keys', () => {
  const previous = rows.slice(0, 5).map(r => structuredClone(r));
  const current = rows.slice(1, 6).map(r => structuredClone(r));
  current[0].regulatory_status = 'study_only';
  const d = diff(current, previous);
  assert.deepEqual(d.added, [rows[5].key]);
  assert.deepEqual(d.removed, [rows[0].key]);
  assert.deepEqual(d.changed.map(c => c.key), [rows[1].key]);
});

test('diff against an empty previous set marks everything added', () => {
  const d = diff(rows, []);
  assert.equal(d.added.length, rows.length);
  assert.equal(d.removed.length, 0);
  assert.equal(d.changed.length, 0);
});

test('diff of a tree against itself is empty', () => {
  const d = diff(rows, rows.map(r => structuredClone(r)));
  assert.deepEqual([d.added, d.changed, d.removed], [[], [], []]);
});

test('describeChange names the specific field that moved', () => {
  const before = structuredClone(rows.find(r => r.monitors.length > 1));
  const after = structuredClone(before);

  after.regulatory_status = 'study_only';
  assert.match(describeChange(before, after), /regulatory_status/);

  const after2 = structuredClone(before);
  after2.monitors = after2.monitors.slice(1);
  assert.match(describeChange(before, after2), /monitors removed: /);

  const after3 = structuredClone(before);
  after3.systems = [...after3.systems, { key: 'brain', relation: 'confounds', note: 'x', evidence: [before.sources[0].id] }];
  assert.match(describeChange(before, after3), /systems: /);

  const after4 = structuredClone(before);
  after4.description += ' Extra.';
  assert.match(describeChange(before, after4), /description revised/);

  const after5 = structuredClone(before);
  after5.typical_dose_shape = { ...after5.typical_dose_shape, amount_high: 999 };
  assert.match(describeChange(before, after5), /dose shape revised/);
});

test('describeChange never returns an empty explanation', () => {
  const before = structuredClone(rows[0]);
  const after = structuredClone(rows[0]);
  after.aka = [...(after.aka ?? []), 'Some Other Brand'];
  assert.ok(describeChange(before, after).length > 0);
});

test('render produces first-release notes when there is no previous version', () => {
  const md = render({ version: '2026.08.1', previous: null, bundle, delta: diff(rows, []), previousDirRead: false });
  assert.match(md, /## substance-catalog 2026\.08\.1/);
  assert.match(md, /First release/);
  assert.match(md, new RegExp(`\\*\\*${rows.length}\\*\\*`));
  assert.match(md, new RegExp(bundle.sha256));
  assert.match(md, /sha256sum -c catalog-2026\.08\.1\.json\.sha256/);
  assert.match(md, /reference data only/i);
});

test('render lists added, changed and removed sections against a previous version', () => {
  const previous = rows.slice(0, 4).map(r => structuredClone(r));
  const delta = diff(rows, previous);
  const md = render({ version: '2026.08.2', previous: '2026.08.1', bundle, delta, previousDirRead: true });
  assert.match(md, /Compared against `2026\.08\.1`/);
  assert.match(md, /\*\*Added \(\d+\)\*\*/);
  assert.match(md, /\*\*Changed \(\d+\)\*\*/);
  assert.match(md, /\*\*Removed \(\d+\)\*\*/);
});

test('render says so plainly when the previous tree could not be read', () => {
  // Silence here would read as "nothing changed", which would be a lie.
  const md = render({ version: '2026.08.2', previous: '2026.08.1', bundle, delta: diff(rows, []), previousDirRead: false });
  assert.match(md, /Could not read the data tree for `2026\.08\.1`/);
  assert.doesNotMatch(md, /\*\*Added \(/, 'a diff was rendered from a tree that was never read');
});

test('render warns that a removed key is retired for consumers', () => {
  const delta = { added: [], changed: [], removed: ['some_retired_key'] };
  const md = render({ version: '2026.08.2', previous: '2026.08.1', bundle, delta, previousDirRead: true });
  assert.match(md, /`some_retired_key` — the key is retired/);
});

test('render includes an attribution line for every source in the bundle', () => {
  const md = render({ version: '2026.08.1', previous: null, bundle, delta: diff(rows, []), previousDirRead: false });
  for (const s of Object.values(bundle.attribution.sources)) {
    assert.ok(md.includes(s.source), `no attribution line for "${s.source}"`);
  }
  assert.match(md, /Proprietary/);
});

test('main() requires a version', () => {
  assert.equal(main(), 2);
});
