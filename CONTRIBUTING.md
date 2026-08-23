# Contributing

These are rules, not guidance. Most of them are enforced by `npm run check` and `npm test`.
The ones that are not are the ones that matter most, because only a person can hold them.

---

## 1. Sourcing rules

These decisions are taken. They are not open questions, and a pull request that reopens one
will be closed.

### 1.1 Clean sources only

Values may come from these sources and no others:

| Source | Licence | Evidence id |
|---|---|---|
| openFDA / DailyMed SPL | CC0-1.0 | `openfda:<set id>` |
| UniTox | CC BY 4.0 | `unitox:<exact row name>` |
| DILIrank 2.0 | public domain | `dilirank:<LTKBID>` |
| LiverTox (NCBI) | public domain | `livertox:<NBK accession>` |
| PubMed citation | `own-curation` | `pubmed:<PMID>` |
| Original curation | `own-curation` | `curation:<substance key>` |

### 1.2 These sources are blocked

| Source | Why |
|---|---|
| **WHO ATC / DDD** | Non-commercial licence only. **Do not use it, do not import it, do not consult it for classification.** The `class` field is deliberately free text so that nobody is ever tempted to reach for an ATC code. |
| **DrugBank** | Closed and commercially licensed. |
| **ChEMBL** | Licensing for this use is unresolved. Do not use it pending a decision. |
| **DrugCentral** | Licensing for this use is unresolved. Do not use it pending a decision. |
| **SNOMED CT** | Excluded by the product specification. Not used anywhere. Do not import a file that embeds it. |
| **LOINC** | Not retrieved. LOINC requires a code to travel with an approved display name reproduced verbatim; this repository publishes no LOINC codes and the app owns that binding. |

### 1.3 bodyhackguide.co is a coverage checklist and nothing else

You may consult it to decide **which compounds this audience expects to see**. That is the
entire permitted use.

You may **not** take from it: its text, its phrasing, its groupings, its category names, its
ordering, its dose figures, its marker choices, its cadences, or its claims. Not paraphrased,
not "inspired by", not restructured.

Every value in this repository comes from a source in §1.1 or from original curation, and
every row records which. If you cannot say where a value came from, it does not go in.

### 1.4 Never invent a citation

Resolve every evidence id against the live source before you write it:

```sh
node tools/fetch-evidence.mjs --name "Semaglutide" --pubmed "semaglutide lean mass"
```

A PMID written from memory is a fabrication even when the paper turns out to exist. Every
PMID in this repository was resolved through the NCBI API and verified.

### 1.5 A miss is recorded, never papered over

If a lookup returns nothing, write a `source_gaps` entry:

```json
{ "source": "openfda_spl", "queried": "BPC-157", "result": "no_rows", "checked": "2026-08-23" }
```

**A documented absence is worth more than a plausible-looking citation.** It is the
difference between "we looked and there is nothing" and "nobody checked", and only one of
those is useful to a reader six months from now.

### 1.6 Never substitute a near-miss row

If UniTox has `Nandrolone phenpropionate` and you need nandrolone decanoate, that is a
**gap**, not a match. Different ester, different pharmacokinetics, different row. The same
goes for a different salt, a different route, or a paediatric formulation of an adult drug.

Corrections to the *same* substance's row form are fine and expected — `Pramlintide` →
`PRAMLINTIDE ACETATE` is the dataset's spelling of the same molecule. Corrections to a
*different* substance are falsification.

### 1.7 A source may only support what it actually says

- A **UniTox** axis is citable for a `burdens` claim only when rated `Most` or `Less`.
- A **DILIrank** row is citable for a hepatic `burdens` claim only when classed
  `vMost-DILI-concern` or `vLess-DILI-concern`.

`tools/build.mjs` resolves these automatically from the rating, so you cannot attach a claim
to a row that does not support it. Where a row was consulted but does not support the claim,
it stays in `sources[]` with its true classification and a "Consulted, not cited" note. Do
not delete it — the fact that it was checked is itself information.

### 1.8 The peptide tier has no FDA label, and must never imply otherwise

BPC-157, TB-500/thymosin, CJC-1295, ipamorelin, sermorelin and enclomiphene return **zero
rows** in openFDA, UniTox, DILIrank and LiverTox. Verified, not assumed — see
[`docs/SOURCES.md`](docs/SOURCES.md).

Every such entry must carry:

- a `regulatory_status` that is **not** `fda_approved`;
- a description stating plainly that no FDA-approved product or labelling exists;
- a `typical_dose_shape.note` stating that no approved dosing reference exists;
- recorded `source_gaps` for every dataset that returned nothing.

Never write prose that lets a reader infer equivalence with an approved drug. "Studied for"
is not "approved for". A non-US approval is not an FDA approval, and must say which
jurisdiction it is.

---

## 2. The licence gate

`sources[].license` must be one of exactly:

```
CC0-1.0    CC-BY-4.0    public-domain    own-curation
```

Anything else fails the schema, the build and CI.

**Do not widen the allowlist to make a row pass.** The allowlist is the product's commercial
boundary; a value that only exists under some other licence does not belong here. If you
believe a fifth licence genuinely belongs, that is a conversation to have before writing
code, and it needs a decision recorded — not a one-line diff to an enum.

