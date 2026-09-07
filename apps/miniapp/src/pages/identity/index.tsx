import { Button, Input, Text, View } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import { useState } from "react";
import {
  loginWithWechat,
  loginWithWechatDemo,
  type LoginUser,
} from "../../api/auth";
import { getErrorMessage } from "../../api/client";
import { getIdentity, saveIdentity, type Identity } from "../../store/session";

const IDENTITIES: Identity[] = [
  { role: "parent", id: "student-1", name: "林小满家长" },
  { role: "teacher", id: "teacher-1", name: "王老师" },
];

function phoneAuthorizationError(detail: {
  errMsg?: string;
  errno?: number;
}): string {
  if (detail.errno === 1400001) {
    return "手机号验证额度不足，请在微信公众平台购买资源包后重试";
  }
  if (
    detail.errMsg?.toLowerCase().includes("deny") ||
    detail.errMsg?.toLowerCase().includes("cancel")
  ) {
    return "你已取消手机号授权，请重新点击并同意授权";
  }
  const errorCode = detail.errno === undefined ? "" : `，错误码 ${detail.errno}`;
  return `微信未返回手机号授权码${errorCode}。请确认小程序为已认证的非个人主体，且手机号验证额度可用`;
}

export default function IdentityPage() {
  const [current, setCurrent] = useState<Identity | undefined>();
  const [organizationCode, setOrganizationCode] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const developmentIdentityEnabled =
    process.env.TARO_APP_DEV_IDENTITY_ENABLED === "true";
  const demoPhoneLoginEnabled =
    process.env.TARO_APP_WECHAT_DEMO_PHONE_LOGIN_ENABLED === "true";

  useDidShow(() => setCurrent(getIdentity()));

  const choose = (identity: Identity) => {
    saveIdentity(identity);
    setCurrent(identity);
    Taro.navigateTo({
      url: identity.role === "parent" ? "/pages/parent/index" : "/pages/teacher/index",
    });
  };

  const completeLogin = async (loginAction: () => Promise<LoginUser>) => {
    setSubmitting(true);
    setError("");
    try {
      const user = await loginAction();
      const identity: Identity = {
        id: user.id,
        name: user.name,
        role: user.role === "TEACHER" ? "teacher" : "parent",
      };
      setCurrent(identity);
      await Taro.navigateTo({
        url: identity.role === "parent" ? "/pages/parent/index" : "/pages/teacher/index",
      });
    } catch (loginError) {
      setError(getErrorMessage(loginError));
    } finally {
      setSubmitting(false);
    }
  };

  const login = (phoneCode: string) =>
    completeLogin(() => loginWithWechat(organizationCode.trim(), phoneCode));

  const loginDemo = () => {
    if (!/^1\d{10}$/.test(phone.trim())) {
      setError("请输入后台预留的 11 位手机号");
      return;
    }
    void completeLogin(() =>
      loginWithWechatDemo(organizationCode.trim(), phone.trim()),
    );
  };

  return (
    <View className="page">
      <View className="hero">
        <Text className="hero-title">你好，欢迎使用课宝</Text>
        <Text className="hero-subtitle">
          {demoPhoneLoginEnabled
            ? "输入后台预留手机号并绑定当前微信"
            : "使用微信授权手机号安全登录"}
        </Text>
      </View>

      <View className="card">
        <View className="form-field">
          <Text className="title">机构编码</Text>
          <Input
            maxlength={64}
            placeholder="请输入所在机构编码"
            value={organizationCode}
            onInput={(event) => setOrganizationCode(event.detail.value)}
          />
        </View>
        {demoPhoneLoginEnabled ? (
          <View className="form-field">
            <Text className="title">手机号</Text>
            <Input
              maxlength={11}
              type="number"
              placeholder="请输入后台预留手机号"
              value={phone}
              onInput={(event) => setPhone(event.detail.value)}
            />
          </View>
        ) : null}
        {error ? <Text className="muted">{error}</Text> : null}
        {demoPhoneLoginEnabled ? (
          <Button
            className="primary"
            disabled={
              submitting ||
              organizationCode.trim().length === 0 ||
              phone.trim().length === 0
            }
            onClick={loginDemo}
          >
            {submitting ? "绑定登录中…" : "绑定微信并登录"}
          </Button>
        ) : (
          <Button
            className="primary"
            disabled={submitting || organizationCode.trim().length === 0}
            openType="getPhoneNumber"
            onGetPhoneNumber={(event) => {
              const detail = event.detail as {
                code?: string;
                errMsg?: string;
                errno?: number;
              };
              const phoneCode = detail.code;
              if (!phoneCode) {
                console.error("微信手机号授权失败", {
                  errMsg: detail.errMsg,
                  errno: detail.errno,
                });
                setError(phoneAuthorizationError(detail));
                return;
              }
              void login(phoneCode);
            }}
          >
            {submitting ? "登录中…" : "微信登录"}
          </Button>
        )}
        {demoPhoneLoginEnabled ? (
          <Text className="muted">
            仅用于个人主体演示。手机号必须已由管理员在后台创建。
          </Text>
        ) : null}
      </View>

      {developmentIdentityEnabled ? (
        <View className="card">
          <Text className="title">开发身份模式</Text>
          <Text className="muted">仅在显式启用 TARO_APP_DEV_IDENTITY_ENABLED 时显示。</Text>
          <Button className="primary" onClick={() => choose(IDENTITIES[0]!)}>
            进入家长端
          </Button>
          <Button className="primary" onClick={() => choose(IDENTITIES[1]!)}>
            进入老师端
          </Button>
        </View>
      ) : null}

      {current ? (
        <Text className="muted">上次使用：{current.name}</Text>
      ) : null}
    </View>
  );
}
