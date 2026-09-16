import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "./authStore";

export function AdminRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (role !== "ADMIN") return <Navigate to="/jobs" replace />;
  return <Outlet />;
}
