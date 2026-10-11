/* 前端逻辑与图表(ECharts) */
const FEATURE_META = [
  { key: "quiz", name: "平时测验", def: 70, hint: "平时测验平均分(0-100)" },
  { key: "homework", name: "作业完成", def: 75, hint: "作业平均分(0-100)" },
  { key: "attendance", name: "出勤率", def: 95, hint: "出勤率百分比(0-100)" },
  { key: "midterm", name: "期中考试", def: 70, hint: "期中成绩(0-100)" },
  { key: "participation", name: "课堂表现", def: 75, hint: "课堂/实验表现(0-100)" },
];
const LV_STYLE = { "优秀": "lv-a", "良好": "lv-b", "中等": "lv-c", "及格": "lv-d", "有挂科风险": "lv-e" };
const LV_COLOR = { "优秀": "#1d4ed8", "良好": "#60a5fa", "中等": "#0d9488", "及格": "#f59e0b", "有挂科风险": "#dc2626" };
const PAGES = { home: "首页概览", predict: "成绩预测", teacher: "教学辅助", viz: "数据可视化", admin: "教学管理" };
const NAV_BY_ROLE = {
  student: ["home", "predict", "viz"],
  teacher: ["home", "predict", "teacher", "viz"],
  admin: ["home", "viz", "admin"],
};
const ROLE_NAME = { student: "学生", teacher: "教师", admin: "教务管理员" };

let ROLE = "student";
let DATA = null;
let pickedStu = null; // 教师端当前选中的学生
let charts = {};

/* ---------- 登录与导航 ---------- */
document.querySelectorAll(".role-btn").forEach(b =>
  b.addEventListener("click", () => enter(b.dataset.role)));

async function enter(role) {
  ROLE = role;
  document.getElementById("login").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("role-badge").textContent = "当前身份: " + ROLE_NAME[role];
  buildNav();
  document.getElementById("stu-pick").classList.toggle("hidden", role !== "teacher");
  if (!DATA) {
    DATA = await (await fetch("/api/overview")).json();
    renderAll();
  }
  showPage("home");
}

function buildNav() {
  document.getElementById("nav").innerHTML = NAV_BY_ROLE[ROLE].map(k =>
    `<button class="nav-btn" data-page="${k}">${PAGES[k]}</button>`).join("");
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.addEventListener("click", () => showPage(b.dataset.page)));
}

function showPage(k) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  document.getElementById("page-" + k).classList.remove("hidden");
  document.getElementById("page-title").textContent = PAGES[k];
  document.querySelectorAll(".nav-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.page === k));
  if (window.echarts) Object.values(charts).forEach(c => c.resize());
}

document.getElementById("logout").addEventListener("click", () => {
  document.getElementById("app").classList.add("hidden");
  document.getElementById("login").classList.remove("hidden");
});

/* ---------- 渲染 ---------- */
function renderAll() {
  renderKpi();
  renderRiskTable();
  document.getElementById("model-info").innerHTML =
    `模型: <b>多元线性回归</b>(标准化特征 + 正规方程求解)。输入平时测验、作业完成、出勤率、期中考试、课堂表现五项特征, 输出期末成绩预测与挂科风险概率(Logistic 函数)。` +
    `训练样本 ${DATA.model.train_n} 人, 测试集 ${DATA.model.test_n} 人, 决定系数 R² = <b>${DATA.model.r2}</b>, ` +
    `平均绝对误差 MAE = <b>${DATA.model.mae}</b> 分, 均方根误差 RMSE = <b>${DATA.model.rmse}</b> 分。` +
    `各特征影响权重见「教学辅助」页。`;
  renderTeacher();
  renderAdmin();
  renderStuSelect();
  buildForm();
  initCharts();
}

