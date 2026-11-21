// The program the harness runs (node22): it reads every case from
// /input/cases.json, answers each one alone with run() from solve.js, and
// writes /output/answers.json, one answer per case and in the cases' order.
// Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for
// /input and /output. V8's incremental marking is turned off before solve.js
// is imported, as the house baseline runs it.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

const mod = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};
const run = mod.run;

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const raw = readFileSync(join(inDir, 'cases.json'), 'utf8');
const list = JSON.parse(raw) as { id: string; input: unknown }[];
const out: unknown[] = new Array(list.length);
for (let i = 0; i < list.length; i++) out[i] = run(list[i].input);
writeFileSync(join(outDir, 'answers.json'), JSON.stringify(out));
