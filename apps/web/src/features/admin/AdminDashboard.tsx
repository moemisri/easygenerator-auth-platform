import type {
  AdminUsersQuery,
  SafeUser,
  UserPage,
} from '@easygenerator/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '../../components/Button';
import { ProblemAlert } from '../../components/ProblemAlert';
import { useAuth } from '../auth/AuthProvider';
import { AuditTimeline } from './AuditTimeline';
import { UserTable } from './UserTable';
import {
  adminQueryKeys,
  useAdminAuditEvents,
  useAdminUsers,
} from './use-admin-users';

const PAGE_SIZE = 20;
const DEFAULT_SORT = 'createdAt';
const DEFAULT_DIRECTION = 'desc';

function positivePage(value: string | null): number {
  return value && /^[1-9][0-9]*$/.test(value) ? Number(value) : 1;
}

export function AdminDashboard() {
  const { user: actor, csrfToken } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = positivePage(searchParams.get('page'));
  const committedSearch = searchParams.get('search') ?? '';
  const [search, setSearch] = useState(committedSearch);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const staleNoticeRef = useRef<HTMLParagraphElement>(null);
  const query = useMemo<AdminUsersQuery>(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      search: committedSearch || undefined,
      sort: DEFAULT_SORT,
      direction: DEFAULT_DIRECTION,
    }),
    [committedSearch, page],
  );
  const users = useAdminUsers(query);
  const audits = useAdminAuditEvents({ page: 1, pageSize: PAGE_SIZE });

  const recoverStaleUser = useCallback(
    async (target: SafeUser) => {
      setStaleNotice(null);
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'audit-events'],
      });
      const usersKey = adminQueryKeys.users(query);
      try {
        await queryClient.invalidateQueries(
          { queryKey: usersKey, exact: true },
          { throwOnError: true },
        );
      } catch {
        return;
      }
      const refreshedTarget = queryClient
        .getQueryData<UserPage>(usersKey)
        ?.items.find((user) => user.id === target.id);
      if (!refreshedTarget || refreshedTarget.version <= target.version) return;
      setStaleNotice(
        `${target.name} changed elsewhere. The latest record is now loaded.`,
      );
    },
    [query, queryClient],
  );

  useEffect(() => {
    if (staleNotice) staleNoticeRef.current?.focus();
  }, [staleNotice]);

  useEffect(() => {
    setSearch(committedSearch);
  }, [committedSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = search.trim();
      if (nextSearch === committedSearch) return;
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextSearch) next.set('search', nextSearch);
          else next.delete('search');
          next.set('page', '1');
          return next;
        },
        { replace: true },
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [committedSearch, search, setSearchParams]);

  const setPage = (nextPage: number) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('page', String(nextPage));
      return next;
    });
  };

  const total = users.data?.total ?? 0;
  const hasNextPage = page * PAGE_SIZE < total;

  return (
    <div className="admin-dashboard">
      <p
        ref={staleNoticeRef}
        className="action-notice"
        aria-live="polite"
        tabIndex={-1}
      >
        {staleNotice ?? ''}
      </p>
      <section className="admin-summary" aria-labelledby="directory-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Directory register</p>
            <h2 id="directory-heading">People and access</h2>
          </div>
          <p
            role="status"
            aria-label="User directory status"
            className="quiet-status"
          >
            {users.isPending
              ? 'Loading users…'
              : users.isFetching
                ? 'Updating results'
                : ''}
          </p>
        </div>

        {users.data && (
          <div className="summary-strip" aria-label="User summary">
            <article>
              <span>{users.data.summary.total}</span>
              <p>Total accounts</p>
            </article>
            <article>
              <span>{users.data.summary.active}</span>
              <p>Active accounts</p>
            </article>
          </div>
        )}

        <label className="admin-search">
          <span>Search users</span>
          <input
            type="search"
            maxLength={100}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or email"
          />
        </label>

        {users.isError && (
          <div className="load-problem">
            <ProblemAlert message="Unable to load users. Please retry." />
            <Button type="button" onClick={() => void users.refetch()}>
              Retry users
            </Button>
          </div>
        )}
        {users.data && (
          <>
            <div className="result-meta">
              <p>
                {users.data.total}{' '}
                {users.data.total === 1 ? 'result' : 'results'}
              </p>
              <p>Page {page}</p>
            </div>
            {users.data.items.length === 0 ? (
              <p className="empty-state">No users match this search.</p>
            ) : (
              actor &&
              csrfToken && (
                <UserTable
                  users={users.data.items}
                  actor={actor}
                  csrfToken={csrfToken}
                  onStaleRecovery={recoverStaleUser}
                />
              )
            )}
            <nav className="pagination" aria-label="User directory pages">
              <Button
                type="button"
                aria-label="Previous users page"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                type="button"
                aria-label="Next users page"
                disabled={!hasNextPage}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </nav>
          </>
        )}
      </section>

      <section className="audit-section" aria-labelledby="audit-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Redacted record</p>
            <h2 id="audit-heading">Recent audit events</h2>
          </div>
          <p
            role="status"
            aria-label="Audit timeline status"
            className="quiet-status"
          >
            {audits.isPending
              ? 'Loading audit events…'
              : audits.isFetching
                ? 'Updating audit events'
                : ''}
          </p>
        </div>
        {audits.isError && (
          <div className="load-problem">
            <ProblemAlert message="Unable to load audit events. Please retry." />
            <Button type="button" onClick={() => void audits.refetch()}>
              Retry audit events
            </Button>
          </div>
        )}
        {audits.data && <AuditTimeline events={audits.data.items} />}
      </section>
    </div>
  );
}
