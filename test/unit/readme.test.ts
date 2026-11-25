import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';

// R-DOCS-1: the TypeScript blocks of README.md (shared by every translation) type-check against the SDK.
const ROOT = join(__dirname, '..', '..');

const PRELUDE = `
import type { Article } from 'finlight-client';
import { FinlightClient } from 'finlight-client';
declare const client: FinlightClient;
declare const article: Article;
declare const queue: { push(x: unknown): void };
`;

test('README code blocks type-check', () => {
  const md = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const blocks = [...md.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]);
  expect(blocks.length).toBeGreaterThan(5);
  const dir = mkdtempSync(join(tmpdir(), 'finlight-readme-'));
  try {
    // A minimal Express shape: enough to check that req.body (Buffer) and req.headers fit constructEvent.
    writeFileSync(
      join(dir, 'express.d.ts'),
      `declare module 'express' {
  type Req = { body: Buffer; headers: import('node:http').IncomingHttpHeaders };
  type Res = { sendStatus(code: number): unknown };
  interface App { post(path: string, mw: unknown, handler: (req: Req, res: Res) => unknown): void }
  interface Express { (): App; raw(options: { type: string }): unknown }
  const e: Express;
  export default e;
}
`,
    );
    const files = blocks.map((block, i) => {
      const lines = block.split('\n');
      const imports = lines.filter((l) => /^import /.test(l));
      const body = lines.filter((l) => !/^import /.test(l)).join('\n');
      const usesOwnClient = /const client = new FinlightClient/.test(body);
      const prelude = PRELUDE.split('\n')
        .filter((l) => !(usesOwnClient && /declare const client/.test(l)))
        .filter(
          (l) =>
            !imports.some((imp) => /\bFinlightClient\b/.test(imp)) || !/^import \{ FinlightClient \}/.test(l),
        )
        .join('\n');
      const file = join(dir, `block${i}.ts`);
      writeFileSync(
        file,
        `${imports.join('\n')}\n${prelude}\nexport async function run${i}(): Promise<void> {\n${body}\n}\n`,
      );
      return file;
    });
    const program = ts.createProgram([...files, join(dir, 'express.d.ts')], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      skipLibCheck: true,
      types: ['node'],
      typeRoots: [join(ROOT, 'node_modules', '@types')],
      baseUrl: ROOT,
      paths: { 'finlight-client': ['src/index.ts'] },
      noUnusedLocals: false,
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file && files.includes(d.file.fileName))
      .map(
        (d) =>
          `${d.file!.fileName.split('/').pop()}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
      );
    expect(diagnostics).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
