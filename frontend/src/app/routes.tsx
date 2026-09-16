import { createBrowserRouter, Navigate } from "react-router-dom";
import { LoginPage } from "@/features/auth/LoginPage";
import { ProtectedRoute } from "@/features/auth/ProtectedRoute";
import { AdminRoute } from "@/features/auth/AdminRoute";
import { ReviewerRoute } from "@/features/auth/ReviewerRoute";
import { JobQueuePage } from "@/features/jobs/JobQueuePage";
import { AnnotationWorkspacePage } from "@/features/annotation/AnnotationWorkspacePage";
import { AdminDashboardPage } from "@/features/admin/AdminDashboardPage";
import { AdminUserSubmissionsPage } from "@/features/admin/AdminUserSubmissionsPage";
import { AdminDocumentPage } from "@/features/admin/AdminDocumentPage";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/jobs" replace /> },
  { path: "/login", element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      { path: "/jobs", element: <JobQueuePage /> },
      { path: "/jobs/:jobId/annotate", element: <AnnotationWorkspacePage /> },
      {
        // Only a REVIEWER ever gets the annotation tool during review —
        // Admin never does (see AdminDocumentPage: view + download only).
        element: <ReviewerRoute />,
        children: [{ path: "/jobs/:jobId/review", element: <AnnotationWorkspacePage mode="review" /> }],
      },
      {
        element: <AdminRoute />,
        children: [
          { path: "/admin", element: <AdminDashboardPage /> },
          { path: "/admin/users/:userId", element: <AdminUserSubmissionsPage /> },
          { path: "/admin/jobs/:jobId", element: <AdminDocumentPage /> },
        ],
      },
    ],
  },
]);
