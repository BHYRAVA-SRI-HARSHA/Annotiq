import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "./lib/prisma";

// Exact label set, order, and approximate colors per ANNOTATION_RULES.md
// Sec. 2.4 (the reference tool's left LABELS panel). This is reference
// data the annotation tool needs to function for the OCRKV task type —
// not "demo" content — so it stays seeded even though sample jobs/queues
// no longer are.
const KV_ONTOLOGY = [
  { name: "GroupedContainer", color: "#b45309", shape: "bbox" }, // brown/orange
  { name: "KeyValueContainer", color: "#14b8a6", shape: "bbox" }, // teal/mint
  { name: "Key", color: "#7c1fd8", shape: "bbox", parentLabel: "KeyValueContainer" }, // vivid blue-violet purple — sampled from the reference tool's own screenshots (was too magenta/pink before, see #a21caf)
  { name: "SubKey", color: "#ca8a04", shape: "bbox", parentLabel: "Key" }, // yellow/gold
  { name: "Value", color: "#0d9488", shape: "bbox", parentLabel: "KeyValueContainer" }, // teal
  { name: "SubValue", color: "#db2777", shape: "bbox", parentLabel: "Value" }, // pink
  { name: "ClickableItemTrue", color: "#7f1d1d", shape: "bbox" }, // maroon/dark red
  { name: "ClickableItemFalse", color: "#16a34a", shape: "bbox" }, // green
  { name: "Line", color: "#22c55e", shape: "bbox" }, // green
  { name: "Word", color: "#4f46e5", shape: "bbox" }, // dark purple/indigo
];

// The real, hand-picked login roster — no more sample/demo accounts.
// Emails are stored lowercase; login normalizes to lowercase too (see
// auth.routes.ts), so typing them with any capitalization still works.
const PROD_USERS = [
  { email: "prod1@annotiq.com", password: "prod1@123" },
  { email: "prod2@annotiq.com", password: "prod2@123" },
  { email: "prod3@annotiq.com", password: "prod3@123" },
  { email: "prod4@annotiq.com", password: "prod4@123" },
];

const QA_USERS = [
  { email: "qa1@annotiq.com", password: "qa1@123" },
  { email: "qa2@annotiq.com", password: "qa2@123" },
  { email: "qa3@annotiq.com", password: "qa3@123" },
  { email: "qa4@annotiq.com", password: "qa4@123" },
];

const ADMIN_USER = { email: "admin@annotiq.com", password: "admin@boss" };

async function upsertUser(email: string, password: string, role: "ANNOTATOR" | "REVIEWER" | "ADMIN") {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { email },
    // Re-running seed always converges the account to exactly this
    // password/role — a previous bug here (`update: {}`) meant re-seeding
    // silently did NOT fix a stale password hash on an existing row.
    update: { passwordHash, role },
    create: { email, passwordHash, role },
  });
}

async function main() {
  const prodEmails: string[] = [];
  for (const u of PROD_USERS) {
    const user = await upsertUser(u.email, u.password, "ANNOTATOR");
    prodEmails.push(user.email);
  }

  const qaEmails: string[] = [];
  for (const u of QA_USERS) {
    const user = await upsertUser(u.email, u.password, "REVIEWER");
    qaEmails.push(user.email);
  }

  const admin = await upsertUser(ADMIN_USER.email, ADMIN_USER.password, "ADMIN");

  await prisma.labelOntology.upsert({
    where: { taskType: "OCRKV" },
    update: { labels: KV_ONTOLOGY },
    create: { taskType: "OCRKV", labels: KV_ONTOLOGY },
  });

  // Deliberately no Customer, Job, Assignment, or Annotation rows here
  // anymore — every real queue/task from here on is created through the
  // Admin dashboard's "Post a new queue" form (POST /jobs), which uploads
  // a real document and writes real Job rows with real image URLs. There
  // is no more seeded sample document or sample queue.
  console.log("Seeded users:", {
    prod: prodEmails,
    qa: qaEmails,
    admin: admin.email,
  });
  console.log("No demo customers/jobs/queues were created — post real ones from the Admin dashboard.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
