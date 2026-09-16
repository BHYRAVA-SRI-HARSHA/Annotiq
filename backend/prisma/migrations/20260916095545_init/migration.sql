-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ANNOTATOR', 'REVIEWER', 'ADMIN');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('OCRKV', 'TABLES', 'LAYOUT', 'SEGRECT', 'TRANSCRIPTION_CONSENSUS', 'OCRKV_QA', 'TABLES_QA', 'LAYOUT_QA');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('AVAILABLE', 'IN_PROGRESS', 'SUBMITTED', 'QA', 'DONE');

-- CreateEnum
CREATE TYPE "ShapeType" AS ENUM ('BBOX', 'POLYGON');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'REJECTED', 'EDITED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ANNOTATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "queueName" TEXT,
    "taskNo" INTEGER,
    "assetId" TEXT,
    "qaAssetId" TEXT,
    "taskType" "TaskType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'AVAILABLE',
    "customerId" TEXT NOT NULL,
    "sourceImageUrl" TEXT NOT NULL,
    "instructionsMd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "prodSubmittedSnapshot" JSONB,
    "qaSubmittedSnapshot" JSONB,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelOntology" (
    "id" TEXT NOT NULL,
    "taskType" "TaskType" NOT NULL,
    "labels" JSONB NOT NULL,

    CONSTRAINT "LabelOntology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "labelName" TEXT NOT NULL,
    "shapeType" "ShapeType" NOT NULL,
    "geometry" JSONB NOT NULL,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "parentAnnotationId" TEXT,
    "lineParentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "qaJobId" TEXT NOT NULL,
    "sourceJobId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "diff" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsensusResult" (
    "id" TEXT NOT NULL,
    "taskGroupId" TEXT NOT NULL,
    "annotationsByWorker" JSONB NOT NULL,
    "mergedAnnotation" JSONB NOT NULL,
    "agreementScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsensusResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Job_assetId_key" ON "Job"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_qaAssetId_key" ON "Job"("qaAssetId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_taskType_idx" ON "Job"("taskType");

-- CreateIndex
CREATE INDEX "Job_customerId_idx" ON "Job"("customerId");

-- CreateIndex
CREATE INDEX "Job_queueName_idx" ON "Job"("queueName");

-- CreateIndex
CREATE INDEX "Assignment_jobId_idx" ON "Assignment"("jobId");

-- CreateIndex
CREATE INDEX "Assignment_userId_idx" ON "Assignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LabelOntology_taskType_key" ON "LabelOntology"("taskType");

-- CreateIndex
CREATE INDEX "Annotation_jobId_idx" ON "Annotation"("jobId");

-- CreateIndex
CREATE INDEX "Annotation_parentAnnotationId_idx" ON "Annotation"("parentAnnotationId");

-- CreateIndex
CREATE INDEX "Annotation_lineParentId_idx" ON "Annotation"("lineParentId");

-- CreateIndex
CREATE INDEX "Review_qaJobId_idx" ON "Review"("qaJobId");

-- CreateIndex
CREATE INDEX "Review_sourceJobId_idx" ON "Review"("sourceJobId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsensusResult_taskGroupId_key" ON "ConsensusResult"("taskGroupId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_parentAnnotationId_fkey" FOREIGN KEY ("parentAnnotationId") REFERENCES "Annotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_lineParentId_fkey" FOREIGN KEY ("lineParentId") REFERENCES "Annotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_qaJobId_fkey" FOREIGN KEY ("qaJobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_sourceJobId_fkey" FOREIGN KEY ("sourceJobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
