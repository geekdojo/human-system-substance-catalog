# Sources

What each source is, its licence, where it came from, when it was retrieved, and exactly
what was taken from it. Required legal notices live in [`ATTRIBUTION.md`](ATTRIBUTION.md);
this file is the operational record.

Every figure below was measured against the data in this repository, not estimated.

## What is in the catalog

| | |
|---|---|
| Substances | 167 |
| Marker keys | 77 |
| System relations | 561 (`acts_on` 218, `burdens` 324, `confounds` 19) |
| Monitor rows | 539 |
| Source rows | 703 |
| Recorded source gaps | 171 |

Source rows by licence — this is what the licence gate sees:

| Licence | Rows |
|---|---|
| `own-curation` | 274 |
| `public-domain` | 183 |
| `CC0-1.0` | 134 |
| `CC-BY-4.0` | 112 |

Nothing else appears, and nothing else can: `tools/build.mjs` fails the build on any
`sources[].license` outside that allowlist, and `tests/catalog.test.mjs` proves the gate
fails by feeding it a poisoned row.

## Coverage by source

How many of the 167 substances carry at least one row from each source:

| Source | Substances | Lookups that returned nothing |
|---|---|---|
| openFDA SPL | 133 | 34 |
| UniTox | 112 | 54 |
| DILIrank 2.0 | 95 | 34 |
| LiverTox | 88 | 48 |
| PubMed | 54 | 1 |
| Own curation | 167 | — |

A "lookup that returned nothing" is not a silence. It is written into the data file as a
`source_gaps` entry recording the source, the exact query string, the result `no_rows` and
the date it was checked, so a future reader can tell a source that was never consulted from
one that was consulted and had nothing to say.

---

## openFDA — drug/label endpoint

| | |
|---|---|
| Licence | CC0-1.0 / U.S. public domain |
| Endpoint | `https://api.fda.gov/drug/label.json` |
| Retrieved | 2026-08-23; the `minoxidil_oral` label and four re-checks on 2026-08-25 |
| Evidence ids | `openfda:<SPL set id>` |
| API key | not required at the volume used here |

**How it was queried.** Each compound's generic name against `openfda.generic_name`,
falling back to `openfda.substance_name` and then `openfda.brand_name`. The `set_id` of the
first matching label was recorded along with its `effective_time`, brand and generic names,
and the total number of matching label records. Requests were rate-limited to roughly three
per second.

**What was taken.** The SPL `set_id` as a stable citation, and the factual content of the
label — indications, boxed warnings, warnings and precautions, and explicit monitoring
instructions — restated in our own words. **No label text is reproduced.**

**Where it returned nothing (34 lookups).** Three groups, all genuine absences rather than
query failures:

1. **Research chemicals and unapproved peptides** — BPC-157, TB-500, CJC-1295, ipamorelin,
   ibutamoren, GHRP-2, GHRP-6, hexarelin, KPV, LL-37, AOD-9604, MOTS-c, melanotan II,
   semax, selank, cerebrolysin, noopept, piracetam, enclomiphene, sermorelin. There is no
   FDA label because there is no FDA-approved product.
2. **Discontinued US human products** — testosterone propionate, nandrolone decanoate,
   oxandrolone, oxymetholone, stanozolol, fluoxymesterone, boldenone undecylenate,
   trenbolone acetate. These are or were approved, but openFDA carries no current label
   record. Where the compound is genuinely approved the entry keeps
   `regulatory_status: "fda_approved"` *and* carries the recorded gap, so the claim and the
   missing evidence are both visible.
3. **BLA biologics openFDA's drug/label endpoint does not carry** — evolocumab (Repatha)
   and inclisiran (Leqvio). Verified by querying both generic and brand name. Alirocumab
   (Praluent), by contrast, does resolve, so this is a per-product gap in the endpoint
   rather than a rule about biologics.

---

## UniTox

| | |
|---|---|
| Licence | CC BY 4.0 |
| Source | Zenodo record 14042913, `UniTox.csv` (42 MB, 2,418 rows) |
| DOI | <https://doi.org/10.5281/zenodo.14042913> |
| Retrieved | 2026-08-23 |
| Evidence ids | `unitox:<exact Generic Name row>` |

