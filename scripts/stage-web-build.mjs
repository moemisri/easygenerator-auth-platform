import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'apps', 'web', 'dist');
const destination = path.join(root, 'apps', 'api', 'public');

fs.rmSync(destination, { force: true, recursive: true });
fs.cpSync(source, destination, { recursive: true });
