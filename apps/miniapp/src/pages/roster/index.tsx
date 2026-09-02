import { Button, Text, View } from "@tarojs/components";
import Taro, {
  useDidShow,
  useLoad,
  usePullDownRefresh,
} from "@tarojs/taro";
import { useCallback, useState } from "react";
import { getErrorMessage } from "../../api/client";
import { getRoster, markAttendance } from "../../api/scheduling";
import type { AttendanceStatus, RosterStudent } from "../../api/types";

const ATTENDANCE_OPTIONS: Array<{ status: AttendanceStatus; label: string }> = [
  { status: "ATTENDED", label: "已到" },
  { status: "LEAVE", label: "请假" },
  { status: "ABSENT", label: "缺席" },
];

function statusLabel(status: RosterStudent["bookingStatus"]): string {
  return (
    ATTENDANCE_OPTIONS.find((option) => option.status === status)?.label || "待签到"
  );
}

export default function RosterPage() {
  const [sessionId, setSessionId] = useState("");
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState("");

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      setStudents(await getRoster(id));
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      setLoading(false);
      Taro.stopPullDownRefresh();
    }
  }, []);

  useLoad<{ sessionId?: string }>((params) => {
    const id = params.sessionId || "";
    setSessionId(id);
    void load(id);
  });
  useDidShow(() => {
    if (sessionId) void load(sessionId);
  });
  usePullDownRefresh(() => {
    void load(sessionId);
  });

  const updateAttendance = async (
    student: RosterStudent,
    status: AttendanceStatus,
  ) => {
    if (pendingId || student.bookingStatus === status) return;
    setPendingId(student.bookingId);
    try {
      await markAttendance(sessionId, [{ bookingId: student.bookingId, status }]);
      setStudents((current) =>
        current.map((item) =>
          item.bookingId === student.bookingId
            ? { ...item, bookingStatus: status }
            : item,
        ),
      );
      await Taro.showToast({ title: "签到状态已更新", icon: "success" });
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      setPendingId("");
    }
  };

  return (
    <View className="page">
      <View className="hero">
        <Text className="hero-title">学员名单</Text>
        <Text className="hero-subtitle">共 {students.length} 名有效预约学员</Text>
      </View>

      {loading ? <View className="loading">正在加载名单…</View> : null}
      {!loading && students.length === 0 ? (
        <View className="empty">本课次暂无预约学员</View>
      ) : null}
      {!loading
        ? students.map((student, index) => (
            <View className="card" key={student.bookingId}>
              <View className="row">
                <View>
                <Text className="title">{student.name}</Text>
                <Text className="muted">监护人手机：{student.guardianPhone}</Text>
                </View>
                <Text className="tag">{statusLabel(student.bookingStatus)}</Text>
              </View>
              <Text className="muted">名单序号 #{index + 1}</Text>
              <View className="attendance-actions">
                {ATTENDANCE_OPTIONS.map((option) => (
                  <Button
                    key={option.status}
                    size="mini"
                    className={
                      student.bookingStatus === option.status
                        ? "attendance-button active"
                        : "attendance-button"
                    }
                    disabled={Boolean(pendingId)}
                    loading={pendingId === student.bookingId}
                    onClick={() => void updateAttendance(student, option.status)}
                  >
                    {option.label}
                  </Button>
                ))}
              </View>
            </View>
          ))
        : null}
    </View>
  );
}
