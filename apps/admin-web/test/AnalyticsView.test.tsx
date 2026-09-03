import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsView } from "../src/AnalyticsView";

const statistics = {
  metrics: {
    sessionCount: 2,
    reservationCount: 8,
    occupancyRate: 40,
    cancellationRate: 12.5,
    attendanceRate: 75,
  },
  details: [
    {
      sessionId: "session-1",
      startsAt: "2026-09-10T02:00:00.000Z",
      courseId: "course-1",
      courseName: "少儿编程",
      campusId: "campus-1",
      campusName: "中心校区",
      teacherId: "teacher-1",
      teacherName: "王老师",
      capacity: 10,
      reservationCount: 5,
      activeBookingCount: 4,
      cancelledBookingCount: 1,
      attendedCount: 3,
      leaveCount: 0,
      absentCount: 1,
      occupancyRate: 40,
      cancellationRate: 20,
      attendanceRate: 75,
    },
  ],
  generatedAt: "2026-09-03T12:00:00.000Z",
  definitions: {
    sessions: "排除草稿和已取消课次。",
    reservations: "排除课程取消预约。",
    occupancy: "有效预约除以容量。",
    cancellation: "用户取消除以预约人次。",
    attendance: "已到除以已记录考勤。",
  },
};

beforeEach(() => {
  localStorage.setItem(
    "kebao.admin.auth",
    JSON.stringify({ accessToken: "access-token" }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AnalyticsView", () => {
  it("展示指标和下钻明细，并提交筛选条件", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ data: statistics }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    render(
      <AnalyticsView
        campuses={[{ id: "campus-1", name: "中心校区", isActive: true, createdAt: "", updatedAt: "" }]}
        courses={[{ id: "course-1", name: "少儿编程", isActive: true, createdAt: "", updatedAt: "" }]}
        teachers={[{ id: "teacher-1", name: "王老师", isActive: true, createdAt: "", updatedAt: "" }]}
      />,
    );

    expect(await screen.findByText("课次明细下钻")).toBeInTheDocument();
    expect(screen.getByText("12.5%")).toBeInTheDocument();
    expect(screen.getAllByText("少儿编程")).toHaveLength(2);
    expect(screen.getByText("3 / 0 / 1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("统计校区"), {
      target: { value: "campus-1" },
    });
    fireEvent.change(screen.getByLabelText("统计课程"), {
      target: { value: "course-1" },
    });
    fireEvent.change(screen.getByLabelText("统计老师"), {
      target: { value: "teacher-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("campusId=campus-1");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("courseId=course-1");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("teacherId=teacher-1");
  });

  it("下载服务端生成的 CSV 文件", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith("/admin/statistics/export")
        ? new Response("\uFEFF统计明细", {
            status: 200,
            headers: {
              "Content-Type": "text/csv",
              "Content-Disposition": 'attachment; filename="statistics.csv"',
            },
          })
        : new Response(JSON.stringify({ data: statistics }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
    );
    vi.stubGlobal("fetch", fetcher);
    const createObjectURL = vi.fn(() => "blob:statistics");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<AnalyticsView campuses={[]} courses={[]} teachers={[]} />);

    fireEvent.click(await screen.findByRole("button", { name: "导出 UTF-8 CSV" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:statistics");
    expect(fetcher.mock.calls.some(([url]) =>
      String(url).startsWith("/admin/statistics/export?"),
    )).toBe(true);
  });
});
