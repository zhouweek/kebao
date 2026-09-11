import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

const session = {
  id: "session-1",
  courseId: "course-coding-l2",
  courseName: "少儿编程 L2",
  campusId: "campus-a",
  campusName: "A 校区",
  classroomId: "room-105",
  classroomName: "105 教室",
  teacherId: "teacher-1",
  teacherName: "王老师",
  startsAt: "2099-09-02T02:00:00.000Z",
  endsAt: "2099-09-02T03:30:00.000Z",
  capacity: 12,
  status: "PUBLISHED",
  bookingOpensAt: "2099-08-26T02:00:00.000Z",
  bookingClosesAt: "2099-09-02T00:00:00.000Z",
  cancelDeadlineAt: "2099-09-01T22:00:00.000Z",
  bookedCount: 5,
  remainingCapacity: 7,
};

const masterItems: Record<string, Array<Record<string, unknown>>> = {
  courses: [{ id: "course-coding-l2", name: "少儿编程 L2", isActive: true }],
  campuses: [{ id: "campus-a", name: "A 校区", isActive: true }],
  teachers: [{ id: "teacher-1", name: "王老师", isActive: true }],
  classrooms: [{
    id: "room-105",
    name: "105 教室",
    campusId: "campus-a",
    isActive: true,
  }],
  guardians: [],
  students: [{ id: "student-1", name: "学生甲", isActive: true }],
};

