# Annotiq — Design & Architecture Document
### As-built (v2) — supersedes the original pre-build plan

Annotiq is a document annotation platform modeled on production-style
document-labeling workforce tools (the worker experience SageMaker Ground
Truth-style tools give annotators): workers pull jobs from a queue,
annotate scanned forms/documents at the word level, group words into
keys/values, and hand work off through a QA review pass before an admin
signs off on it. This document describes what was actually built, not the
original proposal — see git history for the earlier plan if you want to
compare what changed along the way (the biggest shift: one combined
Express + Prisma + Postgres stack instead of a pluggable-storage
recommendation, and no LLM-graded evaluation — the "Evaluate"/"Report"
feature that shipped is a deterministic, client-side structure report, not
a model call).

---

## 1. Goals

- Reproduce the full worker pipeline of the reference tool this project is
  modeled on: **OCR/KV annotation → QA review → Admin oversight**.
- Be genuinely portfolio-grade: real auth, real persistence, a real canvas
  engine, real state management — not a mocked demo.
- Buildable and hostable entirely on free tiers (see the README's
  Deployment section).
- Every screen is wired to a real backend and a real Postgres database —
  no page renders from mock/stubbed data.

---

## 2. Tech Stack (as built)

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + TypeScript + Vite** | fast dev loop, matches the reference tool's SPA feel |
| Canvas engine | **Konva.js (`react-konva`)** | draggable/resizable boxes, polygons, grouping, transformers — a much better fit for this much interactivity than raw SVG/Canvas |
| State management | **Zustand** | the annotation tree gets deep and mutates often (draw, group, drag, resize, delete); Zustand keeps that simple and debuggable without Redux boilerplate |
| Backend | **Node.js + Express + TypeScript** | same language as the frontend, simple to reason about, easy to deploy on free tiers |
| Database | **PostgreSQL** (Neon/Supabase free tier) | relational fits the job/user/annotation hierarchy well; JSONB columns hold flexible geometry/property payloads |
| ORM | **Prisma** | type-safe queries, painless migrations |
| Auth | **JWT (access + refresh)**, custom Express middleware | mirrors the username/password login screen; case-insensitive email lookup (`auth.routes.ts`) |
| File storage | **Local disk** (`backend/public/uploads`, via `multer`) | no object-storage integration exists yet — see README's Deployment section for the ephemeral-filesystem caveat on most free-tier hosts |
| Autosave | **Debounced batched PATCH** | matches a "Saved Xm ago" style indicator; client assigns temporary `tmp-…` ids so drawing feels instant, and the backend's two-phase upsert reconciles them to real ids in the same round trip |
| PDF/report generation | **`jspdf` + `jszip`, entirely client-side** | the Admin "Report"/"Download" feature reads the annotation set already loaded in the browser and builds a structure report — no server call, nothing sent to any external API |

---

## 3. High-Level Architecture

```
┌────────────────────┐        HTTPS/JSON        ┌───────────────────────┐
│  React SPA           │ ───────────────────────▶ │  Express API          │
│  (Vite build,         │ ◀─────────────────────── │  (Node/Express/TS)    │
│   any static host)    │                          │                        │
│                       │                          │  - Auth (JWT)          │
│  - Login               │                          │  - Jobs / Queues       │
│  - Job Queue             │                          │  - Annotations         │
│  - Annotation Workspace │                          │  - Ontologies          │
│    (Konva canvas)      │                          │  - Admin oversight     │
│  - Admin Dashboard      │                          │  - Reviews/Consensus   │
│    (report/PDF built    │                          │    (scaffolded, see    │
│     client-side)        │                          │    Sec. 7)             │
└────────────────────┘                          └──────────┬────────────┘
                                                               │
                                                               ▼
                                                    ┌────────────────────┐
                                                    │ PostgreSQL          │
                                                    │ - users              │
                                                    │ - customers          │
                                                    │ - jobs                │
                                                    │ - assignments         │
                                                    │ - annotations (JSONB) │
                                                    │ - label_ontologies    │
                                                    │ - reviews             │
                                                    │ - consensus_results   │
                                                    └────────────────────┘
                                                               │
                                                               ▼
                                                   backend/public/uploads
                                                   (source document images,
                                                    local disk — see Sec. 8)
```

There is no separate object-storage tier and no third-party AI/model API
in the runtime path — uploaded documents live on the backend's own
filesystem, and the Admin report is generated in the browser from data the
frontend already has.

---

## 4. Domain Model

### 4.1 Core entities (`backend/prisma/schema.prisma`)

- **User** — `id`, `email` (unique, stored lowercase), `passwordHash`,
  `role` (`ANNOTATOR` | `REVIEWER` | `ADMIN`), `createdAt`
