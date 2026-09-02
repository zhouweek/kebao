import Taro from "@tarojs/taro";
import { getIdentity } from "../store/session";
import type { ApiErrorBody } from "./types";

const DEFAULT_BASE_URL = "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(
  path: string,
  options: Omit<Taro.request.Option, "url"> = {},
): Promise<T> {
  const baseUrl =
    (process.env.TARO_APP_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const identity = getIdentity();
  const hasData = options.data !== undefined;
  const response = await Taro.request<T | ApiErrorBody>({
    ...options,
    url: `${baseUrl}${path}`,
    header: {
      ...(hasData ? { "content-type": "application/json" } : {}),
      "x-tenant-id": "org-development",
      "x-role": identity?.role === "teacher" ? "TEACHER" : "GUARDIAN",
      "x-user-id": identity?.id ?? "student-1",
      ...options.header,
    },
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const body = response.data as ApiErrorBody;
    throw new ApiError(
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? "请求失败，请稍后重试",
      response.statusCode,
      body.error?.details,
    );
  }

  return response.data as T;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "网络开小差了，请稍后重试";
}
