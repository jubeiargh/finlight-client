#!/usr/bin/env node
// Runs the live smoke tests (dev only). Needs FINLIGHT_API_KEY, FINLIGHT_BASE_URL, FINLIGHT_WSS_URL.
'use strict';
const { spawnSync } = require('child_process');
const missing = ['FINLIGHT_API_KEY', 'FINLIGHT_BASE_URL', 'FINLIGHT_WSS_URL'].filter((k) => !process.env[k]);
if (missing.length) {
  process.stderr.write(`live: set ${missing.join(', ')} (dev only; production hosts are refused)\n`);
  process.exit(1);
}
const res = spawnSync('npx', ['jest', '--config', 'jest.live.config.js', '--runInBand'], { stdio: 'inherit' });
process.exit(res.status ?? 1);
