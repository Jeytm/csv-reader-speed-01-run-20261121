# csv-reader-speed-01-run-20261121 — a faster csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Jeytm/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Jeytm/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for [make.fun](https://make.fun/bounty/csv-reader-speed-01-run-20261121)'s own csv-reader 1.0.0: `solve.js` answers exactly as the reference does on every case — same `{columns, rows, errors}` for every broken row (stray CRs, unterminated quotes, quote junk, short and long rows, BOM, CRLF and lone CRs inside quotes) — but in a fraction of the CPU time.

## How it is faster

The reference reads one character at a time and builds every field up a character at a time. This reader instead:

- jumps from delimiter to delimiter with the engine's own regex search and takes each field's text as one slice;
- takes a whole record in one `split(',')` when its first line holds no quote and no stray CR (about a fifth of records), falling back to the field scanner otherwise;
- handles quoted fields by finding the closing quote with `indexOf` (a quote that is not doubled), taking the content as one slice, and only touching it again when it holds `""` escapes or line breaks;
- writes the unquoted-field result into shared slots instead of returning a fresh object per field, so the hot path allocates nothing but the field strings themselves.

Nothing is cached across cases and no input is skipped: every case is read fully, left to right, under the reference's own policy.

## Correctness

- Practice set from the kit: **6/6 cases identical** to the reference and to the kit's `expected.json`; the driver output `answers.json` is **byte-identical** to the reference's.
- **3 fresh sets drawn with the kit's own generator** (3 different seeds, 18 cases): **18/18 identical** to the oracle.
- **3,098 fuzz cases** (random raw text from a nasty alphabet, structured records with every broken kind, and hand-picked edge cases): **0 mismatches** against the reference.

## Speed (same machine, CPU time, 6-case sets of ~10 MB of CSV)

| set | reference (csv-reader 1.0.0) | this entry | speedup |
| --- | --- | --- | --- |
| practice set (kit) | ~670 ms | ~180–210 ms | ~3–4× |
| fresh set 1 (own seed) | ~490 ms | ~215 ms | ~2.3× |
| fresh set 2 (own seed) | ~640 ms | ~240 ms | ~2.7× |

(The reference's own time moves around a lot between runs — it builds every field a character at a time — while this entry's time is stable at ~180–240 ms per set. For scale, the house's own numbers put papaparse at 0.78 s and d3-dsv at 0.73 s against the reference's 1.38 s on similar sets, about 1.8×.)

## Layout

- `main.ts` — the program the harness runs: reads `/input/cases.json`, answers each case with `run()` from `solve.js`, writes `/output/answers.json`. (`MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` stand in for `/input` / `/output` outside a container.)
- `solve.js` — the fast reader. Dependency-free ES module, `run(input)` returns `{columns, rows, errors}`.
- `LICENSE` — MIT.

## Run locally

```sh
MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=<dir> node main.ts
```
