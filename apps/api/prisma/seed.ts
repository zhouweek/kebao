import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/auth.js";

const prisma = new PrismaClient();
const organizationId = "org-development";
const tomorrow = new Date();
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
tomorrow.setUTCHours(10, 0, 0, 0);
const endsAt = new Date(tomorrow.getTime() + 90 * 60 * 1000);
const adminPasswordHash = await hashPassword(process.env.SEED_ADMIN_PASSWORD ?? "Admin123!");

await prisma.organization.upsert({
  where: { id: organizationId },
  update: { code: "DEMO", name: "课宝开发机构" },
  create: { id: organizationId, code: "DEMO", name: "课宝开发机构" },
});
await prisma.campus.upsert({
  where: { id: "campus-a" },
  update: {},
  create: { id: "campus-a", organizationId, name: "A 校区" },
});
await prisma.user.upsert({
  where: { id: "admin-1" },
  update: { phone: "13800000001" },
  create: {
    id: "admin-1",
    organizationId,
    role: "ADMIN",
    name: "开发管理员",
    phone: "13800000001",
    passwordHash: adminPasswordHash,
  },
});

await prisma.user.upsert({
  where: { id: "teacher-1" },
  update: { phone: "13800000002", isActive: true },
  create: {
    id: "teacher-1",
    organizationId,
    role: "TEACHER",
    name: "王老师",
    phone: "13800000002",
  },
});
await prisma.user.upsert({
  where: { id: "student-1" },
  update: { phone: "13800001001", isActive: true },
  create: {
    id: "student-1",
    organizationId,
    role: "GUARDIAN",
    name: "林小满家长",
    phone: "13800001001",
  },
});
await prisma.student.upsert({
  where: { id: "student-1" },
  update: {},
  create: { id: "student-1", organizationId, name: "林小满" },
});
await prisma.studentGuardian.upsert({
  where: {
    organizationId_studentId_guardianId: {
      organizationId,
      studentId: "student-1",
      guardianId: "student-1",
    },
  },
  update: {},
  create: { organizationId, studentId: "student-1", guardianId: "student-1" },
});
await prisma.course.upsert({
  where: { id: "course-coding-l2" },
  update: {},
  create: {
    id: "course-coding-l2",
    organizationId,
    name: "少儿编程 L2",
    durationMinutes: 90,
  },
});
await prisma.classroom.upsert({
  where: { id: "room-105" },
  update: {},
  create: {
    id: "room-105",
    organizationId,
    campusId: "campus-a",
    name: "105 教室",
    capacity: 12,
  },
});
await prisma.courseSession.upsert({
  where: { id: "session-1" },
  update: {},
  create: {
    id: "session-1",
    organizationId,
    courseId: "course-coding-l2",
    campusId: "campus-a",
    classroomId: "room-105",
    teacherId: "teacher-1",
    startsAt: tomorrow,
    endsAt,
    capacity: 12,
    bookingOpensAt: new Date(tomorrow.getTime() - 7 * 24 * 60 * 60 * 1000),
    bookingClosesAt: new Date(tomorrow.getTime() - 2 * 60 * 60 * 1000),
    cancelDeadlineAt: new Date(tomorrow.getTime() - 4 * 60 * 60 * 1000),
  },
});

await prisma.$disconnect();
