# human-system-substance-catalog

[![data: CC BY 4.0](https://img.shields.io/badge/data-CC%20BY%204.0-lightgrey.svg)](LICENSE-DATA)
[![code: Apache-2.0](https://img.shields.io/badge/code-Apache--2.0-blue.svg)](LICENSE-CODE)

Versioned compound reference data for the [`human-system`](https://github.com/geekdojo/human-system)
app, published as a JSON bundle on GitHub Releases with AIRAC-style effectivity dates.

It is open data. Anyone may use it, build on it, and contribute to it: the catalog records
are [CC BY 4.0](LICENSE-DATA), the tooling is [Apache-2.0](LICENSE-CODE), and
[`CONTRIBUTING.md`](CONTRIBUTING.md) explains how a change gets in. See [Licence](#licence).

> **This repository is reference data only. It describes no person, contains no health data,
> and is not medical advice.** It records what a compound *is*, which body systems it acts
> on versus merely burdens or confounds, what monitoring it implies, and its regulatory
> status. **Catalog entries describe what to monitor. Nothing in them recommends starting,
> stopping or changing a dose**, and a contribution that does is refused. Interpretation
> belongs to a physician.

**167 substances · 77 marker keys · 703 sourced rows · every value traceable to a clean source.**

---

## Why this is a separate repository

Three reasons, in order of how much they cost to get wrong.

**Licence hygiene.** Compound reference data is a minefield of non-commercial and closed
licences. WHO ATC is non-commercial only, DrugBank is closed, ChEMBL and DrugCentral are
unresolved. One careless import and the catalog can no longer be published under an open
licence at all. If the catalog lived inside the app, that contamination would be inside
the app too. Here the boundary is a wall with a gate on it: **every row records its source,
every source declares its licence, and the build fails on anything outside the allowlist.**
See [the licence gate](#the-licence-gate).

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

- **Body system keys** — the thirteen fixed keys: `brain`, `pituitary`, `thyroid`, `heart`,
  `liver`, `pancreas`, `kidneys`, `blood`, `gonads`, `prostate`, `body`, `skin`, `hair`.
  `skin` and `hair` were added 2026-08-25. They are **two** systems and not one integumentary
  system, because the app caps a system at two live `acts_on` and a finasteride + minoxidil +
  retinoid stack is three, treating two unrelated things.
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
is the mechanism that keeps every row redistributable under the catalog's own CC BY 4.0
licence. `tests/catalog.test.mjs` proves it holds by feeding the validator poisoned rows
carrying `CC-BY-NC-4.0`, `CC-BY-SA-4.0`, `GPL-3.0`, `proprietary` and an empty licence, and
asserting every one is rejected. A non-commercial licence would contradict the commercial
use CC BY permits; a ShareAlike or copyleft licence would impose terms CC BY does not.

**Do not widen the allowlist to make a row pass.** If a value only exists under a licence
outside the four, the value does not belong here.

## Licence

Two licences, divided by path. The badges at the top say the same thing as this table, and
[`LICENSE`](LICENSE) is the authoritative statement of the split.

| Licence | Covers |
|---|---|
| **Data: [CC BY 4.0](LICENSE-DATA)** | `data/` (every catalog record), the built bundle `dist/catalog-*.json` and its `.sha256` sidecar including every release asset, `docs/`, `README.md` and `CONTRIBUTING.md` |
| **Code: [Apache-2.0](LICENSE-CODE)** | `tools/`, `tests/`, `schema/`, `.github/`, `package.json`, `package-lock.json` and `.gitignore` |

**Why two.** Creative Commons licences are written for data and prose, and Creative Commons
itself advises against using them for software. Apache-2.0 is the software licence closest
in spirit to CC BY: permissive, attribution-preserving, and it adds an explicit patent
grant. The data is CC BY rather than a ShareAlike licence, deliberately. You may build on
the catalog under any terms you like, including closed ones, as long as you attribute it.

**Upstream sources keep their own terms and their own attribution.** CC BY 4.0 covers what
Geekdojo and contributors wrote. It does not relicense material taken from openFDA (CC0),
UniTox (CC BY 4.0), DILIrank or LiverTox (U.S. public domain). Every required notice is in
[`docs/ATTRIBUTION.md`](docs/ATTRIBUTION.md) and in the `attribution` block of every
published bundle. Keep that block with the data and both obligations are met.

**How to attribute the catalog:**

> human-system-substance-catalog by Geekdojo and contributors,
> <https://github.com/geekdojo/human-system-substance-catalog>, licensed under
> [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Say what you changed, if anything.

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
LICENSE                  which licence covers which path
LICENSE-DATA             CC BY 4.0, official text
LICENSE-CODE             Apache-2.0, official text
```

## Usage

You need Node.js 26 or newer (`node --version` to check).

```sh
npm ci             # install the two dependencies, exactly as locked
npm run check      # validate everything, write nothing
npm test           # the full gate
npm run build      # -> dist/catalog-<this month>.1.json + .sha256
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

Contributions are welcome from anyone. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the full
rules, including how to propose a compound without writing the entry yourself. In short:

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

## Bundle format

```jsonc
{
  "schema_version": 1,
  "version": "2026.08.1",
  "published_at": "2026-08-23T…",     // excluded from the hash
  "valid_from": "2026-08-23",
  "valid_to": null,
  "substance_count": 167,
  "marker_keys": ["albumin", "alp", …],
  "markers": [ /* full marker rows, adoptable as the app's seed */ ],
  "substances": [ /* sorted by key */ ],
  "attribution": { /* the bundle licence, plus notices derived from the sources actually present */ },
  "sha256": "…"                        // over the canonical body
}
```

### Two hashes, on purpose

| Hash | Covers | Property |
|---|---|---|
| `sha256` **inside** the bundle | the recursively key-sorted body, with `sha256` and `published_at` removed | **Reproducible** — the same data always yields the same value |
| the `.sha256` **sidecar** file | the written file, byte for byte | Works with `sha256sum -c` on the download; changes every build, because it covers `published_at` |

Excluding `published_at` from the body hash is what makes a rebuild *verifiable* rather than
merely plausible: rebuild from the same `data/` a year later and you get the same body hash.
But a release artifact also needs a plain file checksum a downloader can run without parsing
anything, and that is the sidecar. Conflating them would break one or the other, so both
ship.

CI recomputes the body hash independently and fails on a mismatch.

## Sources

openFDA / DailyMed SPL (CC0-1.0) · UniTox (CC BY 4.0) · DILIrank 2.0 (public domain) ·
LiverTox (public domain) · PubMed citations · original curation.

Deliberately **not** used: WHO ATC, DrugBank, ChEMBL, DrugCentral, SNOMED CT, LOINC.
bodyhackguide.co was used only as a coverage checklist of which compounds to cover — no
text, grouping, number or phrasing was taken from it.

Details in [`docs/SOURCES.md`](docs/SOURCES.md); required notices in
[`docs/ATTRIBUTION.md`](docs/ATTRIBUTION.md).
