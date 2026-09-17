import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { adminApi } from "./adminApi";
import { Job } from "@/shared/api/types";
import { formatStatus, prettifyEmail, stageAssetId } from "@/shared/format";
import { useAuthStore } from "@/features/auth/authStore";
import { Button } from "@/shared/ui/Button";
import { Logo } from "@/shared/ui/Logo";
import { ThemeToggle } from "@/shared/ui/ThemeToggle";

export function AdminUserSubmissionsPage() {
  const { userId } = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const group = searchParams.get("group") === "qa" ? "qa" : "prod";
  const navigate = useNavigate();

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [email, setEmail] = useState<string>("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    adminApi
      .listSubmissions(userId)
      .then((res) => {
        setEmail(res.user.email);
        setJobs(res.jobs);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load submissions"))
      .finally(() => setLoading(false));
  }, [userId]);

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
          <span>Hello, {user?.email}</span>
          <ThemeToggle />
          <Button onClick={logout}>Log out</Button>
        </span>
      </header>

      <Button onClick={() => navigate(`/admin?group=${group}`)} style={{ marginBottom: 16 }}>
        ← Back to {group === "prod" ? "Prod" : "QA"} users
      </Button>

      <h2 style={{ margin: "0 0 4px" }}>Submitted tasks</h2>
      <p style={{ margin: "0 0 20px", color: "var(--color-text-muted)" }}>{prettifyEmail(email)}</p>

      {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : jobs.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>No submitted tasks yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
              <th style={thStyle}>Asset ID</th>
              <th style={thStyle}>Task title</th>
              <th style={thStyle}>Task type</th>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr
                key={job.id}
                onClick={() => navigate(`/admin/jobs/${job.id}?userId=${userId}&group=${group}`)}
                style={{ cursor: "pointer", borderBottom: "1px solid var(--color-border)" }}
              >
                <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12.5 }}>
                  {stageAssetId(job, group)}
                </td>
                <td style={tdStyle}>{job.title}</td>
                <td style={tdStyle}>{job.taskType}</td>
                <td style={tdStyle}>{job.customer?.name}</td>
                <td style={tdStyle}>{formatStatus(job.status)}</td>
                <td style={tdStyle}>{new Date(job.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "8px 12px", fontSize: 13, color: "var(--color-text-muted)" };
const tdStyle: React.CSSProperties = { padding: "10px 12px", fontSize: 14 };