Row count verified on download: **2,418**, matching the published figure.

**What was taken.** The ternary rating (`Most` / `Less` / `No`) on each of the eight organ
toxicity axes — cardiotoxicity, dermatological, hematological, infertility, liver,
ototoxicity, pulmonary, renal. The per-drug free-text *reasoning* columns were **not** taken.

**How it is used.** A UniTox axis is cited as evidence for a `burdens` relation **only when
that axis is rated `Most` or `Less`**. The build resolves the citation automatically from
the rating, so a claim cannot be attached to a UniTox row that does not support it. Where a
row was matched but the relevant axis is rated `No`, the row is still written into
`sources[]` with all eight ratings recorded and a note reading *"Consulted, not cited"*.

**Matching policy.** Exact, case-insensitive match on the `Generic Name` column. Seven
entries were corrected to the dataset's own row form after inspection —
`PRAMLINTIDE ACETATE`, `MACIMORELIN ACETATE`, `SOMAPACITAN-BECO`, `SITAGLIPTIN`,
`EXENATIDE`, `BREMELANOTIDE`, `HYDROCORTISONE`. Near-misses for a *different* substance
were **not** accepted: nandrolone decanoate was left as a recorded gap rather than matched
to `Nandrolone phenpropionate`, and zinc and caffeine were left as gaps rather than matched
to `ZINC SULFATE` and `CAFFEINE CITRATE`, which are different preparations used for
different things.

**Where it returned nothing (54 lookups).** Dietary supplements and botanicals (creatine,
curcumin, ashwagandha, taurine, psyllium, tongkat ali, boron, inositol, melatonin,
berberine and others) are correctly absent — UniTox covers FDA-*approved drugs* only. So is
the entire research-chemical tier, and a handful of post-2024 approvals.

**Caveat carried into the data.** UniTox ratings were produced by GPT-4o reading FDA label
text. They are a machine reading of a label, not an independent clinical finding. This
catalog treats them as corroboration for a claim sourced elsewhere, never as the sole basis
for one — which is why no entry rests on a UniTox citation alone.

---

## DILIrank 2.0

| | |
|---|---|
| Licence | U.S. public domain (FDA / NCTR) |
| Source | `https://www.fda.gov/media/113052/download?attachment` (XLSX) |
| Landing page | <https://www.fda.gov/science-research/liver-toxicity-knowledge-base-ltkb/drug-induced-liver-injury-rank-dilirank-20-dataset> |
| Retrieved | 2026-08-23 |
| Evidence ids | `dilirank:<LTKBID>` |

Row count verified on parse: **1,336**, matching the published DILIrank 2.0 figure —
215 + 2 `vMost-DILI-concern`, 351 `vLess-DILI-concern`, 413 + 1 `vNo-DILI-concern`,
354 `Ambiguous-DILI-concern`. (The duplicated class labels are casing variants present in
the FDA spreadsheet itself; the parser preserves them as published rather than normalising
them away.)

**What was taken.** `LTKBID`, `CompoundName`, `SeverityClass` and `vDILI-Concern` for each
matched compound.

**How it is used.** A DILIrank row is cited as evidence for a hepatic `burdens` relation
**only when** its class is `vMost-DILI-concern` or `vLess-DILI-concern`. A `vNo-` or
`Ambiguous-` row is recorded in `sources[]` with its true classification and a note saying
it was consulted but does not support the claim.

**Where it returned nothing (34 lookups).** Mostly a coverage-window effect: DILIrank 2.0
covers drugs approved through 2021, so tirzepatide, dulaglutide, retatrutide, tesamorelin,
somapacitan, macimorelin and inclisiran are legitimately absent. The research-chemical tier
is absent for the obvious reason.

---

## LiverTox

| | |
|---|---|
| Licence | U.S. public domain (NIDDK) |
| Source | NCBI Bookshelf via E-utilities, `db=books` |
| Retrieved | 2026-08-23 |
| Evidence ids | `livertox:<NBK accession>` |

