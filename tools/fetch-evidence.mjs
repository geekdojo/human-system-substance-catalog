#!/usr/bin/env node
// Resolve evidence ids for one substance against the clean sources, so that adding a row
// never means inventing a citation.
//
//   node tools/fetch-evidence.mjs --name "Tirzepatide"
//   node tools/fetch-evidence.mjs --name "Semaglutide" --pubmed "semaglutide lean mass"
//   node tools/fetch-evidence.mjs --name "BPC-157" --json
//
// Queries openFDA (drug/label) and NCBI E-utilities (LiverTox chapters, PubMed) live.
// UniTox and DILIrank are bulk downloads and are NOT fetched here; the URLs to obtain
// them are printed so you can look the compound up yourself. See docs/SOURCES.md.
//
// A miss is reported as a miss. If this tool says "no rows", record a source_gaps entry
// in the data file — do not substitute a near-miss row for a different salt or ester.

import { argv, exit } from 'node:process';

const arg = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const asJson = argv.includes('--json');
const name = arg('name');
const pubmedTerm = arg('pubmed');
const RETRIEVED = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!name) {
  console.error('usage: node tools/fetch-evidence.mjs --name "<generic name>" [--pubmed "<query>"] [--json]');
  exit(2);
}

async function getJSON(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'substance-catalog/1.0' } });
      if (r.status === 404) return null;
      if (r.ok) return await r.json();
      await sleep(1500 * (attempt + 1));
    } catch { await sleep(1500 * (attempt + 1)); }
  }
  return null;
}

/** openFDA drug/label. Tries generic name, then substance name, then brand name. */
export async function findLabel(term) {
  for (const field of ['openfda.generic_name', 'openfda.substance_name', 'openfda.brand_name']) {
    const j = await getJSON(`https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`${field}:"${term}"`)}&limit=1`);
    const r = j?.results?.[0];
    if (r) {
      return {
        matched_on: field,
        evidence_id: `openfda:${r.set_id || r.id}`,
        set_id: r.set_id || r.id,
        brand: r.openfda?.brand_name?.[0] ?? null,
        generic: r.openfda?.generic_name?.[0] ?? null,
        effective_time: r.effective_time ?? null,
        total_matches: j.meta?.results?.total ?? 1,
        url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${r.set_id || r.id}`,
        license: 'CC0-1.0',
      };
    }
    await sleep(300);
  }
  return null;
}

/** LiverTox chapter, matched on an EXACT chapter title so a near-miss is never returned. */
export async function findLiverTox(title) {
  const s = await getJSON(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=books&term=${encodeURIComponent(`"${title}"[Title] AND livertox[book]`)}&retmode=json&retmax=5`);
  const ids = s?.esearchresult?.idlist ?? [];
  if (!ids.length) return null;
  await sleep(360);
  const sum = await getJSON(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=books&id=${ids.join(',')}&retmode=json`);
  for (const uid of sum?.result?.uids ?? []) {
    const r = sum.result[uid];
    if (r.book === 'livertox' && r.title?.trim().toLowerCase() === title.trim().toLowerCase()) {
      return {
        evidence_id: `livertox:${r.accessionid}`,
        title: r.title,
        url: `https://www.ncbi.nlm.nih.gov/books/${r.accessionid}/`,
        license: 'public-domain',
      };
    }
  }
  return null;
}

/** PubMed citations. PMIDs identify literature consulted; no text is reproduced. */
export async function findPubMed(term, retmax = 3) {
  const s = await getJSON(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmode=json&retmax=${retmax}&sort=relevance`);
  const ids = s?.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  await sleep(360);
  const sum = await getJSON(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`);
  return (sum?.result?.uids ?? []).map(uid => {
    const r = sum.result[uid];
    return {
      evidence_id: `pubmed:${uid}`,
      title: r.title,
      journal: r.source,
      pubdate: r.pubdate,
      url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
      license: 'own-curation',
    };
  });
}

const result = {
  queried: name,
  retrieved: RETRIEVED,
  openfda_spl: await findLabel(name),
  livertox: await findLiverTox(name),
  pubmed: pubmedTerm ? await findPubMed(pubmedTerm) : [],
  bulk_sources_not_fetched: {
    unitox: 'https://doi.org/10.5281/zenodo.14042913 — download UniTox.csv and look up the Generic Name column. Cite as unitox:<EXACT ROW NAME>.',
    dilirank: 'https://www.fda.gov/science-research/liver-toxicity-knowledge-base-ltkb/drug-induced-liver-injury-rank-dilirank-20-dataset — cite as dilirank:<LTKBID>, and only when the class is vMost- or vLess-DILI-concern.',
  },
};

if (asJson) { console.log(JSON.stringify(result, null, 2)); exit(0); }

console.log(`\nevidence for "${name}"  (retrieved ${RETRIEVED})\n`);
if (result.openfda_spl) {
  const f = result.openfda_spl;
  console.log(`  openFDA SPL   ${f.evidence_id}`);
  console.log(`                matched on ${f.matched_on}; ${f.brand ?? '?'} / ${f.generic ?? '?'}; effective ${f.effective_time ?? '?'}; ${f.total_matches} label(s)`);
  console.log(`                ${f.url}   [CC0-1.0]`);
} else {
  console.log(`  openFDA SPL   NO ROWS — record { "source": "openfda_spl", "queried": "${name}", "result": "no_rows" } in source_gaps`);
}
if (result.livertox) {
  console.log(`  LiverTox      ${result.livertox.evidence_id}  "${result.livertox.title}"`);
  console.log(`                ${result.livertox.url}   [public-domain]`);
} else {
  console.log(`  LiverTox      NO ROWS — record a source_gaps entry`);
}
if (pubmedTerm) {
  if (result.pubmed.length) {
    console.log(`  PubMed        ${result.pubmed.length} citation(s) for "${pubmedTerm}"`);
    for (const p of result.pubmed) console.log(`                ${p.evidence_id}  ${p.journal} ${p.pubdate} — ${p.title}`);
  } else {
    console.log(`  PubMed        NO ROWS for "${pubmedTerm}"`);
  }
}
console.log(`\n  UniTox and DILIrank are bulk downloads — look the compound up yourself:`);
console.log(`    UniTox   ${result.bulk_sources_not_fetched.unitox}`);
console.log(`    DILIrank ${result.bulk_sources_not_fetched.dilirank}`);
console.log(`\n  Do not substitute a near-miss row for a different salt or ester. A miss is a source_gap.\n`);
