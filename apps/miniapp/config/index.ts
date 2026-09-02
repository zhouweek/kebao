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
  mini: {
    postcss: {
      pxtransform: { enable: true },
      url: { enable: true, config: { limit: 1024 } },
      cssModules: { enable: false },
    },
  },
});
