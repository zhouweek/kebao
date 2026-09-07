ALTER TABLE "Organization"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PlatformAccount" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformSession" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformAuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformAccount_username_key" ON "PlatformAccount"("username");
CREATE UNIQUE INDEX "PlatformSession_refreshTokenHash_key" ON "PlatformSession"("refreshTokenHash");
CREATE INDEX "PlatformSession_accountId_expiresAt_idx" ON "PlatformSession"("accountId", "expiresAt");
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");
CREATE INDEX "PlatformAuditLog_entityType_entityId_idx" ON "PlatformAuditLog"("entityType", "entityId");

ALTER TABLE "PlatformSession"
  ADD CONSTRAINT "PlatformSession_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformAuditLog"
  ADD CONSTRAINT "PlatformAuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "PlatformAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
