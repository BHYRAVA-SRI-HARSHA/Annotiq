import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useAnnotationStore } from "./state/annotationStore";
import { getValidationIssues } from "./state/types";
import { jobsApi } from "@/features/jobs/jobsApi";
import { Job } from "@/shared/api/types";
import { stageAssetId } from "@/shared/format";
import { Button } from "@/shared/ui/Button";
import { Logo } from "@/shared/ui/Logo";
import { ThemeToggle } from "@/shared/ui/ThemeToggle";
import { LabelPanel } from "./panels/LabelPanel";
import { AnnotationTree } from "./panels/AnnotationTree";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { DocumentCanvas } from "./canvas/DocumentCanvas";
import { DeleteConfirmDialog } from "./panels/DeleteConfirmDialog";
import { StopAndResumeDialog } from "./panels/StopAndResumeDialog";

const HIDE_STOP_RESUME_DIALOG_KEY = "annotiq:hideStopResumeDialog";

interface AnnotationWorkspacePageProps {
  /**
   * "annotate" (default) — the normal production-annotator flow.
   * "review" — QA's screen for a task production has submitted (REVIEWER
   * role only — see ReviewerRoute): the document renders with its
   * annotations but none of the drawing/editing tools, until the reviewer
   * clicks "QA" in the top right, which unlocks the exact same toolset an
   * annotator gets. Submit finalizes the task (DONE) — visible only on the
   * Admin oversight dashboard from that point on, and off the QA queue.
   * Admin itself never gets this screen or its tool at all; Admin's doc
   * view is the flattened, view-only render in features/admin/AdminDocumentPage.
   */
  mode?: "annotate" | "review";
}

