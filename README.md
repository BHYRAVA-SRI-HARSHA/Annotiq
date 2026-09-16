# Annotiq

A document annotation platform — job queue → canvas-based word/region
annotation → key-value labeling → QA review → admin oversight. Built from
scratch as a portfolio project modeled on production-style document-labeling
workforce tools (think SageMaker Ground Truth's worker experience).

Full design rationale, data model, and request flow: see
[`ANNOTATE_DESIGN_DOC.md`](./ANNOTATE_DESIGN_DOC.md). Annotation *content*
rules (what a Word/Key/Value/Clickable actually means, sample-vs-template
behavior, transcription rules, the QA playbook) live in
[`docs/ANNOTATION_RULES.md`](./docs/ANNOTATION_RULES.md) — that document is
the project's source of truth for annotation correctness and should be
consulted (or extended) before changing ontology, properties, or QA logic.

## Stack

- **Frontend**: React + TypeScript + Vite, Konva (`react-konva`) for the
  canvas, Zustand for state, React Router.
- **Backend**: Node.js + Express + TypeScript, Prisma ORM, PostgreSQL, JWT auth.
- **File storage**: uploaded source documents are written straight to local
  disk on the backend (`backend/public/uploads`) and served back out
  statically — no S3/R2 integration. See "Deployment" below for what that
  means on a host with an ephemeral filesystem.

## Monorepo layout

```
annotiq/
  backend/            Express API + Prisma schema
    prisma/schema.prisma
    src/
      routes/         auth, jobs, annotations, ontologies, reviews, customers, admin
      middleware/      auth guard, upload (multer), error handler
      lib/             prisma client, jwt helpers, queue listing, asset-id generation,
                        stage (prod/qa) annotation resolution
      app.ts           express app (routes wired in)
      server.ts        entrypoint
      seed.ts          seeds the real login roster + the OCRKV label ontology
                        (no demo customers/jobs — every task comes from a
                        real upload through the Admin dashboard)
  frontend/            React SPA
    src/
      app/routes.tsx    route table
      features/
        auth/           login page, auth store, protected/role-gated routes
        jobs/            job queue page, instructions panel, "Post a new queue" form
        annotation/      workspace: canvas + label/tree/properties panels
        admin/           admin dashboard, per-user submissions, final-document
                         viewer with the on-screen structure report + zip download
      shared/
        api/             typed fetch client
        ui/               shared components (Button, Modal, Logo, icons) + theme
  docs/
    ANNOTATION_RULES.md  the annotation SOP / QA playbook (content rules, not code)
```

Every route, store, and API call is wired end to end — see "Status" below for
exactly what's real vs. not yet built.

## Roles & flow

Three roles, three logged-in experiences:

- **ANNOTATOR ("Prod")** — signs in at `/login`, lands on `/jobs`. Picks a
  queue, works the Konva canvas (draw/select/group/transcribe), autosaves,
  and clicks Submit when done. Submitting an OCRKV task moves it out of the
  prod queue and into the QA queue.
- **REVIEWER ("QA")** — same `/jobs` queue page, but pulling from whatever
  prod has submitted. Opens a submission at `/jobs/:jobId/review` — read-only
  until they click "QA" to unlock the exact same annotation tool an
  annotator gets, so they can fix/approve in place. Submitting there closes
  the task out for good (`DONE`).
- **ADMIN** — signs in and lands straight on `/admin`, a read-only oversight
  dashboard: browse Prod users or QA users, drill into a user's submitted
  tasks, and open the final annotated document for any of them (flattened
  onto a plain canvas, no editing tools). From there Admin can toggle an
  on-screen structure report (words in reading order by Line, plus the full
  Key/Value/Clickable hierarchy) and download a `.zip` containing the
  flattened PNG + the same report as a PDF. Admin is also where new work
  gets posted — "Post a new queue" uploads a source document and creates a
  new job for production annotators to pick up.

A job's annotation set is one live table shared by both stages while work is
in progress, but each stage's submission is frozen into its own snapshot at
submit time (`prodSubmittedSnapshot` / `qaSubmittedSnapshot`) — so Admin can
always show exactly what prod originally submitted even after QA has since
edited the same rows.

## Getting started (local)

```bash
# 1. install deps (root install covers both workspaces)
npm install

# 2. backend: copy env, point DATABASE_URL at a free Postgres (Neon/Supabase)
cp backend/.env.example backend/.env
# edit backend/.env

# 3. frontend: copy env (defaults already point at the local backend)
cp frontend/.env.example frontend/.env

# 4. generate prisma client + run migrations
npm run prisma:generate
npm run prisma:migrate

# 5. seed demo data (login roster + the OCRKV label ontology)
npm run seed

# 6. run both apps (two terminals)
npm run dev:backend    # http://localhost:4000
npm run dev:frontend   # http://localhost:5173
```

Login is case-insensitive on the email — type it however you like.

**Admin** — `admin@annotiq.com` / `admin@boss` — signs straight into the
**admin dashboard** at `/admin`, where you upload a source document (JPG,
PNG, WEBP, TIFF or PDF) and post it as a new queue for production
annotators. A posted job shows up immediately in the prod queue and *only*
there — it isn't visible to QA until an annotator submits it, at which point
it disappears from the prod queue and appears in the QA queue instead.

**Prod (ANNOTATOR)** — one queue, four seats:
| Email | Password |
|---|---|
| `prod1@annotiq.com` | `prod1@123` |
| `prod2@annotiq.com` | `prod2@123` |
| `prod3@annotiq.com` | `prod3@123` |
| `prod4@annotiq.com` | `prod4@123` |

**QA (REVIEWER)** — picks up whatever prod has submitted; four seats:
| Email | Password |
|---|---|
| `qa1@annotiq.com` | `qa1@123` |
| `qa2@annotiq.com` | `qa2@123` |
| `qa3@annotiq.com` | `qa3@123` |
| `qa4@annotiq.com` | `qa4@123` |

There is no seeded sample document, sample queue, or demo customer — every
job in the system comes from a real upload through the Admin dashboard, and
the database is otherwise empty until you post one.

## Status

**Fully wired:**
- Auth flow: login page → `authStore` → JWT (access + refresh) → protected,
  role-gated routes (`ProtectedRoute`, `AdminRoute`, `ReviewerRoute`)
- Job queue page → `jobsApi` → backend `/jobs` routes → Prisma `Job` model,
  with real queue-level pick/release/skip/submit semantics and a resumable
  "Stop and resume later" state (`Assignment.expiresAt`)
- Annotation workspace: 3-pane layout, Konva canvas, label panel, annotation
  tree, properties panel, all sharing one `annotationStore`
- **Draw / select / multi-select / delete / resize / drag** on the canvas —
  pick a label, draw a bbox or polygon, shift-click to multi-select, Delete
  key to remove, drag the Transformer handles to resize
- **Grouping**: select 2+ shapes → "Group into container" (KV tree, via
  `parentAnnotationId`) or "Group into Line" (independent Line tree, via
  `lineParentId`) — see `docs/ANNOTATION_RULES.md` Sec. 3 for why these are
  two separate trees over the same Words
- **Real autosave with id reconciliation**: new shapes get a client-side
  `tmp-…` id immediately (so drawing feels instant); the debounced PATCH
  batch sends them with a stable `clientId`, and the backend's two-phase
  upsert (create rows, then resolve parent pointers) returns a
  `clientId → real id` map so newly-created parents and children — even
  created in the *same* save — end up correctly linked
- **Submit-blocking validation**: a skipped Word with no skip reason, a
  Key/Value outside any KeyValueContainer, or a Key/Value with no matching
  partner under the same container all block Submit until fixed
  (`getValidationIssues`, see `frontend/src/features/annotation/state/types.ts`)
- **KV mode / Line mode toggle** in the annotation tree
- Full Word property set from the rulebook: Language, Transcription, Skip
  Transcription + reason, WritingType (Printed/Handwritten), IsVertical,
  IsSignature, IsWatermark, isBoxForm, isMath, isLatex, StrikeThrough,
  rotation angle
- **Admin dashboard**: Prod/QA user lists with submission counts, per-user
  submission drill-down, a flattened final-document viewer with an
  on-screen structure report (words by Line + full KV/Clickable hierarchy,
  color-matched to the document's bounding boxes) and a one-click `.zip`
  download (flattened PNG + the same report as a PDF) — all built entirely
  client-side from the already-loaded annotation set, no server round-trip
- Prisma schema for the full domain model: Users, Customers, Jobs (with
  frozen per-stage snapshots and posting-time asset IDs), Assignments, the
  dual-parent Annotation table, LabelOntology

**Scaffolded but not yet wired to any UI:**
- `Review` model + `POST /reviews/:qaJobId` — a structured decision/diff
  record separate from the normal Submit flow. Today QA review happens by
  editing annotations directly in the same tool prod used and clicking
  Submit; this table isn't written to by that flow.
- `ConsensusResult` model + `GET /consensus/:taskGroupId` — multi-worker
  agreement scoring. The `TRANSCRIPTION_CONSENSUS` task type is present in
  the ontology/enum but marked "coming soon" (disabled) in the Admin
  "Post a new queue" form.
- Table task type UI (row/column-aware drawing, KV-in-table rules)
- Filter dropdown behavior in the annotation tree (field + Filled/Empty/Equals)

## Deployment

The app is two independently deployable pieces plus a managed Postgres
instance — nothing here needs a container or a VM.

1. **Database** — create a free Postgres instance (Neon or Supabase both
   work) and copy its connection string into `DATABASE_URL`.
2. **Backend** (Render, Railway, Fly.io, or any Node host):
   - Build command: `npm install && npm run build --workspace backend`
     (`npm install` also runs `prisma generate` via the backend's own
     `postinstall`).
   - Start command: `npm run start --workspace backend`.
   - Before the first deploy, run `npm run prisma:migrate` once against the
     production `DATABASE_URL` from your machine to create the initial
     migration and apply it (this generates `backend/prisma/migrations/`,
     which should be committed). Every deploy after that should run
     `npm run prisma:migrate:deploy` instead — `migrate deploy` applies
     committed migrations without prompting and is safe to run in CI/CD.
   - Set every variable in `backend/.env.example` — `NODE_ENV=production`,
     real `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` values (the server
     refuses to start in production without them), and `CORS_ORIGIN` set to
     your deployed frontend's URL.
   - Uploaded documents are written to `backend/public/uploads` on local
     disk (see `backend/src/middleware/upload.ts`) — there's no S3/R2
     integration. If your host's filesystem is ephemeral, attach a
     persistent volume at that path or uploads won't survive a redeploy.
3. **Frontend** (Vercel, Netlify, or any static host):
   - Build command: `npm run build --workspace frontend`; output
     directory: `frontend/dist`.
   - Set `VITE_API_BASE` to the deployed backend's URL.
4. Run `npm run seed --workspace backend` once against the production
   database to create the login roster and the OCRKV label ontology (the
   tool has nothing to draw with until that ontology exists) — edit
   `backend/src/seed.ts` first if you want your own users/passwords instead
   of the demo roster above.