function renderKpi() {
  const S = DATA.students;
  const avgP = S.reduce((a, s) => a + s.predicted, 0) / S.length;
  const riskN = S.filter(s => s.risk > 0.5).length;
  const avgAtt = S.reduce((a, s) => a + s.features.attendance, 0) / S.length;
  const items = [
    ["学生总数", S.length, ""], ["班级数", DATA.classes.length, ""],
    ["模型 R²", DATA.model.r2, ""], ["平均预测分", avgP.toFixed(1), ""],
    ["挂科风险人数", riskN, "danger-top"], ["平均出勤率", avgAtt.toFixed(1) + "%", ""],
  ];
  document.getElementById("kpi").innerHTML = items.map(([l, v, c]) =>
    `<div class="kpi ${c}"><span class="kpi-val">${v}</span><span class="kpi-label">${l}</span></div>`).join("");
}

function weakOf(s) {
  let worst = null, gap = 0;
  for (const f of FEATURE_META) {
    const g = DATA.means[f.name] - s.features[f.key];
    if (g > gap) { gap = g; worst = f.name; }
  }
  return gap > 1 ? `${worst} -${gap.toFixed(0)}` : "综合偏弱";
}

function renderRiskTable() {
  document.getElementById("risk-tbody").innerHTML = DATA.students.slice(0, 5).map(s =>
    `<tr><td>${s.name}</td><td>${s.cls}</td><td><b>${s.predicted}</b></td>` +
    `<td class="${s.risk > 0.5 ? "txt-danger" : ""}">${(s.risk * 100).toFixed(0)}%</td>` +
    `<td class="muted">${weakOf(s)}</td></tr>`).join("");
}

function renderTeacher() {
  const S = DATA.students;
  const avgP = S.reduce((a, s) => a + s.predicted, 0) / S.length;
  const riskN = S.filter(s => s.risk > 0.5).length;
  const lowN = S.filter(s => s.predicted < 70).length;
  const items = [
    ["平均预测分", avgP.toFixed(1), ""],
    ["挂科风险人数", riskN, "danger-top"],
    ["需重点关注(<70分)", lowN, "warn-top"],
    ["学困生占比", ((lowN / S.length) * 100).toFixed(1) + "%", "warn-top"],
  ];
  document.getElementById("teacher-kpi").innerHTML = items.map(([l, v, c]) =>
    `<div class="kpi ${c}"><span class="kpi-val">${v}</span><span class="kpi-label">${l}</span></div>`).join("");
  document.getElementById("stu-tbody").innerHTML = S.map(s =>
    `<tr><td>${s.id}</td><td>${s.name}</td><td>${s.cls}</td>` +
    FEATURE_META.map(f => `<td>${s.features[f.key].toFixed(0)}</td>`).join("") +
    `<td><b>${s.predicted}</b></td>` +
    `<td><span class="badge ${LV_STYLE[s.level]}">${s.level}</span></td>` +
    `<td class="${s.risk > 0.5 ? "txt-danger" : ""}">${(s.risk * 100).toFixed(0)}%</td></tr>`).join("");
}

function renderAdmin() {
  document.getElementById("class-tbody").innerHTML = DATA.classes.map(c =>
    `<tr><td><b>${c.name}</b></td><td>${c.count}</td><td>${c.avg_final}</td>` +
    `<td>${c.pass_rate}%</td><td>${c.excellent_rate}%</td>` +
    `<td class="${c.risk_rate > 25 ? "txt-danger" : ""}">${c.risk_rate}%</td>` +
    `<td><span class="badge lv-b">${c.grade}</span></td></tr>`).join("");
  document.getElementById("admin-advice").innerHTML =
    DATA.admin_tips.map(t => `<li>${t}</li>`).join("");
}

