import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { adminApi } from "@/features/admin/adminApi";
import { Customer, TaskType } from "@/shared/api/types";
import { Button } from "@/shared/ui/Button";

// Only OCRKV has a seeded label ontology today (see backend/src/seed.ts) —
// every other task type is UI-and-schema-ready but has no LabelOntology
// row yet, so posting a queue with one of them left prod AND QA staring at
// a completely empty LABELS panel (the ontology fetch 404s and the panel
// just renders nothing, with no error surfaced). Disabling them here until
// their ontologies exist is cheaper and safer than a silent trap.
const TASK_TYPE_OPTIONS: Array<{ value: TaskType; label: string; disabled?: boolean }> = [
  { value: "OCRKV", label: "OCR + Keys and Values" },
  { value: "TABLES", label: "Tables (coming soon)", disabled: true },
  { value: "LAYOUT", label: "Layout (coming soon)", disabled: true },
  { value: "SEGRECT", label: "Segmentation rectangles (coming soon)", disabled: true },
  { value: "TRANSCRIPTION_CONSENSUS", label: "Transcription consensus (coming soon)", disabled: true },
];

interface PostQueueFormProps {
  // Called once every file in the batch has finished posting (even if some
  // failed) so the parent can refresh whatever list of queues it shows.
  onPosted?: () => void;
}

