-- 第二阶段：校区、教室、课程、教职工、家长和学生基础资料
ALTER TABLE "Campus"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Classroom"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Course"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "User"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "specialty" TEXT,
  ADD COLUMN "remark" TEXT;

ALTER TABLE "Student"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "birthDate" DATE,
  ADD COLUMN "campusId" TEXT,
  ADD COLUMN "remark" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "StudentGuardian"
  ADD COLUMN "relationship" TEXT NOT NULL DEFAULT '监护人',
  ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Classroom_organizationId_campusId_code_key"
  ON "Classroom"("organizationId", "campusId", "code");
CREATE UNIQUE INDEX "Course_organizationId_code_key"
  ON "Course"("organizationId", "code");
CREATE INDEX "Student_organizationId_campusId_idx"
  ON "Student"("organizationId", "campusId");

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_campusId_organizationId_fkey"
  FOREIGN KEY ("campusId", "organizationId")
  REFERENCES "Campus"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
