#!/usr/bin/env node
/*
 * R-PKG-1: lists what `npm pack` would publish and fails when test data, local files or
 * secrets would ship. Run after `npm run build`.
 */
'use strict';
const { execFileSync } = require('child_process');

const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' });
const [info] = JSON.parse(out);
const files = info.files.map((f) => f.path);
const forbidden = [/^conformance\//, /^local\//, /^test\//, /^examples\//, /^src\//, /^scripts\//, /\.env/, /test\.ts$/, /testWs/, /\.tsbuildinfo$/];
const bad = files.filter((f) => forbidden.some((re) => re.test(f)));
const required = ['package.json', 'dist/index.js', 'dist/index.d.ts', 'README.md', 'CHANGELOG.md'];
const missing = required.filter((f) => !files.includes(f));
process.stdout.write(`${info.name}@${info.version}: ${files.length} files\n${files.map((f) => `  ${f}`).join('\n')}\n`);
if (bad.length || missing.length) {
  if (bad.length) process.stderr.write(`pack: must not publish:\n  ${bad.join('\n  ')}\n`);
  if (missing.length) process.stderr.write(`pack: missing:\n  ${missing.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write('pack: ok\n');
