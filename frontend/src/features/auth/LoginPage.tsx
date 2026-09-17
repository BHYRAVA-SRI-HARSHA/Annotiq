import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "./authStore";
import { Button } from "@/shared/ui/Button";
import { Logo } from "@/shared/ui/Logo";
import { ThemeToggle } from "@/shared/ui/ThemeToggle";
import { EyeIcon, EyeOffIcon } from "@/shared/ui/icons";

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Masked by default; toggled by the eye button inside the password
  // field so the person can check what they typed before submitting.
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      // Admins land on the oversight/queue-posting dashboard, and
      // everyone else goes straight to their job queue (annotators pick
      // from the prod queue; reviewers pick submitted tasks off the QA
      // queue and get the locked-until-QA-unlock review screen).
      const role = useAuthStore.getState().user?.role;
      navigate(role === "ADMIN" ? "/admin" : "/jobs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-layout" style={{ position: "relative" }}>
      <ThemeToggle style={{ position: "absolute", top: 16, right: 16, zIndex: 1 }} />

      {/* Brand panel — hidden under 860px; see theme.css */}
      <div className="login-brand-panel">
        <div className="login-brand-center">
          <div className="login-brand-logo">
            <Logo withWordmark onDark style={{ width: 380, height: "auto", maxWidth: "100%" }} />
          </div>

          <p style={{ fontSize: 17, lineHeight: 1.6, maxWidth: 420, color: "#c7cff5", margin: 0, textAlign: "left" }}>
            Annotate scanned documents — words, key-value pairs, tables, and layout regions —
            in one workspace built for the job queue you work through every day.
          </p>
        </div>

        <p style={{ fontSize: 13, color: "#8891bd", margin: "0 0 8px" }}>
          Document annotation workspace
        </p>
      </div>

      {/* Form panel */}
      <div className="login-form-panel">
        <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 340 }}>
          <div style={{ marginBottom: 32 }}>
            <div className="login-mobile-logo">
              <Logo size={26} />
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: "20px 0 6px" }}>Sign in</h1>
            <p style={{ fontSize: 14, color: "var(--color-text-muted)", margin: 0 }}>
              Use your username and password to continue.
            </p>
          </div>

          <label style={labelStyle} htmlFor="login-email">
            Username
          </label>
          <input
            id="login-email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 16 }} htmlFor="login-password">
            Password
          </label>
          <div style={{ position: "relative" }}>
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ ...inputStyle, paddingRight: 36 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--color-text-muted)",
              }}
            >
              {showPassword ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
            </button>
          </div>

          <div style={{ textAlign: "right", marginTop: 8 }}>
            <a href="#" style={{ fontSize: 13, color: "var(--color-accent)", textDecoration: "none" }}>
              Forgot your password?
            </a>
          </div>

          {error && (
            <p style={{ color: "#dc2626", fontSize: 13, marginTop: 12, marginBottom: 0 }}>{error}</p>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={loading}
            style={{
              width: "100%",
              marginTop: 20,
              padding: "10px 14px",
              background: "var(--brand-gradient)",
              border: "none",
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="login-footer-note">© 2026 Annotiq · Built &amp; managed by Bhyrava Sriharsha</p>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontSize: 14,
};
