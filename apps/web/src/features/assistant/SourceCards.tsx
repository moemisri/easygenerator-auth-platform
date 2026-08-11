import type { AssistantSource } from '@easygenerator/contracts';

export function SourceCards({ sources }: { sources: AssistantSource[] }) {
  if (sources.length === 0) return null;
  return (
    <section className="source-rail" aria-label="Sources">
      <h3>Sources</h3>
      <ul>
        {sources.map((source) => (
          <li key={source.id}>
            <p>{source.heading}</p>
            <span>{source.file}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
