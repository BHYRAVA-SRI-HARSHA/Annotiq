const STEPS = [
  {
    title: "Get Started",
    body: "Select a job and click the Start working button on the Jobs list.",
  },
  {
    title: "Read Instructions",
    body: "Read the instructions carefully before you start work on the task. More information is available in the full instructions and the tool guide.",
  },
  {
    title: "Work on labeling tasks",
    body: "Follow the instructions to complete your tasks. Submit the task before you see the next one.",
  },
  {
    title: "Take actions",
    body: "Submit a task when you complete it. Stop working when you want to exit the annotation task and return here.",
  },
];

export function InstructionsPanel() {
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: 20,
        marginBottom: 20,
        background: "var(--color-surface)",
      }}
    >
      <h3 style={{ marginTop: 0 }}>Instructions</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
        {STEPS.map((step) => (
          <div key={step.title}>
            <h4 style={{ marginBottom: 6 }}>{step.title}</h4>
            <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0 }}>
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
