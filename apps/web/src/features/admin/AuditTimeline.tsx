import type { SafeAuditEvent } from '@easygenerator/contracts';

export function AuditTimeline({ events }: { events: SafeAuditEvent[] }) {
  if (events.length === 0) {
    return <p className="empty-state">No audit events yet.</p>;
  }

  return (
    <ol className="audit-timeline">
      {events.map((event) => (
        <li key={event.id}>
          <div className="audit-marker" aria-hidden="true" />
          <div>
            <div className="audit-meta">
              <span className="data-badge">{event.action}</span>
              <time dateTime={event.occurredAt}>
                {new Date(event.occurredAt).toLocaleString()}
              </time>
            </div>
            <p>{event.summary}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
