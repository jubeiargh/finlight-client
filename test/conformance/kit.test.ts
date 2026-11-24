import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { kitCases } from '../helpers/kit';

const root = join(__dirname, '..', '..');

describe('contract kit', () => {
  test('the vendored kit matches its MANIFEST checksums', () => {
    const out = execFileSync(process.execPath, [join(root, 'scripts', 'sync-conformance.js'), '--check'], {
      encoding: 'utf8',
    });
    expect(out).toMatch(/conformance: ok/);
  });

  test('every kit case has a test and the mapping table is current', () => {
    const out = execFileSync(process.execPath, [join(root, 'scripts', 'case-table.js'), '--check'], {
      encoding: 'utf8',
    });
    expect(out).toMatch(/case-table: ok/);
    expect(kitCases().length).toBeGreaterThanOrEqual(102);
  });
});
