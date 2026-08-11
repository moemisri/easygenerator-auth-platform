import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deferred } from '../../test/deferred';
import { useAssistantStream } from './use-assistant-stream';

afterEach(() => vi.restoreAllMocks());

describe('useAssistantStream lifecycle', () => {
  it('does not dispatch state when an aborted request settles after unmount', async () => {
    const releaseSettlement = deferred<void>();
    let requestSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      requestSignal = init?.signal as AbortSignal;
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              requestSignal?.addEventListener(
                'abort',
                () => {
                  void releaseSettlement.promise.then(() =>
                    controller.error(new DOMException('Aborted', 'AbortError')),
                  );
                },
                { once: true },
              );
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );
    });
    const stateTransitions: string[] = [];
    const resourceCleanups: string[] = [];
    const lifecycleObserver = {
      onStateTransition: (transition: string) => {
        stateTransitions.push(transition);
      },
      onResourceCleanup: (resource: string) => {
        resourceCleanups.push(resource);
      },
    };
    const { result, unmount } = renderHook(() =>
      useAssistantStream({
        csrfToken: 'c'.repeat(32),
        enabled: true,
        interactionLocked: false,
        lifecycleObserver,
      }),
    );

    let pending!: Promise<boolean>;
    await act(async () => {
      pending = result.current.send('How are sessions protected?');
      await Promise.resolve();
    });
    await waitFor(() => expect(requestSignal).toBeDefined());
    await waitFor(() => expect(stateTransitions).toContain('request-started'));
    const transitionsAtUnmount = stateTransitions.length;

    unmount();
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => {
      releaseSettlement.resolve();
      await pending;
    });

    expect(resourceCleanups).toEqual(['deadline', 'registration']);
    expect(stateTransitions).toHaveLength(transitionsAtUnmount);
  });
});
