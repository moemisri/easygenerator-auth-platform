type ReturnLocation = {
  pathname?: unknown;
  search?: unknown;
  hash?: unknown;
};

export function requestedPath(state: unknown): string {
  if (!state || typeof state !== 'object' || !('from' in state)) return '/app';
  const from = state.from;
  if (!from || typeof from !== 'object') return '/app';

  const { pathname, search, hash } = from as ReturnLocation;
  if (
    typeof pathname !== 'string' ||
    !pathname.startsWith('/') ||
    pathname.startsWith('//') ||
    pathname === '/signin' ||
    pathname === '/signup'
  ) {
    return '/app';
  }

  return `${pathname}${typeof search === 'string' ? search : ''}${
    typeof hash === 'string' ? hash : ''
  }`;
}