`tests/catalog.test.mjs` proves the gate is load-bearing by feeding the validator rows
carrying `CC-BY-NC-4.0`, `CC-BY-SA-4.0`, `GPL-3.0`, `proprietary` and an empty licence, and
asserting every one is rejected. If you change the gate, that test must still pass.

---

## 3. Placement rules

**A compound is placed by intended effect, never by signalling pathway, and never on the
organ that merely clears it.**

- `acts_on` — the system the compound is **meant** to affect. This counts against the app's
  load cap of two live interventions per system, so it is expensive. Use it deliberately.
- `burdens` — a system the compound stresses, is cleared by, or has a toxicity signal against.
- `confounds` — a system whose **readings** the compound distorts without acting on it.

Fixed placements, enforced by `data/placement-rules.json`:

| Class | `acts_on` | Not |
|---|---|---|
| GH secretagogues, GHRH analogues, growth hormone | `pituitary` | `liver` — IGF-1 is merely made there |
| GLP-1 / GIP / amylin agonists | `pancreas` | `body`, `liver` — weight loss is downstream |
| Androgens and anabolic steroids | `gonads` | `prostate`, `liver`, `heart` |
| Statins | `heart` | `liver` — the enzyme is there, the point is not |
| Thyroid hormones and antithyroid agents | `thyroid` | `heart`, `body` |
| SERMs and aromatase inhibitors | not `pituitary` | the gonadal axis, not the messenger |

Two rules catch the mistake by its language, and they are the ones that fire most often:

- An `acts_on` note containing *cleared*, *excreted*, *metabolised*, *first-pass* or
  *accumulates* is **rejected**. That is a `burdens` relation wearing the wrong label.
- An `acts_on` note containing *toxicity*, *injury*, *adverse* or *boxed warning* is
  **rejected**. Harm is never an intended effect.

A `confounds` note must describe a **reading** — a value, marker, assay, estimate or
interpretation. If it does not, the relation is probably `burdens`.

Adding a rule is welcome when a placement decision was hard enough to be worth freezing.
Adding one that merely restates the schema is not.

---

## 4. Writing style

**Descriptions are factual and descriptive. They are never advisory.**

The app is not a clinic and does not recommend anything. A description says what a compound
*is* and what it is approved or used for. It never says what someone should do.

| Don't | Do |
|---|---|
| "Start at 2.5 mg and titrate up" | "Approved at 2.5 mg weekly, escalating to a maintenance dose" |
| "You should monitor liver enzymes" | "Transaminase elevation is labelled" |
| "The recommended dose is 5 mg" | "Labelled doses range from 5 to 15 mg" |
| "Consult your physician before use" | *(omit — the app already says this once, in the right place)* |

A test rejects `you should`, `should take`, `we recommend`, `recommended dose`, `is advised`,
`consult your`, `start with` and `titrate to`.

**`monitors[].why` earns its place.** It is rendered inside the app's alert explanation
chain, so it must say why *this* marker for *this* compound. "Monitor liver function" is
noise. "Boxed warning for peliosis hepatis in the 17-alkyl structure" is a reason.

**Never write person-specific text.** No patient, no case, no pronouns about a subject. This
is reference data about compounds. A test enforces it.

---

## 5. Mechanics

### Adding a substance

1. Resolve evidence — `node tools/fetch-evidence.mjs --name "…"`.
2. Create `data/substances/<key>.json`. **The filename must equal the key**; the build checks it.
3. Place systems by intended effect. Attach evidence to every claim. Record every gap.
4. `npm run check && npm test`.

### Keys are permanent

`intervention.substance_key` in the app points at your key. Once published, **it never
changes** — a rename orphans every user record that referenced it. To retire an entry, set
`valid_to` to the last date it was in force; do not delete the file and do not reuse the key.

Keys match `^[a-z0-9][a-z0-9_]*$`, the same slug pattern the app uses. Use underscores, not
hyphens: `bpc_157`, not `bpc-157`.

### Marker keys

Every `monitors[].marker_key` must exist in `data/marker-keys.json`. To add one, add it there
first, with `key`, `name`, `system` (one of the eleven) and `unit`.

Do **not** add `ref_low`, `ref_high` or any LOINC field. A reference interval is a property
of the assay and the reference population, not of the compound catalog, and LOINC binding is
the app's job. A test enforces both.

A marker key that no substance references fails the build — the vocabulary describes what the
catalog actually monitors, not what it might one day.

### Releasing

CalVer `YYYY.MM.MICRO`. Push a tag matching `20YY.MM.N`; `release.yml` runs CI as a gate,
builds the bundle, refuses a downgrade, and publishes the release with the bundle, its
`.sha256`, and generated notes listing what was added, changed and removed.

### Before you open a pull request

```sh
npm run check       # schema, marker keys, licence gate, placement rules
npm test            # the full gate
npm run build       # produces dist/catalog-<version>.json
```

CI runs all three, recomputes the bundle hash independently, re-checks the licence gate
against the built bundle, and enforces coverage at 70%.
