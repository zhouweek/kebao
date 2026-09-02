import type { MemorySeed } from "./memory-repository.js";

export function createDevelopmentSeed(now = new Date()): MemorySeed {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const end = new Date(tomorrow.getTime() + 90 * 60 * 1000);

  return {
    organizations: ["org-development"],
    users: [
      { id: "admin-1", organizationId: "org-development", role: "ADMIN" },
      { id: "teacher-1", organizationId: "org-development", role: "TEACHER" },
      { id: "student-1", organizationId: "org-development", role: "GUARDIAN" },
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
