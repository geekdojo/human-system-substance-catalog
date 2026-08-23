# substance-catalog

Versioned compound reference data for the [`human-system`](https://github.com/geekdojo/human-system)
app, published as a JSON bundle on GitHub Releases with AIRAC-style effectivity dates.

> **This repository is reference data only. It describes no person, contains no health data,
> and is not medical advice.** It records what a compound *is*, which body systems it acts
> on versus merely burdens or confounds, what monitoring it implies, and its regulatory
> status. Nothing in it recommends starting, stopping or changing a dose. Interpretation
> belongs to a physician.

**166 substances · 77 marker keys · 700 sourced rows · every value traceable to a clean source.**

---

## Why this is a separate repository

Three reasons, in order of how much they cost to get wrong.

**Licence hygiene.** Compound reference data is a minefield of non-commercial and closed
licences. WHO ATC is non-commercial only, DrugBank is closed, ChEMBL and DrugCentral are
unresolved. One careless import and the catalog stops being saleable — and if the catalog
lived inside the app, that contamination would be inside the product too. Here the boundary
is a wall with a gate on it: **every row records its source, every source declares its
licence, and the build fails on anything outside the allowlist.** See
[the licence gate](#the-licence-gate).

**Different release cadence.** The app ships when code changes. The catalog ships when
*knowledge* changes — a new approval, a label revision, a compound the audience started
asking about. Coupling them would force one to wait on the other. So the catalog is data
with its own version line, its own release, and its own effectivity window; the app fetches
and caches it, and refuses a downgrade.

**Different failure mode.** A code bug throws. A data error is silently wrong forever. That
demands a different kind of scrutiny — a schema, a controlled vocabulary, per-row
provenance, machine-checkable placement rules — and that machinery only makes sense around
a repository whose entire content is data.

## What the app does with it

`human-system` fetches the latest release, verifies the `sha256`, refuses any bundle whose
CalVer version is not newer than the one it holds, and caches it in `catalog_snapshot`.
Substances resolve into `intervention.substance_key`, supplying default system relations and
monitors. See `human-system` `docs/SPEC.md` §2.6 and §3.

Two vocabularies are shared with the app and must not drift:

- **Body system keys** — the eleven fixed keys: `brain`, `pituitary`, `thyroid`, `heart`,
  `liver`, `pancreas`, `kidneys`, `blood`, `gonads`, `prostate`, `body`.
- **Marker keys** — [`data/marker-keys.json`](data/marker-keys.json), shaped so the app can
  adopt it directly as its builtin marker seed. Every `monitors[].marker_key` in the catalog
  resolves against it, and the build fails if one does not.

### Relations: `acts_on` vs `burdens` vs `confounds`

This is the distinction the whole catalog exists to encode, and the one most easily got wrong.

| Relation | Meaning | In the app |
|---|---|---|
| `acts_on` | The system the compound is **intended** to affect. Placed by intended effect, **never** by signalling pathway. | `acts_on` — counts against the load cap of 2 |
| `burdens` | A system the compound stresses, is cleared by, or carries a toxicity signal against. | `monitors` — does not count |
| `confounds` | A system whose **readings** the compound distorts without acting on it. | `monitors` — does not count |

The app collapses `burdens` and `confounds` into its single `monitors` relation. The catalog
keeps them apart because they are different claims, and because a reader deserves to know
whether a marker is on the board because the compound might hurt that organ or because it
makes that organ's numbers lie.

Worked examples:

- **GH secretagogues → `pituitary`**, not liver. IGF-1 is made hepatically, but the intended
  effect is at the somatotroph.
- **Statins → `heart`**, not liver. HMG-CoA reductase sits in the liver; lowering
  cardiovascular risk is the point. The liver is `burdens`.
- **GLP-1s → `pancreas`**. Weight loss is downstream, so `body` is `burdens` — and the note
  says lean mass falls with it.
- **Creatine → `body`**, with `kidneys` as `confounds`: it raises serum creatinine by
  substrate loading without touching filtration. That is the classic false alarm this field
  exists to defuse.

`data/placement-rules.json` encodes these as machine-checked assertions. The build enforces
them, including two that catch the mistake by its language: an `acts_on` note describing
clearance or metabolism is rejected, and so is one describing toxicity.

## The licence gate

Every `sources[].license` must be one of exactly four values:

```
CC0-1.0    CC-BY-4.0    public-domain    own-curation
```

Anything else **fails the schema, fails the build, and fails CI.** This is not advisory. It
is the mechanism that keeps this repository saleable, and `tests/catalog.test.mjs` proves it
holds by feeding the validator poisoned rows carrying `CC-BY-NC-4.0`, `CC-BY-SA-4.0`,
`GPL-3.0`, `proprietary` and an empty licence, and asserting every one is rejected.

**Do not widen the allowlist to make a row pass.** If a value only exists under a licence
outside the four, the value does not belong here.

The bundle itself is proprietary — see [`LICENSE`](LICENSE). The curation *is* the product.

## Layout

```
data/
  substances/*.json      one file per substance; the filename IS the key
  marker-keys.json       controlled marker vocabulary, adoptable by the app as-is
  placement-rules.json   hand-written, machine-enforced placement assertions
schema/
  substance.schema.json  JSON Schema every data file is validated against
tools/
  build.mjs              validate + build dist/catalog-<version>.json
  fetch-evidence.mjs     resolve real evidence ids for a compound, live
  release-notes.mjs      diff this build against the previous release
tests/
  catalog.test.mjs       the gate: integrity, licence, placement, determinism
docs/
  SOURCES.md             what came from where, and what returned nothing
  ATTRIBUTION.md         required notices, verbatim
```

## Usage

```sh
npm ci
npm run check      # validate everything, write nothing
npm test           # the full gate
npm run build      # -> dist/catalog-2026.08.1.json + .sha256
node tools/build.mjs --version 2026.09.1 --out dist
```

## Versioning

**CalVer `YYYY.MM.MICRO`.** This is data, not software — there is no API to break, so
semantic versioning would be describing something that does not exist. What matters is *how
recent* a bundle is, and CalVer says that at a glance.

- `2026.08.1` — first bundle of August 2026
- `2026.08.2` — second bundle that month
- `2026.09.1` — first of September

The app compares versions numerically, component by component, and **refuses a downgrade**.
`release.yml` enforces the same rule before publishing, so a mistagged release cannot ship
backwards.

Each substance carries `valid_from` / `valid_to` (AIRAC-style effectivity), so a row can be
retired without being deleted and the app can still explain a value it recorded last year.

## Adding a substance

1. **Resolve real evidence first.** Never write a citation from memory.

   ```sh
   node tools/fetch-evidence.mjs --name "Semaglutide" --pubmed "semaglutide lean mass"
   ```

   For UniTox and DILIrank, download the datasets (see [`docs/SOURCES.md`](docs/SOURCES.md))
   and look the compound up yourself. Cite the **exact** row identity.

2. **Create `data/substances/<key>.json`.** The filename must equal the `key`; the build
   checks it. The key is a permanent slug matching `^[a-z0-9][a-z0-9_]*$` — the app points
   `intervention.substance_key` at it, so **it never changes**. Copy an existing file of the
   same shape and work from it.

3. **Place the systems by intended effect.** Not by pathway. Not by where the drug is
   metabolised. If your `acts_on` note contains the word "cleared" or "hepatotoxicity", it
   is not an `acts_on`.

4. **Attach evidence to every claim.** Each `systems[]` and `monitors[]` entry needs at least
   one `evidence` id resolving to a `sources[]` row. If a lookup returned nothing, record it
   in `source_gaps` — a documented absence is worth far more than a plausible-looking
   citation.

5. **Record every gap.**

   ```json
   { "source": "openfda_spl", "queried": "BPC-157", "result": "no_rows", "checked": "2026-08-23" }
   ```

6. **Validate and test.**

   ```sh
   npm run check && npm test
   ```

Full rules, stated as rules, in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Bundle format

```jsonc
{
  "schema_version": 1,
  "version": "2026.08.1",
  "published_at": "2026-08-23T…",     // excluded from the hash
  "valid_from": "2026-08-23",
  "valid_to": null,
  "substance_count": 166,
  "marker_keys": ["albumin", "alp", …],
  "markers": [ /* full marker rows, adoptable as the app's seed */ ],
  "substances": [ /* sorted by key */ ],
  "attribution": { /* derived from the sources actually present */ },
  "sha256": "…"                        // over the canonical body
}
```

### Two hashes, on purpose

| Hash | Covers | Property |
|---|---|---|
| `sha256` **inside** the bundle | the recursively key-sorted body, with `sha256` and `published_at` removed | **Reproducible** — the same data always yields the same value |
| the `.sha256` **sidecar** file | the written file, byte for byte | Works with `sha256sum -c` on the download; changes every build, because it covers `published_at` |

Excluding `published_at` from the body hash is what makes a rebuild *verifiable* rather than
merely plausible: rebuild from the same `data/` a year later and you get the same
`70a3c2…`. But a release artifact also needs a plain file checksum a downloader can run
without parsing anything, and that is the sidecar. Conflating them would break one or the
other, so both ship.

CI recomputes the body hash independently and fails on a mismatch.

## Sources

openFDA / DailyMed SPL (CC0-1.0) · UniTox (CC BY 4.0) · DILIrank 2.0 (public domain) ·
LiverTox (public domain) · PubMed citations · original curation.

Deliberately **not** used: WHO ATC, DrugBank, ChEMBL, DrugCentral, SNOMED CT, LOINC.
bodyhackguide.co was used only as a coverage checklist of which compounds to cover — no
text, grouping, number or phrasing was taken from it.

Details in [`docs/SOURCES.md`](docs/SOURCES.md); required notices in
[`docs/ATTRIBUTION.md`](docs/ATTRIBUTION.md).
