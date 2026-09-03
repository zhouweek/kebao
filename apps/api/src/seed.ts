import type { MemorySeed } from "./memory-repository.js";
import { hashPasswordForDevelopment } from "./auth.js";

export function createDevelopmentSeed(now = new Date()): MemorySeed {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const end = new Date(tomorrow.getTime() + 90 * 60 * 1000);
  const createdAt = new Date(now);

  return {
    organizations: [{ id: "org-development", code: "DEMO" }],
    masterData: {
      campuses: [
        {
          id: "campus-a",
          name: "A 校区",
          address: "示例市中心路 1 号",
          phone: "010-88886666",
          timezone: "Asia/Shanghai",
          isActive: true,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      classrooms: [
        {
          id: "room-105",
          name: "105 教室",
          code: "A-105",
          campusId: "campus-a",
          campusName: "A 校区",
          capacity: 12,
          isActive: true,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      courses: [
        {
          id: "course-coding-l2",
          name: "少儿编程 L2",
          code: "CODING-L2",
          durationMinutes: 90,
          description: "进阶编程课程",
          isActive: true,
          createdAt,
          updatedAt: createdAt,
        },
      ],
    },
    users: [
      {
        id: "admin-1",
        organizationId: "org-development",
        role: "ADMIN",
        name: "开发管理员",
        phone: "13800000001",
        passwordHash: hashPasswordForDevelopment("Admin123!"),
      },
      {
        id: "teacher-1",
        organizationId: "org-development",
        role: "TEACHER",
        name: "王老师",
        phone: "13800000002",
      },
      {
        id: "student-1",
        organizationId: "org-development",
        role: "GUARDIAN",
        name: "林小满家长",
        phone: "13800001001",
      },
    ],
    guardians: [
      {
        organizationId: "org-development",
        guardianId: "student-1",
        studentId: "student-1",
      },
    ],
    students: [
      { id: "student-1", name: "林小满", guardianPhone: "138****1001" },
      { id: "student-2", name: "周星辰", guardianPhone: "139****2002" },
      { id: "student-3", name: "陈可乐", guardianPhone: "136****3003" },
    ],
    sessions: [
      {
        id: "session-1",
        courseId: "course-coding-l2",
        courseName: "少儿编程 L2",
        campusId: "campus-a",
        campusName: "A 校区",
        classroomId: "room-105",
        classroomName: "105 教室",
        teacherId: "teacher-1",
        teacherName: "王老师",
        startsAt: tomorrow,
        endsAt: end,
        capacity: 2,
        status: "PUBLISHED",
        bookingOpensAt: new Date(tomorrow.getTime() - 7 * 24 * 60 * 60 * 1000),
        bookingClosesAt: new Date(tomorrow.getTime() - 2 * 60 * 60 * 1000),
        cancelDeadlineAt: new Date(tomorrow.getTime() - 4 * 60 * 60 * 1000),
      },
    ],
    bookings: [
      {
        id: "booking-1",
        sessionId: "session-1",
        studentId: "student-1",
        status: "CONFIRMED",
        createdAt: now,
      },
    ],
  };
}
