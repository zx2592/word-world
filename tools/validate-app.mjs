import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
assert.ok(script, 'index.html should contain an inline script');

new vm.Script(script, { filename: 'index-inline.js' });

const dataScript = script.match(/const D=\[[\s\S]*?;\s*\n\s*const RT=\[[\s\S]*?\];/)?.[0];
assert.ok(dataScript, 'word data should be extractable');

const sandbox = {};
vm.createContext(sandbox);
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
}

assert.ok(html.includes('复习提醒'), 'UI should include adaptive review reminders');
assert.ok(html.includes('同义词'), 'flashcards should render synonyms');
assert.ok(html.includes('反义词'), 'flashcards should render antonyms');
assert.ok(html.includes('visual-card'), 'flashcards should render visual image cards');

console.log(`Validated ${sandbox.D.length} words and ${sandbox.RT.length} root-map nodes.`);
