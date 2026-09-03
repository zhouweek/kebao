(function () {
  var rootStyle = getComputedStyle(document.documentElement);
  var accent = rootStyle.getPropertyValue("--accent").trim();
  var accent2 = rootStyle.getPropertyValue("--accent2").trim();
  var ink = rootStyle.getPropertyValue("--ink").trim();
  var muted = rootStyle.getPropertyValue("--muted").trim();
  var rule = rootStyle.getPropertyValue("--rule").trim();

  var element = document.getElementById("effort-chart");
  if (!element || typeof echarts === "undefined") return;

  var chart = echarts.init(element, null, { renderer: "svg" });
  var names = [
    "M0 需求与契约",
    "A 认证与权限",
    "B 基础资料",
    "C 排课领域",
    "D 家长预约",
    "E 老师端",
    "F 管理后台",
    "G 通知与审计",
    "H 统计与导出",
    "I 生产运行",
    "J 测试与发布"
  ];
  var values = [6, 16, 23, 18, 17, 12, 16, 15, 11, 14, 13];

  chart.setOption({
    animation: false,
    color: [accent],
    tooltip: {
      trigger: "axis",
      appendToBody: true,
      axisPointer: { type: "shadow" },
      formatter: function (items) {
        return items[0].name + "<br/>" + items[0].value + " AI 有效小时";
      }
    },
    grid: { left: 116, right: 52, top: 12, bottom: 30 },
    xAxis: {
      type: "value",
      name: "AI 小时",
      nameTextStyle: { color: muted },
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: rule } },
      splitLine: { lineStyle: { color: rule } }
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: names,
      axisLabel: { color: ink, width: 108, overflow: "truncate" },
      axisLine: { lineStyle: { color: rule } },
      axisTick: { show: false }
    },
    series: [{
      type: "bar",
      data: values,
      barWidth: 18,
      itemStyle: {
        borderRadius: [0, 7, 7, 0],
        color: function (params) {
          return params.dataIndex === 8 ? accent2 : accent;
        }
      },
      label: { show: true, position: "right", color: ink, formatter: "{c}" }
    }]
  });

  window.addEventListener("resize", function () {
    chart.resize();
  });
})();
