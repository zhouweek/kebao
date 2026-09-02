import { Button, Input, Picker, Text, View } from "@tarojs/components";
import Taro, { useLoad, usePullDownRefresh } from "@tarojs/taro";
import { useCallback, useState } from "react";
import { getErrorMessage } from "../../api/client";
import {
  cancelSession,
  listSessions,
  rescheduleSession,
} from "../../api/scheduling";
import type { CourseSession } from "../../api/types";
import { getIdentity } from "../../store/session";
import { formatSessionTime, getSessionStatusLabel } from "../../utils/session";

function datePart(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timePart(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function toIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

export default function SessionPage() {
  const [sessionId, setSessionId] = useState("");
  const [session, setSession] = useState<CourseSession>();
  const [date, setDate] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [classroomName, setClassroomName] = useState("");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const identity = getIdentity();
  const canManage =
    identity?.role === "teacher" && session?.teacherId === identity.id;

  const load = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const item = (await listSessions()).find((entry) => entry.id === id);
      if (!item) throw new Error("课次不存在");
      setSession(item);
      setDate(datePart(item.startsAt));
      setStartsAt(timePart(item.startsAt));
      setEndsAt(timePart(item.endsAt));
      setClassroomName(item.classroomName || "");
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      Taro.stopPullDownRefresh();
    }
  }, []);

  useLoad<{ sessionId?: string }>((params) => {
    const id = params.sessionId || "";
    setSessionId(id);
    void load(id);
  });
  usePullDownRefresh(() => void load(sessionId));

  const saveSchedule = async () => {
    if (!session || pending) return;
    const start = toIso(date, startsAt);
    const end = toIso(date, endsAt);
    if (new Date(end) <= new Date(start)) {
      await Taro.showToast({ title: "结束时间须晚于开始时间", icon: "none" });
      return;
    }
    setPending(true);
    try {
      const updated = await rescheduleSession(session.id, {
        startsAt: start,
        endsAt: end,
        classroomId: session.classroomId,
        classroomName: classroomName.trim() || null,
      });
      setSession({ ...session, ...updated });
      setEditing(false);
      await Taro.showToast({ title: "调课成功，已通知相关人员", icon: "success" });
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      setPending(false);
    }
  };

  const stopSession = async () => {
    if (!session || pending) return;
    const result = await Taro.showModal({
      title: "确认停课",
      content: "停课后不可恢复，系统会通知已预约家长，确定继续吗？",
      confirmText: "确认停课",
      confirmColor: "#b42318",
    });
    if (!result.confirm) return;
    setPending(true);
    try {
      const updated = await cancelSession(session.id);
      setSession({ ...session, ...updated });
      setEditing(false);
      await Taro.showToast({ title: "已停课并发送通知", icon: "success" });
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      setPending(false);
    }
  };

  if (!session) return <View className="loading">正在加载课次详情…</View>;

  const operable = canManage && !["CANCELLED", "FINISHED"].includes(session.status);
  return (
    <View className="page">
      <View className="hero">
        <Text className="hero-title">{session.courseName}</Text>
        <Text className="hero-subtitle">课次详情 · {getSessionStatusLabel(session.status)}</Text>
      </View>
      <View className="card">
        <Text className="title">上课信息</Text>
        <Text className="muted">{formatSessionTime(session.startsAt, session.endsAt)}</Text>
        <Text className="muted">
          {session.campusName} · {session.classroomName || "教室待定"}
        </Text>
        <Text className="muted">授课老师：{session.teacherName}</Text>
        <Text className="muted">
          已预约 {session.bookedCount}/{session.capacity} 人
        </Text>
      </View>

      {editing && operable ? (
        <View className="card">
          <Text className="title">调整上课安排</Text>
          <Text className="field-label">上课日期</Text>
          <Picker mode="date" value={date} onChange={(event) => setDate(event.detail.value)}>
            <View className="field-value">{date}</View>
          </Picker>
          <Text className="field-label">开始时间</Text>
          <Picker
            mode="time"
            value={startsAt}
            onChange={(event) => setStartsAt(event.detail.value)}
          >
            <View className="field-value">{startsAt}</View>
          </Picker>
          <Text className="field-label">结束时间</Text>
          <Picker
            mode="time"
            value={endsAt}
            onChange={(event) => setEndsAt(event.detail.value)}
          >
            <View className="field-value">{endsAt}</View>
          </Picker>
          <Text className="field-label">教室</Text>
          <Input
            className="field-value"
            value={classroomName}
            placeholder="教室待定"
            onInput={(event) => setClassroomName(event.detail.value)}
          />
          <Button className="primary" loading={pending} onClick={() => void saveSchedule()}>
            保存调课
          </Button>
          <Button className="secondary" disabled={pending} onClick={() => setEditing(false)}>
            取消
          </Button>
        </View>
      ) : null}

      {operable && !editing ? (
        <View className="card">
          <Text className="title">老师操作</Text>
          <Button className="primary" onClick={() => setEditing(true)}>
            调整时间与教室
          </Button>
          <Button
            className="secondary"
            onClick={() =>
              Taro.navigateTo({
                url: `/pages/roster/index?sessionId=${encodeURIComponent(session.id)}`,
              })
            }
          >
            签到与名单
          </Button>
          <Button className="danger-button" loading={pending} onClick={() => void stopSession()}>
            停课
          </Button>
        </View>
      ) : null}
      {!canManage ? <View className="card muted">当前身份仅可查看本课次信息。</View> : null}
    </View>
  );
}