- **Customer** — `id`, `name` (maps to the "Customer ID" a queue is posted
  under)
- **Job** — the unit of work. `id`, `title`, `queueName` (which posting
  batch it belongs to), `taskNo` + `assetId`/`qaAssetId` (human-readable
  IDs frozen at posting time — see Sec. 4.3), `taskType`
  (`OCRKV` | `TABLES` | `LAYOUT` | `SEGRECT` | `TRANSCRIPTION_CONSENSUS` |
  `*_QA` variants), `status`
  (`AVAILABLE` → `IN_PROGRESS` → `SUBMITTED` → `QA` → `DONE`),
  `customerId`, `sourceImageUrl`, `instructionsMd`,
  `prodSubmittedSnapshot` / `qaSubmittedSnapshot` (JSON — see Sec. 4.4)
- **Assignment** — `jobId`, `userId`, `startedAt`, `expiresAt`,
  `releasedAt` — drives the "Stop and resume later" flow and who currently
  holds a job
- **LabelOntology** — `taskType` (unique), `labels` (JSONB array of
  `{ name, color, shape: "bbox"|"polygon", parentLabel? }`) — this is what
  populates the left LABELS panel per task type. Seeded once for `OCRKV`
  in `seed.ts`, matching `docs/ANNOTATION_RULES.md` Sec. 2.4 exactly.
- **Annotation** — the generic shape record shared by every task type:
  `id`, `jobId`, `labelName`, `shapeType` (`BBOX`|`POLYGON`), `geometry`
  (JSONB), `properties` (JSONB — transcription, language, skip reason,
  writing type, is-vertical/signature/watermark, etc.), **two independent
  parent pointers** (`parentAnnotationId`, `lineParentId` — see Sec. 4.2),
  `createdById`, timestamps
- **Review** — `qaJobId`, `sourceJobId`, `reviewerId`, `decision`
  (`APPROVED`|`REJECTED`|`EDITED`), `diff`, `notes`. Scaffolded (schema +
  `POST /reviews/:qaJobId` exist) but not yet written to by the actual QA
  flow — see Sec. 7.
- **ConsensusResult** — `taskGroupId`, `annotationsByWorker`,
  `mergedAnnotation`, `agreementScore`. Also scaffolded, not yet wired to
  any UI — see Sec. 7.

### 4.2 Why two parent pointers on one `Annotation` table

Every OCR/KV annotation is really the same shape: *a labeled region on an
image, optionally nested inside a parent region, optionally carrying
transcription metadata.* One generic table with a `labelName` string (not
a foreign key — labels come from the task type's `LabelOntology`, not a
fixed enum) and a JSONB `properties` bag means a new label or a new task
type is a data change, not a schema migration.

The one wrinkle: a Word genuinely belongs to **two independent trees at
once** — its Line (for OCR reading order) and, separately, its
Key/Value/KeyValueContainer/GroupedContainer (for KV structure). A single
`parentAnnotationId` can't represent both memberships simultaneously, so
the schema carries two:

- `parentAnnotationId` → the **KV/container tree**
  (Word → Key/SubKey/Value/SubValue → KeyValueContainer → GroupedContainer)
- `lineParentId` → the **OCR line tree** (Word → Line), entirely
  independent

`frontend/src/features/annotation/state/types.ts`'s `buildAnnotationTree`
picks which pointer to walk via a `mode: "kv" | "line"` argument, so the
same flat annotation list renders either view in the right-hand panel.
`docs/ANNOTATION_RULES.md` Sec. 3 is the content-level rationale for this
split; this is the schema-level consequence of it.

### 4.3 Asset IDs

A posted task gets two human-readable asset IDs — one per stage — frozen
at posting time (`backend/src/lib/assetId.ts`):
`<stage><sanitized queue name><DDMMYYYY posting date><3-digit task no.>`,
e.g. queue `ocrkv-1a`, task 1, posted 16/9/2026 →
`prodocrkv1a16092026001` (prod) / `qaocrkv1a16092026001` (QA). They're
computed once and stored on the `Job` row rather than recomputed later,
since the queue's task count and the calendar date both keep moving after
the fact — recomputing would silently change an already-issued ID.
`frontend/src/shared/format.ts`'s `stageAssetId()` picks the right one to
display for whichever stage (prod/qa) is currently being viewed.

### 4.4 Why submissions are snapshotted, not just "the live annotations"