// Posts one queue (a queue name shared by one or more source documents) —
// every document becomes its own task on the annotator/QA side, but they
// all collapse into a single row in the job-picking queue. Used by the
// "Post a new queue" form on the Admin dashboard (POST /jobs, ADMIN role
// only).
export function PostQueueForm({ onPosted }: PostQueueFormProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("OCRKV");
  const [customerId, setCustomerId] = useState<string>("");
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [instructionsMd, setInstructionsMd] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    adminApi
      .listCustomers()
      .then((res) => {
        setCustomers(res.customers);
        setCustomerId((current) => current || res.customers[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (files.length === 0) {
      setPreviews([]);
      return;
    }
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  // A whole batch can be queued at once — each file becomes its own task
  // in the same posting, so a folder of scanned docs goes into the queue
  // together instead of one at a time. Selecting/dropping more files adds
  // to the batch rather than replacing it; duplicates (same name + size)
  // are skipped.
  function pickFiles(incoming: FileList | File[] | null) {
    if (!incoming) return;
    const list = Array.from(incoming);
    if (list.length === 0) return;
    setFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const additions = list.filter((f) => !existingKeys.has(`${f.name}:${f.size}`));
      return [...prev, ...additions];
    });
    if (!title && list.length === 1) setTitle(list[0].name.replace(/\.[^.]+$/, ""));
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    pickFiles(e.dataTransfer.files);
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    pickFiles(e.target.files);
    e.target.value = ""; // allow re-picking the same file(s) later
  }

  async function handleCreateCustomer() {
    if (!newCustomerName.trim()) return;
    const customer = await adminApi.createCustomer(newCustomerName.trim());
    setCustomers((prev) => [...prev, customer].sort((a, b) => a.name.localeCompare(b.name)));
    setCustomerId(customer.id);
    setNewCustomerName("");
    setAddingCustomer(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (files.length === 0) return setError("Choose at least one image to add as a task in the queue.");
    if (!title.trim()) return setError("Give the queue a name.");
    if (!customerId) return setError("Pick (or add) a customer.");

    setSubmitting(true);
    const posted: string[] = [];
    const failed: string[] = [];

    // One task (Job) per image, all posted under the same queue name. With
    // a single file the queue name is used as the task title as-is; with a
    // batch, each task gets "<queue name> - <filename>" so every task in
    // the queue is still distinct and traceable back to its source image.
    for (const f of files) {
      const jobTitle = files.length > 1 ? `${title.trim()} - ${f.name.replace(/\.[^.]+$/, "")}` : title.trim();
      try {
        const job = await adminApi.createJob({
          title: jobTitle,
          queueName: title.trim(),
          taskType,
          customerId,
          instructionsMd,
          file: f,
        });
        posted.push(job.title);
      } catch (err) {
        failed.push(`${f.name}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    if (posted.length > 0) {
      setSuccess(
        posted.length === 1
          ? `Posted the “${title.trim()}” queue — its task is now available on the annotator side.`
          : `Posted the “${title.trim()}” queue — its ${posted.length} tasks are now available as one queue entry.`
      );
      setFiles([]);
      setTitle("");
      setInstructionsMd("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onPosted?.();
    }
    if (failed.length > 0) {
      setError(`${failed.length} task${failed.length === 1 ? "" : "s"} failed to post: ${failed.join("; ")}`);
    }
    setSubmitting(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr",
        gap: 20,
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: 20,
        marginBottom: 32,
        background: "var(--color-surface)",
      }}
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragging ? "var(--color-accent)" : "var(--color-border)"}`,
          borderRadius: 8,
          background: isDragging ? "var(--color-bg)" : "transparent",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: 16,
          minHeight: 260,
          cursor: "pointer",
          textAlign: "center",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/tiff,application/pdf"
          onChange={handleFileInput}
          style={{ display: "none" }}
        />
        {files.length > 0 ? (
          <>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                justifyContent: "center",
                maxHeight: 170,
                overflowY: "auto",
                width: "100%",
              }}
            >
              {files.map((f, i) => (
                <div key={`${f.name}:${f.size}:${i}`} style={{ position: "relative" }}>
                  <img
                    src={previews[i]}
                    alt={f.name}
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: "cover",
                      borderRadius: 6,
                      border: "1px solid var(--color-border)",
                      display: "block",
                    }}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(i);
                    }}
                    title={`Remove ${f.name}`}
                    style={removeThumbBtnStyle}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              {files.length} task{files.length === 1 ? "" : "s"} selected
            </span>
            <span style={{ fontSize: 12, color: "var(--color-accent)" }}>Click or drop to add more</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 32 }}>📄</span>
            <strong style={{ fontSize: 14 }}>Drop one or more images here</strong>
            <span style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
              or click to browse — JPG, PNG, WEBP, TIFF or PDF. Select several to post them
              as separate tasks in this queue.
            </span>
          </>
        )}
      </div>

      <div>
        <Field label={files.length > 1 ? "Queue name (used as the prefix for every task)" : "Queue name"}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. textract-hd-so-b3c-0912 - ocrkv"
            style={inputStyle}
          />
        </Field>

        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <Field label="Task type">
              <select value={taskType} onChange={(e) => setTaskType(e.target.value as TaskType)} style={inputStyle}>
                {TASK_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div style={{ flex: 1 }}>
            <Field label="Customer">
              {addingCustomer ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    autoFocus
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="Customer / account ID"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <Button type="button" variant="secondary" onClick={handleCreateCustomer}>
                    Add
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setAddingCustomer(false)}>
                    ✕
                  </Button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                    {customers.length === 0 && <option value="">No customers yet</option>}
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="secondary" onClick={() => setAddingCustomer(true)}>
                    + New
                  </Button>
                </div>
              )}
            </Field>
          </div>
        </div>

        <Field label="Instructions (optional, shown to the annotator)">
          <textarea
            value={instructionsMd}
            onChange={(e) => setInstructionsMd(e.target.value)}
            rows={5}
            placeholder="Read the instructions carefully before you start work on the task."
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
        </Field>

        {error && <p style={{ color: "#dc2626", fontSize: 13 }}>{error}</p>}
        {success && <p style={{ color: "#059669", fontSize: 13 }}>{success}</p>}

        <Button type="submit" variant="primary" disabled={submitting} style={{ marginTop: 4 }}>
          {submitting
            ? "Posting…"
            : files.length > 1
            ? `Post queue (${files.length} tasks)`
            : "Post queue"}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 13, marginBottom: 4, color: "var(--color-text-muted)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 4,
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontSize: 14,
};

const removeThumbBtnStyle: React.CSSProperties = {
  position: "absolute",
  top: -6,
  right: -6,
  width: 18,
  height: 18,
  borderRadius: "50%",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg)",
  color: "var(--color-text-muted)",
  fontSize: 10,
  lineHeight: "16px",
  padding: 0,
  cursor: "pointer",
};
