CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE "SessionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'CANCELLED', 'FINISHED');
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'COURSE_CANCELLED', 'ATTENDED', 'ABSENT');
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'TEACHER', 'GUARDIAN');

CREATE TABLE "Organization" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Campus" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  CONSTRAINT "Campus_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Student" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Student_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StudentGuardian" (
  "organizationId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "guardianId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentGuardian_pkey" PRIMARY KEY ("organizationId", "studentId", "guardianId"),
  CONSTRAINT "StudentGuardian_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Course" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  CONSTRAINT "Course_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Classroom" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL,
  CONSTRAINT "Classroom_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CourseSession" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "classroomId" TEXT,
  "teacherId" TEXT NOT NULL,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "capacity" INTEGER NOT NULL,
  "status" "SessionStatus" NOT NULL DEFAULT 'PUBLISHED',
  "bookingOpensAt" TIMESTAMPTZ(3) NOT NULL,
  "bookingClosesAt" TIMESTAMPTZ(3) NOT NULL,
  "cancelDeadlineAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseSession_valid_time" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "CourseSession_positive_capacity" CHECK ("capacity" > 0),
  CONSTRAINT "CourseSession_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Booking" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Booking_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Campus_id_organizationId_key" ON "Campus"("id", "organizationId");
CREATE UNIQUE INDEX "Campus_organizationId_name_key" ON "Campus"("organizationId", "name");
CREATE UNIQUE INDEX "User_id_organizationId_key" ON "User"("id", "organizationId");
CREATE INDEX "User_organizationId_role_idx" ON "User"("organizationId", "role");
CREATE UNIQUE INDEX "Student_id_organizationId_key" ON "Student"("id", "organizationId");
CREATE INDEX "Student_organizationId_name_idx" ON "Student"("organizationId", "name");
CREATE INDEX "StudentGuardian_organizationId_guardianId_idx"
  ON "StudentGuardian"("organizationId", "guardianId");
CREATE UNIQUE INDEX "Course_id_organizationId_key" ON "Course"("id", "organizationId");
CREATE UNIQUE INDEX "Course_organizationId_name_key" ON "Course"("organizationId", "name");
CREATE UNIQUE INDEX "Classroom_id_organizationId_key" ON "Classroom"("id", "organizationId");
CREATE UNIQUE INDEX "Classroom_organizationId_campusId_name_key"
  ON "Classroom"("organizationId", "campusId", "name");
CREATE UNIQUE INDEX "CourseSession_id_organizationId_key"
  ON "CourseSession"("id", "organizationId");
CREATE INDEX "CourseSession_organizationId_teacherId_startsAt_endsAt_idx"
  ON "CourseSession"("organizationId", "teacherId", "startsAt", "endsAt");
CREATE INDEX "CourseSession_organizationId_classroomId_startsAt_endsAt_idx"
  ON "CourseSession"("organizationId", "classroomId", "startsAt", "endsAt");
CREATE INDEX "CourseSession_organizationId_campusId_startsAt_idx"
  ON "CourseSession"("organizationId", "campusId", "startsAt");
CREATE UNIQUE INDEX "Booking_id_organizationId_key" ON "Booking"("id", "organizationId");
CREATE UNIQUE INDEX "Booking_organizationId_sessionId_studentId_key"
  ON "Booking"("organizationId", "sessionId", "studentId");
CREATE INDEX "Booking_organizationId_studentId_status_idx"
  ON "Booking"("organizationId", "studentId", "status");

ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_studentId_organizationId_fkey"
  FOREIGN KEY ("studentId", "organizationId") REFERENCES "Student"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_guardianId_organizationId_fkey"
  FOREIGN KEY ("guardianId", "organizationId") REFERENCES "User"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Classroom" ADD CONSTRAINT "Classroom_campusId_organizationId_fkey"
  FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseSession" ADD CONSTRAINT "CourseSession_courseId_organizationId_fkey"
  FOREIGN KEY ("courseId", "organizationId") REFERENCES "Course"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseSession" ADD CONSTRAINT "CourseSession_campusId_organizationId_fkey"
  FOREIGN KEY ("campusId", "organizationId") REFERENCES "Campus"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseSession" ADD CONSTRAINT "CourseSession_classroomId_organizationId_fkey"
  FOREIGN KEY ("classroomId", "organizationId") REFERENCES "Classroom"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseSession" ADD CONSTRAINT "CourseSession_teacherId_organizationId_fkey"
  FOREIGN KEY ("teacherId", "organizationId") REFERENCES "User"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_sessionId_organizationId_fkey"
  FOREIGN KEY ("sessionId", "organizationId") REFERENCES "CourseSession"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_studentId_organizationId_fkey"
  FOREIGN KEY ("studentId", "organizationId") REFERENCES "Student"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseSession" ADD CONSTRAINT "CourseSession_teacher_time_excl"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "teacherId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" IN ('PUBLISHED', 'CLOSED'));

ALTER TABLE "CourseSession" ADD CONSTRAINT "CourseSession_classroom_time_excl"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "classroomId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE (
    "classroomId" IS NOT NULL
    AND "status" IN ('PUBLISHED', 'CLOSED')
  );
