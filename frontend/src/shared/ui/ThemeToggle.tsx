import { CSSProperties } from "react";
import { useTheme } from "@/shared/theme";
import { MoonIcon, SunIcon } from "./icons";

interface ThemeToggleProps {
  style?: CSSProperties;
}

// Icon-only by design (a moon to switch into night mode, a sun to switch
// back) rather than a text button — reads as a small, deliberate bit of
// chrome on every screen instead of a plain "Dark"/"Light" label, and
// keeps the login page free of the word "dark" while still working the
// same way everywhere else.
export function ThemeToggle({ style }: ThemeToggleProps) {
  const [theme, toggleTheme] = useTheme();
  const goingDark = theme === "light";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={goingDark ? "Switch to night mode" : "Switch to day mode"}
      title={goingDark ? "Switch to night mode" : "Switch to day mode"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        padding: 0,
        borderRadius: 999,
        border: "1px solid var(--color-border)",
        background: "var(--color-bg)",
        color: "var(--color-text-muted)",
        cursor: "pointer",
        transition: "filter 0.12s ease, transform 0.12s ease",
        flexShrink: 0,
        ...style,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-accent)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-muted)")}
    >
      {goingDark ? <MoonIcon size={16} /> : <SunIcon size={16} />}
    </button>
  );
}
