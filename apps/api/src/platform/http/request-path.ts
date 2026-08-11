export function requestPath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;

  const separatorIndex = value.search(/[?#]/u);
  const path = separatorIndex === -1 ? value : value.slice(0, separatorIndex);
  return path === '' ? undefined : path;
}
