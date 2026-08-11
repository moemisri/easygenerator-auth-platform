import type { Role, SafeUser } from '@easygenerator/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createQueryClient } from '../../app/query-client';
import { UserTable } from './UserTable';

const onStaleRecovery = async () => undefined;

function person(
  id: string,
  name: string,
  role: Role,
  status: SafeUser['status'] = 'ACTIVE',
): SafeUser {
  return {
    id,
    name,
    email: `${id}@example.com`,
    role,
    status,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderTable(actor: SafeUser, target: SafeUser) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <UserTable
        users={[target]}
        actor={actor}
        csrfToken={'c'.repeat(32)}
        onStaleRecovery={onStaleRecovery}
      />
    </QueryClientProvider>,
  );
}

function expectControls(name: string, visible: boolean) {
  expect(
    screen.queryAllByRole('button', { name: `Change ${name}'s role` }),
  ).toHaveLength(visible ? 2 : 0);
  expect(
    screen.queryAllByRole('button', { name: `Disable ${name}'s account` }),
  ).toHaveLength(visible ? 2 : 0);
}

describe('UserTable permission policy', () => {
  it('renders no mutation controls for support', () => {
    renderTable(
      person('support-actor', 'Support operator', 'SUPPORT'),
      person('ada', 'Ada Lovelace', 'USER'),
    );

    expectControls('Ada Lovelace', false);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it.each([
    ['manager-actor', 'Manager operator', 'MANAGER', false],
    ['admin-target', 'Admin target', 'ADMIN', false],
    ['support-target', 'Support target', 'SUPPORT', true],
    ['user-target', 'User target', 'USER', true],
  ] as const)(
    'applies manager target policy to %s',
    (targetId, targetName, targetRole, visible) => {
      renderTable(
        person('manager-actor', 'Manager operator', 'MANAGER'),
        person(targetId, targetName, targetRole),
      );

      expectControls(targetName, visible);
    },
  );

  it('lets an admin manage another admin but never themselves', () => {
    const admin = person('admin-actor', 'Admin operator', 'ADMIN');
    const { rerender } = renderTable(
      admin,
      person('admin-target', 'Admin target', 'ADMIN'),
    );
    expectControls('Admin target', true);

    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <UserTable
          users={[admin]}
          actor={admin}
          csrfToken={'c'.repeat(32)}
          onStaleRecovery={onStaleRecovery}
        />
      </QueryClientProvider>,
    );
    expectControls('Admin operator', false);
  });

  it('limits manager role assignments to USER and SUPPORT', () => {
    renderTable(
      person('manager-actor', 'Manager operator', 'MANAGER'),
      person('ada', 'Ada Lovelace', 'USER'),
    );

    const options = screen
      .getAllByRole('combobox', { name: 'New role for Ada Lovelace' })[0]
      ?.querySelectorAll('option');
    expect(Array.from(options ?? [], (option) => option.textContent)).toEqual([
      'SUPPORT',
    ]);
  });

  it('offers an admin every other role', () => {
    renderTable(
      person('admin-actor', 'Admin operator', 'ADMIN'),
      person('ada', 'Ada Lovelace', 'USER'),
    );

    const options = screen
      .getAllByRole('combobox', { name: 'New role for Ada Lovelace' })[0]
      ?.querySelectorAll('option');
    expect(Array.from(options ?? [], (option) => option.textContent)).toEqual([
      'SUPPORT',
      'MANAGER',
      'ADMIN',
    ]);
  });

  it('resets the proposed role when a refreshed server version changes the target', async () => {
    const queryClient = createQueryClient();
    const manager = person('manager-actor', 'Manager operator', 'MANAGER');
    const initial = person('ada', 'Ada Lovelace', 'USER');
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <UserTable
          users={[initial]}
          actor={manager}
          csrfToken={'c'.repeat(32)}
          onStaleRecovery={onStaleRecovery}
        />
      </QueryClientProvider>,
    );
    const refreshed = { ...initial, role: 'SUPPORT' as const, version: 2 };
    rerender(
      <QueryClientProvider client={queryClient}>
        <UserTable
          users={[refreshed]}
          actor={manager}
          csrfToken={'c'.repeat(32)}
          onStaleRecovery={onStaleRecovery}
        />
      </QueryClientProvider>,
    );

    await userEvent.click(
      screen.getAllByRole('button', {
        name: "Change Ada Lovelace's role",
      })[0]!,
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      "Change Ada Lovelace's role from SUPPORT to USER?",
    );
  });
});
