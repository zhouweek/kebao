import Taro from "@tarojs/taro";
import {
  clearAuth,
  getAuth,
  saveAuth,
  saveIdentity,
  type AuthState,
} from "../store/session";
import { request } from "./client";

export interface LoginUser {
  id: string;
  organizationId: string;
  role: "TEACHER" | "GUARDIAN";
  name: string;
  phone: string | null;
}

interface LoginResponse extends AuthState {
  user: LoginUser;
}

interface DataResponse<T> {
  data: T;
}

export async function loginWithWechat(
  organizationCode: string,
  phoneCode: string,
): Promise<LoginUser> {
  const { code: loginCode } = await Taro.login();
  const response = await request<DataResponse<LoginResponse>>("/auth/wechat/login", {
    method: "POST",
    data: { organizationCode, loginCode, phoneCode },
  });
  saveAuth(response.data);
  saveIdentity({
    id: response.data.user.id,
    name: response.data.user.name,
    role: response.data.user.role === "TEACHER" ? "teacher" : "parent",
  });
  return response.data.user;
}

export async function refreshAccessToken(): Promise<AuthState> {
  const current = getAuth();
  if (!current) throw new Error("请先登录");
  const response = await request<DataResponse<AuthState>>("/auth/refresh", {
    method: "POST",
    data: { refreshToken: current.refreshToken },
  });
  saveAuth(response.data);
  return response.data;
}

export async function logout(): Promise<void> {
  try {
    await request<void>("/auth/logout", { method: "POST" });
  } finally {
    clearAuth();
  }
}
