import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function summarizeUnitTests(directory) {
  const totals = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.xml'));
  if (files.length !== 3) throw new Error('UNIT_REPORTS_MISSING');
  for (const name of files) {
    const xml = fs.readFileSync(path.join(directory, name), 'utf8');
    const suite = xml.match(/<testsuites\b[^>]*>/)?.[0] ?? '';
    for (const key of Object.keys(totals)) {
      totals[key] += Number(
        suite.match(new RegExp(`${key}="(\\d+)"`))?.[1] ?? 0,
      );
    }
  }
  if (totals.tests === 0) throw new Error('UNIT_REPORTS_EMPTY');
  return `## Unit test summary\n\n| Tests | Failures | Errors | Skipped |\n| ---: | ---: | ---: | ---: |\n| ${totals.tests} | ${totals.failures} | ${totals.errors} | ${totals.skipped} |\n`;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const directory = process.argv[2];
  if (!directory) process.exitCode = 1;
  else {
    try {
      process.stdout.write(summarizeUnitTests(directory));
    } catch {
      process.stderr.write('Unit test summary failed safely.\n');
      process.exitCode = 1;
    }
  }
}
