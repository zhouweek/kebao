-- 课包定义、购买、学生权益、课时预占与不可变流水
CREATE TYPE "CoursePackageStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "CoursePurchaseStatus" AS ENUM ('PAID', 'CANCELLED', 'REFUNDED');
CREATE TYPE "EntitlementStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "CreditReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED', 'EXPIRED');
CREATE TYPE "CreditLedgerType" AS ENUM (
  'PURCHASE',
  'RESERVE',
  'RELEASE',
  'CONSUME',
  'REFUND',
  'ADJUSTMENT',
  'REVERSAL'
);

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'COURSE_PACKAGE_PURCHASED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ENTITLEMENT_LOW_BALANCE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ENTITLEMENT_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ENTITLEMENT_EXPIRED';

CREATE TABLE "CoursePackage" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "organizationId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "creditCount" INTEGER NOT NULL,
  "validityMonths" INTEGER NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "absentDeductsCredit" BOOLEAN NOT NULL DEFAULT false,
  "lateCancellationDeductsCredit" BOOLEAN NOT NULL DEFAULT false,
  "status" "CoursePackageStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CoursePackage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CoursePackage_nonnegative_version" CHECK ("version" >= 0),
  CONSTRAINT "CoursePackage_creditCount_range" CHECK (
    "creditCount" > 0 AND "creditCount" <= 2147483647
  ),
  CONSTRAINT "CoursePackage_positive_validityMonths" CHECK ("validityMonths" > 0),
  CONSTRAINT "CoursePackage_priceCents_range" CHECK (
    "priceCents" >= 0 AND "priceCents" <= 2147483647
  ),
  CONSTRAINT "CoursePackage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CoursePackage_courseId_organizationId_fkey"
    FOREIGN KEY ("courseId", "organizationId")
    REFERENCES "Course"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CoursePackage_id_organizationId_key"
  ON "CoursePackage"("id", "organizationId");

CREATE TABLE "CoursePurchase" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "packageNameSnapshot" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "courseNameSnapshot" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "creditCount" INTEGER NOT NULL,
  "validityMonths" INTEGER NOT NULL,
  "paidAmountCents" INTEGER NOT NULL,
  "status" "CoursePurchaseStatus" NOT NULL DEFAULT 'PAID',
  "purchasedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "createdBy" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "absentDeductsCreditSnapshot" BOOLEAN NOT NULL,
  "lateCancellationDeductsCreditSnapshot" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CoursePurchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CoursePurchase_creditCount_range" CHECK (
    "creditCount" > 0 AND "creditCount" <= 2147483647
  ),
  CONSTRAINT "CoursePurchase_positive_validityMonths" CHECK ("validityMonths" > 0),
  CONSTRAINT "CoursePurchase_paidAmountCents_range" CHECK (
    "paidAmountCents" >= 0 AND "paidAmountCents" <= 2147483647
  ),
  CONSTRAINT "CoursePurchase_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CoursePurchase_packageId_organizationId_fkey"
    FOREIGN KEY ("packageId", "organizationId")
    REFERENCES "CoursePackage"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CoursePurchase_courseId_organizationId_fkey"
    FOREIGN KEY ("courseId", "organizationId")
    REFERENCES "Course"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CoursePurchase_studentId_organizationId_fkey"
    FOREIGN KEY ("studentId", "organizationId")
    REFERENCES "Student"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CoursePurchase_id_organizationId_key"
  ON "CoursePurchase"("id", "organizationId");
CREATE UNIQUE INDEX "CoursePurchase_organizationId_idempotencyKey_key"
  ON "CoursePurchase"("organizationId", "idempotencyKey");

