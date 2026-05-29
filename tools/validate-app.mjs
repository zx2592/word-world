import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const workshopScript = fs.readFileSync(new URL('../data/workshop-orange.js', import.meta.url), 'utf8');
const harknessScript = fs.readFileSync(new URL('../data/harkness-words.js', import.meta.url), 'utf8');
const imageScript = fs.readFileSync(new URL('../data/image-words.js', import.meta.url), 'utf8');
const phoneticsScript = fs.readFileSync(new URL('../data/phonetics.js', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
assert.ok(script, 'index.html should contain an inline script');

new vm.Script(script, { filename: 'index-inline.js' });

const dataScript = script.match(/const D=\[[\s\S]*?;\s*\n\s*const RT=\[[\s\S]*?\];/)?.[0];
assert.ok(dataScript, 'word data should be extractable');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(workshopScript, sandbox);
vm.runInContext(harknessScript, sandbox);
vm.runInContext(imageScript, sandbox);
vm.runInContext(phoneticsScript, sandbox);
vm.runInContext(dataScript + '\nthis.D=D; this.RT=RT;', sandbox);

const requiredWords = [
  'adopt', 'agile', 'analyze', 'assist', 'babble', 'captivity', 'drab', 'fatal',
  'generosity', 'illegal', 'merit', 'approximate', 'construct', 'crude',
  'decline', 'distinct', 'evident', 'impulse', 'interpret', 'orient', 'sector',
  'submit', 'zest', 'adorn', 'appropriate', 'assemble', 'colossal', 'effective',
  'exaggerate', 'indifferent', 'jubilant', 'manual', 'originate', 'recognition',
  'tribute', 'frail', 'hostage', 'landslide', 'rampage', 'scamper', 'symptom',
  'warrant', 'abide', 'contrast', 'depress', 'dismal', 'dispose'
];

for (const word of requiredWords) {
  assert.ok(sandbox.D.some((entry) => entry.w === word), `missing word: ${word}`);
}

for (const entry of sandbox.D) {
  assert.ok(entry.img, `${entry.w} should include an image/visual cue`);
  assert.ok(Array.isArray(entry.syn) && entry.syn.length > 0, `${entry.w} should include synonyms`);
  assert.ok(Array.isArray(entry.ant) && entry.ant.length > 0, `${entry.w} should include antonyms`);
  assert.ok(entry.rev, `${entry.w} should include review metadata`);
  assert.ok(typeof entry.ph === 'string' && entry.ph.trim().length > 0, `${entry.w} should include a phonetic`);
}

assert.ok(html.includes('复习提醒'), 'UI should include adaptive review reminders');
assert.ok(html.includes('同义词'), 'flashcards should render synonyms');
assert.ok(html.includes('反义词'), 'flashcards should render antonyms');
assert.ok(html.includes('visual-card'), 'flashcards should render visual image cards');
assert.ok(html.includes('同义词练习'), 'UI should include the synonym exercise module');
assert.ok(html.includes('反义词练习'), 'UI should include the antonym exercise module');
assert.ok(script.includes('function lexWords(type){return gF().filter'), 'lexical exercises should honor the selected library filter');
assert.ok(script.includes("if(active==='s-qz')initQ()"), 'changing library should refresh quiz questions');
assert.ok(script.includes("if(active==='s-syn')initLex('syn')"), 'changing library should refresh synonym questions');
assert.ok(script.includes("if(active==='s-ant')initLex('ant')"), 'changing library should refresh antonym questions');
assert.ok(html.includes('gateWrap'), 'UI should include a simple entry password gate');
assert.ok(html.includes("PASS='mtty'"), 'password gate should check the requested password');
assert.ok(sandbox.window.WORKSHOP_ORANGE.length >= 150, 'PDF extraction should provide the broader book vocabulary');
assert.ok(sandbox.window.HARKNESS_WORDS.length >= 1000, 'Harkness PDF extraction should provide the broader custom vocabulary');
assert.ok(sandbox.window.IMAGE_WORDS.length >= 45, 'image extraction should provide the manually verified image vocabulary');
for (const word of ['humidity', 'fretful', 'barrage', 'tyrannical', 'herculean', 'belligerent']) {
  assert.ok(sandbox.D.some((entry) => entry.w === word), `missing custom word: ${word}`);
}
for (const word of ['humidity', 'herculean', 'belligerent']) {
  assert.equal(sandbox.D.find((entry) => entry.w === word)?.c, 'il', `image word should be ISEE Lower: ${word}`);
}
for (const word of ['abandon', 'abbreviate', 'hypothesis']) {
  assert.equal(sandbox.D.find((entry) => entry.w === word)?.c, 'iu', `PDF word should be ISEE Upper: ${word}`);
}
assert.ok(sandbox.D.length >= 180, 'app should merge the broader book vocabulary into the runtime word database');

const counts = sandbox.D.reduce((acc, entry) => {
  acc[entry.c] = (acc[entry.c] || 0) + 1;
  return acc;
}, {});
console.log(`Validated ${sandbox.D.length} words and ${sandbox.RT.length} root-map nodes.`);
console.log(`Category counts: ${JSON.stringify(counts)}`);