export function AnnotationWorkspacePage({ mode = "annotate" }: AnnotationWorkspacePageProps) {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Small green "Saved" confirmation shown right by the Save button after
  // an explicit manual save succeeds — autosave already has the quiet
  // "Saved HH:MM:SS" status text next to it, but a manual click deserves a
  // clear, visible acknowledgment that it worked.
  const [showSavedToast, setShowSavedToast] = useState(false);
  const savedToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "Submit" -> "Submitting..." while the save + /submit round-trip is in
  // flight, so a slow network doesn't look like a dead button inviting a
  // second click (which would otherwise double-fire the request).
  const [submitting, setSubmitting] = useState(false);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  // Only meaningful when mode === "review": false = locked (view-only),
  // true = the reviewer clicked "QA" and unlocked the full toolset. Starts
  // already-unlocked when JobQueuePage's pick told us (via nav state) that
  // this job is being *resumed* rather than opened fresh — the reviewer
  // already went through the locked-preview-then-unlock step once for it,
  // so making them click through it again after "Stop and resume later"
  // is pure friction, not a safeguard.
  const location = useLocation();
  const [qaUnlocked, setQaUnlocked] = useState(Boolean((location.state as { resumed?: boolean } | null)?.resumed));

  const isReview = mode === "review";
  const locked = isReview && !qaUnlocked;
  // Both flows exit back to the job queue they picked this task from —
  // Admin never lands here at all, so there's no "/admin" case anymore.
  const exitPath = "/jobs";

  const loadJob = useAnnotationStore((s) => s.loadJob);
  const isDirty = useAnnotationStore((s) => s.isDirty);
  const isSaving = useAnnotationStore((s) => s.isSaving);
  const lastSavedAt = useAnnotationStore((s) => s.lastSavedAt);
  const save = useAnnotationStore((s) => s.save);
  const annotations = useAnnotationStore((s) => s.annotations);

  const issues = useMemo(() => getValidationIssues(annotations), [annotations]);

  // Ref mirror of `locked` so the loadJob error-handler below (registered
  // once per jobId, not on every QA-unlock toggle) always checks whatever
  // `locked` is *at the moment the ontology fetch settles*, without
  // re-running the whole fetch — and therefore reloading the document out
  // from under an in-progress edit — every time QA is clicked.
  const lockedRef = useRef(locked);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    if (!jobId) return;
    setLoadError(null);
    jobsApi.get(jobId).then((j) => {
      setJob(j);
      // loadJob 404s (and throws) if this job's taskType has no seeded
      // LabelOntology — previously that rejection went uncaught, so the
      // page just sat there with a permanently empty LABELS panel and no
      // indication anything had gone wrong. Surface it — but only when
      // it's actually relevant: while locked (QA's read-only review, no
      // tools rendered at all), a missing ontology has zero visible
      // effect, so the banner was just a scary false alarm on a screen
      // that never even tries to load the LABELS panel in the first
      // place. loadJob itself still always loads the annotations even
      // when the ontology fetch fails (see its own comment), so the
      // document view is unaffected either way.
      loadJob(jobId, j.taskType).catch(() => {
        if (lockedRef.current) return;
        setLoadError(
          `No labels are set up for the "${j.taskType}" task type yet, so the tools on the left can't load. Ask an admin to check this task type.`
        );
      });
    });
  }, [jobId, loadJob]);

  // Wraps every call to the store's save() so a failure (network blip,
  // server error, etc.) is actually visible instead of leaving the Save
  // button looking broken — before this, a failed save just silently left
  // "Unsaved changes" showing forever with no explanation.
  // Clear a stale error banner as soon as the person starts editing again,
  // rather than leaving an old "Couldn't save" message glued to the status
  // line through unrelated new edits.
  useEffect(() => {
    if (isDirty) setSaveError(null);
  }, [isDirty]);

  useEffect(() => {
    return () => {
      if (savedToastTimer.current) clearTimeout(savedToastTimer.current);
    };
  }, []);

  async function saveWithErrorHandling(showToast = false): Promise<boolean> {
    try {
      await save();
      setSaveError(null);
      if (showToast) {
        setShowSavedToast(true);
        if (savedToastTimer.current) clearTimeout(savedToastTimer.current);
        savedToastTimer.current = setTimeout(() => setShowSavedToast(false), 2200);
      }
      return true;
    } catch (err) {
      setSaveError(
        err instanceof Error ? `Couldn't save: ${err.message}` : "Couldn't save your changes. Check your connection and try again."
      );
      return false;
    }
  }

  // Autosave: debounce writes 2.5s after the last change, matching the
  // "Saved Xm ago" indicator seen in the reference tool. Never fires while
  // locked (view-only), since nothing can become dirty there anyway.
  useEffect(() => {
    if (!isDirty || locked) return;
    const timer = setTimeout(() => saveWithErrorHandling(), 2500);
    return () => clearTimeout(timer);
  }, [isDirty, save, locked]);

  // Heartbeat autosave: a hard floor of "at most 60s of work unsaved",
  // independent of the debounce above. The debounce alone resets on every
  // single edit, so someone drawing/adjusting boxes continuously could in
  // principle go much longer than 2.5s between actual saves — this fires
  // on a fixed clock regardless of how active editing is, so nothing ever
  // sits unsaved for more than a minute. Reads straight from the store via
  // getState() rather than the isDirty/save values captured in this
  // closure, so the interval never needs to be torn down and rebuilt every
  // time isDirty flips (which the 2.5s debounce effect above already does
  // for its own, different purpose).
  useEffect(() => {
    if (locked) return;
    const interval = setInterval(() => {
      if (useAnnotationStore.getState().isDirty) {
        saveWithErrorHandling();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [locked]);

  // Hard refresh / tab close / browser close: best-effort save of whatever
  // hasn't made it to the server yet, right as the page is going away.
  // pagehide fires more reliably than beforeunload on mobile browsers
  // (notably Safari, which can skip beforeunload on tab close), so both
  // are wired up; the `flushed` guard just stops the same save from firing
  // twice if both happen to fire for the same navigation. This can't
  // "await" a normal save — browsers don't reliably pause navigation for
  // async work — so it uses the store's keepalive save variant, which asks
  // the browser to keep the request alive for a moment after the page
  // starts navigating away instead of aborting it immediately. Combined
  // with the 2.5s debounce and 60s heartbeat above, this closes the small
  // remaining gap rather than being the only thing standing between an
  // edit and data loss.
  useEffect(() => {
    if (locked) return;
    let flushed = false;
    function flush() {
      if (flushed) return;
      if (!useAnnotationStore.getState().isDirty) return;
      flushed = true;
      useAnnotationStore.getState().save({ keepalive: true });
    }
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [locked]);

  // Finalizes the task and always heads back to the job queue. /submit is
  // stage-aware server-side: an annotator submitting an IN_PROGRESS job
  // moves it to SUBMITTED (off prod, into the QA queue); a reviewer
  // submitting a QA job moves it to DONE (off the QA queue, visible only
  // on the Admin oversight dashboard from here). Same endpoint, same
  // button, for both — which also means it isn't gated to a role that
  // might not be the one calling it.
  async function handleSubmit() {
    if (!jobId || issues.length > 0 || submitting) return;
    setSubmitting(true);
    try {
      const ok = await saveWithErrorHandling();
      if (!ok) return; // don't submit a job whose latest edits didn't actually save
      await jobsApi.submit(jobId);
      navigate("/jobs");
    } finally {
      // Only reached if we're still on this page (the ok===false early
      // return, or an error thrown above) — a successful submit already
      // navigated away, so there's no button left to reset.
      setSubmitting(false);
    }
  }

  // Skip/Release both hand the document back to its own pool server-side
  // (AVAILABLE for prod, or SUBMITTED — never all the way back to
  // AVAILABLE — for a QA review in progress) and close out this user's
  // assignment on it, then send them back to the queue list — re-opening
  // the *same* queue entry from there is what shuffles them into another
  // document (see jobsApi.pickFromQueue), not this.
  async function handleRelease() {
    if (!jobId) return;
    await jobsApi.release(jobId);
    navigate(exitPath);
  }

  async function handleSkip() {
    if (!jobId) return;
    await jobsApi.skip(jobId);
    navigate(exitPath);
  }

  // Save the current draft and leave — the job stays assigned to this
  // annotator so it's exactly where they left it next time they open it.
  async function handleConfirmStop(dontShowAgain: boolean) {
    if (dontShowAgain) localStorage.setItem(HIDE_STOP_RESUME_DIALOG_KEY, "1");
    setStopDialogOpen(false);
    const ok = await saveWithErrorHandling();
    if (!ok) return; // stay put rather than navigate away from unsaved work
    navigate(exitPath);
  }

  function handleStopAndResumeClick() {
    if (localStorage.getItem(HIDE_STOP_RESUME_DIALOG_KEY) === "1") {
      handleConfirmStop(false);
      return;
    }
    setStopDialogOpen(true);
  }

  if (!job) return <p style={{ padding: 24 }}>Loading job…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {loadError && (
        <div
          style={{
            padding: "8px 14px",
            background: "var(--color-amber-soft)",
            color: "var(--color-danger)",
            fontSize: 13,
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          ⚠ {loadError}
        </div>
      )}
      <div
        className="workspace-topbar"
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          rowGap: 8,
          padding: "9px 16px",
          minHeight: 48,
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          boxShadow: "var(--shadow-panel)",
          fontSize: 13,
        }}
      >
        {/* Left cluster: brand + task identity */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Logo size={20} />
          <Divider />
          <strong
            style={{
              flexShrink: 0,
              padding: "3px 10px",
              borderRadius: 999,
              background: "var(--color-accent-soft)",
              color: "var(--color-accent)",
              fontSize: 12.5,
            }}
          >
            {job.taskType}
          </strong>
          <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>
            Customer: {job.customer?.name ?? "—"}
          </span>
          {!locked && (
            <span
              style={{
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 260,
              }}
              title={job.instructionsMd ?? undefined}
            >
              {job.instructionsMd}
            </span>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {locked ? (
          // QA's locked review header: just a way back out to the queue,
          // and the "QA" button that unlocks the exact same tool an
          // annotator gets.
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <Button onClick={() => navigate("/jobs")}>Back</Button>
            <Button variant="primary" onClick={() => setQaUnlocked(true)}>
              QA
            </Button>
          </div>
        ) : (
          <>
            {/* Right side: task-control cluster, then save/submit cluster,
                each group internally tight (gap 6) with a divider between
                groups instead of one uniform gap across every button. */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <Button onClick={() => jobsApi.decline(job.id).then(() => navigate(exitPath))}>
                Decline task
              </Button>
              <Button onClick={handleRelease}>Release task</Button>
              <Button onClick={handleSkip}>Skip task</Button>
            </div>

            <Divider />

            <Button onClick={handleStopAndResumeClick}>Stop and resume later</Button>

            <Divider />

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span
                style={{
                  color: saveError ? "var(--color-danger)" : "var(--color-text-muted)",
                  fontSize: 12.5,
                  whiteSpace: "nowrap",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={saveError ?? undefined}
              >
                {saveError
                  ? `⚠ ${saveError}`
                  : isSaving
                    ? "Saving…"
                    : isDirty
                      ? "Unsaved changes"
                      : lastSavedAt
                        ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
                        : ""}
              </span>
              <div style={{ position: "relative", display: "flex" }}>
                <Button onClick={() => saveWithErrorHandling(true)} disabled={!isDirty || isSaving}>
                  Save
                </Button>
                {showSavedToast && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      background: "var(--color-accent)",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "4px 10px",
                      borderRadius: 6,
                      whiteSpace: "nowrap",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.28)",
                      zIndex: 30,
                      pointerEvents: "none",
                    }}
                  >
                    ✓ Saved
                  </div>
                )}
              </div>
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={issues.length > 0 || submitting}
                title={issues.length > 0 ? issues[0].message : undefined}
                style={
                  issues.length > 0
                    ? { background: "var(--color-surface)", color: "var(--color-text-muted)", borderColor: "var(--color-border)" }
                    : undefined
                }
              >
                {submitting ? "Submitting..." : issues.length > 0 ? `⚠ Submit (${issues.length})` : "Submit"}
              </Button>
            </div>

            <Divider />

            <ThemeToggle />
          </>
        )}
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0, minWidth: 0 }}>
        {!locked && (
          <LabelPanel assetId={stageAssetId(job, isReview ? "qa" : "prod")} batch={job.title} page={1} />
        )}
        {/* key={jobId} forces a full remount of the canvas whenever the
            annotator opens a different task. Without it, React Router keeps
            this same component instance mounted across job navigations, so
            the canvas's own "fit to screen once" flag would stay stuck from
            the previous document and the next task would open at whatever
            pan/zoom the last one was left at instead of centered and fit. */}
        <DocumentCanvas key={jobId} imageUrl={job.sourceImageUrl} readOnly={locked} />
        {!locked && (
          <div
            className="workspace-panel"
            style={{
              display: "flex",
              flexDirection: "column",
              flex: "0 1 clamp(200px, 22vw, 260px)",
              minWidth: 0,
              overflow: "hidden",
              borderLeft: "1px solid var(--color-border)",
            }}
          >
            <AnnotationTree />
            <PropertiesPanel />
          </div>
        )}
      </div>

      <DeleteConfirmDialog />
      <StopAndResumeDialog
        open={stopDialogOpen}
        onCancel={() => setStopDialogOpen(false)}
        onConfirm={handleConfirmStop}
      />
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 20, background: "var(--color-border)", margin: "0 12px", flexShrink: 0 }} />;
}
