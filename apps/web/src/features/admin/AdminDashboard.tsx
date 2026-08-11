import type { AdminUsersQuery, SafeUser } from '@easygenerator/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '../../components/Button';
import { ProblemAlert } from '../../components/ProblemAlert';
import { useAuth } from '../auth/AuthProvider';
import { AuditTimeline } from './AuditTimeline';
import { UserTable } from './UserTable';
import { useAdminAuditEvents, useAdminUsers } from './use-admin-users';

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
  const query: AdminUsersQuery = {
    page,
    pageSize: PAGE_SIZE,
    search: committedSearch || undefined,
    sort: DEFAULT_SORT,
    direction: DEFAULT_DIRECTION,
  };
  const users = useAdminUsers(query);
  const audits = useAdminAuditEvents({ page: 1, pageSize: PAGE_SIZE });

  const recoverStaleUser = useCallback(
    async (target: SafeUser) => {
      setStaleNotice(null);
      const userRefresh = queryClient.invalidateQueries({
        queryKey: ['admin', 'users'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'audit-events'],
      });
      await userRefresh;
      setStaleNotice(
        `${target.name} changed elsewhere. The latest record is now loaded.`,
      );
    },
    [queryClient],
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
      {staleNotice && (
        <p
          ref={staleNoticeRef}
          className="action-notice"
          aria-live="polite"
          tabIndex={-1}
        >
          {staleNotice}
        </p>
      )}
      <section className="admin-summary" aria-labelledby="directory-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Directory register</p>
            <h2 id="directory-heading">People and access</h2>
          </div>
          {users.isFetching && !users.isPending && (
            <p role="status" className="quiet-status">
              Updating results
            </p>
          )}
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

        {users.isPending && <p role="status">Loading users…</p>}
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
          {audits.isFetching && !audits.isPending && (
            <p role="status" className="quiet-status">
              Updating audit events
            </p>
          )}
        </div>
        {audits.isPending && <p role="status">Loading audit events…</p>}
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
