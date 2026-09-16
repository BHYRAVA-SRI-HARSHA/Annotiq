import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "./authStore";

// Gates the QA review screen (/jobs/:jobId/review): a reviewer opens the
// submitted document locked/read-only first, then unlocks the full
// annotation toolset with the "QA" button in the top right. This is the
// ONLY role that ever gets that tool during review — Admin only ever sees
// a flattened, view-only render (see features/admin/AdminDocumentPage).
export function ReviewerRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (role !== "REVIEWER") return <Navigate to="/jobs" replace />;
  return <Outlet />;
}
