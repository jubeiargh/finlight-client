#!/usr/bin/env node
/*
 * Builds README.md and its translations from one skeleton (docs/readme/template.md) and one
 * string table per language (docs/readme/<lang>.json). Code blocks live in the skeleton, so
 * every language shows the same code and the same section order.
 *   node scripts/build-readmes.js           write the READMEs
 *   node scripts/build-readmes.js --check   fail when a README is stale, a string is missing,
 *                                           or the version table is gone
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'docs', 'readme');
const LANGS = [
  { code: 'en', file: 'README.md', label: 'English' },
  { code: 'zh-CN', file: 'README.zh-CN.md', label: '简体中文' },
  { code: 'ja', file: 'README.ja.md', label: '日本語' },
  { code: 'ko', file: 'README.ko.md', label: '한국어' },
];

const template = fs.readFileSync(path.join(dir, 'template.md'), 'utf8');
const keys = [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
const problems = [];

function render(lang) {
  const strings = JSON.parse(fs.readFileSync(path.join(dir, `${lang.code}.json`), 'utf8'));
  strings.langLinks = `*${LANGS.map((l) => (l.code === lang.code ? l.label : `[${l.label}](${l.file})`)).join(' | ')}*`;
  for (const key of keys) {
    if (!(key in strings)) problems.push(`${lang.code}: missing "${key}"`);
  }
  for (const key of Object.keys(strings)) {
    if (key !== 'langLinks' && !keys.includes(key)) problems.push(`${lang.code}: unused "${key}"`);
  }
  let out = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = strings[key];
    return Array.isArray(value) ? value.join('\n') : (value ?? '');
  });
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}

const headings = (md) => outsideCode(md).length;
// sdk-style.md section 10: README.md has exactly these headings, in this order.
const SKELETON = [
  '# finlight client for TypeScript',
  '## Versions',
  '## Requirements',
  '## Installation',
  '## Quick start',
  '## Search articles',
  '## Look up articles, companies and sources',
  '## Absent, null and empty',
  '## Real-time streams',
  '## Webhooks',
  '## Errors and retries',
  '## Configuration',
  '## Logging',
  '## Data notes',
  '## Migrating from 3.x',
  '## Development',
  '## License',
];
function outsideCode(md) {
  let inCode = false;
  return md.split('\n').filter((l) => {
    if (l.startsWith('```')) inCode = !inCode;
    return !inCode && /^#{1,3} /.test(l);
  });
}
const check = process.argv.includes('--check');
let reference = null;
for (const lang of LANGS) {
  const md = render(lang);
  if (!/\| 4\.x \| v3 /.test(md)) problems.push(`${lang.file}: version table missing`);
  if (!/\| SDK version \| API version \| Status \|/.test(md) && lang.code === 'en') problems.push('README.md: version table header');
  if (!md.includes('> **Breaking release.**')) problems.push(`${lang.file}: breaking notice missing`);
  if (lang.code === 'en' && JSON.stringify(outsideCode(md)) !== JSON.stringify(SKELETON)) {
    problems.push(`README.md headings differ from the skeleton: ${JSON.stringify(outsideCode(md))}`);
  }
  if (reference === null) reference = headings(md);
  else if (headings(md) !== reference) problems.push(`${lang.file}: heading structure differs from README.md`);
  const target = path.join(root, lang.file);
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== md) problems.push(`${lang.file} is stale`);
  } else {
    fs.writeFileSync(target, md);
  }
}
if (problems.length) {
  process.stderr.write(`readme: ${problems.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write(`readme: ${check ? 'ok' : 'wrote'} ${LANGS.map((l) => l.file).join(', ')}\n`);
