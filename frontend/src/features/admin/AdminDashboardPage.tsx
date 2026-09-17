import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { adminApi, AdminUser, AdminUserGroup } from "./adminApi";
import { PostQueueForm } from "@/features/jobs/PostQueueForm";
import { QueueRow } from "@/shared/api/types";
import { formatStatus, prettifyEmail } from "@/shared/format";
import { useAuthStore } from "@/features/auth/authStore";
import { Button } from "@/shared/ui/Button";
import { Logo } from "@/shared/ui/Logo";
import { ThemeToggle } from "@/shared/ui/ThemeToggle";

export function AdminDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialGroup: AdminUserGroup = searchParams.get("group") === "qa" ? "qa" : "prod";

  const [group, setGroup] = useState<AdminUserGroup | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active queues — kept independent of the "manage users" tabs above, so
  // switching one doesn't disturb the other.
  const [queueGroup, setQueueGroup] = useState<AdminUserGroup>("prod");
  const [queues, setQueues] = useState<QueueRow[]>([]);
  const [queuesLoading, setQueuesLoading] = useState(false);
  const [queuesError, setQueuesError] = useState<string | null>(null);

  function openGroup(g: AdminUserGroup) {
    setGroup(g);
    setLoading(true);
    setError(null);
    adminApi
      .listUsers(g)
      .then((res) => setUsers(res.users))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load users"))
      .finally(() => setLoading(false));
  }

  function loadQueues(g: AdminUserGroup) {
    setQueuesLoading(true);
    setQueuesError(null);
    adminApi
      .listQueues(g)
      .then((res) => setQueues(res.queues))
      .catch((err) => setQueuesError(err instanceof Error ? err.message : "Failed to load queues"))
      .finally(() => setQueuesLoading(false));
  }

  useEffect(() => {
    openGroup(initialGroup);
    loadQueues(queueGroup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchQueueGroup(g: AdminUserGroup) {
    setQueueGroup(g);
    loadQueues(g);
  }

  return (
    <div style={{ width: "100%", padding: "24px 28px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid var(--color-border)",
          paddingBottom: 12,
          marginBottom: 20,
        }}
      >
        <Logo size={22} />
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>Hello, {user?.email}</span>
            <span style={badgeStyle}>Admin</span>
          </span>
          <ThemeToggle />
          <Button onClick={logout}>Log out</Button>
        </span>
      </header>

      <h2 style={{ margin: "0 0 16px" }}>Post a new queue</h2>
      <PostQueueForm onPosted={() => loadQueues(queueGroup)} />

      <h2 style={{ margin: "0 0 16px" }}>Active queues</h2>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <Button
          variant={queueGroup === "prod" ? "primary" : "secondary"}
          onClick={() => switchQueueGroup("prod")}
          style={{ padding: "12px 22px", fontSize: 15 }}
        >
          Prod queues
        </Button>
        <Button
          variant={queueGroup === "qa" ? "primary" : "secondary"}
          onClick={() => switchQueueGroup("qa")}
          style={{ padding: "12px 22px", fontSize: 15 }}
        >
          QA queues
        </Button>
        <div style={{ flex: 1 }} />
        <Button onClick={() => loadQueues(queueGroup)}>Refresh</Button>
      </div>

      {queuesError && <p style={{ color: "#dc2626" }}>{queuesError}</p>}

      {queuesLoading ? (
        <p>Loading…</p>
      ) : queues.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)", marginBottom: 32 }}>
          No {queueGroup === "prod" ? "Prod" : "QA"} queues posted yet.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 32 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
              <th style={thStyle}>Queue name</th>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>Task type</th>
              <th style={thStyle}>Docs</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Posted</th>
            </tr>
          </thead>
          <tbody>
            {queues.map((q) => (
              <tr key={q.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                {/* Only the queue name is shown — a queue posted with 5
                    docs still shows as this one row, never the individual
                    documents inside it. */}
                <td style={tdStyle}>{q.title}</td>
                <td style={tdStyle}>{q.customer?.name}</td>
                <td style={tdStyle}>{q.taskType}</td>
                <td style={tdStyle}>
                  {q.totalDocs > 1 ? `${q.availableDocs} of ${q.totalDocs} available` : "1 doc"}
                </td>
                <td style={tdStyle}>{formatStatus(q.status)}</td>
                <td style={tdStyle}>{new Date(q.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ margin: "0 0 16px" }}>Manage users</h2>

      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <Button
          variant={group === "prod" ? "primary" : "secondary"}
          onClick={() => openGroup("prod")}
          style={{ padding: "12px 22px", fontSize: 15 }}
        >
          Prod users
        </Button>
        <Button
          variant={group === "qa" ? "primary" : "secondary"}
          onClick={() => openGroup("qa")}
          style={{ padding: "12px 22px", fontSize: 15 }}
        >
          QA users
        </Button>
      </div>

      {error && <p style={{ color: "#dc2626" }}>{error}</p>}

      {group && (
        <>
          <h3 style={{ margin: "0 0 12px", color: "var(--color-text-muted)", fontSize: 14, fontWeight: 600 }}>
            {group === "prod" ? "Production annotators" : "QA users"} ({users.length})
          </h3>

          {loading ? (
            <p>Loading…</p>
          ) : users.length === 0 ? (
            <p style={{ color: "var(--color-text-muted)" }}>No {group === "prod" ? "Prod" : "QA"} users yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                  <th style={thStyle}>Name / email</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Submitted tasks</th>
                  <th style={{ ...thStyle, width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => navigate(`/admin/users/${u.id}?group=${group}`)}
                    style={{ cursor: "pointer", borderBottom: "1px solid var(--color-border)" }}
                  >
                    <td style={tdStyle}>{prettifyEmail(u.email)}</td>
                    <td style={tdStyle}>{roleLabel(u.role)}</td>
                    <td style={tdStyle}>{u.submittedCount}</td>
                    <td style={{ ...tdStyle, color: "var(--color-accent)" }}>View →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

// User-facing label for a role. The Prisma enum keeps the historical
// "REVIEWER" value (renaming that would mean a migration + touching every
// role check across the backend), but nobody outside the codebase should
// ever see that word — the product calls this role "QA".
function roleLabel(role: string): string {
  if (role === "REVIEWER") return "QA";
  if (role === "ANNOTATOR") return "Prod";
  return role;
}

const thStyle: React.CSSProperties = { padding: "8px 12px", fontSize: 13, color: "var(--color-text-muted)" };
const tdStyle: React.CSSProperties = { padding: "10px 12px", fontSize: 14 };

const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "var(--color-accent-contrast)",
  background: "var(--color-accent)",
  borderRadius: 999,
  padding: "2px 8px",
};
