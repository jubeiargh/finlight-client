#!/usr/bin/env node
/*
 * package.json is the single source of the SDK version.
 * This script writes it into src/version.ts and jsr.json.
 *   node scripts/sync-version.js           write both files
 *   node scripts/sync-version.js --check   fail if either file is out of date
 *   node scripts/sync-version.js --tag v4.0.0   also fail unless the tag equals the version
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const versionFile = path.join(root, 'src', 'version.ts');
const jsrFile = path.join(root, 'jsr.json');

const versionSource =
  '// Generated from package.json by scripts/sync-version.js. Do not edit.\n' +
  `export const VERSION = '${version}';\n`;
const jsr = JSON.parse(fs.readFileSync(jsrFile, 'utf8'));
jsr.version = version;
const jsrSource = JSON.stringify(jsr, null, 2) + '\n';

const args = process.argv.slice(2);
const tagIndex = args.indexOf('--tag');
if (tagIndex >= 0) {
  const tag = (args[tagIndex + 1] || '').replace(/^refs\/tags\//, '');
  if (tag !== `v${version}` && tag !== version) {
    process.stderr.write(`version: tag ${tag} does not match package.json ${version}\n`);
    process.exit(1);
  }
}
if (args.includes('--check')) {
  const current = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8') : '';
  if (current !== versionSource || fs.readFileSync(jsrFile, 'utf8') !== jsrSource) {
    process.stderr.write('version: src/version.ts or jsr.json is out of date; run npm run version:sync\n');
    process.exit(1);
  }
  process.stdout.write(`version: ok (${version})\n`);
} else {
  fs.writeFileSync(versionFile, versionSource);
  fs.writeFileSync(jsrFile, jsrSource);
  process.stdout.write(`version: wrote ${version}\n`);
}
