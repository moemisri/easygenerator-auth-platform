type AbortActiveStream = () => void;

const activeStreams = new Set<AbortActiveStream>();

export function registerAssistantStream(abort: AbortActiveStream) {
  activeStreams.add(abort);
  return () => activeStreams.delete(abort);
}

export function abortAssistantStreams() {
  for (const abort of [...activeStreams]) abort();
}
