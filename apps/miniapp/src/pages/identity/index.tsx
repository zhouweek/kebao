import { Button, Input, Text, View } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { loginWithWechat } from "../../api/auth";
import { getErrorMessage } from "../../api/client";
import { getIdentity, saveIdentity, type Identity } from "../../store/session";

const IDENTITIES: Identity[] = [
  { role: "parent", id: "student-1", name: "林小满家长" },
  { role: "teacher", id: "teacher-1", name: "王老师" },
];

export default function IdentityPage() {
  const [current, setCurrent] = useState<Identity | undefined>();
  const [organizationCode, setOrganizationCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const developmentIdentityEnabled =
    process.env.TARO_APP_DEV_IDENTITY_ENABLED === "true";

  useDidShow(() => setCurrent(getIdentity()));

  const choose = (identity: Identity) => {
    saveIdentity(identity);
    setCurrent(identity);
    Taro.navigateTo({
      url: identity.role === "parent" ? "/pages/parent/index" : "/pages/teacher/index",
    });
  };

  const login = async (phoneCode: string) => {
    setSubmitting(true);
    setError("");
    try {
      const user = await loginWithWechat(organizationCode.trim(), phoneCode);
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

  return (
    <View className="page">
      <View className="hero">
        <Text className="hero-title">你好，欢迎使用课宝</Text>
        <Text className="hero-subtitle">使用微信授权手机号安全登录</Text>
      </View>

      <View className="card">
        <Text className="title">机构编码</Text>
        <Input
          maxlength={64}
          placeholder="请输入所在机构编码"
          value={organizationCode}
          onInput={(event) => setOrganizationCode(event.detail.value)}
        />
        {error ? <Text className="muted">{error}</Text> : null}
        <Button
          className="primary"
          disabled={submitting || organizationCode.trim().length === 0}
          openType="getPhoneNumber"
          onGetPhoneNumber={(event) => {
            const phoneCode = event.detail.code;
            if (!phoneCode) {
              setError("需要授权微信手机号才能登录");
              return;
            }
            void login(phoneCode);
          }}
        >
          {submitting ? "登录中…" : "微信登录"}
        </Button>
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
