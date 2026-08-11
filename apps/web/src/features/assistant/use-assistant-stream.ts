import type {
  AssistantHistoryItem,
  AssistantSource,
  AssistantSseEvent,
} from '@easygenerator/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiProblem } from '../../lib/api-client';
import { openAssistantStream } from './assistant-api';
import { AssistantProtocolError, parseEventStream } from './parse-event-stream';
import { registerAssistantStream } from './assistant-stream-registry';

const CLIENT_DEADLINE_MS = 30_000;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARACTERS = 6_000;
const MAX_HISTORY_ITEM_CHARACTERS = 1_000;
const MAX_DISPLAY_ANSWER_CHARACTERS = 65_536;

export const ASSISTANT_REFUSAL_MESSAGE =
  'The public documentation does not support an answer to that question. Try a new question about the documented application behavior.';

type StreamStatus =
  | 'idle'
  | 'streaming'
  | 'stopping'
  | 'complete'
  | 'refused'
  | 'stopped'
  | 'error'
  | 'disabled';

export type AssistantTurn = {
  question: string;
  answer: string;
  sources: AssistantSource[];
  outcome: 'answered' | 'refused';
};

type ActiveAttempt = {
  question: string;
  answer: string;
  sources: AssistantSource[];
};

type StreamError = {
  message: string;
  retryAfter?: number;
};

type AbortReason = 'stop' | 'timeout' | 'logout' | 'unmount';

type Completion =
  | {
      kind: 'done';
      outcome: 'answered' | 'refused';
      answer: string;
      sources: AssistantSource[];
    }
  | { kind: 'server-error'; message: string }
  | { kind: 'disabled' }
  | { kind: 'failed'; error: StreamError }
  | { kind: 'aborted'; reason: AbortReason };

function boundedHistoryContent(content: string) {
  if (content.length <= MAX_HISTORY_ITEM_CHARACTERS) return content;
  let end = MAX_HISTORY_ITEM_CHARACTERS;
  const previous = content.charCodeAt(end - 1);
  const next = content.charCodeAt(end);
  if (
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  ) {
    end -= 1;
  }
  return content.slice(0, end);
}

function historyFrom(turns: AssistantTurn[]): AssistantHistoryItem[] {
  return turns.flatMap(({ question, answer }) =>
    answer
      ? [
          { role: 'user' as const, content: question },
          {
            role: 'assistant' as const,
            content: boundedHistoryContent(answer),
          },
        ]
      : [],
  );
}

function boundTurns(turns: AssistantTurn[]) {
  const bounded = turns.slice();
  while (bounded.length > 0) {
    const history = historyFrom(bounded);
    const characters = history.reduce(
      (total, message) => total + message.content.length,
      0,
    );
    if (
      bounded.length <= MAX_HISTORY_MESSAGES / 2 &&
      history.length <= MAX_HISTORY_MESSAGES &&
      characters <= MAX_HISTORY_CHARACTERS
    ) {
      break;
    }
    bounded.shift();
  }
  return bounded;
}

function isAbortError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

function safeRequestError(error: unknown): StreamError {
  if (error instanceof ApiProblem && error.status === 429) {
    const result: StreamError = {
      message: 'The assistant is busy right now. Please try again shortly.',
    };
    if (error.retryAfter !== undefined) result.retryAfter = error.retryAfter;
    return result;
  }
  return {
    message: 'The assistant request could not be completed. Please try again.',
  };
}

