import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const detectors = [
  ['gemini-key', /AIzaSy[A-Za-z0-9_-]{30,}/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

const adminPasswordAssignment =
  /(?<![A-Za-z0-9_])ADMIN_PASSWORD[ \t]*=[ \t]*(?:"[^"\r\n]+"|'[^'\r\n]+'|[^\s#"'][^\s"']*)/g;
const bootstrapRedactionFixturePath =
  'apps/api/src/cli/bootstrap-admin.spec.ts';
const bootstrapRedactionFixtureAssignment = [
  'ADMIN_PASSWORD',
  '=secret-marker',
].join('');

function isKnownBootstrapRedactionFixture(pathname, content, match) {
  const normalizedPath = pathname.replace(/^[0-9a-f]{40}:/, '');
  if (
    normalizedPath !== bootstrapRedactionFixturePath ||
    match[0] !== bootstrapRedactionFixtureAssignment
  ) {
    return false;
  }
  const before = content.slice(Math.max(0, match.index - 64), match.index);
  const quote = before.match(/new\s+Error\(\s*(["'])$/)?.[1];
  return (
    quote !== undefined && content.at(match.index + match[0].length) === quote
  );
}

function hasAdminPasswordFinding(pathname, content) {
  adminPasswordAssignment.lastIndex = 0;
  for (const match of content.matchAll(adminPasswordAssignment)) {
    if (!isKnownBootstrapRedactionFixture(pathname, content, match))
      return true;
  }
  return false;
}

const credentialMongoUri =
  /mongodb(?:\+srv)?:\/\/([^\s:@/]+):([^\s@/]+)@(\[[^\]\s]+\]|[A-Za-z0-9.-]+)/gi;
const fixtureCredentialVocabulary = new Set([
  'admin',
  'user',
  'secret',
  'secret-password',
  'password',
]);

function hasCredentialMongoFinding(content) {
  for (const match of content.matchAll(credentialMongoUri)) {
    const [, username, password, hostname] = match;
    const reservedHostname =
      hostname.endsWith('.example') || hostname.endsWith('.test');
    const explicitFixture =
      fixtureCredentialVocabulary.has(username) &&
      fixtureCredentialVocabulary.has(password);
    if (!reservedHostname || !explicitFixture) return true;
  }
  return false;
}

const base64Candidate =
  /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/]{43,}={0,2}(?![A-Za-z0-9+/=_-])/g;
const documentedRepositorySourcePaths = new Set([
  'apps/web/src/features/admin/UserActionDialog.tsx',
  'apps/web/src/features/admin/UserActionDialog.test.tsx',
  'apps/web/src/features/assistant/SafeMarkdown.tsx',
  'apps/web/src/features/assistant/SafeMarkdown.test.tsx',
]);

function containsCanonicalLongBase64(content) {
  for (const match of content.matchAll(base64Candidate)) {
    const candidate = match[0];
    if (candidate.length % 4 !== 0) continue;
    const decoded = Buffer.from(candidate, 'base64');
    const before = content.slice(Math.max(0, match.index - 1), match.index);
    const after = content.slice(match.index + candidate.length);
    const sourcePathSuffix = after.match(
      /^(\.(?:test\.)?(?:[cm]?[jt]sx?|md|ya?ml|json|css|html))([`'"])/,
    );
    const knownSourcePath =
      ['"', "'", '`'].includes(before) &&
      sourcePathSuffix?.[2] === before &&
      documentedRepositorySourcePaths.has(
        `${candidate}${sourcePathSuffix?.[1] ?? ''}`,
      );
    const routePath =
      /^\/api\/v1\/admin\/users\/[0-9a-f]{24}$/i.test(candidate) &&
      ['"', "'", '`'].includes(before) &&
      (['?', '/', '#'].includes(after.at(0) ?? '') || after.at(0) === before);
    const immediatelyBefore = content.slice(
      Math.max(0, match.index - 7),
      match.index,
    );
    const artifactSha256 =
      immediatelyBefore === 'sha256:' && /^[0-9a-f]{64}$/.test(candidate);
    if (
      !knownSourcePath &&
      !routePath &&
      !artifactSha256 &&
      decoded.length >= 32 &&
      decoded.toString('base64') === candidate &&
      !/integrity:\s+sha(?:256|384|512)-$/.test(
        content.slice(Math.max(0, match.index - 32), match.index),
      )
    ) {
      return true;
    }
  }
  return false;
}

export function scanText(pathname, content) {
  const findings = [];
  credentialMongoUri.lastIndex = 0;
  if (hasCredentialMongoFinding(content)) {
    findings.push({ path: pathname, category: 'mongodb-uri' });
  }
  for (const [category, pattern] of detectors) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push({ path: pathname, category });
  }
  if (hasAdminPasswordFinding(pathname, content)) {
    findings.push({ path: pathname, category: 'admin-password' });
  }
  if (containsCanonicalLongBase64(content)) {
    findings.push({ path: pathname, category: 'base64-secret' });
  }
  return findings;
}

function git(arguments_, input) {
  const result = spawnSync('git', arguments_, {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  if (result.status !== 0) throw new Error('GIT_SCAN_FAILED');
  return result.stdout;
}

function trackedEntries() {
  return git(['ls-files', '-z'])
    .split('\0')
    .filter(Boolean)
    .map((pathname) => ({
      path: pathname,
      content: fs.readFileSync(pathname, 'utf8'),
    }));
}

function reachableEntries(ref) {
  const objects = git(['rev-list', '--objects', ref])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(' ');
      return separator === -1
        ? { object: line, path: line }
        : { object: line.slice(0, separator), path: line.slice(separator + 1) };
    });
  const entries = [];
  const seen = new Set();
  for (const { object, path: pathname } of objects) {
    if (seen.has(object)) continue;
    seen.add(object);
    const type = git(['cat-file', '-t', object]).trim();
    if (type !== 'blob') continue;
    entries.push({
      path: `${object}:${pathname}`,
      content: git(['cat-file', 'blob', object]),
    });
  }
  return entries;
}

export function runScan(arguments_) {
  let entries;
  if (arguments_[0] === '--tracked' && arguments_.length === 1) {
    entries = trackedEntries();
  } else if (arguments_[0] === '--reachable' && arguments_.length === 2) {
    entries = reachableEntries(arguments_[1]);
  } else {
    throw new Error('USAGE');
  }

  const findings = entries.flatMap(({ path: pathname, content }) =>
    scanText(pathname, content),
  );
  for (const finding of findings) {
    process.stderr.write(`${finding.path} ${finding.category}\n`);
  }
  return findings.length === 0 ? 0 : 1;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    process.exitCode = runScan(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      error.message === 'USAGE'
        ? 'Usage: scan-secrets.mjs --tracked | --reachable <ref>\n'
        : 'Secret scan failed safely.\n',
    );
    process.exitCode = 2;
  }
}
