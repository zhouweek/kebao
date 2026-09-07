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

function persistLogin(response: LoginResponse): LoginUser {
  saveAuth(response);
  saveIdentity({
    id: response.user.id,
    name: response.user.name,
    role: response.user.role === "TEACHER" ? "teacher" : "parent",
  });
  return response.user;
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
  return persistLogin(response.data);
}

export async function loginWithWechatDemo(
  organizationCode: string,
  phone: string,
): Promise<LoginUser> {
  const { code: loginCode } = await Taro.login();
  const response = await request<DataResponse<LoginResponse>>(
    "/auth/wechat/demo-login",
    {
      method: "POST",
      data: { organizationCode, loginCode, phone },
    },
  );
  return persistLogin(response.data);
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
