#!/usr/bin/env node
/*
 * Vendors the finlight API v3 contract kit into ./conformance and checks it.
 *
 *   node scripts/sync-conformance.js                 copy from the default kit location
 *   node scripts/sync-conformance.js --from <dir>    copy from <dir> (or set FINLIGHT_CONTRACT_KIT)
 *   node scripts/sync-conformance.js --check         verify ./conformance against its MANIFEST
 *
 * The default location is the monorepo layout this repo is a submodule of:
 * <monorepo>/shared/ts/packages/finlight-client -> <monorepo>/shared/contracts/api-v3.
 *
 * A copy is only accepted when every file matches the sha256 in the kit's MANIFEST,
 * and the check fails when a file is missing, changed, or not listed.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'conformance');
const DEFAULT_SOURCE = path.resolve(ROOT, '..', '..', '..', 'contracts', 'api-v3');

function fail(message) {
  process.stderr.write(`conformance: ${message}\n`);
  process.exit(1);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readManifest(dir) {
  const file = path.join(dir, 'MANIFEST');
  if (!fs.existsSync(file)) fail(`no MANIFEST in ${dir}`);
  const entries = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (!match) fail(`bad MANIFEST line: ${line}`);
    entries.set(match[2], match[1]);
  }
  if (!entries.has('CONTRACT_VERSION')) fail('MANIFEST does not list CONTRACT_VERSION');
  return entries;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function verify(dir) {
  const manifest = readManifest(dir);
  const problems = [];
  for (const [rel, hash] of manifest) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) problems.push(`missing ${rel}`);
    else if (sha256(file) !== hash) problems.push(`checksum mismatch ${rel}`);
  }
  for (const rel of listFiles(dir)) {
    if (rel !== 'MANIFEST' && !manifest.has(rel)) problems.push(`not in MANIFEST ${rel}`);
  }
  return { manifest, problems };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check')) {
    if (!fs.existsSync(TARGET)) fail('./conformance does not exist; run npm run conformance:sync');
    const { manifest, problems } = verify(TARGET);
    if (problems.length) fail(`./conformance does not match its MANIFEST:\n  ${problems.join('\n  ')}`);
    const version = fs.readFileSync(path.join(TARGET, 'CONTRACT_VERSION'), 'utf8').trim();
    process.stdout.write(`conformance: ok, contract ${version}, ${manifest.size} files\n`);
    return;
  }

  const fromIndex = args.indexOf('--from');
  const source = path.resolve(
    fromIndex >= 0 ? args[fromIndex + 1] || '' : process.env.FINLIGHT_CONTRACT_KIT || DEFAULT_SOURCE,
  );
  if (!fs.existsSync(source)) fail(`kit not found at ${source}; pass --from <dir> or set FINLIGHT_CONTRACT_KIT`);

  const { manifest, problems } = verify(source);
  if (problems.length) fail(`the kit at ${source} does not match its own MANIFEST:\n  ${problems.join('\n  ')}`);

  fs.rmSync(TARGET, { recursive: true, force: true });
  for (const rel of [...manifest.keys(), 'MANIFEST']) {
    const dest = path.join(TARGET, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(source, rel), dest);
  }
  const after = verify(TARGET);
  if (after.problems.length) fail(`copy failed:\n  ${after.problems.join('\n  ')}`);
  const version = fs.readFileSync(path.join(TARGET, 'CONTRACT_VERSION'), 'utf8').trim();
  process.stdout.write(`conformance: synced contract ${version} (${manifest.size} files) from ${source}\n`);
}

main();