export function useAssistantStream({
  csrfToken,
  enabled,
  interactionLocked,
}: {
  csrfToken: string | null;
  enabled: boolean;
  interactionLocked: boolean;
}) {
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [attempt, setAttempt] = useState<ActiveAttempt | null>(null);
  const [status, setStatus] = useState<StreamStatus>(
    enabled ? 'idle' : 'disabled',
  );
  const [liveStatus, setLiveStatus] = useState(
    enabled ? 'Ready for a question.' : 'Assistant unavailable.',
  );
  const [error, setError] = useState<StreamError | null>(null);
  const [requestActive, setRequestActive] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const turnsRef = useRef(turns);
  const activeControllerRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<AbortReason | undefined>(undefined);
  const mountedRef = useRef(false);

  const abortActive = useCallback((reason: AbortReason) => {
    const controller = activeControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    abortReasonRef.current = reason;
    controller.abort();
    if (!mountedRef.current || reason === 'unmount') return;
    setStatus('stopping');
    setLiveStatus(
      reason === 'timeout'
        ? 'Stopping timed-out request.'
        : 'Stopping generation.',
    );
    setError(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortActive('unmount');
    };
  }, [abortActive]);

  useEffect(() => {
    if (enabled) {
      setStatus((current) => (current === 'disabled' ? 'idle' : current));
      return;
    }
    abortActive('logout');
    setStatus('disabled');
    setLiveStatus('Assistant unavailable.');
    setError(null);
  }, [abortActive, enabled]);

  const send = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (
        !enabled ||
        !csrfToken ||
        interactionLocked ||
        !question ||
        question.length > MAX_HISTORY_ITEM_CHARACTERS ||
        activeControllerRef.current
      ) {
        return false;
      }

      const controller = new AbortController();
      activeControllerRef.current = controller;
      abortReasonRef.current = undefined;
      setRequestActive(true);
      setLastQuestion(question);
      setAttempt({ question, answer: '', sources: [] });
      setError(null);
      setStatus('streaming');
      setLiveStatus('Answer in progress.');
      const unregister = registerAssistantStream(() => abortActive('logout'));
      const deadline = window.setTimeout(
        () => abortActive('timeout'),
        CLIENT_DEADLINE_MS,
      );
      let terminal:
        Extract<AssistantSseEvent, { type: 'done' | 'error' }> | undefined;
      let answer = '';
      let sources: AssistantSource[] = [];
      let completion: Completion | undefined;

      try {
        const history = historyFrom(turnsRef.current);
        const body = await openAssistantStream(
          { message: question, history },
          csrfToken,
          controller.signal,
        );
        for await (const event of parseEventStream(body)) {
          if (event.type === 'sources') {
            sources = event.data.sources;
            if (mountedRef.current) {
              setAttempt((current) =>
                current ? { ...current, sources: event.data.sources } : current,
              );
              setLiveStatus(
                sources.length > 0
                  ? 'Sources available. Answer in progress.'
                  : 'Documentation checked.',
              );
            }
          } else if (event.type === 'delta') {
            if (
              event.data.text.length >
              MAX_DISPLAY_ANSWER_CHARACTERS - answer.length
            ) {
              throw new AssistantProtocolError();
            }
            answer += event.data.text;
            if (mountedRef.current) {
              setAttempt((current) =>
                current ? { ...current, answer } : current,
              );
            }
          } else {
            terminal = event;
          }
        }

        if (!terminal) throw new AssistantProtocolError();
        completion =
          terminal.type === 'error'
            ? { kind: 'server-error', message: terminal.data.message }
            : {
                kind: 'done',
                outcome: terminal.data.outcome,
                answer,
                sources,
              };
      } catch (caught) {
        if (controller.signal.aborted || isAbortError(caught)) {
          completion = {
            kind: 'aborted',
            reason: abortReasonRef.current ?? 'stop',
          };
        } else if (
          caught instanceof ApiProblem &&
          caught.code === 'ASSISTANT_DISABLED'
        ) {
          completion = { kind: 'disabled' };
        } else {
          if (caught instanceof AssistantProtocolError) controller.abort();
          completion = { kind: 'failed', error: safeRequestError(caught) };
        }
      } finally {
        window.clearTimeout(deadline);
        unregister();
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
        abortReasonRef.current = undefined;
      }

      if (!mountedRef.current || !completion) return true;
      setRequestActive(false);

      if (completion.kind === 'done') {
        const refused = completion.outcome === 'refused';
        const completedAnswer = refused
          ? ASSISTANT_REFUSAL_MESSAGE
          : completion.answer;
        const nextTurns = boundTurns([
          ...turnsRef.current,
          {
            question,
            answer: completedAnswer,
            sources: completion.sources,
            outcome: completion.outcome,
          },
        ]);
        turnsRef.current = nextTurns;
        setTurns(nextTurns);
        setAttempt(null);
        setStatus(refused ? 'refused' : 'complete');
        setLiveStatus(refused ? 'Question refused.' : 'Answer complete.');
      } else if (completion.kind === 'server-error') {
        setStatus('error');
        setLiveStatus('Assistant request failed.');
        setError({ message: completion.message });
      } else if (completion.kind === 'disabled') {
        setAttempt(null);
        setStatus('disabled');
        setLiveStatus('Assistant unavailable.');
        setError(null);
      } else if (completion.kind === 'failed') {
        setStatus('error');
        setLiveStatus('Assistant request failed.');
        setError(completion.error);
      } else if (completion.reason !== 'unmount') {
        if (completion.reason === 'timeout') {
          setStatus('error');
          setLiveStatus('Assistant request failed.');
          setError({
            message:
              'The assistant took too long to respond. Please try again.',
          });
        } else {
          setStatus('stopped');
          setLiveStatus('Generation stopped.');
          setError({
            message: 'Generation stopped. You can retry the question.',
          });
        }
      }
      return true;
    },
    [abortActive, csrfToken, enabled, interactionLocked],
  );

  return {
    turns,
    attempt,
    status,
    liveStatus,
    error,
    isActive: requestActive,
    isStopping: status === 'stopping',
    send,
    stop: () => abortActive('stop'),
    retry: () => (lastQuestion ? send(lastQuestion) : Promise.resolve(false)),
  };
}