/* ---------- 预测 ---------- */
function renderStuSelect() {
  document.getElementById("stu-select").innerHTML =
    `<option value="">— 手动输入 —</option>` +
    DATA.students.map(s => `<option value="${s.id}">${s.name}(${s.cls})</option>`).join("");
  document.getElementById("stu-select").addEventListener("change", e => {
    pickedStu = DATA.students.find(s => s.id === e.target.value) || null;
    FEATURE_META.forEach(f => {
      document.getElementById("sl-" + f.key).value =
        pickedStu ? pickedStu.features[f.key] : f.def;
      document.getElementById("sl-" + f.key).dispatchEvent(new Event("input"));
    });
  });
}

function buildForm() {
  document.getElementById("predict-form").innerHTML = FEATURE_META.map(f => `
    <div class="frow">
      <div class="frow-top"><label>${f.name}</label><span class="fval" id="pv-${f.key}">${f.def}</span></div>
      <input type="range" id="sl-${f.key}" min="0" max="100" step="1" value="${f.def}" title="${f.hint}">
    </div>`).join("");
  FEATURE_META.forEach(f => {
    document.getElementById("sl-" + f.key).addEventListener("input", () => {
      document.getElementById("pv-" + f.key).textContent =
        document.getElementById("sl-" + f.key).value;
    });
  });
  document.getElementById("predict-btn").addEventListener("click", doPredict);
}

