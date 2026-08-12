import path from 'node:path';
import { fileURLToPath } from 'node:url';

type SpaRequest = { method: string; path: string };
type SpaResponse = {
  sendFile(filePath: string, options: { root: string }): void;
};
type SpaNext = () => void;
type ExpressApplication = {
  use(
    handler: (
      request: SpaRequest,
      response: SpaResponse,
      next: SpaNext,
    ) => void,
  ): void;
};
type SpaHttpAdapter = {
  getInstance(): unknown;
  // Optional on Nest's HttpServer contract because non-Express adapters may not
  // implement it; this application is Express-only, so its absence is a wiring
  // fault worth failing loudly on rather than silently serving no assets.
  useStaticAssets?(rootPath: string, options: Record<string, unknown>): unknown;
};

export const productionStaticRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'public',
);

export function shouldServeSpaFallback(
  nodeEnvironment: string | undefined,
  serveStaticAssets: unknown,
): boolean {
  return (
    nodeEnvironment === 'production' ||
    serveStaticAssets === true ||
    serveStaticAssets === 'true'
  );
}

export function registerSpaFallback(
  expressApplication: ExpressApplication,
  serveStaticAssets: unknown,
  options: { nodeEnvironment?: string; spaEntryPath?: string } = {},
): void {
  if (
    !shouldServeSpaFallback(
      options.nodeEnvironment ?? process.env.NODE_ENV,
      serveStaticAssets,
    )
  ) {
    return;
  }

  const spaEntryPath =
    options.spaEntryPath ?? path.join(productionStaticRoot, 'index.html');
  // `send` (behind res.sendFile) rejects any absolute path containing a
  // dot-prefixed segment when no `root` is supplied, because its default
  // `dotfiles: 'ignore'` policy is applied to every segment of the resolved
  // path. Anchoring to the entry's own directory keeps that check scoped to the
  // bare filename, so deploy paths such as /opt/.releases or a git worktree
  // under .worktrees/ still serve the SPA.
  const entryRoot = path.dirname(spaEntryPath);
  const entryFile = path.basename(spaEntryPath);

  expressApplication.use((request, response, next) => {
    if (
      !['GET', 'HEAD'].includes(request.method) ||
      /^\/(?:api|health|assets)(?:\/|$)/i.test(request.path) ||
      /\/[^/]*\.[^/]+$/.test(request.path)
    ) {
      next();
      return;
    }
    response.sendFile(entryFile, { root: entryRoot });
  });
}

export function registerSpaHosting(
  httpAdapter: SpaHttpAdapter,
  serveStaticAssets: unknown,
  options: { nodeEnvironment?: string; staticRoot?: string } = {},
): void {
  const nodeEnvironment = options.nodeEnvironment ?? process.env.NODE_ENV;
  if (!shouldServeSpaFallback(nodeEnvironment, serveStaticAssets)) {
    return;
  }

  if (typeof httpAdapter.useStaticAssets !== 'function') {
    throw new Error(
      'Static asset hosting requires an HTTP adapter that supports useStaticAssets.',
    );
  }

  const staticRoot = options.staticRoot ?? productionStaticRoot;
  // Assets only. `index: false` keeps every HTML response flowing through the
  // fallback below, so there is exactly one code path that serves index.html.
  httpAdapter.useStaticAssets(staticRoot, {
    index: false,
    fallthrough: true,
  });
  registerSpaFallback(
    httpAdapter.getInstance() as ExpressApplication,
    serveStaticAssets,
    {
      ...(nodeEnvironment === undefined ? {} : { nodeEnvironment }),
      spaEntryPath: path.join(staticRoot, 'index.html'),
    },
  );
}
