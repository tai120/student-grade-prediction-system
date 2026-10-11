# -*- coding: utf-8 -*-
"""学生成绩预测系统 - 后端服务
模型: 多元线性回归(正规方程求解 + 岭回归兜底), 基于 numpy 实现
首次启动自动生成演示数据 data/students.csv(UTF-8-SIG, 可用 Excel 直接编辑)
运行: python app.py  ->  http://127.0.0.1:5000
"""
import csv
import os
import socket
import sys
import threading
import webbrowser

import numpy as np
from flask import Flask, jsonify, request, send_from_directory

BASE = os.path.dirname(os.path.abspath(__file__))
if getattr(sys, "frozen", False):  # PyInstaller 打包后
    STATIC = os.path.join(sys._MEIPASS, "static")  # 静态资源在解包目录
    DATA_FILE = os.path.join(os.path.dirname(sys.executable), "data", "students.csv")  # 数据在 exe 旁
else:
    STATIC = os.path.join(BASE, "static")
    DATA_FILE = os.path.join(BASE, "data", "students.csv")

FEATURES = ["quiz", "homework", "attendance", "midterm", "participation"]
FEATURE_NAMES = {
    "quiz": "平时测验",
    "homework": "作业完成",
    "attendance": "出勤率",
    "midterm": "期中考试",
    "participation": "课堂表现",
}
ADVICE = {
    "quiz": "多做练习并整理错题, 小测前系统复习",
    "homework": "按时保质完成作业, 疑难问题及时请教老师",
    "attendance": "保证出勤, 避免缺课造成知识断层",
    "midterm": "针对期中暴露的薄弱章节集中突破",
    "participation": "主动参与课堂互动与上机实验, 加深理解",
}

app = Flask(__name__)


# ---------------- 数据 ----------------
def clip(v, lo=0, hi=100):
    return min(hi, max(lo, float(v)))


