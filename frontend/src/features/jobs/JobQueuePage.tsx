import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { jobsApi } from "./jobsApi";
import { InstructionsPanel } from "./InstructionsPanel";
import { GuidelinesModal } from "./GuidelinesModal";
import { QueueRow } from "@/shared/api/types";
import { formatStatus } from "@/shared/format";
import { Button } from "@/shared/ui/Button";
import { Logo } from "@/shared/ui/Logo";
import { ThemeToggle } from "@/shared/ui/ThemeToggle";
import { useAuthStore } from "@/features/auth/authStore";

export function JobQueuePage() {
  // This page is for ANNOTATOR (prod) and REVIEWER (QA) only — both work
  // through queue rows, one per queue name however many documents were
  // posted under it. Admin never picks/works a task here at all; Admin's
  // whole world is the /admin dashboard (queues, users, submissions, and
  // a view-only doc render with no tool whatsoever — see AdminDocumentPage).
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueExhausted, setQueueExhausted] = useState(false);
  // Set the moment a background refresh notices the row the person had
  // selected disappeared out from under them — i.e. someone else picked
  // the last available document in it since the list last loaded. Cleared
  // as soon as they pick a different row.
  const [selectionTaken, setSelectionTaken] = useState(false);

  // A REVIEWER only ever sees/picks from the QA-stage queue; an
  // ANNOTATOR sees the prod-stage queue. Doesn't matter what this
  // resolves to for Admin, since they're redirected away below before
  // ever rendering the table.
  const isReviewer = user?.role === "REVIEWER";
  const queueGroup = isReviewer ? "qa" : "prod";
  // Whether the currently-selected queue row has a document this user
  // already started and stopped partway through — same flag the "In
  // progress" pause-glyph badge in the table below reads.
  const isResumingSelected = Boolean(rows.find((r) => r.id === selectedId)?.hasResumableForUser);

  useEffect(() => {
    if (user?.role === "ADMIN") return; // redirected away below; skip the fetch
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQueueExhausted(false);
    setSelectionTaken(false);
    setSelectedId(null);

    jobsApi
      .listQueues({ search, group: queueGroup })
      .then((res) => {
        if (cancelled) return;
        setRows(res.queues);
        setTotal(res.total);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [search, queueGroup, user?.role]);

  // Background refresh: someone else picking (or releasing/skipping) a
  // task changes what's actually pickable out from under a list that was
  // only ever fetched once on load — without this, a row can keep showing
  // as available for as long as this page stays open even after another
  // annotator/reviewer has already taken the last document in it. Silent
  // (no loading state) so it doesn't flicker the table every 10s; skipped
  // entirely while a pick is in flight so it can't yank the list out from
  // under an in-progress "Start working" click.
  useEffect(() => {
    if (user?.role === "ADMIN") return;
    const interval = setInterval(() => {
      if (picking) return;
      jobsApi
        .listQueues({ search, group: queueGroup })
        .then((res) => {
          setRows(res.queues);
          setTotal(res.total);
        })
        .catch(() => {
          // A background refresh failing (network blip, momentarily
          // expired token mid-refresh, etc.) shouldn't interrupt anyone —
          // the list just tries again on the next tick.
        });
    }, 10000);
    return () => clearInterval(interval);
  }, [search, queueGroup, user?.role, picking]);

  // Rows with nothing left to pick (for this user's stage) simply drop out
  // of the list — that's what "prod2 shouldn't see a task prod1 already
  // picked" means for a 1-document queue. A row with a document this user
  // specifically has paused stays visible either way, so they can always
  // get back to their own in-progress work.
  const visibleRows = useMemo(
    () => rows.filter((r) => r.availableDocs > 0 || r.hasResumableForUser),
    [rows]
  );

  // If the row someone had selected just vanished from visibleRows (taken
  // by someone else since the last refresh), clear the stale selection and
  // say so, rather than leaving a now-invalid row looking selected.
  useEffect(() => {
    if (!selectedId) return;
    if (visibleRows.some((r) => r.id === selectedId)) return;
    setSelectedId(null);
    setSelectionTaken(true);
  }, [visibleRows, selectedId]);

  async function handleStartWorking() {
    if (!selectedId) return;

    // The server picks one document out of this queue row that's
    // unclaimed for this user's stage — AVAILABLE for an annotator,
    // SUBMITTED for a reviewer (preferring one this user hasn't already
    // skipped/released) — assigns it to them, and hands back its id. This
    // is what makes re-opening the same queue after a skip/release
    // "shuffle" into a different document instead of always the same one.
    setError(null);
    setQueueExhausted(false);
    setSelectionTaken(false);
    setPicking(true);
    try {
      const { jobId, resumed } = await jobsApi.pickFromQueue(selectedId);
      navigate(isReviewer ? `/jobs/${jobId}/review` : `/jobs/${jobId}/annotate`, {
        state: resumed ? { resumed: true } : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Nothing available in that queue right now.";
      // Distinguish "you finished the whole queue" (the backend's specific
      // 409 for an empty pickable pool) from an actual failure — this is a
      // good outcome for the person, not an error, so it gets its own
      // congratulatory banner instead of looking like something broke.
      if (message.includes("No available documents left")) {
        setQueueExhausted(true);
      } else {
        setError(message);
      }
    } finally {
      setPicking(false);
    }
  }

  // Admin never picks/works a task here — bounce straight to their own
  // dashboard. This sits after all the hooks above (never before) so the
  // hook-call order stays identical on every render.
  if (user?.role === "ADMIN") {
    return <Navigate to="/admin" replace />;
  }

  return (
    <div style={{ width: "100%", padding: "24px 28px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          rowGap: 10,
          borderBottom: "1px solid var(--color-border)",
          paddingBottom: 12,
          marginBottom: 20,
        }}
      >
        <Logo size={22} />
        <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", rowGap: 8 }}>
          <span style={{ color: "var(--color-text-muted)" }}>Hello, {user?.email}</span>
          <ThemeToggle />
          <Button onClick={logout}>Log out</Button>
        </span>
      </header>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <label style={{ fontSize: 14 }}>
          <input
            type="checkbox"
            checked={showInstructions}
            onChange={(e) => setShowInstructions(e.target.checked)}
          />{" "}
          Show instructions
        </label>
      </div>

      {showInstructions && <InstructionsPanel />}

      {/* Prod (ANNOTATOR) side only — reviewers have their own QA process
          and don't need the new-annotator onboarding prompt. */}
      {showInstructions && !isReviewer && (
        <div style={{ marginBottom: 20 }}>
          <Button onClick={() => setShowGuidelines(true)}>Are you new?</Button>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-text-muted)" }}>
            Here are our guidelines...
          </p>
        </div>
      )}

      <GuidelinesModal open={showGuidelines} onClose={() => setShowGuidelines(false)} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>{isReviewer ? "QA queues" : "Job queues"} ({visibleRows.length})</h2>
        <Button variant="primary" disabled={!selectedId || picking} onClick={handleStartWorking}>
          {picking
            ? "Picking a document…"
            : // Resuming a document you stopped partway through skips the
              // locked "click QA to unlock" preview page entirely (the
              // workspace opens already-unlocked — see AnnotationWorkspacePage's
              // `resumed` nav state), so the button that gets you there
              // should say "Start working" too, not "Review" — "Review"
              // only makes sense for the locked-preview flow a fresh pick
              // actually goes through.
              isReviewer && !isResumingSelected
              ? "Review"
              : "Start working"}
        </Button>
      </div>

      <input
        placeholder="Search task title…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: "100%",
          padding: "8px 10px",
          marginBottom: 12,
          border: "1px solid var(--color-border)",
          borderRadius: 4,
          background: "var(--color-bg)",
          color: "var(--color-text)",
        }}
      />

      {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}
      {selectionTaken && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            marginBottom: 4,
            borderRadius: 8,
            background: "var(--color-warning-soft)",
            border: "1px solid var(--color-warning-border)",
            color: "var(--color-warning-text)",
            fontSize: 14,
          }}
        >
          <span style={{ fontSize: 18 }}>⏱</span>
          <span>That task was just picked up by someone else. Pick another from the list below.</span>
        </div>
      )}
      {queueExhausted && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            marginBottom: 4,
            borderRadius: 8,
            background: "var(--color-success-soft)",
            border: "1px solid var(--color-success-border)",
            color: "var(--color-success-text)",
            fontSize: 14,
          }}
        >
          <span style={{ fontSize: 20 }}>🎉</span>
          <span>
            <strong>Nice work — this queue is all caught up!</strong> There's nothing left to pick right now.
            Check back later, or choose a different queue above.
          </span>
        </div>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                <th style={{ width: 30 }} />
                <th style={thStyle}>Queue name</th>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Docs</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Creation time</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => {
                    setSelectionTaken(false);
                    setSelectedId(row.id);
                  }}
                  style={{
                    cursor: "pointer",
                    background: selectedId === row.id ? "var(--color-surface)" : "transparent",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <td style={tdStyle}>
                    <input type="radio" checked={selectedId === row.id} readOnly />
                  </td>
                  {/* Only the queue name is shown here — a queue posted
                      with 5 docs still shows as a single row, never the
                      individual documents inside it. */}
                  <td style={tdStyle}>{row.title}</td>
                  <td style={tdStyle}>{row.customer?.name}</td>
                  <td style={tdStyle}>
                    {row.totalDocs > 1 ? `${row.availableDocs} of ${row.totalDocs} available` : "1 doc"}
                  </td>
                  <td style={tdStyle}>
                    {row.hasResumableForUser ? (
                      <span
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-warning-text)" }}
                        title="You stopped partway through a document here — Start working resumes it."
                      >
                        {/* Simple two-bar pause glyph — no icon set has one
                            imported in this file, and a single Unicode ⏸
                            renders inconsistently across fonts, so this is
                            a small inline SVG instead. */}
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                          <rect x="2" y="1" width="3" height="10" rx="0.5" />
                          <rect x="7" y="1" width="3" height="10" rx="0.5" />
                        </svg>
                        In progress
                      </span>
                    ) : (
                      displayStatus(row.status, isReviewer)
                    )}
                  </td>
                  <td style={tdStyle}>{new Date(row.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, color: "var(--color-text-muted)" }}>
                    No queues available right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "8px 12px", fontSize: 13, color: "var(--color-text-muted)" };
const tdStyle: React.CSSProperties = { padding: "10px 12px", fontSize: 14 };

// A reviewer's own queue only ever shows two statuses — SUBMITTED
// ("unclaimed, ready for QA to pick up") or QA ("someone's actively
// reviewing it"). SUBMITTED is the literal, correct DB status (see
// lib/queues.ts's stage comment), but showing that word to a reviewer
// reads as "already finished, nothing to do" when it actually means the
// opposite for their queue — it's exactly what pickable/available means
// on the QA side. Purely a display relabel: the underlying status and
// state machine are untouched, and a prod annotator's own queue (where
// AVAILABLE already reads correctly) is never affected.
function displayStatus(status: string, isReviewerQueue: boolean): string {
  if (isReviewerQueue && status === "SUBMITTED") return "AVAILABLE";
  return formatStatus(status);
}
