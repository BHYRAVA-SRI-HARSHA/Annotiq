import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "annotiq:theme";

// Kept in one place so every page (login, jobs, admin, the annotation
// workspace) reads/writes the exact same source of truth instead of each
// screen owning its own disconnected toggle — previously the dark-mode
// button only existed inside the annotation tool, and even there its
// choice was plain component state that reset the moment you navigated
// away.
function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // localStorage can throw in some locked-down/private-browsing modes —
    // fall through to the default rather than crash the page over a
    // cosmetic preference.
  }
  return "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

// Single shared hook — every component that calls this reads/writes the
// same localStorage-backed value and stays in sync with each other via
// the "storage" event (e.g. toggling in one tab updates another) and a
// same-tab custom event (native "storage" events don't fire in the tab
// that made the change).
const THEME_CHANGE_EVENT = "annotiq:theme-change";

export function useTheme(): [Theme, () => void] {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    function sync() {
      setThemeState(readStoredTheme());
    }
    window.addEventListener("storage", sync);
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Same non-fatal localStorage caveat as readStoredTheme above.
      }
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
      return next;
    });
  }, []);

  return [theme, toggleTheme];
}