async function doPredict() {
  const body = {};
  FEATURE_META.forEach(f => (body[f.key] = +document.getElementById("sl-" + f.key).value));
  const r = await (await fetch("/api/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })).json();
  if (r.error) { alert(r.error); return; }
  const riskP = (r.risk * 100).toFixed(1);
  const cls = r.risk > 0.5 ? "rb-danger" : r.risk > 0.2 ? "rb-warn" : "rb-ok";
  document.getElementById("predict-result").innerHTML = `
    <div class="score-box">
      <span class="score-big">${r.predicted}</span><span class="score-unit">分</span>
      <span class="badge ${LV_STYLE[r.level]}">${r.level}</span>
    </div>
    ${pickedStu ? `<p class="muted" style="margin-top:8px">该生实际期末成绩: <b>${pickedStu.final}</b> 分</p>` : ""}
    <div class="risk-title">挂科风险概率 <b class="${cls}">${riskP}%</b></div>
    <div class="riskbar"><i class="${cls}" style="width:${riskP}%"></i></div>
    <h4 class="adv-title">💡 查漏补缺建议</h4>
    <ul class="advice-list">${r.advice.map(a => `<li>${a.text}</li>`).join("")}</ul>`;
}

/* ---------- 图表 ---------- */
function initCharts() {
  if (!window.echarts || !DATA) return;
  const blue = "#2563eb", orange = "#f97316";
  const ax = {
    axisLine: { lineStyle: { color: "#cbd5e1" } },
    axisLabel: { color: "#64748b" },
    splitLine: { lineStyle: { color: "#e8eef7" } },
  };

  // 1. 期末成绩分布
  charts.hist = echarts.init(document.getElementById("chart-hist"));
  charts.hist.setOption({
    grid: { left: 40, right: 16, top: 30, bottom: 28 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: DATA.histogram.bins, ...ax },
    yAxis: { type: "value", ...ax },
    series: [{
      type: "bar", data: DATA.histogram.counts, barWidth: "50%",
      itemStyle: { color: blue, borderRadius: [4, 4, 0, 0] },
    }],
  });

  // 2. 特征重要性(标准化系数)
  const imp = DATA.importance;
  charts.imp = echarts.init(document.getElementById("chart-imp"));
  charts.imp.setOption({
    grid: { left: 90, right: 56, top: 16, bottom: 28 },
    tooltip: { trigger: "axis", formatter: p => `${p[0].name}: ${p[0].value}%` },
    xAxis: { type: "value", ...ax },
    yAxis: { type: "category", data: imp.map(d => d.name).reverse(), ...ax },
    series: [{
      type: "bar", data: imp.map(d => d.value).reverse(), barWidth: "55%",
      itemStyle: { color: blue, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: "#475569", formatter: "{c}%" },
    }],
  });

  // 3. 预测 vs 实际(测试集)
  charts.scatter = echarts.init(document.getElementById("chart-scatter"));
  charts.scatter.setOption({
    grid: { left: 44, right: 20, top: 20, bottom: 36 },
    tooltip: { trigger: "item", formatter: p => `实际 ${p.value[0]} 分 / 预测 ${p.value[1]} 分` },
    xAxis: { type: "value", name: "实际成绩", min: 30, max: 100, ...ax },
    yAxis: { type: "value", name: "预测成绩", min: 30, max: 100, ...ax },
    series: [
      { // 45度参考线: 点越贴近此线, 预测越准
        type: "line", data: [[30, 30], [100, 100]], symbol: "none", silent: true,
        lineStyle: { color: "#94a3b8", width: 2, type: "dashed" },
      },
      {
        type: "scatter", data: DATA.scatter.map(d => [d.actual, d.predicted]),
        symbolSize: 9,
        itemStyle: { color: blue, opacity: 0.75, borderColor: "#fff", borderWidth: 2 },
      },
    ],
  });

  // 4. 预测等级构成
  charts.pie = echarts.init(document.getElementById("chart-pie"));
  charts.pie.setOption({
    tooltip: { trigger: "item", formatter: "{b}: {c} 人 ({d}%)" },
    legend: { bottom: 0, icon: "circle", textStyle: { color: "#475569" } },
    series: [{
      type: "pie", radius: ["38%", "64%"], center: ["50%", "44%"],
      itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 4 },
      label: { color: "#334155", formatter: "{b}\n{d}%" },
      data: DATA.level_counts.map(d => ({ ...d, itemStyle: { color: LV_COLOR[d.name] } })),
    }],
  });

  // 5. 班级学习指标对比(雷达)
  const ind = FEATURE_META.map(f => f.name);
  charts.radar = echarts.init(document.getElementById("chart-radar"));
  charts.radar.setOption({
    tooltip: {},
    legend: { bottom: 0, textStyle: { color: "#475569" } },
    radar: {
      indicator: ind.map(n => ({ name: n, max: 100 })),
      axisName: { color: "#475569" },
      splitLine: { lineStyle: { color: "#e8eef7" } },
      splitArea: { areaStyle: { color: ["#fbfdff", "#f2f7fd"] } },
      axisLine: { lineStyle: { color: "#cbd5e1" } },
    },
    series: [{
      type: "radar",
      data: DATA.classes.map((c, i) => ({
        name: c.name,
        value: FEATURE_META.map(f => c.avg[f.key]),
        lineStyle: { width: 2 },
        itemStyle: { color: i ? orange : blue },
        areaStyle: { opacity: 0.22 },
      })),
    }],
  });

  // 6. 班级对比柱状图
  const mk = (name, key, color) => ({
    name, type: "bar", barWidth: "30%",
    data: DATA.classes.map(c => c[key]),
    itemStyle: { color, borderRadius: [4, 4, 0, 0] },
    label: { show: true, position: "top", color: "#475569", formatter: "{c}%" },
  });
  charts.classbar = echarts.init(document.getElementById("chart-classbar"));
  charts.classbar.setOption({
    grid: { left: 44, right: 20, top: 44, bottom: 28 },
    tooltip: { trigger: "axis", valueFormatter: v => v + "%" },
    legend: { top: 0, textStyle: { color: "#475569" } },
    xAxis: { type: "category", data: DATA.classes.map(c => c.name), ...ax },
    yAxis: { type: "value", max: 100, ...ax },
    series: [
      mk("及格率", "pass_rate", blue),
      mk("优秀率", "excellent_rate", "#60a5fa"),
      mk("挂科风险率", "risk_rate", "#dc2626"),
    ],
  });
}

window.addEventListener("resize", () => Object.values(charts).forEach(c => c.resize()));
/* CDN 回退加载完成后补初始化 */
window.__onChartsReady = () => { if (DATA) initCharts(); };
