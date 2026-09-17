import { api } from "@/shared/api/client";
import { Annotation, Customer, Job, LabelOntology, QueueRow, TaskType, UserRole } from "@/shared/api/types";

export type AdminUserGroup = "prod" | "qa";

export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  submittedCount: number;
}

export interface CreateJobInput {
  title: string;
  queueName: string;
  taskType: TaskType;
  customerId: string;
  instructionsMd?: string;
  file: File;
}

export const adminApi = {
  // "prod" -> production annotators, "qa" -> reviewers.
  listUsers: (group: AdminUserGroup) =>
    api.get<{ type: AdminUserGroup; users: AdminUser[] }>(`/admin/users?type=${group}`),

  // Every job a given user has submitted, differentiated by asset id
  // (the job's own id).
  listSubmissions: (userId: string) =>
    api.get<{ user: { id: string; email: string; role: UserRole }; jobs: Job[] }>(
      `/admin/users/${userId}/submissions`
    ),

  // Every currently posted queue — a queue posted with 5 docs still shows
  // as one row here — split into prod task types vs QA task types.
  listQueues: (group: AdminUserGroup, search?: string) => {
    const qs = new URLSearchParams({ type: group });
    if (search) qs.set("search", search);
    return api.get<{ type: AdminUserGroup; queues: QueueRow[] }>(`/admin/queues?${qs.toString()}`);
  },

  // The final annotated doc for one submission: the job itself, its full
  // annotation set, and (when one exists) the label ontology used to
  // color each shape — flattened onto a plain canvas with NO editing
  // tools around it. Admin only ever views/downloads; the annotation
  // tool itself is QA (REVIEWER)-only, via /jobs/:jobId/review.
  getJob: (jobId: string) => api.get<Job>(`/jobs/${jobId}`),
  // stage: "prod" | "qa" — which submission to show (see the matching
  // backend comment on GET /jobs/:jobId/annotations). Always pass the
  // group the admin is browsing under so a prod user's page shows their
  // own submission even after QA has since edited the live annotations.
  getAnnotations: (jobId: string, stage: AdminUserGroup) =>
    api.get<Annotation[]>(`/jobs/${jobId}/annotations?stage=${stage}`),
  getOntology: (taskType: string) => api.get<LabelOntology>(`/ontologies/${taskType}`).catch(() => null),

  // Queue-posting — the "Post a new queue" form's calls.
  listCustomers: () => api.get<{ customers: Customer[] }>("/customers"),
  createCustomer: (name: string) => api.post<Customer>("/customers", { name }),
  deleteCustomer: (id: string) => api.del<void>(`/customers/${id}`),
  createJob: (input: CreateJobInput) => {
    const form = new FormData();
    form.set("title", input.title);
    form.set("queueName", input.queueName);
    form.set("taskType", input.taskType);
    form.set("customerId", input.customerId);
    if (input.instructionsMd) form.set("instructionsMd", input.instructionsMd);
    form.set("document", input.file);
    return api.postForm<Job>("/jobs", form);
  },
};
