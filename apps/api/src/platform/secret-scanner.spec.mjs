import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { runScan, scanText } from '../../../../scripts/scan-secrets.mjs';

describe('secret scanner', () => {
  const adminKey = ['ADMIN', '_PASSWORD'].join('');
  const credentialMongo = [
    'mongodb+srv://user',
    ':credential@',
    'database.invalid/db',
  ].join('');
  const geminiKey = ['AIzaSyA012345678901', '2345678901234567890'].join('');
  const privateKeyMarker = ['-----BEGIN OPENSSH ', 'PRIVATE KEY-----'].join('');
  const adminAssignment = [adminKey, '=Temporary1!'].join('');
  const exportedAdminAssignment = [`export ${adminKey}`, '=Temporary1!'].join(
    '',
  );

  it.each([
    ['mongodb-uri', `MONGODB_URI=${credentialMongo}`],
    ['gemini-key', `GEMINI_API_KEY=${geminiKey}`],
    ['private-key', `${privateKeyMarker}\nopaque`],
    ['admin-password', adminAssignment],
    ['admin-password', exportedAdminAssignment],
    ['base64-secret', `value=${Buffer.alloc(32, 7).toString('base64')}`],
    ['base64-secret', `opaque: ${Buffer.alloc(33, 8).toString('base64')}`],
    ['base64-secret', `'${Buffer.alloc(32, 9).toString('base64')}'`],
    ['base64-secret', `'${Buffer.alloc(32, 255).toString('base64')}'`],
    ['base64-secret', `value=${Buffer.alloc(32, 255).toString('base64')}.ts`],
    [
      'base64-secret',
      `value=${Buffer.alloc(32, 254).toString('base64')}.test.ts`,
    ],
    ['base64-secret', `value=${Buffer.alloc(33, 253).toString('base64')}.tsx`],
    [
      'base64-secret',
      `leaked material ${Buffer.alloc(32, 10).toString('base64')}`,
    ],
    [
      'base64-secret',
      `leaked material ${Buffer.alloc(33, 12).toString('base64')}`,
    ],
    [
      'base64-secret',
      `tool --secret ${Buffer.alloc(33, 11).toString('base64')}`,
    ],
    ['base64-secret', `'/api/v1/${'A'.repeat(36)}'`],
  ])('detects %s without returning the matched value', (category, content) => {
    const findings = scanText('fixture.txt', content);
    expect(findings).toEqual([{ path: 'fixture.txt', category }]);
    expect(JSON.stringify(findings)).not.toContain(content);
  });

  it.each([
    ['env prefix', [`env ${adminKey}`, '=fixture-value command'].join('')],
    [
      'docker environment flag',
      [`docker run -e ${adminKey}`, '=fixture-value image'].join(''),
    ],
    [
      'inline shell assignment',
      [`command ${adminKey}`, '=fixture-value'].join(''),
    ],
    [
      'semicolon-adjacent assignment',
      ['command;', adminKey, '=fixture-value'].join(''),
    ],
    [
      'quoted inline assignment',
      ['command "', adminKey, '=fixture-value"'].join(''),
    ],
    ['single-quoted value', [adminKey, "='fixture-value'"].join('')],
    ['double-quoted value', [adminKey, '="fixture-value"'].join('')],
  ])(
    'detects an administrator password in %s without returning its value',
    (_, content) => {
      const findings = scanText('fixture.sh', content);
      expect(findings).toEqual([
        { path: 'fixture.sh', category: 'admin-password' },
      ]);
      expect(JSON.stringify(findings)).not.toContain('fixture-value');
    },
  );

  it('allows documentation and empty environment key names', () => {
    const documentation = `
      MONGODB_URI=
      GEMINI_API_KEY=
      ${adminKey}=
      Mention ${adminKey} without assigning it.
      Use CSRF_SECRET and IDENTITY_HASH_SECRET from the secure UI.
      mongodb://mongo:27017/easygenerator_auth
    `;
    expect(scanText('.env.example', documentation)).toEqual([]);
    expect(
      scanText('fixture.sh', [`NOT_${adminKey}`, '=fixture-value'].join('')),
    ).toEqual([]);
    for (const emptyAssignment of [
      `${adminKey}=`,
      `${adminKey}=''`,
      `${adminKey}=""`,
    ]) {
      expect(scanText('fixture.sh', emptyAssignment)).toEqual([]);
    }
  });

  it('classifies only the exact historical bootstrap redaction fixture', () => {
    const fixturePath = 'apps/api/src/cli/bootstrap-admin.spec.ts';
    const knownAssignment = [adminKey, '=secret-marker'].join('');
    const otherAssignment = [adminKey, '=different-marker'].join('');
    const mockContext = (assignment) =>
      `const close = vi.fn().mockRejectedValue(new Error('${assignment}'));`;

    expect(scanText(fixturePath, mockContext(knownAssignment))).toEqual([]);
    expect(
      scanText(
        `a`.repeat(40) + `:${fixturePath}`,
        mockContext(knownAssignment),
      ),
    ).toEqual([]);
    expect(scanText(fixturePath, `env ${knownAssignment} command`)).toEqual([
      { path: fixturePath, category: 'admin-password' },
    ]);
    expect(scanText('other.spec.ts', mockContext(knownAssignment))).toEqual([
      { path: 'other.spec.ts', category: 'admin-password' },
    ]);
    expect(scanText(fixturePath, mockContext(otherAssignment))).toEqual([
      { path: fixturePath, category: 'admin-password' },
    ]);
  });

  it('classifies only fixed fake credentials on reserved hosts as test fixtures', () => {
    const fakeReserved = [
      'mongodb://admin',
      ':secret@',
      'db.example/test',
    ].join('');
    const fakeRealHost = [
      'mongodb://admin',
      ':secret@',
      'database.invalid/test',
    ].join('');
    const nonfakeReserved = [
      'mongodb://admin',
      ':actual-value@',
      'db.example/test',
    ].join('');

    expect(scanText('fixture.ts', fakeReserved)).toEqual([]);
    expect(scanText('fixture.ts', fakeRealHost)).toEqual([
      { path: 'fixture.ts', category: 'mongodb-uri' },
    ]);
    expect(scanText('fixture.ts', nonfakeReserved)).toEqual([
      { path: 'fixture.ts', category: 'mongodb-uri' },
    ]);
  });

  it('detects credential-bearing Mongo IPv6 authorities', () => {
    const uri = [
      'mongodb://real-user',
      ':real-password@',
      '[2001:db8::1]/db',
    ].join('');
    expect(scanText('fixture.ts', uri)).toEqual([
      { path: 'fixture.ts', category: 'mongodb-uri' },
    ]);
  });

  it('allows package-manager integrity metadata while still scanning other files', () => {
    expect(
      scanText(
        'pnpm-lock.yaml',
        `integrity: sha512-${Buffer.alloc(64, 9).toString('base64')}`,
      ),
    ).toEqual([]);
    expect(
      scanText(
        'pnpm-lock.yaml',
        `integrity: sha512-${Buffer.alloc(64, 9).toString('base64')}\nuri: ${credentialMongo}`,
      ),
    ).toEqual([{ path: 'pnpm-lock.yaml', category: 'mongodb-uri' }]);
    expect(scanText('fixture.txt', 'not-canonical-base64=A===')).toEqual([]);
    const artifactDigest = 'a'.repeat(64);
    expect(scanText('AI.md', `image sha256:${artifactDigest}`)).toEqual([]);
    expect(scanText('AI.md', `image ${artifactDigest}`)).toEqual([
      { path: 'AI.md', category: 'base64-secret' },
    ]);
    expect(
      scanText(
        'AI.md',
        `image sha256:${Buffer.alloc(48, 255).toString('base64')}`,
      ),
    ).toEqual([{ path: 'AI.md', category: 'base64-secret' }]);
    for (const sourcePath of [
      'apps/web/src/features/admin/UserActionDialog.tsx',
      'apps/web/src/features/admin/UserActionDialog.test.tsx',
      'apps/web/src/features/assistant/SafeMarkdown.tsx',
      'apps/web/src/features/assistant/SafeMarkdown.test.tsx',
    ]) {
      expect(scanText('plan.md', `- Create: \`${sourcePath}\``)).toEqual([]);
    }
    const deceptiveSourceToken = `apps/a/${'a'.repeat(37)}`;
    expect(Buffer.from(deceptiveSourceToken, 'base64').toString('base64')).toBe(
      deceptiveSourceToken,
    );
    expect(scanText('fixture.txt', `\`${deceptiveSourceToken}.ts\``)).toEqual([
      { path: 'fixture.txt', category: 'base64-secret' },
    ]);
    for (const route of [
      "'/API/V1/ADMIN/users?page=1'",
      "'/Api/v1/AdMiN/users/507f1f77bcf86cd799439011'",
      "instance: '/api/v1/admin/users/507f1f77bcf86cd799439011'",
    ]) {
      expect(scanText('route.spec.ts', route)).toEqual([]);
    }
  });

  it('scans current tracked worktree bytes instead of the staged index', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-secret-scan-'));
    const originalDirectory = process.cwd();
    try {
      expect(run(fixture, ['init']).status).toBe(0);
      fs.writeFileSync(path.join(fixture, 'tracked.txt'), 'safe\n');
      expect(run(fixture, ['add', 'tracked.txt']).status).toBe(0);
      fs.writeFileSync(
        path.join(fixture, 'tracked.txt'),
        `GEMINI_API_KEY=${geminiKey}\n`,
      );
      process.chdir(fixture);
      expect(runScan(['--tracked'])).toBe(1);
    } finally {
      process.chdir(originalDirectory);
      fs.rmSync(fixture, { recursive: true });
    }
  });
});

function run(cwd, arguments_) {
  return spawnSync('git', arguments_, { cwd, encoding: 'utf8', shell: false });
}