**How it was queried.** `esearch` with `"<name>"[Title] AND livertox[book]`, then `esummary`
on the returned UIDs, accepting a result **only** when `book == "livertox"` and the chapter
title matches the queried name exactly (case-insensitively). This is deliberately strict: a
fuzzy match would happily return a `References` or `Table` node from an unrelated book, and
citing one of those would be worse than citing nothing.

**What was taken.** The NBK accession as a stable citation and the factual hepatotoxicity
characterisation of the chapter, restated in our own words. **No chapter text is reproduced.**

**Where it returned nothing (48 lookups).** The research-chemical tier, most supplements,
and several compounds whose LiverTox chapter is filed under a class title rather than the
drug name. Rather than loosen the exact-title rule and risk a wrong citation, these were
left as recorded gaps.

---

## PubMed

| | |
|---|---|
| Licence recorded as | `own-curation` |
| Source | NCBI E-utilities, `db=pubmed` |
| Retrieved | 2026-08-23 |
| Evidence ids | `pubmed:<PMID>` |

Used only where no label exists — chiefly the peptide, research-chemical and supplement
tiers. For each such compound a relevance-sorted search was run and the top citations were
resolved through `esummary`; up to two PMIDs per compound are carried.

**Every PMID in this repository was resolved against the live NCBI API and verified to
exist, with its title and journal recorded.** None was written from memory. 54 substances
carry a PubMed citation; 1 lookup returned nothing.

**What was taken.** The PMID, article title, journal and publication date, as a pointer to
literature consulted. **No abstract or article text is reproduced.** The licence is recorded
as `own-curation` because the catalog value is our reading, not the publisher's material.

---

## The peptide tier — independently verified

The project brief asserted that BPC-157, TB-500/thymosin, CJC-1295, ipamorelin, sermorelin
and enclomiphene return zero rows in UniTox, DILIrank and DailyMed. **That was checked
against all four datasets rather than taken on trust, and it holds:**

| Compound | openFDA | UniTox | DILIrank | LiverTox | PubMed |
|---|---|---|---|---|---|
| BPC-157 | — | — | — | — | 3 |
| TB-500 | — | — | — | — | 3 |
| CJC-1295 | — | — | — | — | 3 |
| Ipamorelin | — | — | — | — | 3 |
| Sermorelin | — | — | — | — | 3 |
| Enclomiphene | — | — | — | — | 3 |

Every one of these entries therefore carries a non-`fda_approved` `regulatory_status`, an
explicit statement in its description that no FDA-approved product or labelling exists, a
`typical_dose_shape.note` stating that no approved dosing reference exists, and recorded
`source_gaps` for each dataset that returned nothing. `tests/catalog.test.mjs` enforces all
of this, so the tier cannot quietly acquire an approval claim later.

---

## Reproducing the source pulls

openFDA, LiverTox and PubMed lookups for a single compound:

```sh
node tools/fetch-evidence.mjs --name "Tirzepatide"
node tools/fetch-evidence.mjs --name "BPC-157" --pubmed "BPC 157 pentadecapeptide"
```

UniTox and DILIrank are bulk downloads and are **not** vendored into this repository — they
are large, and re-hosting them would add a redistribution obligation for no benefit:

```sh
mkdir -p sources   # gitignored
curl -L -o sources/UniTox.csv \
  "https://zenodo.org/api/records/14042913/files/UniTox.csv/content"
curl -L -o sources/dilirank.xlsx \
  "https://www.fda.gov/media/113052/download?attachment"
```

Then look the compound up in the `Generic Name` column (UniTox) or the `CompoundName`
column of the `version 2` sheet (DILIrank), and cite the **exact** row identity.

## Sources deliberately not used

WHO ATC (non-commercial only), DrugBank (closed), ChEMBL and DrugCentral (licensing
unresolved), SNOMED CT (excluded by the product spec) and LOINC (not retrieved; the app owns
that binding). bodyhackguide.co was used **only** as a coverage checklist of which compounds
to cover — no text, grouping, number, ordering or phrasing was taken from it. Rationale for
each is in [`ATTRIBUTION.md`](ATTRIBUTION.md#sources-deliberately-not-used).
