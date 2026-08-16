#!/usr/bin/env node
/**
 * Compares the sources this project's cleaners were ported from against the
 * hashes recorded in scripts/upstream-sources.json.
 *
 * The parity suite already catches behavioural drift, but only for the cases it
 * covers: when upstream added AVIF and HEIC support, every parity test stayed
 * green while this port simply lacked the feature. A hash of the source files
 * catches that second failure mode — upstream changed at all — which no
 * behavioural test can notice on its own.
 *
 * Exit codes: 0 unchanged · 1 drift detected · 2 could not check (network,
 * rate limit, bad manifest) — a failed fetch must not be reported as drift.
 */
import { createHash } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, 'upstream-sources.json');
const TIMEOUT_MS = 20000;

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'md-to-wordpress-converter upstream check' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  } catch (e) {
    console.error(`cannot read ${MANIFEST}: ${e.message}`);
    return 2;
  }

  const results = [];
  let unreachable = 0;

  for (const source of manifest.sources) {
    try {
      const body = await fetchText(source.url);
      const actual = sha256(body);
      results.push({ ...source, actual, changed: actual !== source.sha256 });
    } catch (e) {
      unreachable++;
      results.push({ ...source, error: e.message });
    }
  }

  for (const r of results) {
    const mark = r.error ? '??' : r.changed ? 'CHANGED' : 'ok';
    console.log(`${mark.padEnd(8)} ${r.id}${r.error ? `  (${r.error})` : ''}`);
    if (r.changed) {
      console.log(`         recorded ${r.sha256}`);
      console.log(`         actual   ${r.actual}`);
    }
  }

  const changed = results.filter((r) => r.changed);

  if (unreachable) {
    console.error(`\n${unreachable} source(s) could not be fetched — not reporting drift.`);
    return 2;
  }

  if (!changed.length) {
    console.log(`\nAll ${results.length} sources match the recorded hashes.`);
    await writeSummary(`✅ All ${results.length} upstream sources match the recorded hashes.`);
    return 0;
  }

  const mirrors = [...new Set(changed.flatMap((r) => r.mirrors))];
  const body = [
    `${changed.length} of ${results.length} upstream sources changed since these ports were last synced.`,
    '',
    '| Source | Recorded | Now | History |',
    '| --- | --- | --- | --- |',
    ...changed.map(
      (r) => `| \`${r.id}\` | \`${r.sha256.slice(0, 12)}\` | \`${r.actual.slice(0, 12)}\` | [commits](${r.history}) |`
    ),
    '',
    '**Files in this repository that mirror the changed sources:**',
    ...mirrors.map((m) => `- \`${m}\``),
    '',
    'Re-port the affected logic, then update `sha256` in `scripts/upstream-sources.json` in the same commit so this check goes quiet again.',
    ...(manifest.followUp ? ['', manifest.followUp] : []),
  ].join('\n');

  console.log(`\n${body}`);
  await writeSummary(body);
  await writeOutput('drift', 'true');
  await writeOutput('body', body);
  return 1;
}

async function writeSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
}

async function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const delimiter = `EOF_${name}_${Math.abs(sha256(value).slice(0, 8).split('').reduce((a, c) => a + c.charCodeAt(0), 0))}`;
  await appendFile(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

process.exit(await main());