CREATE TABLE "StudentCourseEntitlement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "purchaseId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "totalCredits" INTEGER NOT NULL,
  "remainingCredits" INTEGER NOT NULL,
  "reservedCredits" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "validFrom" DATE NOT NULL,
  "validUntil" DATE NOT NULL,
  "status" "EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StudentCourseEntitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentCourseEntitlement_credit_balance" CHECK (
    "totalCredits" > 0
    AND "remainingCredits" >= 0
    AND "remainingCredits" <= "totalCredits"
    AND "reservedCredits" >= 0
    AND "reservedCredits" <= "remainingCredits"
    AND "version" >= 0
  ),
  CONSTRAINT "StudentCourseEntitlement_valid_dates" CHECK ("validUntil" >= "validFrom"),
  CONSTRAINT "StudentCourseEntitlement_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudentCourseEntitlement_purchaseId_organizationId_fkey"
    FOREIGN KEY ("purchaseId", "organizationId")
    REFERENCES "CoursePurchase"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StudentCourseEntitlement_packageId_organizationId_fkey"
    FOREIGN KEY ("packageId", "organizationId")
    REFERENCES "CoursePackage"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StudentCourseEntitlement_courseId_organizationId_fkey"
    FOREIGN KEY ("courseId", "organizationId")
    REFERENCES "Course"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StudentCourseEntitlement_studentId_organizationId_fkey"
    FOREIGN KEY ("studentId", "organizationId")
    REFERENCES "Student"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StudentCourseEntitlement_id_organizationId_key"
  ON "StudentCourseEntitlement"("id", "organizationId");
CREATE UNIQUE INDEX "StudentCourseEntitlement_purchaseId_organizationId_key"
  ON "StudentCourseEntitlement"("purchaseId", "organizationId");

CREATE TABLE "CreditReservation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "credits" INTEGER NOT NULL DEFAULT 1,
  "status" "CreditReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "expiresAt" TIMESTAMPTZ(3),
  "releasedAt" TIMESTAMPTZ(3),
  "consumedAt" TIMESTAMPTZ(3),
  "settlementAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextSettlementAttemptAt" TIMESTAMPTZ(3),
  "settlementLastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CreditReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditReservation_positive_credits" CHECK ("credits" > 0),
  CONSTRAINT "CreditReservation_terminal_date" CHECK (
    NOT ("releasedAt" IS NOT NULL AND "consumedAt" IS NOT NULL)
  ),
  CONSTRAINT "CreditReservation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CreditReservation_entitlementId_organizationId_fkey"
    FOREIGN KEY ("entitlementId", "organizationId")
    REFERENCES "StudentCourseEntitlement"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CreditReservation_bookingId_organizationId_fkey"
    FOREIGN KEY ("bookingId", "organizationId")
    REFERENCES "Booking"("id", "organizationId")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CreditReservation_id_organizationId_key"
  ON "CreditReservation"("id", "organizationId");

