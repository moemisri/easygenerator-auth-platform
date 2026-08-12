import { fileURLToPath } from 'node:url';
import path from 'node:path';

const checks = [
  { path: '/', status: 200, content: 'html' },
  { path: '/health/live', status: 200 },
  { path: '/health/ready', status: 200 },
  { path: '/api/v1/users/me', status: 401 },
];

const sensitivePatterns = [
  /mongodb(?:\+srv)?:\/\/[^\s:@/]+:[^\s@/]+@/i,
  /AIzaSy[A-Za-z0-9_-]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{43,}={0,2}(?:$|[^A-Za-z0-9+/=])/,
];

export function parseSmokeOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('INVALID_ORIGIN');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('INVALID_ORIGIN');
  }
  return url;
}

function containsSensitiveMaterial(value) {
  return sensitivePatterns.some((pattern) => pattern.test(value));
}

function fail(pathname, status, category) {
  throw new Error(`${pathname} ${status} ${category}`);
}

export async function runSmoke(
  originValue,
  fetcher = fetch,
  environment = process.env,
) {
  const origin = parseSmokeOrigin(originValue);
  const configuredSecrets = [
    environment.MONGODB_URI,
    environment.REDIS_URL,
    environment.CSRF_SECRET,
    environment.IDENTITY_HASH_SECRET,
    environment.GEMINI_API_KEY,
    environment.ADMIN_PASSWORD,
  ].filter((value) => typeof value === 'string' && value.length > 0);
  const results = [];
  for (const check of checks) {
    let response;
    try {
      response = await fetcher(new URL(check.path, origin), {
        headers: {
          accept: check.content === 'html' ? 'text/html' : 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      fail(check.path, 0, 'REQUEST_FAILED');
    }

    let body;
    let headers;
    try {
      body = await response.text();
      headers = [...response.headers]
        .map(([name, value]) => `${name}:${value}`)
        .join('\n');
    } catch {
      fail(check.path, response.status, 'RESPONSE_READ_FAILED');
    }
    if (
      containsSensitiveMaterial(body) ||
      containsSensitiveMaterial(headers) ||
      configuredSecrets.some(
        (secret) => body.includes(secret) || headers.includes(secret),
      )
    ) {
      fail(check.path, response.status, 'SENSITIVE_MATERIAL');
    }
    if (response.status !== check.status) {
      fail(check.path, response.status, 'UNEXPECTED_STATUS');
    }
    if (
      check.content === 'html' &&
      !response.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('text/html')
    ) {
      fail(check.path, response.status, 'INVALID_CONTENT');
    }
    results.push({ path: check.path, status: response.status });
  }
  return results;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runSmoke(process.env.SMOKE_ORIGIN)
    .then((results) => {
      for (const result of results)
        process.stdout.write(`${result.path} ${result.status}\n`);
    })
    .catch((error) => {
      process.stderr.write(`Smoke failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