While a task is in progress, prod and QA share **one live `Annotation`
table** — there's no forked copy per stage. But `POST /jobs/:id/submit`
freezes a full JSON copy of the current annotation set into
`prodSubmittedSnapshot` (when a prod annotator submits) or
`qaSubmittedSnapshot` (when a reviewer submits), because QA's own edits
keep mutating those same rows after prod hands the task off. Without the
snapshot, "what did prod actually submit?" becomes unanswerable the moment
QA changes anything. `GET /jobs/:jobId/annotations?stage=prod|qa`
(`backend/src/lib/annotationStage.ts`) reads the matching snapshot for
Admin's viewer, falling back to the live table only when that stage hasn't
been submitted yet.

---

## 5. Frontend Architecture

```
src/
  app/
    routes.tsx                  # route table + role gates
  features/
    auth/
      LoginPage.tsx              # routes ADMIN -> /admin, everyone else -> /jobs
      authStore.ts                # Zustand: JWT storage, current user
      ProtectedRoute / AdminRoute / ReviewerRoute
    jobs/
      JobQueuePage.tsx           # searchable/sortable/paginated queue table
      InstructionsPanel.tsx      # onboarding banner
      PostQueueForm.tsx          # Admin-only: upload + post a new queue
    annotation/
      AnnotationWorkspacePage.tsx # top bar + 3-pane layout; mode="annotate"|"review"
      canvas/
        DocumentCanvas.tsx        # Konva Stage/Layer: zoom/pan/draw/select/
                                   #   resize/group, all shape-style constants
        WordQuickEditPopover.tsx  # inline popup opened right after drawing a Word
      panels/
        LabelPanel.tsx            # left: ontology, show/hide, lock, shape tool
        AnnotationTree.tsx        # right: hierarchical list (KV mode / Line mode)
        PropertiesPanel.tsx       # per-shape: language, transcription, skip/
                                   #   vertical/signature/watermark toggles
        DeleteConfirmDialog.tsx / StopAndResumeDialog.tsx
      state/
        annotationStore.ts        # Zustand: shapes, selection, dirty flag, autosave
        types.ts                  # tree builders + getValidationIssues (submit gate)
        wordColors.ts              # per-attribute color coding for Words
    admin/
      AdminDashboardPage.tsx      # Prod users / QA users, each with submission counts
      AdminUserSubmissionsPage.tsx # one user's submitted jobs
      AdminDocumentPage.tsx        # flattened final document + Report toggle + zip Download
      EvaluationReportPanel.tsx    # the on-screen twin of the PDF report
      evaluationReport.ts          # shared tree-walking + jsPDF building logic
  shared/
    api/                          # typed fetch client + shared TS types
    ui/                           # Button, Modal, Logo, icons, theme.css (light/dark)
```

Key interaction details worth knowing when working in this codebase:
- Drawing a bounding box opens the transcription popup automatically —
  Language/Transcription fields are focused for immediate typing.
