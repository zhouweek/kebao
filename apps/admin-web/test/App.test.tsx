import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("管理后台", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("排课时间有冲突"),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("老师冲突、教室冲突");
    expect(screen.getByRole("alert")).toHaveTextContent("少儿编程 L2");
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
});