CREATE TABLE "CreditLedger" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "purchaseId" TEXT,
  "reservationId" TEXT,
  "bookingId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "type" "CreditLedgerType" NOT NULL,
  "creditDelta" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "reservedCreditDelta" INTEGER NOT NULL DEFAULT 0,
  "reservedBalanceAfter" INTEGER NOT NULL DEFAULT 0,
  "reversalOfId" TEXT,
  "actorId" TEXT NOT NULL,
  "note" TEXT,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditLedger_nonnegative_balances" CHECK (
    "balanceAfter" >= 0
    AND "reservedBalanceAfter" >= 0
    AND "reservedBalanceAfter" <= "balanceAfter"
  ),
  CONSTRAINT "CreditLedger_reversal_shape" CHECK (
    ("type" = 'REVERSAL' AND "reversalOfId" IS NOT NULL)
    OR ("type" <> 'REVERSAL' AND "reversalOfId" IS NULL)
  ),
  CONSTRAINT "CreditLedger_link_shape" CHECK (
    (
      "type" = 'PURCHASE'
      AND "purchaseId" IS NOT NULL
      AND "reservationId" IS NULL
      AND "bookingId" IS NULL
      AND "reversalOfId" IS NULL
    )
    OR (
      "type" IN ('RESERVE', 'RELEASE', 'CONSUME')
      AND "purchaseId" IS NULL
      AND "reservationId" IS NOT NULL
      AND "bookingId" IS NOT NULL
      AND "reversalOfId" IS NULL
    )
    OR (
      "type" = 'REFUND'
      AND "purchaseId" IS NOT NULL
      AND "reservationId" IS NULL
      AND "bookingId" IS NULL
      AND "reversalOfId" IS NULL
    )
    OR (
      "type" = 'ADJUSTMENT'
      AND "purchaseId" IS NULL
      AND "reservationId" IS NULL
      AND "bookingId" IS NULL
      AND "reversalOfId" IS NULL
    )
    OR (
      "type" = 'REVERSAL'
      AND "purchaseId" IS NULL
      AND "reservationId" IS NULL
      AND "bookingId" IS NULL
      AND "reversalOfId" IS NOT NULL
    )
  ),
  CONSTRAINT "CreditLedger_delta_shape" CHECK (
    ("type" = 'PURCHASE' AND "creditDelta" > 0 AND "reservedCreditDelta" = 0)
    OR ("type" = 'RESERVE' AND "creditDelta" = 0 AND "reservedCreditDelta" > 0)
    OR ("type" = 'RELEASE' AND "creditDelta" = 0 AND "reservedCreditDelta" < 0)
    OR ("type" = 'CONSUME' AND "creditDelta" < 0 AND "reservedCreditDelta" = "creditDelta")
    OR ("type" = 'REFUND' AND "creditDelta" < 0 AND "reservedCreditDelta" = 0)
    OR ("type" = 'ADJUSTMENT' AND "creditDelta" <> 0 AND "reservedCreditDelta" = 0)
    OR "type" = 'REVERSAL'
  ),
  CONSTRAINT "CreditLedger_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CreditLedger_entitlementId_organizationId_fkey"
    FOREIGN KEY ("entitlementId", "organizationId")
    REFERENCES "StudentCourseEntitlement"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CreditLedger_purchaseId_organizationId_fkey"
    FOREIGN KEY ("purchaseId", "organizationId")
    REFERENCES "CoursePurchase"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CreditLedger_reservationId_organizationId_fkey"
    FOREIGN KEY ("reservationId", "organizationId")
    REFERENCES "CreditReservation"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CreditLedger_bookingId_organizationId_fkey"
    FOREIGN KEY ("bookingId", "organizationId")
    REFERENCES "Booking"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "EntitlementValidityChange" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "previousValidUntil" DATE NOT NULL,
  "newValidUntil" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "changedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EntitlementValidityChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EntitlementValidityChange_changed_date" CHECK (
    "newValidUntil" > "previousValidUntil"
  ),
  CONSTRAINT "EntitlementValidityChange_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EntitlementValidityChange_entitlementId_organizationId_fkey"
    FOREIGN KEY ("entitlementId", "organizationId")
    REFERENCES "StudentCourseEntitlement"("id", "organizationId")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CoursePackage_organizationId_name_key"
  ON "CoursePackage"("organizationId", "name");
CREATE INDEX "CoursePackage_organizationId_courseId_status_idx"
  ON "CoursePackage"("organizationId", "courseId", "status");

CREATE INDEX "CoursePurchase_organizationId_studentId_purchasedAt_idx"
  ON "CoursePurchase"("organizationId", "studentId", "purchasedAt");
CREATE INDEX "CoursePurchase_organizationId_packageId_status_idx"
  ON "CoursePurchase"("organizationId", "packageId", "status");

CREATE INDEX "StudentCourseEntitlement_organizationId_studentId_courseId_status_idx"
  ON "StudentCourseEntitlement"("organizationId", "studentId", "courseId", "status");
CREATE INDEX "StudentCourseEntitlement_organizationId_validUntil_status_idx"
  ON "StudentCourseEntitlement"("organizationId", "validUntil", "status");

