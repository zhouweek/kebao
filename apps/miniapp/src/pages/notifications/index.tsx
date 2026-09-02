import { Text, View } from "@tarojs/components";
import Taro, { useDidShow, usePullDownRefresh } from "@tarojs/taro";
import { useCallback, useState } from "react";
import { getErrorMessage } from "../../api/client";
import {
  listNotifications,
  markNotificationRead,
} from "../../api/notifications";
import type { Notification } from "../../api/types";

function formatNoticeTime(value: string): string {
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState("");

  const load = useCallback(async (onlyUnread: boolean) => {
    setLoading(true);
    try {
      setNotifications(await listNotifications(onlyUnread));
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      setLoading(false);
      Taro.stopPullDownRefresh();
    }
  }, []);

  useDidShow(() => void load(unreadOnly));
  usePullDownRefresh(() => void load(unreadOnly));

  const changeFilter = (onlyUnread: boolean) => {
    setUnreadOnly(onlyUnread);
    void load(onlyUnread);
  };

  const read = async (notification: Notification) => {
    if (notification.readAt || pendingId) return;
    setPendingId(notification.id);
    try {
      const updated = await markNotificationRead(notification.id);
      setNotifications((current) =>
        unreadOnly
          ? current.filter((item) => item.id !== notification.id)
          : current.map((item) => (item.id === notification.id ? updated : item)),
      );
    } catch (error) {
      await Taro.showToast({ title: getErrorMessage(error), icon: "none" });
    } finally {
      setPendingId("");
    }
  };

  const unreadCount = notifications.filter((item) => !item.readAt).length;
  return (
    <View className="page">
      <View className="hero">
        <Text className="hero-title">站内通知</Text>
        <Text className="hero-subtitle">
          {unreadCount ? `${unreadCount} 条未读消息` : "暂无未读消息"}
        </Text>
      </View>
      <View className="tabs">
        <View
          className={`tab ${unreadOnly ? "" : "active"}`}
          onClick={() => changeFilter(false)}
        >
          全部
        </View>
        <View
          className={`tab ${unreadOnly ? "active" : ""}`}
          onClick={() => changeFilter(true)}
        >
          未读
        </View>
      </View>

      {loading ? <View className="loading">正在加载通知…</View> : null}
      {!loading && notifications.length === 0 ? (
        <View className="empty">{unreadOnly ? "没有未读通知" : "暂无通知"}</View>
      ) : null}
      {!loading
        ? notifications.map((notification) => (
            <View
              className={`card notice ${notification.readAt ? "read" : "unread"}`}
              key={notification.id}
              onClick={() => void read(notification)}
            >
              <View className="row">
                <Text className="title">{notification.title}</Text>
                <Text className={`tag ${notification.readAt ? "" : "unread-tag"}`}>
                  {notification.readAt ? "已读" : pendingId === notification.id ? "处理中" : "未读"}
                </Text>
              </View>
              <Text className="muted">{notification.content}</Text>
              <Text className="notice-time">{formatNoticeTime(notification.createdAt)}</Text>
            </View>
          ))
        : null}
    </View>
  );
}
