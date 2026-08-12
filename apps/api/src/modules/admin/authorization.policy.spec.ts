import type { Role } from '@easygenerator/contracts';
import { describe, expect, it } from 'vitest';

import {
  capabilities,
  can,
  canUpdateUser,
  type Capability,
} from './authorization.policy';

const roles = ['USER', 'SUPPORT', 'MANAGER', 'ADMIN'] as const;

const expectedCapabilities: Record<Role, Record<Capability, boolean>> = {
  USER: {
    USE_APP: true,
    READ_USERS: false,
    READ_AUDIT: false,
    MANAGE_BASIC_USERS: false,
    MANAGE_PRIVILEGED_USERS: false,
  },
  SUPPORT: {
    USE_APP: true,
    READ_USERS: true,
    READ_AUDIT: true,
    MANAGE_BASIC_USERS: false,
    MANAGE_PRIVILEGED_USERS: false,
  },
  MANAGER: {
    USE_APP: true,
    READ_USERS: true,
    READ_AUDIT: true,
    MANAGE_BASIC_USERS: true,
    MANAGE_PRIVILEGED_USERS: false,
  },
  ADMIN: {
    USE_APP: true,
    READ_USERS: true,
    READ_AUDIT: true,
    MANAGE_BASIC_USERS: true,
    MANAGE_PRIVILEGED_USERS: true,
  },
};

describe('capability policy', () => {
  it.each(
    roles.flatMap((role) =>
      capabilities.map(
        (capability) =>
          [role, capability, expectedCapabilities[role][capability]] as const,
      ),
    ),
  )('%s / %s -> %s', (role, capability, expected) => {
    expect(can(role, capability)).toBe(expected);
  });

  it.each([
    [undefined, 'READ_USERS'],
    [null, 'READ_USERS'],
    ['', 'READ_USERS'],
    ['OWNER', 'READ_USERS'],
    ['ADMINISTRATOR', 'MANAGE_PRIVILEGED_USERS'],
    ['ADMIN', undefined],
    ['ADMIN', 'DELETE_USERS'],
  ])(
    'fails closed for malformed role/capability %j / %j',
    (role, capability) => {
      expect(can(role, capability)).toBe(false);
    },
  );
});

const transitionMatrix = [
  {
    target: 'USER',
    proposed: 'USER',
    USER: false,
    SUPPORT: false,
    MANAGER: true,
    ADMIN: true,
  },
  {
    target: 'USER',
    proposed: 'SUPPORT',
    USER: false,
    SUPPORT: false,
    MANAGER: true,
    ADMIN: true,
  },
  {
    target: 'USER',
    proposed: 'MANAGER',
    USER: false,
    SUPPORT: false,
    MANAGER: false,
    ADMIN: true,
  },
  {
    target: 'USER',
    proposed: 'ADMIN',
    USER: false,
    SUPPORT: false,
    MANAGER: false,
    ADMIN: true,
  },
  {
    target: 'SUPPORT',
    proposed: 'USER',
    USER: false,
    SUPPORT: false,
    MANAGER: true,
    ADMIN: true,
  },
  {
    target: 'SUPPORT',
    proposed: 'SUPPORT',
    USER: false,
    SUPPORT: false,
    MANAGER: true,
    ADMIN: true,
  },
  {
    target: 'SUPPORT',
    proposed: 'MANAGER',
    USER: false,
    SUPPORT: false,
    MANAGER: false,
    ADMIN: true,
  },
  {
    target: 'SUPPORT',
    proposed: 'ADMIN',
    USER: false,
    SUPPORT: false,
    MANAGER: false,
    ADMIN: true,
  },
  {
    target: 'MANAGER',
    proposed: 'USER',
    USER: false,
    SUPPORT: false,
    MANAGER: false,
    ADMIN: true,
  },
  {
    target: 'MANAGER',
    proposed: 'SUPPORT',
    USER: false,
    SUPPORT: false,
    MANAGER: false,
    ADMIN: true,
  },
  {
    target: 'MANAGER',
    proposed: 'MANAGER',
    USER: false,
    SUPPORT: false,
    MANAGER: false,
    ADMIN: true,
  },
  {
    target: 'MANAGER',
    proposed: 'ADMIN',
    USER: false,
    SUPPORT: false,
    MANAGER: false,
    ADMIN: true,
  },
  {
    target: 'ADMIN',
    proposed: 'USER',
    USER: false,
    SUPPORT: false,
    MANAGER: false,
    ADMIN: true,
  },
  {
    target: 'ADMIN',
    proposed: 'SUPPORT',
    USER: false,
    SUPPORT: false,
    MANAGER: false,
    ADMIN: true,
  },
  {
    target: 'ADMIN',
    proposed: 'MANAGER',
    USER: false,
    SUPPORT: false,
    MANAGER: false,
    ADMIN: true,
  },
  {
    target: 'ADMIN',
    proposed: 'ADMIN',
    USER: false,
    SUPPORT: false,
    MANAGER: false,
    ADMIN: true,
  },
] as const;

describe('actor/target policy', () => {
  it.each(
    transitionMatrix.flatMap((row) =>
      roles.map(
        (actor) => [actor, row.target, row.proposed, row[actor]] as const,
      ),
    ),
  )(
    '%s changing %s to %s -> %s',
    (actorRole, targetRole, proposedRole, expected) => {
      expect(
        canUpdateUser(
          { id: 'actor-id', role: actorRole },
          { id: 'target-id', role: targetRole },
          proposedRole,
        ),
      ).toBe(expected);
    },
  );

  it.each([
    ['MANAGER', 'MANAGER'],
    ['ADMIN', 'ADMIN'],
  ] as const)('forbids %s from changing self', (actorRole, proposedRole) => {
    expect(
      canUpdateUser(
        { id: 'same-id', role: actorRole },
        { id: 'same-id', role: actorRole },
        proposedRole,
      ),
    ).toBe(false);
  });

  it('fails closed when actor, target, or proposed roles are malformed', () => {
    expect(
      canUpdateUser(
        { id: 'actor-id', role: 'OWNER' },
        { id: 'target-id', role: 'USER' },
        'USER',
      ),
    ).toBe(false);
    expect(
      canUpdateUser(
        { id: 'actor-id', role: 'ADMIN' },
        { id: 'target-id', role: 'OWNER' },
        'USER',
      ),
    ).toBe(false);
    expect(
      canUpdateUser(
        { id: 'actor-id', role: 'ADMIN' },
        { id: 'target-id', role: 'USER' },
        'OWNER',
      ),
    ).toBe(false);
  });
});