CREATE UNIQUE INDEX "CreditReservation_organizationId_bookingId_key"
  ON "CreditReservation"("organizationId", "bookingId");
CREATE INDEX "CreditReservation_organizationId_entitlementId_status_idx"
  ON "CreditReservation"("organizationId", "entitlementId", "status");
CREATE INDEX "CreditReservation_status_expiresAt_idx"
  ON "CreditReservation"("status", "expiresAt");
CREATE INDEX "CreditReservation_status_nextSettlementAttemptAt_expiresAt_idx"
  ON "CreditReservation"("status", "nextSettlementAttemptAt", "expiresAt");

CREATE UNIQUE INDEX "CreditLedger_id_organizationId_key"
  ON "CreditLedger"("id", "organizationId");
ALTER TABLE "CreditLedger"
  ADD CONSTRAINT "CreditLedger_reversalOfId_organizationId_fkey"
  FOREIGN KEY ("reversalOfId", "organizationId")
  REFERENCES "CreditLedger"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "CreditLedger_organizationId_idempotencyKey_key"
  ON "CreditLedger"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "CreditLedger_organizationId_reversalOfId_key"
  ON "CreditLedger"("organizationId", "reversalOfId");
CREATE INDEX "CreditLedger_organizationId_entitlementId_occurredAt_idx"
  ON "CreditLedger"("organizationId", "entitlementId", "occurredAt");
CREATE INDEX "CreditLedger_organizationId_bookingId_idx"
  ON "CreditLedger"("organizationId", "bookingId");
CREATE INDEX "CreditLedger_organizationId_purchaseId_idx"
  ON "CreditLedger"("organizationId", "purchaseId");

CREATE FUNCTION "prevent_credit_ledger_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CreditLedger is append-only; % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER "CreditLedger_prevent_update"
BEFORE UPDATE ON "CreditLedger"
FOR EACH ROW
EXECUTE FUNCTION "prevent_credit_ledger_mutation"();

CREATE TRIGGER "CreditLedger_prevent_delete"
BEFORE DELETE ON "CreditLedger"
FOR EACH ROW
EXECUTE FUNCTION "prevent_credit_ledger_mutation"();

CREATE UNIQUE INDEX "EntitlementValidityChange_id_organizationId_key"
  ON "EntitlementValidityChange"("id", "organizationId");
CREATE INDEX "EntitlementValidityChange_organizationId_entitlementId_createdAt_idx"
  ON "EntitlementValidityChange"("organizationId", "entitlementId", "createdAt");

-- 新字段均可空，保证现有预约和通知数据无需回填即可迁移。
ALTER TABLE "Booking" ADD COLUMN "entitlementId" TEXT;
CREATE INDEX "Booking_organizationId_entitlementId_idx"
  ON "Booking"("organizationId", "entitlementId");
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_entitlementId_organizationId_fkey"
  FOREIGN KEY ("entitlementId", "organizationId")
  REFERENCES "StudentCourseEntitlement"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD COLUMN "entitlementId" TEXT;
CREATE INDEX "Notification_organizationId_entitlementId_idx"
  ON "Notification"("organizationId", "entitlementId");
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_entitlementId_organizationId_fkey"
  FOREIGN KEY ("entitlementId", "organizationId")
  REFERENCES "StudentCourseEntitlement"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 预约必须使用同一学生、同一课程的权益。
CREATE FUNCTION "validate_booking_entitlement"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."entitlementId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "StudentCourseEntitlement" entitlement
    JOIN "CourseSession" session
      ON session."id" = NEW."sessionId"
      AND session."organizationId" = NEW."organizationId"
    WHERE entitlement."id" = NEW."entitlementId"
      AND entitlement."organizationId" = NEW."organizationId"
      AND entitlement."studentId" = NEW."studentId"
      AND entitlement."courseId" = session."courseId"
  ) THEN
    RAISE EXCEPTION 'Booking entitlement must belong to the same student and course';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Booking_validate_entitlement"
