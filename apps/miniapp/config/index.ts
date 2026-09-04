import { defineConfig } from "@tarojs/cli";

export default defineConfig({
  projectName: "kebao-miniapp",
  date: "2026-09-01",
  designWidth: 750,
  deviceRatio: {
    375: 2,
    750: 1,
  },
  sourceRoot: "src",
  outputRoot: "dist",
  framework: "react",
  compiler: "webpack5",
  cache: { enable: false },
  env: {
    TARO_APP_API_BASE_URL: JSON.stringify(
      process.env.TARO_APP_API_BASE_URL ?? "http://localhost:3000",
    ),
    TARO_APP_DEV_IDENTITY_ENABLED: JSON.stringify(
      process.env.TARO_APP_DEV_IDENTITY_ENABLED ?? "false",
    ),
  },
  mini: {
    postcss: {
      pxtransform: { enable: true },
      url: { enable: true, config: { limit: 1024 } },
      cssModules: { enable: false },
    },
  },
});