- Zoom range goes well past 100% (up to Konva's own practical ceiling)
  since source images are scanned documents with small handwritten text.
- Label visibility/lock toggles in the left panel filter what's
  selectable and paintable on the canvas — not just cosmetic.
- Dark/light theme is a `data-theme` attribute on `<html>`
  (`theme.css`'s `[data-theme="dark"]` block), read by `Logo.tsx` to pick
  the correct wordmark asset (`logo-wordmark.png` on light,
  `logo-wordmark-light.png` — the white-on-transparent variant — on dark)
  so the brand mark stays legible in both themes.

---

## 6. Backend API (as built)

```
POST   /auth/login
POST   /auth/refresh

GET    /jobs/queues?status=&search=&group=prod|qa   # queue listing (picking UI)
POST   /jobs/queues/:queueId/pick                     # claim next pickable doc in a queue
GET    /jobs?status=&search=&page=                    # raw per-document listing (general-purpose)
GET    /jobs/:id
POST   /jobs                                           # Admin: upload + post a new queue
DELETE /jobs/:id                                       # Admin: pull a posted job
POST   /jobs/:id/start                                 # legacy direct-by-id start
POST   /jobs/:id/release
POST   /jobs/:id/skip
POST   /jobs/:id/decline
POST   /jobs/:id/submit                                # advances status + freezes a snapshot

GET    /jobs/:jobId/annotations?stage=prod|qa          # flat list; client rebuilds the tree
PATCH  /jobs/:jobId/annotations                        # batched upsert (autosave)

GET    /ontologies/:taskType

GET    /customers
POST   /customers

GET    /admin/users?type=prod|qa
GET    /admin/users/:userId/submissions
GET    /admin/queues?type=prod|qa&search=

POST   /reviews/:qaJobId                                # scaffolded, not called by any UI yet
GET    /consensus/:taskGroupId                          # scaffolded, not called by any UI yet
```

Autosave pattern: the frontend batches shape mutations client-side and
`PATCH`es a debounced batch rather than one request per drag event. Each
mutation in the batch carries a `clientId` (a real DB id if one already
exists, otherwise a `tmp-…` id assigned the instant the shape is drawn so
the UI never waits on the network to feel responsive); the backend's
two-phase upsert — create every row first, then resolve
`parentAnnotationId`/`lineParentId` pointers — returns a
`clientId → real id` map, so a parent and child created in the *same*
save still end up correctly linked.

---

## 7. Task-Type Specifics & What's Actually Live

| Task type | Status |
|---|---|
| **OCRKV** (Key-Value) | **Fully built.** Word-level boxes, Line grouping, Key/Value/KeyValueContainer/GroupedContainer nesting, Clickables, full property set, submit-blocking validation, Admin structure report. |
| **OCRKV_QA** | **Fully built** — the review flow is the same annotation tool in `mode="review"`, locked until the reviewer clicks "QA" to unlock it. |
| **TABLES / TABLES_QA / LAYOUT / LAYOUT_QA / SEGRECT** | Present in the `TaskType` enum and `PostQueueForm`'s dropdown, but there's no task-specific UI (row/column-aware table drawing, layout region typing, segmentation rectification) yet — they'd currently just get the generic bbox/polygon tool with no ontology seeded for them. |
| **TRANSCRIPTION_CONSENSUS** | Present in the enum; disabled ("coming soon") in `PostQueueForm`. The `ConsensusResult` model and `GET /consensus/:taskGroupId` exist for it, but nothing produces or reads consensus data yet. |

**Review model vs. the actual QA flow:** the `Review` table and
`POST /reviews/:qaJobId` were scaffolded for a structured
approve/reject/edit decision record, but the QA flow that actually shipped
is simpler — a reviewer edits annotations directly in the same tool prod
used and clicks the same Submit button, which is enough to drive the job's
`status` machine end to end. `Review` rows are never written by that path
today. Wiring a real decision UI to `Review` (and, separately, building
whatever produces `ConsensusResult` rows) are the two clearest "next"
pieces of unfinished scaffolding in the schema.

---

## 8. Known Limitations (honest, as of this writing)

- **Local-disk file storage.** `backend/public/uploads` is not
  object storage — on a host with an ephemeral filesystem, uploaded
  documents will not survive a redeploy unless a persistent volume is
  attached at that path. Swapping in S3/R2 would mean changing
  `middleware/upload.ts` and `jobs.routes.ts`'s URL construction; nothing
  else in the domain model assumes local disk.
- **No object versioning / audit log** on Job or Annotation changes beyond
  the two submission snapshots.
- **Decline reasons aren't persisted** — `POST /jobs/:id/decline` just
  acknowledges the decline so the job can be released back to the pool by
  a follow-up `/release` call; there's no reason/audit trail.
- **Review/Consensus scaffolding** — see Sec. 7. The schema and routes
  exist; nothing produces or consumes that data yet.

---

## 9. What Makes This a Strong Portfolio Piece

- Non-trivial canvas/graphics state management (nested shape groups,
  two independent parent trees over the same nodes, temp-id → real-id
  reconciliation on autosave) — most portfolio CRUD apps don't touch this.
- A believable multi-stage workforce pipeline (queue → work → QA →
  oversight) with real state-machine transitions (`AVAILABLE` →
  `IN_PROGRESS` → `SUBMITTED` → `QA` → `DONE`) driven by one shared
  endpoint (`POST /jobs/:id/submit`) that branches on current status.
- Clean generic data model (Sec. 4.1/4.2) is a good interview talking
  point: *why one annotation table instead of five, and why two parent
  pointers on it instead of one.*
- The Admin structure report (Sec. 5/6) is a good example of choosing
  "no server round-trip, no external API" over reaching for an LLM call —
  the report is fully deterministic and reproducible from data already in
  the browser.

---

## 10. Alternatives Considered

- **Fabric.js instead of Konva** — comparable capability; Konva's React
  bindings (`react-konva`) were a better fit for this component tree.
- **Next.js full-stack instead of a separate Express API** — simpler
  single-project deploy, but a separate frontend/backend makes the API
  surface and system diagram cleaner to explain, and keeps the door open
  to hosting each piece independently (see README Deployment).
- **MongoDB instead of Postgres** — annotations are naturally
  document-shaped, but the job/user/review relationships are relational;
  Postgres + JSONB gets both without splitting the domain across two
  databases.
- **LLM-graded evaluation instead of a deterministic report** — an
  earlier iteration of the Admin "Evaluate" feature called out to
  Claude's API to grade a submission against the OCR-KV rulebook. It was
  replaced with the current client-side structure report: no external API
  key to provision, no per-click cost, instant and reproducible, and
  since it renders the exact tree the annotator/reviewer built, it's
  easier to trust than a model's summary of it.
