ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOKING_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOKING_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SESSION_REMINDER_24H';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SESSION_REMINDER_2H';

CREATE TYPE "NotificationDeliveryStatus" AS ENUM (
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED',
  'SKIPPED'
);

ALTER TABLE "Notification" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Notification_organizationId_idempotencyKey_key"
  ON "Notification"("organizationId", "idempotencyKey");

CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'WECHAT',
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationDelivery_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationDelivery_notificationId_organizationId_fkey"
    FOREIGN KEY ("notificationId", "organizationId")
    REFERENCES "Notification"("id", "organizationId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationDelivery_userId_organizationId_fkey"
    FOREIGN KEY ("userId", "organizationId")
    REFERENCES "User"("id", "organizationId")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NotificationDelivery_id_organizationId_key"
  ON "NotificationDelivery"("id", "organizationId");
CREATE UNIQUE INDEX "NotificationDelivery_organizationId_idempotencyKey_key"
  ON "NotificationDelivery"("organizationId", "idempotencyKey");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx"
  ON "NotificationDelivery"("status", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_organizationId_createdAt_idx"
  ON "NotificationDelivery"("organizationId", "createdAt");
