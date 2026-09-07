import { Button, Picker, Text, View } from "@tarojs/components";
import Taro, { useDidShow, usePullDownRefresh } from "@tarojs/taro";
import { useCallback, useState } from "react";
import {
  bookSession,
  cancelBooking as cancelBookingRequest,
  listGuardianStudents,
  listSessions,
} from "../../api/scheduling";
import type { CourseSession, GuardianStudent } from "../../api/types";
import { getErrorMessage } from "../../api/client";
import {
  getSavedBookings,
  markBookingCancelled,
  saveBooking,
  type SavedBooking,
} from "../../store/session";
import {
  canCancelBooking,
  formatSessionTime,
  getBookingAvailability,
} from "../../utils/session";

type Tab = "available" | "mine";

export default function ParentPage() {
  const [tab, setTab] = useState<Tab>("available");
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [students, setStudents] = useState<GuardianStudent[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [bookings, setBookings] = useState<SavedBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string>();
  const selectedStudent = students.find(
    (student) => student.id === selectedStudentId,
  );
  const selectedStudentBookings = bookings.filter(
    (item) => item.booking.studentId === selectedStudentId,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSessions, nextStudents] = await Promise.all([
        listSessions({ status: "PUBLISHED" }),
        listGuardianStudents(),
      ]);
      setSessions(nextSessions);
      setStudents(nextStudents);
      setSelectedStudentId((current) =>
        nextStudents.some((student) => student.id === current)
          ? current
          : (nextStudents[0]?.id ?? ""),
      );
      setBookings(getSavedBookings());
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      setLoading(false);
      Taro.stopPullDownRefresh();
    }
  }, []);

  useDidShow(() => {
    void load();
  });
  usePullDownRefresh(() => {
    void load();
  });

  const handleBook = async (session: CourseSession) => {
    if (pendingId) return;
    if (!selectedStudentId) {
      await Taro.showToast({
        title: "请联系机构绑定学生",
        icon: "none",
      });
      return;
    }
    setPendingId(session.id);
    try {
      const result = await bookSession(session.id, selectedStudentId);
      saveBooking({
        booking: result.booking,
        courseName: session.courseName,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        cancelDeadlineAt: session.cancelDeadlineAt,
        campusName: session.campusName,
        classroomName: session.classroomName,
      });
      await Taro.showToast({
        title: result.alreadyBooked ? "已预约过该课程" : "预约成功",
        icon: "success",
      });
      await load();
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      setPendingId(undefined);
    }
  };

  const handleCancel = async (item: SavedBooking) => {
    const confirmed = await Taro.showModal({
      title: "取消预约",
      content: "取消后名额会立即释放，确定继续吗？",
      confirmText: "确认取消",
      confirmColor: "#b42318",
    });
    if (!confirmed.confirm) return;
    setPendingId(item.booking.id);
    try {
      await cancelBookingRequest(item.booking.id);
      markBookingCancelled(item.booking.id);
      setBookings(getSavedBookings());
      await Taro.showToast({ title: "预约已取消", icon: "success" });
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      setPendingId(undefined);
    }
  };

  return (
    <View className="page">
      <View className="hero">
        <View className="row">
          <View>
            <Text className="hero-title">课程预约</Text>
            <Text className="hero-subtitle">
              当前学生：{selectedStudent?.name ?? "尚未绑定"}
            </Text>
          </View>
          <Text
            className="hero-link"
            onClick={() => Taro.navigateTo({ url: "/pages/notifications/index" })}
          >
            通知
          </Text>
        </View>
      </View>
      {!loading && students.length === 0 ? (
        <View className="card">
          <Text className="title">尚未绑定学生</Text>
          <Text className="muted">
            请联系机构管理员，在学生管理中绑定当前家长后再预约。
          </Text>
        </View>
      ) : null}
      {students.length > 1 ? (
        <Picker
          mode="selector"
          range={students.map((student) => student.name)}
          value={Math.max(
            0,
            students.findIndex((student) => student.id === selectedStudentId),
          )}
          onChange={(event) => {
            const next = students[Number(event.detail.value)];
            if (next) setSelectedStudentId(next.id);
          }}
        >
          <View className="status-filter">
            切换学生：{selectedStudent?.name ?? "请选择"}
          </View>
        </Picker>
      ) : null}
      <View className="tabs">
        <View
          className={`tab ${tab === "available" ? "active" : ""}`}
          onClick={() => setTab("available")}
        >
          可预约
        </View>
        <View
          className={`tab ${tab === "mine" ? "active" : ""}`}
          onClick={() => setTab("mine")}
        >
          我的课程
        </View>
      </View>

      {loading ? <View className="loading">正在加载课程…</View> : null}

      {!loading && tab === "available" && sessions.length === 0 ? (
        <View className="empty">暂无可预约课程，下拉可刷新</View>
      ) : null}
      {!loading && tab === "available"
        ? sessions.map((session) => {
            const availability = getBookingAvailability(session);
            return (
              <View className="card" key={session.id}>
                <View className="row">
                  <Text className="title">{session.courseName}</Text>
                  <Text className={`tag ${availability.enabled ? "" : "danger"}`}>
                    {availability.label}
                  </Text>
                </View>
                <Text className="muted">
                  {formatSessionTime(session.startsAt, session.endsAt)}
                </Text>
                <Text className="muted">
                  {session.campusName} · {session.classroomName || "教室待定"} ·{" "}
                  {session.teacherName}
                </Text>
                <Button
                  className="primary"
                  disabled={
                    !availability.enabled ||
                    !selectedStudentId ||
                    pendingId === session.id
                  }
                  loading={pendingId === session.id}
                  onClick={() => void handleBook(session)}
                >
                  {availability.enabled ? "立即预约" : availability.label}
                </Button>
                <Button
                  className="secondary"
                  onClick={() =>
                    Taro.navigateTo({
                      url: `/pages/session/index?sessionId=${encodeURIComponent(
                        session.id,
                      )}`,
                    })
                  }
                >
                  查看课次详情
                </Button>
              </View>
            );
          })
        : null}

      {!loading && tab === "mine" && selectedStudentBookings.length === 0 ? (
        <View className="empty">还没有通过本设备预约的课程</View>
      ) : null}
      {!loading && tab === "mine"
        ? selectedStudentBookings.map((item) => {
            const active = item.booking.status === "CONFIRMED";
            const cancellable =
              active && canCancelBooking(item.cancelDeadlineAt);
            return (
              <View className="card" key={item.booking.id}>
                <View className="row">
                  <Text className="title">{item.courseName}</Text>
                  <Text className={`tag ${active ? "" : "danger"}`}>
                    {active ? "已预约" : "已取消"}
                  </Text>
                </View>
                <Text className="muted">
                  {formatSessionTime(item.startsAt, item.endsAt)}
                </Text>
                <Text className="muted">
                  {item.campusName} · {item.classroomName || "教室待定"}
                </Text>
                {cancellable ? (
                  <Button
                    className="danger-button"
                    loading={pendingId === item.booking.id}
                    disabled={Boolean(pendingId)}
                    onClick={() => void handleCancel(item)}
                  >
                    取消预约
                  </Button>
                ) : active ? (
                  <Button className="secondary" disabled>
                    已过自助取消时间，请联系机构
                  </Button>
                ) : null}
              </View>
            );
          })
        : null}
    </View>
  );
}
