import type { Role } from '@easygenerator/contracts';

export const capabilities = [
  'USE_APP',
  'READ_USERS',
  'READ_AUDIT',
  'MANAGE_BASIC_USERS',
  'MANAGE_PRIVILEGED_USERS',
] as const;

export type Capability = (typeof capabilities)[number];

const roleCapabilities = {
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
} as const satisfies Record<Role, Record<Capability, boolean>>;

const knownRoles = new Set<string>(['USER', 'SUPPORT', 'MANAGER', 'ADMIN']);
const knownCapabilities = new Set<string>(capabilities);

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && knownRoles.has(value);
}

function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && knownCapabilities.has(value);
}

export function can(role: unknown, capability: unknown): boolean {
  return (
    isRole(role) &&
    isCapability(capability) &&
    roleCapabilities[role][capability]
  );
}

interface PolicyUser {
  id: string;
  role: unknown;
}

export function canUpdateUser(
  actor: PolicyUser,
  target: PolicyUser,
  proposedRole: unknown,
): boolean {
  if (
    actor.id === target.id ||
    !isRole(actor.role) ||
    !isRole(target.role) ||
    !isRole(proposedRole)
  ) {
    return false;
  }

  if (actor.role === 'ADMIN') return true;
  return (
    actor.role === 'MANAGER' &&
    (target.role === 'USER' || target.role === 'SUPPORT') &&
    (proposedRole === 'USER' || proposedRole === 'SUPPORT')
  );
}

interface AdminMembership {
  role: unknown;
  status: unknown;
}

export function removesActiveAdmin(
  current: AdminMembership,
  proposed: AdminMembership,
): boolean {
  const currentlyActiveAdmin =
    current.role === 'ADMIN' && current.status === 'ACTIVE';
  const remainsActiveAdmin =
    proposed.role === 'ADMIN' && proposed.status === 'ACTIVE';
  return currentlyActiveAdmin && !remainsActiveAdmin;
}
