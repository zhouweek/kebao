import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api";
import {
  calculateEntitlementMetrics,
  CoursePackagePrototype,
  createPurchaseIdempotencyKeyStore,
  yuanToCents,
} from "../src/CoursePackagePrototype";

const api = vi.hoisted(() => ({
  createCoursePackage: vi.fn(),
  createCoursePackagePurchase: vi.fn(),
  extendStudentEntitlement: vi.fn(),
  getCoursePackages: vi.fn(),
  getEntitlementLedger: vi.fn(),
  getEntitlementValidityChanges: vi.fn(),
  getMasterData: vi.fn(),
  getStudentEntitlements: vi.fn(),
  setCoursePackageStatus: vi.fn(),
  updateCoursePackage: vi.fn(),
}));

vi.mock("../src/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/api")>()),
  ...api,
}));

const coursePackage = {
  id: "package-1",
  version: 0,
  courseId: "course-1",
  courseName: "少儿编程 L2",
  name: "少儿编程 · 64 课时包",
  description: null,
  creditCount: 64,
  validityMonths: 24,
  priceCents: 998000,
  absentDeductsCredit: false,
  lateCancellationDeductsCredit: false,
  status: "ACTIVE" as const,
  soldCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const entitlement = {
  id: "entitlement-1",
  purchaseId: "purchase-1",
  packageId: "package-1",
  packageName: "少儿编程 · 64 课时包",
  courseId: "course-1",
  courseName: "少儿编程 L2",
  studentId: "student-1",
  studentName: "林小满",
  totalCredits: 64,
  remainingCredits: 46,
  reservedCredits: 2,
  version: 4,
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2028-01-01T00:00:00.000Z",
  status: "ACTIVE" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function page<T>(items: T[]) {
  return { items, page: 1, pageSize: 100, total: items.length };
}

function setSuccessfulLoads() {
  api.getCoursePackages.mockResolvedValue(page([coursePackage]));
  api.getStudentEntitlements.mockResolvedValue(page([entitlement]));
  api.getMasterData.mockImplementation(async (resource: string) => page(resource === "courses"
    ? [{
        id: "course-1",
        name: "少儿编程 L2",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }]
    : [{
        id: "student-1",
        name: "林小满",
        isActive: true,
        phone: null,
        guardians: [{
          id: "guardian-1",
          name: "林女士",
          phone: "13800001024",
          relationship: "母亲",
          isPrimary: true,
        }],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }]));
  api.getEntitlementLedger.mockResolvedValue(page([{
    id: "ledger-1",
    entitlementId: "entitlement-1",
    purchaseId: null,
    reservationId: null,
    bookingId: null,
    idempotencyKey: "consume-1",
    type: "CONSUME",
    creditDelta: -1,
    balanceAfter: 46,
    reservedCreditDelta: -1,
    reservedBalanceAfter: 2,
    reversalOfId: null,
    actorId: "admin-1",
    note: "第 18 课",
    occurredAt: "2026-09-09T08:32:00.000Z",
    createdAt: "2026-09-09T08:32:00.000Z",
  }]));
  api.getEntitlementValidityChanges.mockResolvedValue(page([{
    id: "change-1",
    entitlementId: "entitlement-1",
    previousValidUntil: "2027-12-01T00:00:00.000Z",
    newValidUntil: "2028-01-01T00:00:00.000Z",
    reason: "停课补偿",
    changedBy: "admin-1",
    createdAt: "2026-09-09T08:32:00.000Z",
  }]));
}

describe("课包管理真实 API 页面", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSuccessfulLoads();
    api.createCoursePackage.mockResolvedValue(coursePackage);
    api.createCoursePackagePurchase.mockResolvedValue({
      purchase: {
        id: "purchase-2",
        packageId: "package-1",
        studentId: "student-1",
        paidAmountCents: 998000,
        purchasedAt: "2026-09-11T00:00:00.000Z",
      },
      entitlement,
      alreadyPurchased: false,
    });
    api.extendStudentEntitlement.mockResolvedValue(entitlement);
    api.setCoursePackageStatus.mockResolvedValue({ ...coursePackage, status: "INACTIVE" });
    api.updateCoursePackage.mockResolvedValue(coursePackage);
  });

  it("概览按 studentId 去重并按自然日边界统计", () => {
    expect(calculateEntitlementMetrics([
      { id: "1", version: 0, studentId: "student-1", student: "学生", guardian: "", packageId: "1", packageName: "A", totalLessons: 10, usedLessons: 2, reservedLessons: 1, expiresAt: "2026-09-10", status: "正常" },
      { id: "2", version: 0, studentId: "student-1", student: "学生", guardian: "", packageId: "2", packageName: "B", totalLessons: 5, usedLessons: 5, reservedLessons: 0, expiresAt: "2026-10-10", status: "已用完" },
      { id: "3", version: 0, studentId: "student-2", student: "学生二", guardian: "", packageId: "3", packageName: "C", totalLessons: 3, usedLessons: 0, reservedLessons: 0, expiresAt: "2026-10-11", status: "正常" },
      { id: "4", version: 0, studentId: "student-3", student: "学生三", guardian: "", packageId: "4", packageName: "D", totalLessons: 20, usedLessons: 0, reservedLessons: 0, expiresAt: "2026-09-20", status: "已取消" },
    ], "2026-09-10")).toEqual({
      activeStudents: 2,
      remainingLessons: 10,
      expiring: 1,
    });
  });

  it("指标日期固定使用 Asia/Shanghai 自然日", () => {
    vi.stubEnv("TZ", "UTC");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T16:30:00.000Z"));
    try {
      expect(calculateEntitlementMetrics([
        { id: "1", version: 0, studentId: "student-1", student: "学生", guardian: "", packageId: "1", packageName: "A", totalLessons: 10, usedLessons: 0, reservedLessons: 0, expiresAt: "2026-09-11", status: "正常" },
        { id: "2", version: 0, studentId: "student-2", student: "学生二", guardian: "", packageId: "2", packageName: "B", totalLessons: 5, usedLessons: 0, reservedLessons: 0, expiresAt: "2026-10-11", status: "正常" },
      ])).toEqual({ activeStudents: 2, remainingLessons: 15, expiring: 2 });
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it("首屏只加载核心数据，切换对应 tab 后才懒加载流水和变更记录", async () => {
    render(<CoursePackagePrototype />);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载课包数据");
    expect(await screen.findByText("少儿编程 · 64 课时包")).toBeInTheDocument();
    expect(api.getCoursePackages).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(api.getStudentEntitlements).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(api.getMasterData).not.toHaveBeenCalled();
    expect(api.getEntitlementLedger).not.toHaveBeenCalled();
    expect(api.getEntitlementValidityChanges).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "学生权益" }));
    expect(screen.getByText("学生 ID · student-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "课时流水" }));
    expect(await screen.findByText("第 18 课")).toBeInTheDocument();
    expect(api.getEntitlementLedger).toHaveBeenCalledWith(
      "entitlement-1",
      { page: 1, pageSize: 20 },
    );
    expect(api.getEntitlementValidityChanges).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "有效期变更" }));
    expect(await screen.findByText("停课补偿")).toBeInTheDocument();
    expect(screen.getByText("+1 个月")).toBeInTheDocument();
    expect(api.getEntitlementValidityChanges).toHaveBeenCalledWith(
      "entitlement-1",
      { page: 1, pageSize: 20 },
    );
  });

  it("流水只请求选定权益，切换权益时不批量获取当前页历史", async () => {
    const manyEntitlements = Array.from({ length: 6 }, (_, index) => ({
      ...entitlement, id: `entitlement-${index + 1}`, purchaseId: `purchase-${index + 1}`, studentId: `student-${index + 1}`,
    }));
    api.getStudentEntitlements.mockResolvedValue(page(manyEntitlements));
    api.getEntitlementLedger.mockResolvedValue(page([]));

    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");
    fireEvent.click(screen.getByRole("tab", { name: "课时流水" }));
    await waitFor(() => expect(api.getEntitlementLedger).toHaveBeenCalledTimes(1));
    expect(api.getEntitlementLedger).toHaveBeenLastCalledWith(
      "entitlement-1",
      { page: 1, pageSize: 20 },
    );
    fireEvent.change(screen.getByLabelText("选择权益"), {
      target: { value: "entitlement-2" },
    });
    await waitFor(() => expect(api.getEntitlementLedger).toHaveBeenCalledTimes(2));
    expect(api.getEntitlementLedger).toHaveBeenLastCalledWith(
      "entitlement-2",
      { page: 1, pageSize: 20 },
    );
    expect(await screen.findByText("没有匹配的课时流水")).toBeInTheDocument();
  });

  it("附属 tab 加载失败独立展示错误且不清空核心数据", async () => {
    api.getEntitlementValidityChanges.mockRejectedValueOnce(new Error("延期服务不可用"));
    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");
    fireEvent.click(screen.getByRole("tab", { name: "有效期变更" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("延期服务不可用");
    expect(screen.getByText("在售课包（当前页）").nextElementSibling).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("tab", { name: "课包列表" }));
    expect(screen.getByText("少儿编程 · 64 课时包")).toBeInTheDocument();
    expect(api.getEntitlementLedger).not.toHaveBeenCalled();
  });

  it("切换权益后的流水请求失败时不展示上一权益的旧流水", async () => {
    api.getStudentEntitlements.mockResolvedValue(page([
      entitlement,
      {
        ...entitlement,
        id: "entitlement-2",
        purchaseId: "purchase-2",
        studentId: "student-2",
        studentName: "第二位学生",
      },
    ]));
    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");
    fireEvent.click(screen.getByRole("tab", { name: "课时流水" }));
    expect(await screen.findByText("第 18 课")).toBeInTheDocument();

    api.getEntitlementLedger.mockRejectedValueOnce(new Error("新权益流水加载失败"));
    fireEvent.change(screen.getByLabelText("选择权益"), {
      target: { value: "entitlement-2" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("新权益流水加载失败");
    expect(screen.queryByText("第 18 课")).not.toBeInTheDocument();
  });

  it("明细关键词请求失败时不展示上一关键词的旧延期记录", async () => {
    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");
    fireEvent.click(screen.getByRole("tab", { name: "有效期变更" }));
    expect(await screen.findByText("停课补偿")).toBeInTheDocument();

    api.getEntitlementValidityChanges.mockRejectedValueOnce(new Error("关键词查询失败"));
    fireEvent.change(screen.getByPlaceholderText("搜索延期原因"), {
      target: { value: "运营调整" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("关键词查询失败");
    expect(screen.queryByText("停课补偿")).not.toBeInTheDocument();
  });

  it("展示空态，并在加载失败后允许重试", async () => {
    api.getCoursePackages.mockRejectedValueOnce(new Error("网络不可用"));
    const view = render(<CoursePackagePrototype />);

    expect(await screen.findByRole("alert")).toHaveTextContent("网络不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("少儿编程 · 64 课时包")).toBeInTheDocument();

    api.getCoursePackages.mockResolvedValue(page([]));
    api.getStudentEntitlements.mockResolvedValue(page([]));
    api.getEntitlementLedger.mockResolvedValue(page([]));
    api.getEntitlementValidityChanges.mockResolvedValue(page([]));
    view.unmount();
    render(<CoursePackagePrototype />);
    expect(await screen.findByText("没有匹配的课包")).toBeInTheDocument();
  });

  it("新增课包调用创建接口并重新加载持久化数据", async () => {
    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");

    fireEvent.click(screen.getByRole("button", { name: /新增课包/ }));
    const dialog = screen.getByRole("dialog", { name: "新增课包" });
    fireEvent.change(within(dialog).getByLabelText("课包名称"), {
      target: { value: "舞蹈基础 · 20 课时包" },
    });
    fireEvent.change(within(dialog).getByLabelText("课时数"), { target: { value: "20" } });
    fireEvent.change(within(dialog).getByLabelText("有效期（月）"), {
      target: { value: "6" },
    });
    fireEvent.change(within(dialog).getByLabelText("售价（元）"), {
      target: { value: "1999" },
    });
    fireEvent.change(within(dialog).getByLabelText("初始状态"), {
      target: { value: "在售" },
    });
    expect(within(dialog).getByLabelText("缺席扣课")).not.toBeChecked();
    expect(within(dialog).getByLabelText("晚取消扣课")).not.toBeChecked();
    fireEvent.click(within(dialog).getByLabelText("缺席扣课"));
    const submit = within(dialog).getByRole("button", { name: "确认新增" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(api.createCoursePackage).toHaveBeenCalledWith({
      courseId: "course-1",
      name: "舞蹈基础 · 20 课时包",
      creditCount: 20,
      validityMonths: 6,
      priceCents: 199900,
      absentDeductsCredit: true,
      lateCancellationDeductsCredit: false,
      status: "ACTIVE",
    }));
    await waitFor(() => expect(api.getCoursePackages).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent("已新增");
  });

  it("列表展示扣课规则，编辑时回显并显式提交两个开关", async () => {
    api.getCoursePackages.mockResolvedValue(page([{
      ...coursePackage,
      absentDeductsCredit: true,
      lateCancellationDeductsCredit: false,
    }]));
    render(<CoursePackagePrototype />);

    expect(await screen.findByText("缺席扣课")).toBeInTheDocument();
    expect(screen.getByText("晚取消不扣课")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑少儿编程 · 64 课时包" }));

    const dialog = screen.getByRole("dialog", { name: "编辑课包" });
    expect(within(dialog).getByLabelText("缺席扣课")).toBeChecked();
    expect(within(dialog).getByLabelText("晚取消扣课")).not.toBeChecked();
    fireEvent.click(within(dialog).getByLabelText("缺席扣课"));
    fireEvent.click(within(dialog).getByLabelText("晚取消扣课"));
    fireEvent.click(within(dialog).getByRole("button", { name: "确认保存" }));

    await waitFor(() => expect(api.updateCoursePackage).toHaveBeenCalledWith(
      "package-1",
      {
        courseId: "course-1",
        name: "少儿编程 · 64 课时包",
        creditCount: 64,
        validityMonths: 24,
        priceCents: 998000,
        absentDeductsCredit: false,
        lateCancellationDeductsCredit: true,
        status: "ACTIVE",
      },
    ));
  });

  it("流水和延期使用独立明细搜索词且不传给权益列表", async () => {
    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");
    fireEvent.click(screen.getByRole("tab", { name: "课时流水" }));
    await waitFor(() => expect(api.getEntitlementLedger).toHaveBeenCalledTimes(1));
    const entitlementCallsBeforeSearch = api.getStudentEntitlements.mock.calls.length;

    fireEvent.change(screen.getByPlaceholderText("搜索流水类型或备注"), {
      target: { value: "第 18 课" },
    });
    await waitFor(() => expect(api.getEntitlementLedger).toHaveBeenLastCalledWith(
      "entitlement-1",
      { page: 1, pageSize: 20, keyword: "第 18 课" },
    ));
    expect(api.getStudentEntitlements).toHaveBeenCalledTimes(entitlementCallsBeforeSearch);

    fireEvent.click(screen.getByRole("tab", { name: "有效期变更" }));
    await waitFor(() => expect(api.getEntitlementValidityChanges).toHaveBeenLastCalledWith(
      "entitlement-1",
      { page: 1, pageSize: 20, keyword: "第 18 课" },
    ));
    fireEvent.change(screen.getByPlaceholderText("搜索延期原因"), {
      target: { value: "停课补偿" },
    });
    await waitFor(() => expect(api.getEntitlementValidityChanges).toHaveBeenLastCalledWith(
      "entitlement-1",
      { page: 1, pageSize: 20, keyword: "停课补偿" },
    ));
    expect(api.getStudentEntitlements).toHaveBeenCalledTimes(entitlementCallsBeforeSearch);
  });

  it("课程和学生选择器按页并支持服务端搜索", async () => {
    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");

    fireEvent.click(screen.getByRole("button", { name: /新增课包/ }));
    let dialog = screen.getByRole("dialog", { name: "新增课包" });
    await waitFor(() => expect(api.getMasterData).toHaveBeenCalledWith("courses", {
      page: 1,
      pageSize: 20,
      activeOnly: true,
    }));
    fireEvent.change(within(dialog).getByPlaceholderText("按课程名称搜索"), {
      target: { value: "编程" },
    });
    await waitFor(() => expect(api.getMasterData).toHaveBeenCalledWith("courses", {
      page: 1,
      pageSize: 20,
      keyword: "编程",
      activeOnly: true,
    }));
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: /录入购买/ }));
    dialog = screen.getByRole("dialog", { name: "录入购买" });
    fireEvent.change(within(dialog).getByPlaceholderText("按学生姓名搜索"), {
      target: { value: "小满" },
    });
    await waitFor(() => expect(api.getMasterData).toHaveBeenCalledWith("students", {
      page: 1,
      pageSize: 20,
      keyword: "小满",
      activeOnly: true,
    }));
  });

  it("录入购买使用幂等键且提交期间阻止重复请求", async () => {
    let resolvePurchase!: (value: unknown) => void;
    api.createCoursePackagePurchase.mockImplementation(() => new Promise((resolve) => {
      resolvePurchase = resolve;
    }));
    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");

    fireEvent.click(screen.getByRole("button", { name: /录入购买/ }));
    const dialog = screen.getByRole("dialog", { name: "录入购买" });
    const submit = within(dialog).getByRole("button", { name: "确认录入" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.createCoursePackagePurchase).toHaveBeenCalledTimes(1);
    expect(api.createCoursePackagePurchase).toHaveBeenCalledWith(expect.objectContaining({
      packageId: "package-1",
      studentId: "student-1",
      paidAmountCents: 998000,
      idempotencyKey: expect.stringMatching(/^admin-/),
    }));

    resolvePurchase({
      purchase: { id: "purchase-2" },
      entitlement,
      alreadyPurchased: false,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("已为 林小满 录入购买");
  });

  it("购买失败后在同一弹窗重试时复用幂等键", async () => {
    api.createCoursePackagePurchase
      .mockRejectedValueOnce(new Error("网络超时"))
      .mockResolvedValueOnce({
        purchase: { id: "purchase-2" },
        entitlement,
        alreadyPurchased: true,
      });
    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");

    fireEvent.click(screen.getByRole("button", { name: /录入购买/ }));
    const dialog = screen.getByRole("dialog", { name: "录入购买" });
    const submit = within(dialog).getByRole("button", { name: "确认录入" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("网络超时");
    const firstKey = api.createCoursePackagePurchase.mock.calls[0]?.[0].idempotencyKey;

    fireEvent.click(submit);
    await waitFor(() => expect(api.createCoursePackagePurchase).toHaveBeenCalledTimes(2));
    expect(api.createCoursePackagePurchase.mock.calls[1]?.[0].idempotencyKey).toBe(firstKey);
  });

  it("购买幂等键按规范化请求指纹复用，参数变化时生成新键", () => {
    let sequence = 0;
    const keys = createPurchaseIdempotencyKeyStore(() => `key-${++sequence}`);
    const original = keys.get({ studentId: " student-1 ", packageId: "package-1", paidAmountCents: 998000 });
    expect(keys.get({ studentId: "student-1", packageId: " package-1 ", paidAmountCents: 998000 })).toBe(original);
    expect(keys.get({ studentId: "student-2", packageId: "package-1", paidAmountCents: 998000 })).not.toBe(original);
    expect(keys.get({ studentId: "student-1", packageId: "package-2", paidAmountCents: 998000 })).not.toBe(original);
    expect(keys.get({ studentId: "student-1", packageId: "package-1", paidAmountCents: 998001 })).not.toBe(original);
  });

  it("课包和权益仅请求当前页，切换权益页后流水只读取新页权益", async () => {
    const secondPackage = { ...coursePackage, id: "package-2", name: "第二页课包" };
    const secondEntitlement = {
      ...entitlement,
      id: "entitlement-2",
      purchaseId: "purchase-2",
      studentId: "student-2",
      studentName: "第二页学生",
    };
    api.getCoursePackages.mockImplementation(async ({ page: currentPage = 1 }) => ({
      ...page(currentPage === 1 ? [coursePackage] : [secondPackage]),
      page: currentPage,
      total: 21,
    }));
    api.getStudentEntitlements.mockImplementation(async ({ page: currentPage = 1 }) => ({
      ...page(currentPage === 1 ? [entitlement] : [secondEntitlement]),
      page: currentPage,
      total: 21,
    }));
    api.getMasterData.mockImplementation(async (resource: string, { page: currentPage = 1 }) => ({
      ...page([{
        id: `${resource}-${currentPage}`,
        name: `${resource}-第${currentPage}页`,
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }]),
      page: currentPage,
      total: 2,
    }));
    api.getEntitlementLedger.mockImplementation(async (_id: string, { page: currentPage = 1 }) => ({
      ...page([]),
      page: currentPage,
      total: 21,
    }));
    api.getEntitlementValidityChanges.mockResolvedValue(page([]));

    render(<CoursePackagePrototype />);

    expect(await screen.findByText("少儿编程 · 64 课时包")).toBeInTheDocument();
    expect(api.getCoursePackages).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByLabelText("分页")).getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("第二页课包")).toBeInTheDocument();
    expect(api.getCoursePackages).toHaveBeenCalledWith({ page: 2, pageSize: 20 });

    fireEvent.click(screen.getByRole("tab", { name: "学生权益" }));
    fireEvent.click(within(screen.getByLabelText("分页")).getByRole("button", { name: "下一页" }));
    expect(await screen.findByText("第二页学生")).toBeInTheDocument();
    expect(api.getStudentEntitlements).toHaveBeenCalledWith({ page: 2, pageSize: 20 });
    fireEvent.click(screen.getByRole("tab", { name: "课时流水" }));
    await waitFor(() => expect(api.getEntitlementLedger).toHaveBeenCalledWith(
      "entitlement-2",
      { page: 1, pageSize: 20 },
    ));
    fireEvent.click(
      within(screen.getByLabelText("流水分页")).getByRole("button", { name: "下一页" }),
    );
    await waitFor(() => expect(api.getEntitlementLedger).toHaveBeenLastCalledWith(
      "entitlement-2",
      { page: 2, pageSize: 20 },
    ));
    expect(api.getEntitlementLedger).not.toHaveBeenCalledWith(
      "entitlement-1",
      expect.anything(),
    );
  });

  it("刷新搜索后忽略先发后到的旧课包响应", async () => {
    let resolveOld!: (value: {
      items: Array<typeof coursePackage>;
      page: number;
      pageSize: number;
      total: number;
    }) => void;
    api.getCoursePackages
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveOld = resolve;
      }))
      .mockResolvedValueOnce(page([{ ...coursePackage, id: "package-new", name: "新响应课包" }]));

    render(<CoursePackagePrototype />);
    fireEvent.change(screen.getByPlaceholderText("搜索学生、课包或状态"), {
      target: { value: "新响应" },
    });
    expect(await screen.findByText("新响应课包")).toBeInTheDocument();

    await act(async () => {
      resolveOld(page([{ ...coursePackage, name: "旧响应课包" }]));
    });
    expect(screen.queryByText("旧响应课包")).not.toBeInTheDocument();
    expect(screen.getByText("新响应课包")).toBeInTheDocument();
  });

  it("状态更新遇到 409 时刷新服务端数据且不提示成功", async () => {
    api.setCoursePackageStatus.mockRejectedValueOnce(
      new ApiError("课包已被其他操作修改，请刷新后重试", "COURSE_PACKAGE_CONFLICT", 409),
    );
    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");

    fireEvent.change(screen.getByLabelText("少儿编程 · 64 课时包状态"), {
      target: { value: "停售" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("已刷新为最新数据");
    expect(api.getCoursePackages).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/状态已更新为/)).not.toBeInTheDocument();
  });

  it("409 后刷新失败时展示加载错误而不声称刷新成功", async () => {
    api.setCoursePackageStatus.mockRejectedValueOnce(
      new ApiError("课包已被其他操作修改", "COURSE_PACKAGE_CONFLICT", 409),
    );
    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");
    api.getCoursePackages.mockRejectedValueOnce(new Error("刷新失败"));

    fireEvent.change(screen.getByLabelText("少儿编程 · 64 课时包状态"), {
      target: { value: "停售" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("刷新失败");
    expect(screen.getByRole("alert")).not.toHaveTextContent("已刷新为最新数据");
  });

  it("金额固定显示两位小数并把元精确换算为分", async () => {
    expect(yuanToCents("1.005")).toBe(101);
    expect(yuanToCents("9980.01")).toBe(998001);

    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");
    expect(screen.getByText(/¥9,980\.00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /新增课包/ }));
    const dialog = screen.getByRole("dialog", { name: "新增课包" });
    const priceInput = within(dialog).getByLabelText("售价（元）");
    expect(priceInput).toHaveAttribute("step", "0.01");
  });

  it("延期提交权益版本并在成功后重新加载记录", async () => {
    render(<CoursePackagePrototype />);
    await screen.findByText("少儿编程 · 64 课时包");
    fireEvent.click(screen.getByRole("tab", { name: "学生权益" }));
    fireEvent.click(screen.getByRole("button", { name: "延期有效期" }));

    const dialog = screen.getByRole("dialog", { name: "延期有效期" });
    fireEvent.change(within(dialog).getByLabelText("延长月数"), {
      target: { value: "2" },
    });
    fireEvent.change(within(dialog).getByLabelText("延期原因"), {
      target: { value: "运营调整" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认延期" }));

    await waitFor(() => expect(api.extendStudentEntitlement).toHaveBeenCalledWith(
      "entitlement-1",
      { months: 2, reason: "运营调整", version: 4 },
    ));
    await waitFor(() => expect(api.getStudentEntitlements).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent("延长 2 个月");
  });
});
