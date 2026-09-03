import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryRepository } from "../src/memory-repository.js";

const apps: ReturnType<typeof buildApp>[] = [];
const now = new Date("2026-09-03T00:00:00.000Z");

function createApp() {
  const repository = new MemoryRepository({
    organizations: ["org-a", "org-b"],
    users: [
      { id: "admin-a", organizationId: "org-a", role: "ADMIN" },
      { id: "teacher-a", organizationId: "org-a", role: "TEACHER" },
      { id: "guardian-a", organizationId: "org-a", role: "GUARDIAN", name: "家长甲" },
      { id: "guardian-b", organizationId: "org-b", role: "GUARDIAN", name: "家长乙" },
    ],
    students: [
      { id: "student-a", organizationId: "org-a", name: "学生甲", guardianPhone: "" },
      { id: "student-b", organizationId: "org-b", name: "学生乙", guardianPhone: "" },
    ],
    masterData: {
      campuses: [
        { id: "campus-a1", organizationId: "org-a", name: "北校区", isActive: true, createdAt: now, updatedAt: now },
        { id: "campus-a2", organizationId: "org-a", name: "南校区", isActive: true, createdAt: now, updatedAt: now },
        { id: "campus-b", organizationId: "org-b", name: "外部校区", isActive: true, createdAt: now, updatedAt: now },
      ],
    },
  });
  const app = buildApp(repository, { developmentIdentityEnabled: true });
  apps.push(app);
  return app;
}

function headers(tenant = "org-a", role = "ADMIN", user = "admin-a") {
  return {
    "x-tenant-id": tenant,
    "x-role": role,
    "x-user-id": user,
    "content-type": "application/json",
  };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("管理员基础资料 API", () => {
  it("仅允许管理员访问且列表严格按机构隔离", async () => {
    const app = createApp();
    const forbidden = await app.inject({
      method: "GET",
      url: "/admin/campuses",
      headers: headers("org-a", "TEACHER", "teacher-a"),
    });
    expect(forbidden.statusCode).toBe(403);

    const listed = await app.inject({
      method: "GET",
      url: "/admin/campuses?page=1&pageSize=10",
      headers: headers(),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.items.map((item: { name: string }) => item.name)).toEqual([
      "北校区",
      "南校区",
    ]);
  });

  it("支持创建、关键词筛选、分页、编辑、启停和删除", async () => {
    const app = createApp();
    const created = await app.inject({
      method: "POST",
      url: "/admin/courses",
      headers: headers(),
      payload: { name: "少儿编程", code: "CODE", durationMinutes: 90, description: "基础课" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;

    const filtered = await app.inject({
      method: "GET",
      url: "/admin/courses?page=1&pageSize=1&keyword=编程&activeOnly=true",
      headers: headers(),
    });
    expect(filtered.json().data).toMatchObject({ page: 1, pageSize: 1, total: 1 });

    const updated = await app.inject({
      method: "PATCH",
      url: `/admin/courses/${id}`,
      headers: headers(),
      payload: { name: "少儿编程进阶", code: "CODE-2", durationMinutes: 120 },
    });
    expect(updated.json().data).toMatchObject({ name: "少儿编程进阶", durationMinutes: 120 });

    const disabled = await app.inject({
      method: "PATCH",
      url: `/admin/courses/${id}/status`,
      headers: headers(),
      payload: { isActive: false },
    });
    expect(disabled.json().data.isActive).toBe(false);

    const removed = await app.inject({
      method: "DELETE",
      url: `/admin/courses/${id}`,
      headers: {
        "x-tenant-id": "org-a",
        "x-role": "ADMIN",
        "x-user-id": "admin-a",
      },
    });
    expect(removed.statusCode, removed.body).toBe(204);
  });

  it("允许不同校区使用相同教室名称", async () => {
    const app = createApp();
    for (const campusId of ["campus-a1", "campus-a2"]) {
      const response = await app.inject({
        method: "POST",
        url: "/admin/classrooms",
        headers: headers(),
        payload: { name: "101 教室", campusId, capacity: 20 },
      });
      expect(response.statusCode).toBe(201);
    }
  });

  it("绑定家长时拒绝跨机构身份，并支持设置主要监护人", async () => {
    const app = createApp();
    const crossTenant = await app.inject({
      method: "PUT",
      url: "/admin/students/student-a/guardians",
      headers: headers(),
      payload: {
        guardians: [{ guardianId: "guardian-b", relationship: "母亲", isPrimary: true }],
      },
    });
    expect(crossTenant.statusCode).toBe(404);

    const bound = await app.inject({
      method: "PUT",
      url: "/admin/students/student-a/guardians",
      headers: headers(),
      payload: {
        guardians: [{ guardianId: "guardian-a", relationship: "母亲", isPrimary: true }],
      },
    });
    expect(bound.statusCode).toBe(200);
    expect(bound.json().data.guardians).toEqual([
      expect.objectContaining({ id: "guardian-a", relationship: "母亲", isPrimary: true }),
    ]);
  });

  it("拒绝给学生关联当前机构不存在的校区", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "PATCH",
      url: "/admin/students/student-a",
      headers: headers(),
      payload: { name: "学生甲", campusId: "campus-b" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("CAMPUS_NOT_FOUND");
  });
});