function masterResponse(input: RequestInfo | URL) {
  const match = String(input).match(/^\/admin\/([^?]+)/);
  if (!match) return undefined;
  const items = masterItems[match[1]!] ?? [];
  return new Response(JSON.stringify({
    data: { items, page: 1, pageSize: 100, total: items.length },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.setItem(
    "kebao.admin.auth",
    JSON.stringify({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresIn: 900,
      user: {
        id: "admin-1",
        organizationId: "org-development",
        role: "ADMIN",
        name: "管理员",
        phone: "13800000001",
      },
    }),
  );
});

describe("管理后台", () => {
  it("机构管理员首次登录必须改密，成功后清除已撤销的会话", async () => {
    const forcedUser = {
      id: "admin-1",
      organizationId: "org-development",
      role: "ADMIN",
      name: "管理员",
      phone: "13800000001",
      mustChangePassword: true,
    };
    localStorage.setItem(
      "kebao.admin.auth",
      JSON.stringify({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        accessTokenExpiresIn: 900,
        user: forcedUser,
      }),
    );
    localStorage.setItem(
      "kebao.admin.login-credentials",
      JSON.stringify({
        organizationCode: "DEMO",
        phone: "13800000001",
        password: "Temp123!",
      }),
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/auth/me") {
        return new Response(JSON.stringify({ data: forcedUser }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (input === "/auth/change-password") {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);
    expect(await screen.findByRole("heading", { name: "请先修改密码" })).toBeInTheDocument();
    expect(localStorage.getItem("kebao.admin.login-credentials")).toBeNull();
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "Temp123!" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "NewPassword123!" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "NewPassword123!" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/auth/change-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          currentPassword: "Temp123!",
          newPassword: "NewPassword123!",
        }),
      }),
    ));
    expect(await screen.findByRole("heading", { name: "管理员登录" })).toBeInTheDocument();
    expect(localStorage.getItem("kebao.admin.auth")).toBeNull();
  });

  it("动态展示机构管理员身份并允许随时修改本人密码", async () => {
    const currentUser = {
      id: "admin-1",
      organizationId: "org-development",
      role: "ADMIN",
      name: "周老师",
      phone: "13800000001",
      mustChangePassword: false,
    };
    localStorage.setItem(
      "kebao.admin.login-credentials",
      JSON.stringify({
        organizationCode: "DEMO",
        phone: "13800000001",
        password: "OldPassword123!",
      }),
    );
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/auth/me") {
        return new Response(JSON.stringify({ data: currentUser }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (input === "/auth/change-password") {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ data: [session] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);
    expect(await screen.findByRole("heading", { name: "上午好，周老师" })).toBeInTheDocument();
    expect(screen.getByText("机构管理员")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "修改本人密码" }));
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "OldPassword123!" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "NewPassword123!" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "NewPassword123!" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/auth/change-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          currentPassword: "OldPassword123!",
          newPassword: "NewPassword123!",
        }),
      }),
    ));
    expect(await screen.findByRole("heading", { name: "管理员登录" })).toBeInTheDocument();
    expect(localStorage.getItem("kebao.admin.auth")).toBeNull();
    expect(localStorage.getItem("kebao.admin.login-credentials")).toBeNull();
    expect(screen.getByLabelText("密码")).toHaveValue("");
  });

  it("支持显示密码并记住登录信息", async () => {
    localStorage.clear();
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          input === "/auth/admin/login"
            ? {
                data: {
                  accessToken: "new-access",
                  refreshToken: "new-refresh",
                  accessTokenExpiresIn: 900,
                  user: {
                    id: "admin-1",
                    organizationId: "org-development",
                    role: "ADMIN",
                    name: "管理员",
                    phone: "13800000001",
                  },
                },
              }
            : { data: [session] },
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    render(<App />);

    fireEvent.change(screen.getByLabelText("机构编码"), {
      target: { value: "DEMO" },
    });
    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800000001" },
    });
    const password = screen.getByLabelText("密码");
    fireEvent.change(password, { target: { value: "Admin123!" } });
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(password).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("checkbox", { name: "记住上次登录信息" }));
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await screen.findByText("少儿编程 L2");

    expect(JSON.parse(localStorage.getItem("kebao.admin.login-credentials")!)).toEqual({
      organizationCode: "DEMO",
      phone: "13800000001",
      password: "Admin123!",
    });
  });

  it("自动回填上次记住的登录信息", () => {
    localStorage.clear();
    localStorage.setItem(
      "kebao.admin.login-credentials",
      JSON.stringify({
        organizationCode: "DEMO",
        phone: "13800000001",
        password: "Admin123!",
      }),
    );
    render(<App />);

    expect(screen.getByLabelText("机构编码")).toHaveValue("DEMO");
    expect(screen.getByLabelText("手机号")).toHaveValue("13800000001");
    expect(screen.getByLabelText("密码")).toHaveValue("Admin123!");
    expect(screen.getByRole("checkbox", { name: "记住上次登录信息" })).toBeChecked();
  });

  it("未勾选记住信息时登录后清空三个输入项", async () => {
    localStorage.clear();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/auth/logout") {
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify(
          input === "/auth/admin/login"
            ? {
                data: {
                  accessToken: "new-access",
                  refreshToken: "new-refresh",
                  accessTokenExpiresIn: 900,
                  user: {
                    id: "admin-1",
                    organizationId: "org-development",
                    role: "ADMIN",
                    name: "管理员",
                    phone: "13800000001",
                  },
                },
              }
            : { data: [session] },
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    render(<App />);

    fireEvent.change(screen.getByLabelText("机构编码"), {
      target: { value: "DEMO" },
    });
    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800000001" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "Admin123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    await screen.findByText("少儿编程 L2");
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "管理员登录" })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("机构编码")).toHaveValue("");
    expect(screen.getByLabelText("手机号")).toHaveValue("");
    expect(screen.getByLabelText("密码")).toHaveValue("");
    expect(localStorage.getItem("kebao.admin.login-credentials")).toBeNull();
  });

  it("未登录时展示手机号密码登录并在成功后加载课次", async () => {
    localStorage.clear();
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          input === "/auth/admin/login"
            ? {
                data: {
                  accessToken: "new-access",
                  refreshToken: "new-refresh",
                  accessTokenExpiresIn: 900,
                  user: {
                    id: "admin-1",
                    organizationId: "org-development",
                    role: "ADMIN",
                    name: "管理员",
                    phone: "13800000001",
                  },
                },
              }
            : { data: [session] },
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    render(<App />);

    fireEvent.change(screen.getByLabelText("机构编码"), {
      target: { value: "DEMO" },
    });
    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800000001" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "Admin123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("少儿编程 L2")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      "/auth/admin/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          organizationCode: "DEMO",
          phone: "13800000001",
          password: "Admin123!",
        }),
      }),
    );
  });

  it("展示概览和 GET /sessions 返回的课次", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ data: [session] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);

    render(<App />);

    expect(screen.getByRole("heading", { name: /上午好/ })).toBeInTheDocument();
    expect(await screen.findByText("少儿编程 L2")).toBeInTheDocument();
    expect(
      screen.getAllByText((_, element) => element?.textContent === "5 / 12 人"),
    ).not.toHaveLength(0);
  });

  it("提交冲突时展示服务端错误和冲突课次", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const referenceData = masterResponse(_input);
      if (referenceData) return referenceData;
      if (init?.method === "POST") {
        return new Response(
          JSON.stringify({
            error: {
              code: "SESSION_CONFLICT",
              message: "老师或教室在该时段已被占用",
              details: {
                conflicts: [
                  {
                    sessionId: "session-1",
                    teacherConflict: true,
                    classroomConflict: true,
                  },
                ],
              },
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: [session] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    render(<App />);
    await screen.findByText("少儿编程 L2");
    fireEvent.click(screen.getByRole("button", { name: "创建课次" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认创建" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("排课时间有冲突"),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("老师冲突、教室冲突");
    expect(screen.getByRole("alert")).toHaveTextContent("少儿编程 L2");
  });

  it("从管理接口加载排课选项并展示基础资料页面", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const referenceData = masterResponse(input);
      if (referenceData) return referenceData;
      return new Response(JSON.stringify({ data: [session] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    await screen.findByText("少儿编程 L2");

    fireEvent.click(screen.getByRole("button", { name: "创建课次" }));
    expect(await screen.findByRole("option", { name: "A 校区" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "王老师" })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      "/admin/courses?pageSize=100&activeOnly=true",
      expect.any(Object),
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "校区管理" }));
    expect(await screen.findByRole("heading", { name: "校区管理" })).toBeInTheDocument();
    expect((await screen.findAllByText("A 校区")).length).toBeGreaterThan(0);
  });

  it("在课次管理中提交停课原因", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/cancel") && init?.method === "POST") {
        return new Response(JSON.stringify({ data: { ...session, status: "CANCELLED" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ data: [session] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<App />);

    await screen.findByText("少儿编程 L2");
    fireEvent.click(screen.getByRole("button", { name: "课次管理" }));
    fireEvent.click(screen.getByRole("button", { name: "停课" }));
    fireEvent.change(screen.getByLabelText("停课原因"), { target: { value: "老师请假" } });
    fireEvent.click(screen.getByRole("button", { name: "确认停课" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/sessions/session-1/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "老师请假" }),
      }),
    ));
  });

  it("在预约管理中筛选并提交代预约和带原因的代取消", async () => {
    const booking = {
      id: "booking-1",
      sessionId: "session-1",
      studentId: "student-1",
      status: "CONFIRMED",
      createdAt: "2099-09-01T02:00:00.000Z",
      session: {
        id: "session-1",
        courseId: "course-coding-l2",
        courseName: "少儿编程 L2",
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        status: "PUBLISHED",
      },
      student: { id: "student-1", name: "学生甲", guardianPhone: "138****0001" },
      teacher: { id: "teacher-1", name: "王老师" },
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/admin/bookings")) {
        const data = init?.method === "POST"
          ? String(input).endsWith("/cancel")
            ? { ...booking, status: "CANCELLED" }
            : { booking, alreadyBooked: false }
          : { items: [booking], page: 1, pageSize: 10, total: 1 };
        return new Response(JSON.stringify({ data }), {
          status: init?.method === "POST" ? 201 : 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const referenceData = masterResponse(input);
      if (referenceData) return referenceData;
      return new Response(JSON.stringify({ data: [session] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    await screen.findByText("少儿编程 L2");

    fireEvent.click(screen.getByRole("button", { name: "预约管理" }));
    expect((await screen.findAllByText("学生甲")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/admin/bookings?page=1&pageSize=10",
      expect.any(Object),
    ));

    fireEvent.click(screen.getByRole("button", { name: "代预约" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认代预约" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/admin/bookings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1", studentId: "student-1" }),
      }),
    ));

    fireEvent.click(screen.getByRole("button", { name: "代取消" }));
    expect(screen.getByRole("button", { name: "确认代取消" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("取消原因"), {
      target: { value: "家长电话申请" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认代取消" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/admin/bookings/booking-1/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "家长电话申请" }),
      }),
    ));
  });

  it("展示站内通知并支持标记已读", async () => {
    const notice = {
      id: "notice-1",
      userId: "admin-1",
      type: "SESSION_RESCHEDULED",
      title: "课程时间调整",
      content: "少儿编程已调整",
      sessionId: "session-1",
      readAt: null,
      createdAt: "2099-09-01T02:00:00.000Z",
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/notifications/notice-1/read" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ data: { ...notice, readAt: "2099-09-01T03:00:00.000Z" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (input === "/notifications") {
        return new Response(JSON.stringify({ data: [notice] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ data: [session] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "站内通知" }));
    expect(await screen.findByText("课程时间调整")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /课程时间调整/ }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      "/notifications/notice-1/read",
      expect.objectContaining({ method: "PATCH" }),
    ));
    expect(screen.queryByText("未读")).not.toBeInTheDocument();
  });

  it("从侧栏进入课包管理并加载真实接口", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input === "/auth/me") {
        return new Response(JSON.stringify({
          data: {
            id: "admin-1",
            organizationId: "org-development",
            role: "ADMIN",
            name: "管理员",
            phone: "13800000001",
            mustChangePassword: false,
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(input).startsWith("/admin/course-packages")) {
        return new Response(JSON.stringify({
          data: {
            items: [{
              id: "package-1",
              courseId: "course-1",
              courseName: "少儿编程 L2",
              name: "真实课包",
              creditCount: 20,
              validityMonths: 6,
              priceCents: 199900,
              soldCount: 0,
              status: "ACTIVE",
            }],
            page: 1,
            pageSize: 100,
            total: 1,
          },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(input).startsWith("/admin/student-entitlements")) {
        return new Response(JSON.stringify({
          data: { items: [], page: 1, pageSize: 100, total: 0 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (String(input).startsWith("/admin/courses") || String(input).startsWith("/admin/students")) {
        return new Response(JSON.stringify({
          data: { items: [], page: 1, pageSize: 100, total: 0 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: [session] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<App />);
    await screen.findByText("少儿编程 L2");

    fireEvent.click(screen.getByRole("button", { name: "课包管理" }));

    expect(screen.getByRole("heading", { name: "课包管理" })).toBeInTheDocument();
    expect(await screen.findByText("真实课包")).toBeInTheDocument();
    expect(screen.getByLabelText("课包管理")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      "/admin/course-packages?page=1&pageSize=20",
      expect.anything(),
    );
  });
});
