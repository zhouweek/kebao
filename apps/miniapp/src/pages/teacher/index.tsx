import { Button, Text, View } from "@tarojs/components";
import Taro, { useDidShow, usePullDownRefresh } from "@tarojs/taro";
import { useCallback, useState } from "react";
import { getErrorMessage } from "../../api/client";
import { listSessions } from "../../api/scheduling";
import type { CourseSession } from "../../api/types";
import { getIdentity } from "../../store/session";
import { formatSessionTime, getSessionStatusLabel } from "../../utils/session";

export default function TeacherPage() {
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [loading, setLoading] = useState(true);
  const identity = getIdentity();
  const teacherId = identity?.role === "teacher" ? identity.id : "teacher-1";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await listSessions({ teacherId }));
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      setLoading(false);
      Taro.stopPullDownRefresh();
    }
  }, [teacherId]);

  useDidShow(() => {
    void load();
  });
  usePullDownRefresh(() => {
    void load();
  });

  const openSession = (sessionId: string) => {
    void Taro.navigateTo({
      url: `/pages/session/index?sessionId=${encodeURIComponent(sessionId)}`,
    });
  };

  return (
    <View className="page">
      <View className="hero">
        <View className="row">
          <View>
            <Text className="hero-title">我的课表</Text>
            <Text className="hero-subtitle">
              {identity?.role === "teacher" ? identity.name : "王老师"} · 共{" "}
              {sessions.length} 节课
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

      {loading ? <View className="loading">正在加载课表…</View> : null}
      {!loading && sessions.length === 0 ? (
        <View className="empty">暂无课次，下拉可刷新</View>
      ) : null}
      {!loading
        ? sessions.map((session) => (
            <View className="card" key={session.id}>
              <View className="row">
                <Text className="title">{session.courseName}</Text>
                <Text className="tag">{getSessionStatusLabel(session.status)}</Text>
              </View>
              <Text className="muted">
                {formatSessionTime(session.startsAt, session.endsAt)}
              </Text>
              <Text className="muted">
                {session.campusName} · {session.classroomName || "教室待定"}
              </Text>
              <Text className="muted">
                已预约 {session.bookedCount}/{session.capacity} 人
              </Text>
              <Button
                className="secondary"
                onClick={() => openSession(session.id)}
              >
                课次详情与操作
              </Button>
            </View>
          ))
        : null}
    </View>
  );
}
