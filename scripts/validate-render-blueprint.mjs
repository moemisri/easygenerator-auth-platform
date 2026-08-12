import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(
  new URL('../apps/api/package.json', import.meta.url),
);
const Ajv2020Module = require('ajv/dist/2020.js');
const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const addFormats = require('ajv-formats');
const { load } = require('js-yaml');

const schemaUrl = 'https://render.com/schema/render.yaml.json';

export async function validateRenderBlueprint(blueprintPath, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(schemaUrl, {
      headers: { accept: 'application/schema+json, application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('SCHEMA_FETCH_FAILED');
  }
  if (!response.ok) throw new Error('SCHEMA_FETCH_FAILED');

  let schema;
  let blueprint;
  try {
    schema = await response.json();
    blueprint = load(fs.readFileSync(blueprintPath, 'utf8'));
  } catch {
    throw new Error('BLUEPRINT_PARSE_FAILED');
  }

  let valid;
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    valid = ajv.validate(schema, blueprint);
  } catch {
    throw new Error('SCHEMA_VALIDATION_FAILED');
  }
  if (!valid) {
    throw new Error('BLUEPRINT_SCHEMA_INVALID');
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  validateRenderBlueprint(path.resolve('render.yaml'))
    .then(() =>
      process.stdout.write('Render Blueprint schema validation passed.\n'),
    )
    .catch((error) => {
      process.stderr.write(
        `Render Blueprint validation failed: ${error.message}\n`,
      );
      process.exitCode = 1;
    });
}
