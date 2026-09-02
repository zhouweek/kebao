import { request } from "./client";
import type { Notification } from "./types";

interface DataResponse<T> {
  data: T;
}

export async function listNotifications(unreadOnly = false): Promise<Notification[]> {
  const query = unreadOnly ? "?unreadOnly=true" : "";
  const response = await request<DataResponse<Notification[]>>(`/notifications${query}`);
  return response.data;
}

export async function markNotificationRead(
  notificationId: string,
): Promise<Notification> {
  const response = await request<DataResponse<Notification>>(
    `/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "PATCH" },
  );
  return response.data;
}