BEFORE INSERT OR UPDATE OF "organizationId", "sessionId", "studentId", "entitlementId"
ON "Booking"
FOR EACH ROW
EXECUTE FUNCTION "validate_booking_entitlement"();

-- 权益的身份字段创建后不可修改，余额、状态、版本和有效期按业务事务更新。
CREATE FUNCTION "prevent_entitlement_identity_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD."organizationId",
    OLD."purchaseId",
    OLD."packageId",
    OLD."courseId",
    OLD."studentId",
    OLD."totalCredits",
    OLD."validFrom"
  ) IS DISTINCT FROM ROW(
    NEW."organizationId",
    NEW."purchaseId",
    NEW."packageId",
    NEW."courseId",
    NEW."studentId",
    NEW."totalCredits",
    NEW."validFrom"
  ) THEN
    RAISE EXCEPTION 'StudentCourseEntitlement identity fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "StudentCourseEntitlement_prevent_identity_update"
BEFORE UPDATE ON "StudentCourseEntitlement"
FOR EACH ROW
EXECUTE FUNCTION "prevent_entitlement_identity_mutation"();

-- 预占和流水必须引用同一份预约权益，冲正只能执行一次且不能再次冲正。
CREATE FUNCTION "validate_credit_reservation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Booking"
    WHERE "id" = NEW."bookingId"
      AND "organizationId" = NEW."organizationId"
      AND "entitlementId" = NEW."entitlementId"
  ) THEN
    RAISE EXCEPTION 'CreditReservation must match the booking entitlement';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "CreditReservation_validate_booking"
BEFORE INSERT OR UPDATE OF "organizationId", "entitlementId", "bookingId"
ON "CreditReservation"
FOR EACH ROW
EXECUTE FUNCTION "validate_credit_reservation"();

CREATE FUNCTION "validate_credit_ledger_links"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  original_credit_delta INTEGER;
  original_reserved_delta INTEGER;
BEGIN
  IF NEW."purchaseId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "StudentCourseEntitlement"
    WHERE "id" = NEW."entitlementId"
      AND "organizationId" = NEW."organizationId"
      AND "purchaseId" = NEW."purchaseId"
  ) THEN
    RAISE EXCEPTION 'CreditLedger purchase must match the entitlement purchase';
  END IF;

  IF NEW."bookingId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "Booking"
    WHERE "id" = NEW."bookingId"
      AND "organizationId" = NEW."organizationId"
      AND "entitlementId" = NEW."entitlementId"
  ) THEN
    RAISE EXCEPTION 'CreditLedger booking must match the entitlement';
  END IF;

  IF NEW."reservationId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "CreditReservation"
    WHERE "id" = NEW."reservationId"
      AND "organizationId" = NEW."organizationId"
      AND "entitlementId" = NEW."entitlementId"
      AND (NEW."bookingId" IS NULL OR "bookingId" = NEW."bookingId")
  ) THEN
    RAISE EXCEPTION 'CreditLedger reservation must match the entitlement and booking';
  END IF;

  IF NEW."reversalOfId" IS NOT NULL THEN
    SELECT "creditDelta", "reservedCreditDelta"
    INTO original_credit_delta, original_reserved_delta
    FROM "CreditLedger"
    WHERE "id" = NEW."reversalOfId"
      AND "organizationId" = NEW."organizationId"
      AND "entitlementId" = NEW."entitlementId"
      AND "type" <> 'REVERSAL';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CreditLedger reversal must reference a reversible entry';
    END IF;

    IF NEW."creditDelta" <> -original_credit_delta
      OR NEW."reservedCreditDelta" <> -original_reserved_delta THEN
      RAISE EXCEPTION 'CreditLedger reversal deltas must negate the original entry';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "CreditLedger_validate_links"
BEFORE INSERT ON "CreditLedger"
FOR EACH ROW
EXECUTE FUNCTION "validate_credit_ledger_links"();
