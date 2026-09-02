import { Button, Text, View } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { getIdentity, saveIdentity, type Identity } from "../../store/session";

const IDENTITIES: Identity[] = [
  { role: "parent", id: "student-1", name: "林小满家长" },
  { role: "teacher", id: "teacher-1", name: "王老师" },
];

export default function IdentityPage() {
  const [current, setCurrent] = useState<Identity | undefined>();

  useDidShow(() => setCurrent(getIdentity()));

  const choose = (identity: Identity) => {
    saveIdentity(identity);
    setCurrent(identity);
    Taro.navigateTo({
      url: identity.role === "parent" ? "/pages/parent/index" : "/pages/teacher/index",
    });
  };

  return (
    <View className="page">
      <View className="hero">
        <Text className="hero-title">你好，欢迎使用课宝</Text>
        <Text className="hero-subtitle">请选择本次使用的身份</Text>
      </View>

      <View className="card">
        <View className="row">
          <Text className="title">我是家长</Text>
          <Text className="tag">课程预约</Text>
        </View>
        <Text className="muted">为孩子查看可约课程，完成预约或取消预约。</Text>
        <Button className="primary" onClick={() => choose(IDENTITIES[0]!)}>
          进入家长端
        </Button>
      </View>

      <View className="card">
        <View className="row">
          <Text className="title">我是老师</Text>
          <Text className="tag">教学工作台</Text>
        </View>
        <Text className="muted">查看个人课表，并进入课次查看学员名单。</Text>
        <Button className="primary" onClick={() => choose(IDENTITIES[1]!)}>
          进入老师端
        </Button>
      </View>

      {current ? (
        <Text className="muted">上次使用：{current.name}</Text>
      ) : null}
    </View>
  );
}
