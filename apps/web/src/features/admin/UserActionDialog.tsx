import type { Role, SafeUser, UserStatus } from '@easygenerator/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';

import { Button } from '../../components/Button';
import { ProblemAlert } from '../../components/ProblemAlert';
import { ApiProblem } from '../../lib/api-client';
import { adminApi } from './admin-api';

export type UserAction =
  { kind: 'role'; role: Role } | { kind: 'status'; status: UserStatus };

function actionCopy(target: SafeUser, action: UserAction) {
  if (action.kind === 'role') {
    return {
      title: `Change ${target.name}'s role from ${target.role} to ${action.role}?`,
      description:
        'Their available administration tools will change as soon as this update succeeds.',
      confirm: 'Change role',
    };
  }
  const disabling = action.status === 'DISABLED';
  return {
    title: `${disabling ? 'Disable' : 'Enable'} ${target.name}'s account?`,
    description: disabling
      ? 'They will no longer be able to use authenticated application features.'
      : 'They will be able to sign in and use their assigned features again.',
    confirm: `${disabling ? 'Disable' : 'Enable'} account`,
  };
}

function mutationProblemMessage(caught: unknown): string {
  if (!(caught instanceof ApiProblem)) {
    return 'Unable to update this account. Please retry.';
  }
  if (caught.code === 'LAST_ACTIVE_ADMIN_PROTECTED') {
    return 'The last active administrator cannot be disabled or demoted.';
  }
  if (caught.code === 'TARGET_UPDATE_FORBIDDEN') {
    return 'You no longer have permission to update this account.';
  }
  return caught.detail ?? caught.title;
}

export function UserActionDialog({
  target,
  action,
  csrfToken,
  triggerLabel,
  onStaleRecovery,
}: {
  target: SafeUser;
  action: UserAction;
  csrfToken: string;
  triggerLabel: string;
  onStaleRecovery: (target: SafeUser) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryBlocked, setRetryBlocked] = useState(false);
  const copy = actionCopy(target, action);

  const refreshRecords = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-events'] }),
    ]);
  };

  const mutation = useMutation({
    mutationFn: () =>
      adminApi.updateUser(
        target.id,
        action.kind === 'role'
          ? { version: target.version, role: action.role }
          : { version: target.version, status: action.status },
        csrfToken,
      ),
    onSuccess: async () => {
      setOpen(false);
      await refreshRecords();
    },
    onError: async (caught: unknown) => {
      if (
        caught instanceof ApiProblem &&
        caught.status === 409 &&
        caught.code === 'STALE_USER_VERSION'
      ) {
        setOpen(false);
        await onStaleRecovery(target);
        return;
      }

      if (
        caught instanceof ApiProblem &&
        (caught.status === 403 || caught.status === 409)
      ) {
        setError(mutationProblemMessage(caught));
        setRetryBlocked(true);
        void refreshRecords().catch(() => undefined);
        return;
      }
      setError(mutationProblemMessage(caught));
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (mutation.isPending) return;
    setOpen(nextOpen);
    if (nextOpen) {
      setError(null);
      setRetryBlocked(false);
      mutation.reset();
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <Button
          type="button"
          className="button-secondary"
          aria-disabled={mutation.isPending || undefined}
        >
          {triggerLabel}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content"
          onEscapeKeyDown={(event) => {
            if (mutation.isPending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (mutation.isPending) event.preventDefault();
          }}
        >
          <p className="eyebrow">Confirm account change</p>
          <Dialog.Title>{copy.title}</Dialog.Title>
          <Dialog.Description>{copy.description}</Dialog.Description>
          {error && <ProblemAlert message={error} />}
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <Button
                type="button"
                className="button-secondary"
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              className="button-danger"
              disabled={mutation.isPending || retryBlocked}
              onClick={() => {
                setError(null);
                setRetryBlocked(false);
                mutation.mutate();
              }}
            >
              {mutation.isPending ? 'Updating…' : copy.confirm}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
