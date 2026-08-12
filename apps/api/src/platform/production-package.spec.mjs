import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

describe('production container artifacts', () => {
  it('pins the toolchain and preserves the minimal ESM runtime layout', () => {
    const dockerfile = read('Dockerfile');

    expect(dockerfile.match(/FROM node:24\.18\.0-bookworm-slim/g)).toHaveLength(
      3,
    );
    expect(dockerfile).toContain('pnpm@11.0.6');
    expect(dockerfile).toContain('/workspace/docs/assistant-public');
    expect(dockerfile).toContain('/workspace/package.json ./package.json');
    expect(dockerfile).toContain(
      '/workspace/docker/pnpm-workspace.runtime.yaml ./pnpm-workspace.yaml',
    );
    expect(read('docker/pnpm-workspace.runtime.yaml')).toBe(
      "packages:\n  - 'apps/*'\nverifyDepsBeforeRun: false\n",
    );
    expect(dockerfile).toContain(
      '/out/api/package.json ./apps/api/package.json',
    );
    expect(dockerfile).toContain('/workspace/apps/api/dist ./apps/api/dist');
    expect(dockerfile).toContain('/workspace/apps/web/dist ./apps/api/public');
    expect(dockerfile).toContain('corepack prepare pnpm@11.0.6 --activate');
    expect(dockerfile).toContain('ENV COREPACK_HOME=/corepack');
    expect(dockerfile).toContain('/app/docs/assistant-public');
    expect(dockerfile).toContain('USER 10001:10001');
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--"]');
    expect(dockerfile).toContain('CMD ["node", "dist/main.js"]');
  });

  it('defines disposable local dependencies and localhost-only production serving', () => {
    const compose = read('compose.yaml');

    expect(compose).toContain(
      "['mongod', '--replSet', 'rs0', '--bind_ip_all']",
    );
    expect(compose).toContain('service_completed_successfully');
    expect(compose).toContain('image: redis:8-alpine');
    expect(compose).toContain("- '127.0.0.1:3000:3000'");
    expect(compose).toContain('DB_NAME: easygenerator_auth');
    expect(compose).toContain('APP_ORIGIN: https://localhost:3000');
    expect(compose).toContain("COOKIE_SECURE: 'true'");
    expect(compose).not.toContain('easygenerator_auth_test');
    expect(compose).not.toMatch(/mongodb(?:\+srv)?:\/\/[^\s:@]+:[^\s@]+@/);
  });
});
