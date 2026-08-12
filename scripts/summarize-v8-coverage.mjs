import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function summarizeV8Coverage(directory) {
  const files = fs
    .readdirSync(directory, { recursive: true })
    .filter((name) => name.endsWith('.json'));
  if (files.length === 0) throw new Error('COVERAGE_REPORTS_MISSING');
  let scripts = 0;
  let functions = 0;
  let coveredFunctions = 0;
  for (const name of files) {
    const report = JSON.parse(
      fs.readFileSync(path.join(directory, name), 'utf8'),
    );
    for (const script of report.result ?? []) {
      if (!/\/(?:apps|packages)\/[^/]+\/src\//.test(script.url)) continue;
      scripts += 1;
      for (const function_ of script.functions ?? []) {
        functions += 1;
        if (function_.ranges?.some((range) => range.count > 0))
          coveredFunctions += 1;
      }
    }
  }
  if (scripts === 0 || functions === 0)
    throw new Error('COVERAGE_REPORTS_EMPTY');
  const percent = ((coveredFunctions / functions) * 100).toFixed(2);
  return `## Raw V8 coverage summary\n\n| Source scripts | Functions covered | Functions observed | Function coverage |\n| ---: | ---: | ---: | ---: |\n| ${scripts} | ${coveredFunctions} | ${functions} | ${percent}% |\n`;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    process.stdout.write(summarizeV8Coverage(process.argv[2]));
  } catch {
    process.stderr.write('V8 coverage summary failed safely.\n');
    process.exitCode = 1;
  }
}
