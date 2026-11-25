import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const KIT_DIR = join(__dirname, '..', '..', 'conformance');

export function kitPath(rel: string): string {
  return join(KIT_DIR, rel);
}

export function loadFixture<T = any>(rel: string): T {
  return JSON.parse(readFileSync(kitPath(rel), 'utf8')) as T;
}

export function listFixtures(dir: string): string[] {
  return readdirSync(kitPath(dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => `${dir}/${f}`);
}

export interface KitCase {
  id: string;
  title: string;
  fixture: string;
  expected: string;
}

/** Every numbered case of conformance.md. */
export function kitCases(): KitCase[] {
  const md = readFileSync(kitPath('conformance.md'), 'utf8');
  const cases: KitCase[] = [];
  for (const line of md.split('\n')) {
    const m = /^\| ([A-Z]-\d{2}) \| (.*?) \| `?(.*?)`? \| (.*) \|$/.exec(line);
    if (m) cases.push({ id: m[1], title: m[2], fixture: m[3], expected: m[4] });
  }
  return cases;
}

export function kitCase(id: string): KitCase {
  const c = kitCases().find((k) => k.id === id);
  if (!c) throw new Error(`no kit case ${id}`);
  return c;
}

/** Test name: "<case id> <case title>". */
export function caseName(id: string): string {
  return `${id} ${kitCase(id).title}`;
}

export const KIT_API_KEY = 'sk_0000000000000000000000000000000000000000000000000000000000000001';
