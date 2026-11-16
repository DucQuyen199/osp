import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'client', 'src');
const globalDictionaryPath = path.join(root, 'client', 'src', 'lib', 'ui.en.js');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function decodeString(raw) {
  return raw.replace(/\\u\{([\da-f]{1,6})\}|\\u([\da-f]{4})|\\x([\da-f]{2})|\\([\\'"/bfnrtv])/gi, (match, codePoint, unicode, hex, escaped) => {
    if (codePoint) return String.fromCodePoint(Number.parseInt(codePoint, 16));
    if (unicode) return String.fromCharCode(Number.parseInt(unicode, 16));
    if (hex) return String.fromCharCode(Number.parseInt(hex, 16));
    return ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' })[escaped] ?? escaped;
  });
}

function stringsMatching(source, expression) {
  return [...source.matchAll(expression)].map((match) => decodeString(match[2]));
}

function dictionaryKeys(source) {
  return new Set([
    ...stringsMatching(source, /(['"])((?:\\.|(?!\1)[\s\S])*)\1\s*:/g),
  ]);
}

function callStrings(source, name) {
  return stringsMatching(source, new RegExp(`\\b${name}\\(\\s*(['"])((?:\\\\.|(?!\\1)[\\s\\S])*)\\1\\s*\\)`, 'g'));
}

function addMissing(missing, file, key, dictionaries) {
  if (!dictionaries.some((dictionary) => dictionary.has(key))) {
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    const entries = missing.get(relative) || new Set();
    entries.add(key);
    missing.set(relative, entries);
  }
}

const globalSource = fs.readFileSync(globalDictionaryPath, 'utf8');
const globalKeys = dictionaryKeys(globalSource);
const missing = new Map();

for (const file of walk(sourceRoot).filter((candidate) => candidate.endsWith('.jsx'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const key of callStrings(source, 'uiText')) addMissing(missing, file, key, [globalKeys]);

  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  const hasVietnamese = (value) => /[À-ỹĐđ]/u.test(value);
  for (const match of source.matchAll(/\b(?:placeholder|aria-label|title|alt)\s*=\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1/g)) {
    if (hasVietnamese(decodeString(match[2]))) {
      const entries = missing.get(relative) || new Set();
      entries.add(`Untranslated literal attribute: ${decodeString(match[2])}`);
      missing.set(relative, entries);
    }
  }
  for (const match of source.matchAll(/document\.title\s*=\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1/g)) {
    if (hasVietnamese(decodeString(match[2]))) {
      const entries = missing.get(relative) || new Set();
      entries.add(`Untranslated document title: ${decodeString(match[2])}`);
      missing.set(relative, entries);
    }
  }

  const imports = [...source.matchAll(/import\s+(\w+)\s+from\s+['"](\.\/[^'"]+\.en\.js)['"]/g)];
  for (const [, name, relativePath] of imports) {
    if (!source.includes(`uiTextWith(text, ${name})`)) continue;
    const dictionaryPath = path.resolve(path.dirname(file), relativePath);
    if (!fs.existsSync(dictionaryPath)) continue;
    const featureKeys = dictionaryKeys(fs.readFileSync(dictionaryPath, 'utf8'));
    for (const key of callStrings(source, 't')) addMissing(missing, file, key, [featureKeys, globalKeys]);
  }

  const inlineDictionary = source.match(/uiTextWith\(text,\s*\{([\s\S]*?)\}\s*\)/);
  if (inlineDictionary) {
    const inlineKeys = dictionaryKeys(inlineDictionary[1]);
    for (const key of callStrings(source, 't')) addMissing(missing, file, key, [inlineKeys, globalKeys]);
  }
}

if (missing.size) {
  for (const [file, keys] of missing) {
    console.error(`${file}:`);
    for (const key of keys) console.error(`  Missing English translation: ${JSON.stringify(key)}`);
  }
  process.exitCode = 1;
} else {
  console.log(`English translation key coverage is complete for ${globalKeys.size} shared keys and feature screens.`);
}
