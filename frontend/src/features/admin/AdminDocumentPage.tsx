import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { adminApi } from "./adminApi";
import { Annotation, BBoxGeometry, Job, PolygonGeometry } from "@/shared/api/types";
import { stageAssetId } from "@/shared/format";
import { useAuthStore } from "@/features/auth/authStore";
import { Button } from "@/shared/ui/Button";
import { Logo } from "@/shared/ui/Logo";
import { buildEvaluationPdf, buildLabelColorMap } from "./evaluationReport";
import { EvaluationReportPanel } from "./EvaluationReportPanel";

export function AdminDocumentPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const userId = searchParams.get("userId") ?? "";
  const group = searchParams.get("group") === "qa" ? "qa" : "prod";
  const navigate = useNavigate();

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [job, setJob] = useState<Job | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The label -> color map used to draw the flattened document is kept in
  // state (not recomputed inline) so the exact same map can be handed to
  // the Report panel and the PDF — a box's color always means the same
  // thing everywhere it shows up.
  const [labelColors, setLabelColors] = useState<Record<string, string>>({});

  // "Report" — toggles an on-screen structure report (words in reading
  // order by Line, plus the Key/Value/GroupedContainer/Clickable
  // hierarchy) side-by-side with the final annotated document, built
  // straight from the annotation set already loaded above. Nothing is
  // sent to the server and nothing about the job changes.
  const [showReport, setShowReport] = useState(false);
  // "Download" produces the same structure as a PDF (plus the flattened
  // PNG), bundled together into a single .zip, for anyone who wants a
  // file to keep/share — even though viewing the report itself no longer
  // requires downloading one.
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    Promise.all([adminApi.getJob(jobId), adminApi.getAnnotations(jobId, group)])
      .then(([j, a]) => {
        setJob(j);
        setAnnotations(a);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load this task"))
      .finally(() => setLoading(false));
  }, [jobId, group]);

  // Draw the source document with every annotation flattened on top —
  // no labels panel, no tree, no tools, just the finished document.
  useEffect(() => {
    if (!job) return;
    let cancelled = false;

    (async () => {
      const ontology = await adminApi.getOntology(job.taskType);
      if (cancelled) return;

      const colors = buildLabelColorMap(annotations, ontology);
      setLabelColors(colors);

      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.src = job.sourceImageUrl;
      img.onload = () => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.drawImage(img, 0, 0);

        for (const a of annotations) {
          const color = colors[a.labelName] ?? "#4f46e5";
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(2, Math.round(img.width / 500));
          ctx.fillStyle = color;

          if (a.shapeType === "BBOX") {
            const g = a.geometry as BBoxGeometry;
            ctx.strokeRect(g.x, g.y, g.width, g.height);
          } else {
            const g = a.geometry as PolygonGeometry;
            if (g.points.length > 0) {
              ctx.beginPath();
              ctx.moveTo(g.points[0][0], g.points[0][1]);
              for (const [x, y] of g.points.slice(1)) ctx.lineTo(x, y);
              ctx.closePath();
              ctx.stroke();
            }
          }
        }
      };
    })();

    return () => {
      cancelled = true;
    };
  }, [job, annotations]);

  // Bundles the flattened annotated document (PNG) and the structure
  // report (PDF) into a single .zip and downloads that one file, instead
  // of firing two separate browser downloads — a reviewer grabbing this
  // for training/record-keeping gets one artifact with both pieces
  // together, not two files that can drift apart or get misplaced.
  async function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas || !job) return;
    setDownloadError(null);
    setDownloading(true);
    try {
      const pngBlob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!pngBlob) throw new Error("Couldn't render the annotated document image.");

      const { doc, filename: pdfFilename } = buildEvaluationPdf(job, annotations, labelColors, group);
      const pdfBlob = doc.output("blob") as Blob;

      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const baseName = `${job.title.replace(/[^a-z0-9-_]+/gi, "_")}-${job.id}`;
      zip.file(`${baseName}.png`, pngBlob);
      zip.file(pdfFilename, pdfBlob);
      const zipBlob = await zip.generateAsync({ type: "blob" });

      const link = document.createElement("a");
      link.download = `${baseName}.zip`;
      link.href = URL.createObjectURL(zipBlob);
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Couldn't prepare the download.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div style={{ width: "100%", padding: "24px 28px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid var(--color-border)",
          paddingBottom: 12,
          marginBottom: 20,
        }}
      >
        <Logo size={22} />
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span>Hello, {user?.email}</span>
          <Button onClick={logout}>Log out</Button>
        </span>
      </header>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Button onClick={() => navigate(`/admin/users/${userId}?group=${group}`)}>← Back to submissions</Button>
        <div style={{ display: "flex", gap: 10 }}>
          <Button
            variant={showReport ? "primary" : undefined}
            onClick={() => setShowReport((v) => !v)}
            disabled={!job || loading}
          >
            {showReport ? "Hide report" : "Report"}
          </Button>
          <Button variant="primary" onClick={handleDownload} disabled={!job || loading || downloading}>
            {downloading ? "Preparing…" : "Download"}
          </Button>
        </div>
      </div>

      {downloadError && <p style={{ color: "#dc2626" }}>{downloadError}</p>}

      {error && <p style={{ color: "#dc2626" }}>{error}</p>}
      {loading && <p>Loading…</p>}

      {job && (
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ margin: "0 0 4px" }}>{job.title}</h2>
          <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: 13 }}>
            Asset ID: <span style={{ fontFamily: "monospace" }}>{stageAssetId(job, group)}</span> &nbsp;·&nbsp; Task type:{" "}
            {job.taskType} &nbsp;·&nbsp; Status: {job.status}
          </p>
        </div>
      )}

      {/* Pure document — no annotation toolbar, no label/tree panels, just
          the flattened final image. Both width and height are driven by
          CSS (not just a max-width cap) so the canvas actually fills the
          available viewer area — scaling up a modest-resolution source
          image as well as down an oversized one — instead of rendering at
          its native pixel size and looking shrunk inside a much bigger
          box. object-fit: contain preserves the aspect ratio either way.

          With the Report toggle on, the canvas shares this row with the
          on-screen EvaluationReportPanel instead of a PDF download — the
          two sit side-by-side so the structure report can be read right
          next to the document it describes. The document panel is
          position: sticky so it stays put on screen while the report
          (which can run much longer than one screen) scrolls on its own —
          if the page ever needs to scroll (e.g. a long header wrap on a
          short viewport), the document doesn't get dragged out of view
          along with it. */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div
          style={{
            flex: showReport ? "1 1 55%" : "1 1 auto",
            minWidth: 0,
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            background: "var(--color-surface)",
            padding: 12,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "calc(100vh - 220px)",
            minHeight: 420,
            position: "sticky",
            top: 12,
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
        </div>

        {showReport && job && (
          <div style={{ flex: "1 1 45%", minWidth: 0, height: "calc(100vh - 220px)", minHeight: 420 }}>
            <EvaluationReportPanel job={job} annotations={annotations} labelColors={labelColors} />
          </div>
        )}
      </div>
    </div>
  );
}
