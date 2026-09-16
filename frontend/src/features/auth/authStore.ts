import { create } from "zustand";
import { api } from "@/shared/api/client";
import { AuthUser } from "@/shared/api/types";

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hydrateFromStorage: () => void;
}

// Read once, synchronously, at module load — BEFORE the store's initial
// state is constructed. Previously this only happened inside a useEffect
// in App.tsx, which runs *after* the first render: ProtectedRoute's very
// first render saw isAuthenticated: false (the store's hard-coded initial
// value) and immediately redirected to /login, even for someone who was
// already logged in — the effect setting the real state one tick later
// was already too late, the redirect had happened. That's the "hitting
// refresh sends me back to the login page" bug: it wasn't that the
// session was gone, it was a one-render-too-slow read of it. Reading
// localStorage here instead means the store's initial state is correct
// from the very first render, so there's no window for that redirect to
// fire incorrectly.
function readStoredSession(): AuthUser | null {
  try {
    const raw = localStorage.getItem("annotiq_user");
    const token = localStorage.getItem("annotiq_access_token");
    if (raw && token) return JSON.parse(raw) as AuthUser;
  } catch {
    // Malformed localStorage (e.g. hand-edited) — treat as logged out
    // rather than throwing during store creation.
  }
  return null;
}

const initialUser = readStoredSession();

export const useAuthStore = create<AuthState>((set) => ({
  user: initialUser,
  isAuthenticated: Boolean(initialUser),

  login: async (email, password) => {
    const res = await api.post<LoginResponse>("/auth/login", { email, password });
    // Login is case-insensitive server-side (see auth.routes.ts, which
    // lowercases before the DB lookup), so res.user.email always comes
    // back as the normalized-lowercase value from the database — not
    // necessarily how this person actually typed it. The "Hello, …"
    // greeting should read back exactly what they typed (e.g.
    // "Prod1@Annotiq.com"), so keep their own casing for display while
    // everything else about auth stays keyed off the server's response.
    const user: AuthUser = { ...res.user, email: email.trim() };
    localStorage.setItem("annotiq_access_token", res.accessToken);
    localStorage.setItem("annotiq_refresh_token", res.refreshToken);
    localStorage.setItem("annotiq_user", JSON.stringify(user));
    set({ user, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem("annotiq_access_token");
    localStorage.removeItem("annotiq_refresh_token");
    localStorage.removeItem("annotiq_user");
    set({ user: null, isAuthenticated: false });
  },

  // Kept for compatibility with the existing App.tsx mount effect and for
  // any future cross-tab "storage" event handling — a no-op in the common
  // case now that initial state already reflects localStorage, but still
  // useful if storage was written to by another tab between module load
  // and this running.
  hydrateFromStorage: () => {
    const raw = localStorage.getItem("annotiq_user");
    const token = localStorage.getItem("annotiq_access_token");
    if (raw && token) {
      set({ user: JSON.parse(raw), isAuthenticated: true });
    }
  },
}));
