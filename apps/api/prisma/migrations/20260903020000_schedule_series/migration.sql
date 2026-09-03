CREATE TABLE "ScheduleSeries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recurrence" TEXT NOT NULL DEFAULT 'WEEKLY',
    "intervalWeeks" INTEGER NOT NULL DEFAULT 1,
    "requestedCount" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduleSeries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CourseSession"
  ADD COLUMN "seriesId" TEXT,
  ADD COLUMN "occurrenceIndex" INTEGER;

CREATE UNIQUE INDEX "ScheduleSeries_id_organizationId_key"
  ON "ScheduleSeries"("id", "organizationId");
CREATE INDEX "ScheduleSeries_organizationId_createdAt_idx"
  ON "ScheduleSeries"("organizationId", "createdAt");
CREATE UNIQUE INDEX "CourseSession_organizationId_seriesId_occurrenceIndex_key"
  ON "CourseSession"("organizationId", "seriesId", "occurrenceIndex");

ALTER TABLE "ScheduleSeries"
  ADD CONSTRAINT "ScheduleSeries_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseSession"
  ADD CONSTRAINT "CourseSession_seriesId_organizationId_fkey"
  FOREIGN KEY ("seriesId", "organizationId")
  REFERENCES "ScheduleSeries"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
