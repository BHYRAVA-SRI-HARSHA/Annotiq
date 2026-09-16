import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/routes";
import { useAuthStore } from "@/features/auth/authStore";
import { SESSION_EXPIRED_EVENT } from "@/shared/api/client";

export default function App() {
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  // The api client dispatches this exactly once, only when a 401 survives
  // a transparent refresh attempt (i.e. the refresh token itself is dead,
  // not just the short-lived access token — see shared/api/client.ts).
  // That's the one case where the person really is signed out: clearing
  // local session state here lets ProtectedRoute's existing
  // isAuthenticated check send them to /login on its own, instead of
  // leaving them stuck on a screen where every action just keeps failing
  // with the same expired-token error.
  useEffect(() => {
    function onSessionExpired() {
      logout();
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, [logout]);

  return <RouterProvider router={router} />;
}
