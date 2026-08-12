export function hasExpectedProcessTree(output) {
  const rows = output
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      return match === null
        ? undefined
        : { pid: match[1], ppid: match[2], command: match[3], args: match[4] };
    })
    .filter(Boolean);
  const tini = rows.find((row) => row.command === 'tini');
  const node = rows.find((row) => /^(?:\/\S*\/)?node(?:\s|$)/.test(row.args));
  return tini !== undefined && node !== undefined && node.ppid === tini.pid;
}
