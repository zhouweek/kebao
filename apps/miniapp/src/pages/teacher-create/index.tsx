import { Button, Input, Picker, Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useMemo, useState } from "react";
import { getErrorMessage } from "../../api/client";
import { createSeries, createSession, getTeacherOptions, previewSeries } from "../../api/scheduling";
import type { TeacherOptions } from "../../api/types";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function initialDate() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toIso(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

export default function TeacherCreatePage() {
  const [options, setOptions] = useState<TeacherOptions>();
  const [courseIndex, setCourseIndex] = useState(0);
  const [campusIndex, setCampusIndex] = useState(0);
  const [classroomIndex, setClassroomIndex] = useState(0);
  const [date, setDate] = useState(initialDate);
  const [startsAt, setStartsAt] = useState("09:00");
  const [endsAt, setEndsAt] = useState("10:00");
  const [capacity, setCapacity] = useState("12");
  const [status, setStatus] = useState<"PUBLISHED" | "DRAFT">("PUBLISHED");
  const [repeatMode, setRepeatMode] = useState<"ONCE" | "WEEKLY">("ONCE");
  const [repeatCount, setRepeatCount] = useState("4");
  const [skipConflicts, setSkipConflicts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useLoad(() => {
    void getTeacherOptions()
      .then(setOptions)
      .catch(async (error) => {
        await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
      })
      .finally(() => setLoading(false));
  });

  const classrooms = useMemo(() => {
    const campus = options?.campuses[campusIndex];
    return options?.classrooms.filter((item) => item.campusId === campus?.id) ?? [];
  }, [campusIndex, options]);
  const classroomLabels = ["不指定教室", ...classrooms.map((item) => item.name)];
  const ready = Boolean(options?.courses.length && options.campuses.length);

  const submit = async () => {
    const course = options?.courses[courseIndex];
    const campus = options?.campuses[campusIndex];
    const teacher = options?.teacher;
    const classroom = classroomIndex > 0 ? classrooms[classroomIndex - 1] : undefined;
    const parsedCapacity = Number(capacity);
    if (!course || !campus || !teacher) {
      await Taro.showToast({ title: "请先选择课程和校区", icon: "none" });
      return;
    }
    if (!Number.isInteger(parsedCapacity) || parsedCapacity <= 0) {
      await Taro.showToast({ title: "课次容量必须为正整数", icon: "none" });
      return;
    }
    const parsedRepeatCount = Number(repeatCount);
    if (
      repeatMode === "WEEKLY" &&
      (!Number.isInteger(parsedRepeatCount) ||
        parsedRepeatCount < 1 ||
        parsedRepeatCount > 104)
    ) {
      await Taro.showToast({ title: "重复次数必须为 1 到 104", icon: "none" });
      return;
    }
    const start = toIso(date, startsAt);
    const end = toIso(date, endsAt);
    if (new Date(end) <= new Date(start)) {
      await Taro.showToast({ title: "结束时间必须晚于开始时间", icon: "none" });
      return;
    }
    setSubmitting(true);
    try {
      const input = {
        courseId: course.id,
        courseName: course.name,
        campusId: campus.id,
        campusName: campus.name,
        classroomId: classroom?.id ?? null,
        classroomName: classroom?.name ?? null,
        teacherId: teacher.id,
        teacherName: teacher.name,
        startsAt: start,
        endsAt: end,
        capacity: parsedCapacity,
        status,
      };
      if (repeatMode === "WEEKLY") {
        const seriesInput = {
          ...input,
          recurrence: "WEEKLY" as const,
          intervalWeeks: 1,
          repeatCount: parsedRepeatCount,
          skipConflicts,
        };
        const preview = await previewSeries(seriesInput);
        if (preview.conflicts.length && !skipConflicts) {
          await Taro.showModal({
            title: "排课冲突",
            content: `冲突日期：${preview.conflicts.map((item) => item.date).join("、")}。默认未创建任何课次。`,
            showCancel: false,
          });
          return;
        }
        const result = await createSeries(seriesInput);
        await Taro.showToast({
          title: `成功 ${result.successDates.length} 节${result.conflicts.length ? `，跳过 ${result.conflicts.length} 节` : ""}`,
          icon: "success",
        });
      } else {
        await createSession(input);
        await Taro.showToast({ title: "课次创建成功", icon: "success" });
      }
      setTimeout(() => void Taro.navigateBack(), 500);
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <View className="loading">正在加载基础资料…</View>;

  return (
    <View className="page">
      <View className="hero">
        <Text className="hero-title">创建课次</Text>
        <Text className="hero-subtitle">
          {options?.teacher.name ?? "当前老师"} · 仅展示已启用基础资料
        </Text>
      </View>
      {!ready ? (
        <View className="empty">
          <Text>暂无可用课程或校区，请联系管理员启用基础资料</Text>
        </View>
      ) : (
        <View className="card form-card">
          <Text className="field-label">课程</Text>
          <Picker
            mode="selector"
            range={options!.courses.map((item) => item.name)}
            value={courseIndex}
            onChange={(event) => setCourseIndex(Number(event.detail.value))}
          >
            <View className="field-value">{options!.courses[courseIndex]?.name}</View>
          </Picker>

          <Text className="field-label">校区</Text>
          <Picker
            mode="selector"
            range={options!.campuses.map((item) => item.name)}
            value={campusIndex}
            onChange={(event) => {
              setCampusIndex(Number(event.detail.value));
              setClassroomIndex(0);
            }}
          >
            <View className="field-value">{options!.campuses[campusIndex]?.name}</View>
          </Picker>

          <Text className="field-label">教室</Text>
          <Picker
            mode="selector"
            range={classroomLabels}
            value={classroomIndex}
            onChange={(event) => setClassroomIndex(Number(event.detail.value))}
          >
            <View className="field-value">{classroomLabels[classroomIndex]}</View>
          </Picker>

          <Text className="field-label">上课日期</Text>
          <Picker mode="date" value={date} onChange={(event) => setDate(event.detail.value)}>
            <View className="field-value">{date}</View>
          </Picker>
          <View className="form-row">
            <View className="form-column">
              <Text className="field-label">开始时间</Text>
              <Picker
                mode="time"
                value={startsAt}
                onChange={(event) => setStartsAt(event.detail.value)}
              >
                <View className="field-value">{startsAt}</View>
              </Picker>
            </View>
            <View className="form-column">
              <Text className="field-label">结束时间</Text>
              <Picker
                mode="time"
                value={endsAt}
                onChange={(event) => setEndsAt(event.detail.value)}
              >
                <View className="field-value">{endsAt}</View>
              </Picker>
            </View>
          </View>

          <Text className="field-label">课次容量</Text>
          <Input
            className="field-value"
            type="number"
            value={capacity}
            onInput={(event) => setCapacity(event.detail.value)}
          />

          <Text className="field-label">发布状态</Text>
          <Picker
            mode="selector"
            range={["立即发布", "保存草稿"]}
            value={status === "PUBLISHED" ? 0 : 1}
            onChange={(event) =>
              setStatus(Number(event.detail.value) === 0 ? "PUBLISHED" : "DRAFT")
            }
          >
            <View className="field-value">
              {status === "PUBLISHED" ? "立即发布" : "保存草稿"}
            </View>
          </Picker>

          <Text className="field-label">排课方式</Text>
          <Picker
            mode="selector"
            range={["仅本次", "按周重复"]}
            value={repeatMode === "ONCE" ? 0 : 1}
            onChange={(event) => setRepeatMode(Number(event.detail.value) === 0 ? "ONCE" : "WEEKLY")}
          >
            <View className="field-value">{repeatMode === "ONCE" ? "仅本次" : "按周重复"}</View>
          </Picker>
          {repeatMode === "WEEKLY" && (
            <>
              <Text className="field-label">重复次数</Text>
              <Input
                className="field-value"
                type="number"
                value={repeatCount}
                onInput={(event) => setRepeatCount(event.detail.value)}
              />
              <Text className="field-label">冲突策略</Text>
              <Picker
                mode="selector"
                range={["整批失败（默认）", "跳过冲突日期"]}
                value={skipConflicts ? 1 : 0}
                onChange={(event) => setSkipConflicts(Number(event.detail.value) === 1)}
              >
                <View className="field-value">{skipConflicts ? "跳过冲突日期" : "整批失败（默认）"}</View>
              </Picker>
            </>
          )}

          <Button className="primary" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "提交中…" : "创建课次"}
          </Button>
        </View>
      )}
    </View>
  );
}
