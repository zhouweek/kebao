import { Button, Picker, Text, View } from "@tarojs/components";
import Taro, { useDidShow, usePullDownRefresh } from "@tarojs/taro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getErrorMessage } from "../../api/client";
import { listSessions } from "../../api/scheduling";
import type { CourseSession, SessionStatus } from "../../api/types";
import { getIdentity } from "../../store/session";
import { formatSessionTime, getSessionStatusLabel } from "../../utils/session";

export default function TeacherPage() {
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"day" | "week">("day");
  const [anchor, setAnchor] = useState(() => new Date());
  const [status, setStatus] = useState<SessionStatus | "ALL">("ALL");
  const mounted = useRef(false);
  const identity = getIdentity();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(anchor);
      from.setHours(0, 0, 0, 0);
      if (view === "week") {
        const weekday = from.getDay() || 7;
        from.setDate(from.getDate() - weekday + 1);
      }
      const to = new Date(from);
      to.setDate(to.getDate() + (view === "week" ? 7 : 1));
      setSessions(
        await listSessions({
          from: from.toISOString(),
          to: to.toISOString(),
          ...(status === "ALL" ? {} : { status }),
        }),
      );
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      setLoading(false);
      Taro.stopPullDownRefresh();
    }
  }, [anchor, status, view]);

  useDidShow(() => {
    if (mounted.current) void load();
  });
  useEffect(() => {
    mounted.current = true;
    void load();
  }, [load]);
  usePullDownRefresh(() => {
    void load();
  });

  const openSession = (sessionId: string) => {
    void Taro.navigateTo({
      url: `/pages/session/index?sessionId=${encodeURIComponent(sessionId)}`,
    });
  };

  const statusOptions: Array<{ value: SessionStatus | "ALL"; label: string }> = [
    { value: "ALL", label: "全部状态" },
    { value: "PUBLISHED", label: "已发布" },
    { value: "DRAFT", label: "草稿" },
    { value: "CLOSED", label: "已停招" },
    { value: "CANCELLED", label: "已取消" },
    { value: "FINISHED", label: "已结束" },
  ];
  const statusIndex = Math.max(
    0,
    statusOptions.findIndex((item) => item.value === status),
  );
  const dateLabel = useMemo(() => {
    const format = (date: Date) =>
      `${date.getMonth() + 1}月${date.getDate()}日`;
    if (view === "day") return format(anchor);
    const start = new Date(anchor);
    start.setHours(0, 0, 0, 0);
    const weekday = start.getDay() || 7;
    start.setDate(start.getDate() - weekday + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${format(start)} - ${format(end)}`;
  }, [anchor, view]);
  const move = (direction: -1 | 1) => {
    const next = new Date(anchor);
    next.setDate(next.getDate() + direction * (view === "week" ? 7 : 1));
    setAnchor(next);
  };
  const setCalendarView = (nextView: "day" | "week") => {
    setView(nextView);
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
        <Button
          className="hero-create"
          onClick={() => Taro.navigateTo({ url: "/pages/teacher-create/index" })}
        >
          创建课次
        </Button>
      </View>

      <View className="tabs">
        <View className={`tab ${view === "day" ? "active" : ""}`} onClick={() => setCalendarView("day")}>
          日课表
        </View>
        <View className={`tab ${view === "week" ? "active" : ""}`} onClick={() => setCalendarView("week")}>
          周课表
        </View>
      </View>
      <View className="schedule-toolbar">
        <Text className="date-arrow" onClick={() => move(-1)}>‹</Text>
        <View className="date-center">
          <Text className="date-title">{dateLabel}</Text>
          <Text className="today-link" onClick={() => setAnchor(new Date())}>回到今天</Text>
        </View>
        <Text className="date-arrow" onClick={() => move(1)}>›</Text>
      </View>
      <Picker
        mode="selector"
        range={statusOptions.map((item) => item.label)}
        value={statusIndex}
        onChange={(event) => setStatus(statusOptions[Number(event.detail.value)]!.value)}
      >
        <View className="status-filter">{statusOptions[statusIndex]!.label}⌄</View>
      </Picker>

      {loading ? <View className="loading">正在加载课表…</View> : null}
      {!loading && sessions.length === 0 ? (
        <View className="empty empty-card">
          <Text className="empty-title">当前日期范围暂无课次</Text>
          <Text className="muted">可切换日期、状态，或创建一个新课次</Text>
          <Button
            className="primary"
            onClick={() => Taro.navigateTo({ url: "/pages/teacher-create/index" })}
          >
            创建课次
          </Button>
        </View>
      ) : null}
      {!loading
        ? sessions.map((session) => (
            <View className="card" key={session.id}>
              {view === "week" ? (
                <Text className="session-date">
                  {new Date(session.startsAt).toLocaleDateString("zh-CN", {
                    weekday: "short",
                    month: "numeric",
                    day: "numeric",
                  })}
                </Text>
              ) : null}
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
