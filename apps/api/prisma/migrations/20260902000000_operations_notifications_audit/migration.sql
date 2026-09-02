ALTER TYPE "BookingStatus" ADD VALUE 'LEAVE';

CREATE TYPE "NotificationType" AS ENUM ('SESSION_RESCHEDULED', 'SESSION_CANCELLED');

CREATE TABLE "Notification" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "sessionId" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Notification_id_organizationId_key"
  ON "Notification"("id", "organizationId");
CREATE INDEX "Notification_organizationId_userId_readAt_createdAt_idx"
  ON "Notification"("organizationId", "userId", "readAt", "createdAt");
CREATE UNIQUE INDEX "AuditLog_id_organizationId_key"
  ON "AuditLog"("id", "organizationId");
CREATE INDEX "AuditLog_organizationId_createdAt_idx"
  ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX "AuditLog_organizationId_entityType_entityId_idx"
  ON "AuditLog"("organizationId", "entityType", "entityId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_organizationId_fkey"
  FOREIGN KEY ("userId", "organizationId") REFERENCES "User"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