def generate_data():
    rng = np.random.default_rng(42)
    surnames = "赵钱孙李周吴郑王冯陈蒋沈韩杨朱秦许何吕张孔曹严华金魏陶姜"
    givens = ["伟", "芳", "娜", "敏", "静", "磊", "军", "洋", "勇", "艳", "杰", "娟",
              "涛", "明", "超", "霞", "平", "刚", "鑫", "浩", "雨桐", "子涵", "宇轩",
              "欣怡", "思远", "梦琪", "天佑", "一诺", "俊杰", "诗涵", "浩然", "子墨"]
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    rows = []
    for ci, cls in enumerate(["计科2501班", "计科2502班"]):
        for i in range(30):
            ab = rng.normal(0, 1)  # 学生潜在能力
            quiz = clip(66 + 18 * ab + rng.normal(0, 8))
            homework = clip(68 + 15 * ab + rng.normal(0, 7))
            attendance = clip((0.8 + 0.07 * ab + rng.normal(0, 0.05)) * 100, lo=40)
            participation = clip(65 + 18 * ab + rng.normal(0, 9))
            midterm = clip(0.3 * quiz + 0.3 * homework + 0.25 * participation
                           + 0.15 * attendance + rng.normal(0, 6))
            final = clip(0.25 * quiz + 0.2 * homework + 0.15 * attendance
                         + 0.15 * participation + 0.25 * midterm + rng.normal(0, 5))
            rows.append([f"2025{ci + 1:02d}{i + 1:02d}",
                         rng.choice(list(surnames)) + rng.choice(givens), cls,
                         round(quiz, 1), round(homework, 1), round(attendance, 1),
                         round(midterm, 1), round(participation, 1), round(final, 1)])
    header = ["学号", "姓名", "班级"] + [FEATURE_NAMES[f] for f in FEATURES] + ["期末成绩"]
    with open(DATA_FILE, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def load_students():
    if not os.path.exists(DATA_FILE):
        generate_data()
    students = []
    with open(DATA_FILE, encoding="utf-8-sig") as f:
        for r in list(csv.reader(f))[1:]:
            if not r:
                continue
            students.append({
                "id": r[0], "name": r[1], "cls": r[2],
                **{FEATURES[i]: float(r[3 + i]) for i in range(5)},
                "final": float(r[8]),
            })
    return students


# ---------------- 模型 ----------------
def fit(X, y):
    """标准化特征 + 正规方程, 奇异时岭回归兜底"""
    mu, sd = X.mean(0), X.std(0) + 1e-9
    A = np.column_stack([np.ones(len(X)), (X - mu) / sd])
    try:
        w = np.linalg.solve(A.T @ A, A.T @ y)
    except np.linalg.LinAlgError:
        w = np.linalg.solve(A.T @ A + 1e-3 * np.eye(A.shape[1]), A.T @ y)
    return w, mu, sd


def build_model(students):
    X = np.array([[s[f] for f in FEATURES] for s in students])
    y = np.array([s["final"] for s in students])
    idx = np.random.default_rng(7).permutation(len(X))
    tr, te = idx[: int(len(X) * 0.8)], idx[int(len(X) * 0.8):]
    w, mu, sd = fit(X[tr], y[tr])

    def pred(raw):
        x = (np.asarray(raw, float) - mu) / sd
        return float(w[0] + x @ w[1:])

    p = np.array([pred(x) for x in X])
    yte, pte = y[te], p[te]
    ss_res, ss_tot = ((yte - pte) ** 2).sum(), ((yte - yte.mean()) ** 2).sum()
    imp = np.abs(w[1:]) / np.abs(w[1:]).sum() * 100  # 标准化系数占比 = 特征重要性
    return {
        "pred": pred,
        "metrics": {
            "r2": round(float(1 - ss_res / ss_tot), 3),
            "mae": round(float(np.abs(yte - pte).mean()), 2),
            "rmse": round(float(np.sqrt(((yte - pte) ** 2).mean())), 2),
            "train_n": int(len(tr)), "test_n": int(len(te)),
        },
        "importance": [{"name": FEATURE_NAMES[f], "value": round(float(v), 1)}
                       for f, v in zip(FEATURES, imp)],
        "scatter": [{"actual": round(float(a), 1), "predicted": round(float(b), 1)}
                    for a, b in zip(yte, pte)],
    }


def level_of(s):
    if s >= 85:
        return "优秀"
    if s >= 75:
        return "良好"
    if s >= 65:
        return "中等"
    if s >= 60:
        return "及格"
    return "有挂科风险"


def risk_of(s):
    """sigmoid 风险概率: 60分 -> 50%, 每低6分风险约翻倍"""
    return float(1 / (1 + np.exp((s - 60) / 6)))


# ---------------- 接口 ----------------
@app.route("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.route("/api/overview")
def overview():
    students = load_students()
    M = build_model(students)
    preds = [M["pred"]([s[f] for f in FEATURES]) for s in students]
    for s, p in zip(students, preds):
        s["predicted"] = round(clip(p), 1)
        s["risk"] = risk_of(s["predicted"])
        s["level"] = level_of(s["predicted"])

    means = {f: float(np.mean([s[f] for s in students])) for f in FEATURES}

    bins = ["0-59", "60-69", "70-79", "80-89", "90-100"]
    counts = [0] * 5
    for s in students:
        v = s["final"]
        counts[0 if v < 60 else 1 if v < 70 else 2 if v < 80 else 3 if v < 90 else 4] += 1

    levels = ["优秀", "良好", "中等", "及格", "有挂科风险"]
    level_counts = [sum(1 for s in students if s["level"] == lv) for lv in levels]

    classes, admin_tips = [], []
    for cls in sorted({s["cls"] for s in students}):
        sub = [(s, p) for s, p in zip(students, preds) if s["cls"] == cls]
        avgs = {f: float(np.mean([s[f] for s, _ in sub])) for f in FEATURES}
        finals = [s["final"] for s, _ in sub]
        ps = [p for _, p in sub]
        avg_final = float(np.mean(finals))
        pass_rate = sum(1 for v in finals if v >= 60) / len(finals)
        classes.append({
            "name": cls, "count": len(sub),
            "avg_final": round(avg_final, 1),
            "pass_rate": round(pass_rate * 100, 1),
            "excellent_rate": round(sum(1 for v in finals if v >= 85) / len(finals) * 100, 1),
            "risk_rate": round(sum(1 for p in ps if p < 60) / len(ps) * 100, 1),
            "avg": {f: round(v, 1) for f, v in avgs.items()},
            "grade": ("优秀" if avg_final >= 80 and pass_rate >= 0.95 else
                      "良好" if avg_final >= 75 and pass_rate >= 0.9 else
                      "合格" if pass_rate >= 0.8 else "需改进"),
        })
        weak = min(FEATURES, key=lambda f: avgs[f])
        admin_tips.append(
            f"{cls}: 平均分 {avg_final:.1f}, 及格率 {pass_rate * 100:.1f}%, "
            f"最弱指标为「{FEATURE_NAMES[weak]}」(均值 {avgs[weak]:.1f}), 建议加强该环节教学。")
    top = max(M["importance"], key=lambda x: x["value"])
    admin_tips.append(
        f"全年级来看, 「{top['name']}」对期末成绩影响最大(标准化系数占比 {top['value']}%), 教学中应重点保障该环节。")
    n_risk = sum(1 for s in students if s["risk"] > 0.5)
    if n_risk:
        admin_tips.append(f"当前共 {n_risk} 人预测存在挂科风险, 建议安排帮扶计划并跟踪辅导效果。")

    return jsonify({
        "model": M["metrics"],
        "importance": M["importance"],
        "histogram": {"bins": bins, "counts": counts},
        "level_counts": [{"name": lv, "value": c} for lv, c in zip(levels, level_counts)],
        "classes": classes,
        "scatter": M["scatter"],
        "admin_tips": admin_tips,
        "means": {FEATURE_NAMES[f]: round(v, 1) for f, v in means.items()},
        "students": [{
            "id": s["id"], "name": s["name"], "cls": s["cls"],
            "features": {f: s[f] for f in FEATURES},
            "final": s["final"], "predicted": s["predicted"],
            "risk": round(s["risk"], 3), "level": s["level"],
        } for s in sorted(students, key=lambda s: s["predicted"])],
    })


@app.route("/api/predict", methods=["POST"])
def predict_api():
    data = request.get_json(force=True)
    try:
        x = [float(data.get(f, 0)) for f in FEATURES]
    except (TypeError, ValueError):
        return jsonify({"error": "请输入有效的数字"}), 400
    students = load_students()
    M = build_model(students)
    p = clip(M["pred"](x))
    means = {f: float(np.mean([s[f] for s in students])) for f in FEATURES}
    advice = []
    for f, v in zip(FEATURES, x):
        if means[f] - v > 5:
            advice.append({
                "feature": FEATURE_NAMES[f],
                "text": (f"<b>{FEATURE_NAMES[f]}</b> 当前 {v:.1f} 分(班级均值 {means[f]:.1f} 分), "
                         f"建议: {ADVICE[f]}"),
            })
    if not advice:
        advice.append({"feature": "整体", "text": "各项表现均衡, 保持当前学习状态即可稳步提升"})
    return jsonify({
        "predicted": round(p, 1), "level": level_of(p),
        "risk": risk_of(p), "advice": advice,
    })


def pick_port():
    for p in (5000, 5001, 5002):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                pass
    return 5000


if __name__ == "__main__":
    port = pick_port()
    url = f"http://127.0.0.1:{port}"
    threading.Timer(1.2, lambda: webbrowser.open(url)).start()  # 双击 exe 自动打开浏览器
    print("Server:", url)
    app.run(host="127.0.0.1", port=port, debug=False)
