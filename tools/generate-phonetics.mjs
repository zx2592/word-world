// Generates data/phonetics.js: a { word -> /IPA/ } map for every word in the
// bundled data sources. Real IPA is fetched from dictionaryapi.dev (cached so
// re-runs are cheap); words the dictionary lacks fall back to a rule-based
// grapheme-to-phoneme approximation so no card is ever left without a phonetic.
//
// Usage: node tools/generate-phonetics.mjs

import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const dataFiles = ['data/workshop-orange.js', 'data/harkness-words.js', 'data/image-words.js'];
const cachePath = new URL('tools/.phonetics-cache.json', root);
const outPath = new URL('data/phonetics.js', root);

// --- collect every unique word from the data sources ---
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of dataFiles) {
  vm.runInContext(fs.readFileSync(new URL(f, root), 'utf8'), sandbox);
}
const sources = [
  ...(sandbox.window.WORKSHOP_ORANGE || []),
  ...(sandbox.window.HARKNESS_WORDS || []),
  ...(sandbox.window.IMAGE_WORDS || []),
];
const words = [...new Set(sources.map((e) => e.w).filter(Boolean))].sort();
console.log(`Collected ${words.length} unique words from ${dataFiles.length} sources.`);

// --- resumable cache ---
let cache = {};
try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}

// --- rule-based fallback grapheme-to-phoneme (approximate, no stress marks) ---
function approxIPA(raw) {
  let s = String(raw).toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return `/${raw}/`;
  // drop a silent trailing 'e' (rule, keep, lake) unless the word is tiny
  const silentE = s.length > 3 && s.endsWith('e') && !/[aeiou]e$/.test(s) && !s.endsWith('ee');
  if (silentE) s = s.slice(0, -1);
  const digraphs = [
    ['tch', 'tʃ'], ['sch', 'sk'], ['shi', 'ʃi'],
    ['sh', 'ʃ'], ['ch', 'tʃ'], ['th', 'θ'], ['ph', 'f'], ['wh', 'w'],
    ['ck', 'k'], ['ng', 'ŋ'], ['qu', 'kw'], ['gh', ''],
    ['ee', 'iː'], ['ea', 'iː'], ['oo', 'uː'], ['oa', 'oʊ'], ['oe', 'oʊ'],
    ['ai', 'eɪ'], ['ay', 'eɪ'], ['ei', 'eɪ'], ['ey', 'eɪ'],
    ['ie', 'aɪ'], ['igh', 'aɪ'], ['oi', 'ɔɪ'], ['oy', 'ɔɪ'],
    ['ou', 'aʊ'], ['ow', 'aʊ'], ['au', 'ɔː'], ['aw', 'ɔː'],
    ['ar', 'ɑːr'], ['er', 'ər'], ['ir', 'ɜːr'], ['or', 'ɔːr'], ['ur', 'ɜːr'],
    ['tion', 'ʃən'], ['sion', 'ʒən'], ['ture', 'tʃər'], ['ous', 'əs'],
  ];
  const single = {
    a: 'æ', e: 'ɛ', i: 'ɪ', o: 'ɒ', u: 'ʌ', y: 'i',
    b: 'b', c: 'k', d: 'd', f: 'f', g: 'ɡ', h: 'h', j: 'dʒ', k: 'k',
    l: 'l', m: 'm', n: 'n', p: 'p', q: 'k', r: 'r', s: 's', t: 't',
    v: 'v', w: 'w', x: 'ks', z: 'z',
  };
  let out = '';
  for (let i = 0; i < s.length; ) {
    // soft c / g before e, i, y
    const ch = s[i];
    const next = s[i + 1];
    if (ch === 'c' && 'eiy'.includes(next)) { out += 's'; i += 1; continue; }
    if (ch === 'g' && 'eiy'.includes(next)) { out += 'dʒ'; i += 1; continue; }
    let matched = false;
    for (const [seq, rep] of digraphs) {
      if (s.startsWith(seq, i)) { out += rep; i += seq.length; matched = true; break; }
    }
    if (matched) continue;
    out += single[ch] ?? ch;
    i += 1;
  }
  return `/${out}/`;
}

// --- dictionary API lookup ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseIPA(data) {
  for (const entry of Array.isArray(data) ? data : []) {
    if (entry.phonetic && /[ˈˌːɪʊəæɛɒɑʌθðʃʒŋ]/.test(entry.phonetic)) {
      return entry.phonetic.replace(/^\/?/, '/').replace(/\/?$/, '/');
    }
    for (const p of entry.phonetics || []) {
      if (p.text && p.text.trim()) {
        return p.text.replace(/^\/?/, '/').replace(/\/?$/, '/');
      }
    }
  }
  return null;
}

// Returns { status: 'ok', ipa } | { status: 'notfound' } | { status: 'retry' }.
// 429 / network errors back off and retry; only definitive results are cached.
async function fetchIPA(word) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.status === 429) { await sleep(1500 * (attempt + 1) + Math.random() * 1000); continue; }
      if (res.status === 404) return { status: 'notfound' };
      if (!res.ok) { await sleep(800 * (attempt + 1)); continue; }
      const ipa = parseIPA(await res.json());
      return ipa ? { status: 'ok', ipa } : { status: 'notfound' };
    } catch {
      await sleep(800 * (attempt + 1));
    }
  }
  return { status: 'retry' };
}

// --- run passes with bounded concurrency until nothing retryable remains ---
const CONCURRENCY = 5;
let done = 0;
let saveTick = 0;
async function worker(queue, retryBucket, total) {
  while (queue.length) {
    const w = queue.pop();
    const r = await fetchIPA(w);
    if (r.status === 'retry') { retryBucket.push(w); }
    else { cache[w] = { ipa: r.ipa || null, src: r.ipa ? 'dict' : 'approx' }; }
    done += 1;
    if (++saveTick % 100 === 0) {
      fs.writeFileSync(cachePath, JSON.stringify(cache));
      console.log(`  ${done}/${total} processed (this pass)...`);
    }
  }
}

let pending = words.filter((w) => !(w in cache));
console.log(`${words.length - pending.length} cached, ${pending.length} to fetch.`);
for (let pass = 1; pending.length && pass <= 6; pass += 1) {
  done = 0;
  const total = pending.length;
  console.log(`Pass ${pass}: ${total} words (concurrency ${CONCURRENCY})...`);
  const retryBucket = [];
  const queue = [...pending];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue, retryBucket, total)));
  fs.writeFileSync(cachePath, JSON.stringify(cache));
  if (retryBucket.length) { await sleep(5000); }
  pending = retryBucket;
}
if (pending.length) console.log(`${pending.length} words exhausted retries; using approximation.`);

// --- build the final map (real IPA where available, else approximation) ---
const map = {};
let dictCount = 0;
let approxCount = 0;
for (const w of words) {
  const hit = cache[w];
  if (hit && hit.ipa) { map[w] = hit.ipa; dictCount += 1; }
  else { map[w] = approxIPA(w); approxCount += 1; }
}

const banner =
  '// Generated by tools/generate-phonetics.mjs — do not edit by hand.\n' +
  `// ${dictCount} dictionary IPA + ${approxCount} rule-based approximations = ${words.length} words.\n`;
const body = words.map((w) => `  ${JSON.stringify(w)}: ${JSON.stringify(map[w])}`).join(',\n');
fs.writeFileSync(outPath, `${banner}window.PHONETICS = {\n${body}\n};\n`);
console.log(`Wrote ${words.length} phonetics (${dictCount} dict, ${approxCount} approx) to data/phonetics.js`);
