import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { prepareLocalEnvironment } from '../../../../scripts/prepare-local-env.mjs';
import { configSchema } from './config/config.schema';

const template = `NODE_ENV=development
MONGODB_URI='mongodb://127.0.0.1:27018/easygenerator_auth?replicaSet=rs0&directConnection=true'
DB_NAME=easygenerator_auth
REDIS_URL=redis://127.0.0.1:6380
CSRF_SECRET=
IDENTITY_HASH_SECRET=
GEMINI_API_KEY=
ADMIN_PASSWORD=
`;

function parse(content) {
  return Object.fromEntries(
    content
      .trim()
      .split('\n')
      .map((line) => {
        const separator = line.indexOf('=');
        const value = line.slice(separator + 1);
        return [
          line.slice(0, separator),
          /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value,
        ];
      }),
  );
}

describe('local environment preparer', () => {
  it('creates a private sourceable file with distinct random secrets and no value output', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-env-'));
    try {
      fs.writeFileSync(path.join(directory, '.env.example'), template);
      const stdout = [];
      const stderr = [];
      expect(
        prepareLocalEnvironment({
          repositoryRoot: directory,
          stdout: (message) => stdout.push(message),
          stderr: (message) => stderr.push(message),
        }),
      ).toBe(0);

      const target = path.join(directory, '.env.local');
      const content = fs.readFileSync(target, 'utf8');
      const environment = parse(content);
      expect(environment.MONGODB_URI).toContain('127.0.0.1:27018');
      expect(environment.REDIS_URL).toBe('redis://127.0.0.1:6380');
      expect(Buffer.from(environment.CSRF_SECRET, 'base64')).toHaveLength(32);
      expect(
        Buffer.from(environment.IDENTITY_HASH_SECRET, 'base64'),
      ).toHaveLength(32);
      expect(environment.CSRF_SECRET).not.toBe(
        environment.IDENTITY_HASH_SECRET,
      );
      expect(environment.GEMINI_API_KEY).toBe('');
      expect(environment.ADMIN_PASSWORD).toBe('');
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
      expect(stdout).toEqual(['Local environment prepared.\n']);
      expect(stderr).toEqual([]);
      expect(stdout.join('')).not.toContain(environment.CSRF_SECRET);
      expect(stdout.join('')).not.toContain(environment.IDENTITY_HASH_SECRET);
      expect(configSchema.parse(environment)).toMatchObject({
        MONGODB_URI:
          'mongodb://127.0.0.1:27018/easygenerator_auth?replicaSet=rs0&directConnection=true',
        REDIS_URL: 'redis://127.0.0.1:6380',
      });
      const sourced = spawnSync(
        'sh',
        [
          '-c',
          '. "$1"; test "$MONGODB_URI" = "$2"; test "$REDIS_URL" = "$3"',
          'environment-check',
          target,
          environment.MONGODB_URI,
          environment.REDIS_URL,
        ],
        { encoding: 'utf8', shell: false },
      );
      expect(sourced).toMatchObject({ status: 0, stdout: '', stderr: '' });
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });

  it('preserves nonblank values and fills only missing secrets on rerun', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-env-'));
    try {
      fs.writeFileSync(path.join(directory, '.env.example'), template);
      fs.writeFileSync(
        path.join(directory, '.env.local'),
        template.replace('CSRF_SECRET=', 'CSRF_SECRET=operator-owned-value'),
      );
      expect(
        prepareLocalEnvironment({
          repositoryRoot: directory,
          stdout: () => undefined,
          stderr: () => undefined,
        }),
      ).toBe(0);
      const environment = parse(
        fs.readFileSync(path.join(directory, '.env.local'), 'utf8'),
      );
      expect(environment.CSRF_SECRET).toBe('operator-owned-value');
      expect(
        Buffer.from(environment.IDENTITY_HASH_SECRET, 'base64'),
      ).toHaveLength(32);
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });

  it('fails safely without leaving a temporary file when the template is absent', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-env-'));
    try {
      const stderr = [];
      expect(
        prepareLocalEnvironment({
          repositoryRoot: directory,
          stdout: () => undefined,
          stderr: (message) => stderr.push(message),
        }),
      ).toBe(1);
      expect(stderr).toEqual(['Local environment preparation failed.\n']);
      expect(fs.readdirSync(directory)).toEqual([]);
    } finally {
      fs.rmSync(directory, { recursive: true });
    }
  });
});
