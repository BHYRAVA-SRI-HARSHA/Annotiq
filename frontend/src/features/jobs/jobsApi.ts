import { api } from "@/shared/api/client";
import { Job, QueueRow } from "@/shared/api/types";

interface QueuesResponse {
  queues: QueueRow[];
  total: number;
}

export const jobsApi = {
  // One row per queue (however many documents it holds) — what the
  // annotator/QA job-picking page renders instead of a flat per-document
  // list. Admin doesn't use this page at all (see AdminDashboardPage's
  // own queue listing via adminApi.listQueues).
  listQueues: (params: { search?: string; group?: "prod" | "qa" } = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.group) qs.set("group", params.group);
    return api.get<QueuesResponse>(`/jobs/queues?${qs.toString()}`);
  },
  // Resolves a queue row to one specific available document, assigns it to
  // the caller, and hands back its job id — preferring a document this user
  // hasn't already skipped/released before, so re-entering the same queue
  // shuffles them into something new.
  pickFromQueue: (queueId: string) =>
    api.post<{ jobId: string; resumed?: boolean }>(`/jobs/queues/${encodeURIComponent(queueId)}/pick`),
  get: (id: string) => api.get<Job>(`/jobs/${id}`),
  start: (id: string) => api.post(`/jobs/${id}/start`),
  release: (id: string) => api.post(`/jobs/${id}/release`),
  skip: (id: string) => api.post(`/jobs/${id}/skip`),
  decline: (id: string) => api.post(`/jobs/${id}/decline`),
  // Stage-aware: an annotator submitting an IN_PROGRESS job moves it to
  // SUBMITTED (off prod, into the QA queue); a reviewer submitting a QA
  // job moves it to DONE (off the QA queue, onto the Admin dashboard).
  submit: (id: string) => api.post(`/jobs/${id}/submit`),
};
