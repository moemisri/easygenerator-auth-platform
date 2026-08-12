import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const secretKeys = ['CSRF_SECRET', 'IDENTITY_HASH_SECRET'];

function fillBlankSecret(content, key) {
  const pattern = new RegExp(`^${key}=[ \\t]*$`, 'm');
  if (!pattern.test(content)) return content;
  return content.replace(
    pattern,
    `${key}=${randomBytes(32).toString('base64')}`,
  );
}

export function prepareLocalEnvironment(runtime) {
  const target = path.join(runtime.repositoryRoot, '.env.local');
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    let content;
    let targetExists = true;
    try {
      content = fs.readFileSync(target, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      targetExists = false;
      content = fs.readFileSync(
        path.join(runtime.repositoryRoot, '.env.example'),
        'utf8',
      );
    }
    for (const key of secretKeys) content = fillBlankSecret(content, key);
    if (targetExists) {
      fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, target);
    } else {
      fs.writeFileSync(target, content, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    }
    fs.chmodSync(target, 0o600);
    runtime.stdout('Local environment prepared.\n');
    return 0;
  } catch {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        runtime.stderr('Local environment preparation failed.\n');
        return 1;
      }
    }
    runtime.stderr('Local environment preparation failed.\n');
    return 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.exitCode = prepareLocalEnvironment({
    repositoryRoot: process.cwd(),
    stdout: (message) => process.stdout.write(message),
    stderr: (message) => process.stderr.write(message),
  });
}
