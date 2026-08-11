import { useState, type FormEvent } from 'react';

import { Button } from '../../components/Button';
import { ProblemAlert } from '../../components/ProblemAlert';
import { useAuth } from '../auth/AuthProvider';
import { SourceCards } from './SourceCards';
import { SafeMarkdown } from './SafeMarkdown';
import {
  ASSISTANT_REFUSAL_MESSAGE,
  useAssistantStream,
} from './use-assistant-stream';

const suggestions = [
  'How are user sessions protected?',
  'What can each application role manage?',
  'How does the assistant choose its sources?',
];

export function AssistantChat() {
  const { csrfToken, features, isLoggingOut } = useAuth();
  const assistant = useAssistantStream({
    csrfToken,
    enabled: features?.assistant === true,
    interactionLocked: isLoggingOut,
  });
  const [question, setQuestion] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const submittedQuestion = question;
    if (await assistant.send(submittedQuestion)) {
      setQuestion((current) => (current === submittedQuestion ? '' : current));
    }
  }

  if (assistant.status === 'disabled') {
    return (
      <section
        className="assistant-disabled"
        aria-labelledby="assistant-disabled-heading"
      >
        <p className="eyebrow">Assistant unavailable</p>
        <h2 id="assistant-disabled-heading">
          The assistant is not enabled for this environment.
        </h2>
        <p>You can continue using the rest of the application.</p>
        <p className="visually-hidden" role="status" aria-live="polite">
          {assistant.liveStatus}
        </p>
      </section>
    );
  }

  const hasConversation = assistant.turns.length > 0 || assistant.attempt;

  return (
    <section
      className="assistant-chat"
      aria-labelledby="assistant-chat-heading"
    >
      <h2 id="assistant-chat-heading" className="visually-hidden">
        Documentation conversation
      </h2>
      <aside
        className="assistant-privacy"
        aria-label="Assistant privacy notice"
      >
        <p className="eyebrow">Before you ask</p>
        <p>
          Your question, bounded conversation history, and selected public
          excerpts are sent to Gemini. You must not submit personal, secret, or
          sensitive information.
        </p>
      </aside>

      <div className="assistant-transcript">
        {!hasConversation && (
          <div className="assistant-empty">
            <p className="eyebrow">Start with the public docs</p>
            <h3>Ask about access, security, or this application.</h3>
            <div
              className="assistant-suggestions"
              aria-label="Suggested questions"
            >
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setQuestion(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {assistant.turns.map((turn, index) => (
          <div className="assistant-turn" key={`${index}-${turn.question}`}>
            <article className="chat-message chat-message-user">
              <p className="message-label">You</p>
              <p>{turn.question}</p>
            </article>
            <article className="chat-message chat-message-assistant">
              <p className="message-label">Assistant</p>
              {turn.answer ? (
                <SafeMarkdown>{turn.answer}</SafeMarkdown>
              ) : (
                <p className="empty-answer">
                  No answer text was returned. Review the selected sources or
                  ask a more specific documented question.
                </p>
              )}
              {turn.outcome === 'refused' && (
                <span className="refusal-mark">Documentation boundary</span>
              )}
            </article>
            <SourceCards sources={turn.sources} />
          </div>
        ))}

        {assistant.attempt && (
          <div className="assistant-turn assistant-turn-current">
            <article className="chat-message chat-message-user">
              <p className="message-label">You</p>
              <p>{assistant.attempt.question}</p>
            </article>
            {(assistant.attempt.answer || assistant.isActive) && (
              <article className="chat-message chat-message-assistant">
                <p className="message-label">Assistant</p>
                {assistant.attempt.answer && (
                  <SafeMarkdown>{assistant.attempt.answer}</SafeMarkdown>
                )}
                {assistant.isActive && (
                  <span className="streaming-cursor" aria-hidden="true" />
                )}
              </article>
            )}
            <SourceCards sources={assistant.attempt.sources} />
          </div>
        )}
      </div>

      {assistant.error && !assistant.isActive && (
        <div className="assistant-problem">
          <ProblemAlert
            message={assistant.error.message}
            retryAfter={assistant.error.retryAfter}
          />
          <Button
            type="button"
            className="button-secondary"
            disabled={isLoggingOut}
            onClick={() => void assistant.retry()}
          >
            Retry question
          </Button>
        </div>
      )}

      {assistant.status === 'refused' &&
        !assistant.turns.some(
          (turn) => turn.answer === ASSISTANT_REFUSAL_MESSAGE,
        ) && <p>{ASSISTANT_REFUSAL_MESSAGE}</p>}

      <p className="assistant-live-status" role="status" aria-live="polite">
        {assistant.liveStatus}
      </p>

      <form
        className="assistant-composer"
        onSubmit={(event) => void submit(event)}
      >
        <label htmlFor="assistant-question">Question</label>
        <textarea
          id="assistant-question"
          value={question}
          maxLength={1_000}
          rows={3}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about the documented application…"
        />
        <div className="assistant-actions">
          <Button
            type="submit"
            disabled={
              assistant.isActive || isLoggingOut || question.trim().length === 0
            }
          >
            Ask assistant
          </Button>
          {assistant.isActive && (
            <Button
              type="button"
              className="button-secondary"
              disabled={assistant.isStopping}
              onClick={assistant.stop}
            >
              {assistant.isStopping ? 'Stopping generation' : 'Stop generating'}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
