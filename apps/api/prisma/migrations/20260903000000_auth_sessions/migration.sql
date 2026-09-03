ALTER TABLE "Organization"
  ADD COLUMN "code" TEXT;

UPDATE "Organization"
SET "code" = CASE
  WHEN "id" = 'org-development' THEN 'demo'
  ELSE "id"
END;

ALTER TABLE "Organization"
  ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "Organization_code_key"
  ON "Organization"("code");

ALTER TABLE "User"
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "wechatOpenId" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_organizationId_phone_key"
  ON "User"("organizationId", "phone");
CREATE UNIQUE INDEX "User_organizationId_wechatOpenId_key"
  ON "User"("organizationId", "wechatOpenId");

CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key"
  ON "AuthSession"("refreshTokenHash");
CREATE INDEX "AuthSession_organizationId_userId_expiresAt_idx"
  ON "AuthSession"("organizationId", "userId", "expiresAt");

ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuthSession"
  ADD CONSTRAINT "AuthSession_userId_organizationId_fkey"
  FOREIGN KEY ("userId", "organizationId") REFERENCES "User"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
