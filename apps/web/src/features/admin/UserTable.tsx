import type { Role, SafeUser } from '@easygenerator/contracts';
import { useState } from 'react';

import { UserActionDialog } from './UserActionDialog';

const ROLES: Role[] = ['USER', 'SUPPORT', 'MANAGER', 'ADMIN'];

export function canManageUser(actor: SafeUser, target: SafeUser): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === 'ADMIN') return true;
  return (
    actor.role === 'MANAGER' &&
    (target.role === 'USER' || target.role === 'SUPPORT')
  );
}

export function assignableRoles(actor: SafeUser, target: SafeUser): Role[] {
  if (!canManageUser(actor, target)) return [];
  const allowed =
    actor.role === 'ADMIN' ? ROLES : (['USER', 'SUPPORT'] satisfies Role[]);
  return allowed.filter((role) => role !== target.role);
}

function UserFacts({ user }: { user: SafeUser }) {
  return (
    <>
      <span className="user-name">{user.name}</span>
      <span className="user-email">{user.email}</span>
    </>
  );
}

function UserControls({
  actor,
  target,
  csrfToken,
}: {
  actor: SafeUser;
  target: SafeUser;
  csrfToken: string;
}) {
  const roles = assignableRoles(actor, target);
  const [role, setRole] = useState<Role | undefined>(roles[0]);

  if (!canManageUser(actor, target) || !role) return null;

  const nextStatus = target.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  const statusVerb = nextStatus === 'DISABLED' ? 'Disable' : 'Enable';

  return (
    <div className="user-actions">
      <label>
        <span className="visually-hidden">New role for {target.name}</span>
        <select
          aria-label={`New role for ${target.name}`}
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
        >
          {roles.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
      </label>
      <UserActionDialog
        target={target}
        action={{ kind: 'role', role }}
        csrfToken={csrfToken}
        triggerLabel={`Change ${target.name}'s role`}
      />
      <UserActionDialog
        target={target}
        action={{ kind: 'status', status: nextStatus }}
        csrfToken={csrfToken}
        triggerLabel={`${statusVerb} ${target.name}'s account`}
      />
    </div>
  );
}

export function UserTable({
  users,
  actor,
  csrfToken,
}: {
  users: SafeUser[];
  actor: SafeUser;
  csrfToken: string;
}) {
  const hasActions = users.some((user) => canManageUser(actor, user));

  return (
    <div className="user-directory">
      <div className="user-table-wrap">
        <table aria-label="User directory" className="user-table">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Joined</th>
              {hasActions && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <th scope="row">
                  <UserFacts user={user} />
                </th>
                <td>
                  <span className="data-badge">{user.role}</span>
                </td>
                <td>
                  <span className="status-badge" data-status={user.status}>
                    {user.status}
                  </span>
                </td>
                <td>
                  <time dateTime={user.createdAt}>
                    {new Date(user.createdAt).toLocaleDateString()}
                  </time>
                </td>
                {hasActions && (
                  <td>
                    <UserControls
                      key={user.version}
                      actor={actor}
                      target={user}
                      csrfToken={csrfToken}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="user-card-list" aria-label="User directory cards">
        {users.map((user) => (
          <li key={user.id} className="user-card">
            <div className="user-card-heading">
              <UserFacts user={user} />
            </div>
            <dl>
              <div>
                <dt>Role</dt>
                <dd className="data-badge">{user.role}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd className="status-badge" data-status={user.status}>
                  {user.status}
                </dd>
              </div>
              <div>
                <dt>Joined</dt>
                <dd>
                  <time dateTime={user.createdAt}>
                    {new Date(user.createdAt).toLocaleDateString()}
                  </time>
                </dd>
              </div>
            </dl>
            <UserControls
              key={user.version}
              actor={actor}
              target={user}
              csrfToken={csrfToken}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
