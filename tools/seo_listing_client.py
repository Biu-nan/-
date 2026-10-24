#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一跨而境工作台 · 本地程序调用客户端（仅 SEO 与商品文案 / seo_content_only）

零第三方依赖（仅标准库）。Python 3.9+
所有行为均与 dist/src/server.js 的实际路由与前置条件对齐。

用法:
  # 单品：出 SEO 词库 + 商品文案（不归档）
  python tools/seo_listing_client.py \
      --name "硅胶隐形乳贴" --category "女士内衣配件" \
      --notes "材质医用硅胶；直径8cm；肤色；2对装；可水洗重复使用20次" \
      --images "F:/img/a.jpg,F:/img/b.jpg"

  # 无图纯文本（本模式允许）
  python tools/seo_listing_client.py --name "硅胶隐形乳贴" --category "女士内衣配件" --notes "..." --no-archive

  # 跑完自动归档到 已完成产品/
  python tools/seo_listing_client.py --name "..." --notes "..." --archive

  # 只查状态
  python tools/seo_listing_client.py --status
"""

import argparse
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE = os.environ.get("YKB_BASE", "http://127.0.0.1:3000")
DEPLOY_DIR = Path(os.environ.get("YKB_DIR", r"F:\yikuaborder-deploy"))
PRODUCT_IMAGES_DIR = DEPLOY_DIR / "当前产品" / "产品图"
OUTPUT_DIR = DEPLOY_DIR / "当前产品" / "output"

VALID_EXT = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_BYTES = 15 * 1024 * 1024

TERMINAL_BAD_STAGES = {"PAUSED", "READY_FOR_LOGIN"}


class ApiError(RuntimeError):
    def __init__(self, status, message):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.message = message


class WorkbenchClient:
    def __init__(self, base=BASE, deploy_dir=DEPLOY_DIR):
        self.base = base.rstrip("/")
        self.deploy_dir = Path(deploy_dir)
        self.images_dir = self.deploy_dir / "当前产品" / "产品图"
        self.output_dir = self.deploy_dir / "当前产品" / "output"

    # ---------- 底层 ----------
    def _req(self, method, path, payload=None, timeout=60):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(
            f"{self.base}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore")
            try:
                msg = json.loads(body).get("error", body)
            except Exception:
                msg = body
            raise ApiError(e.code, msg) from None

    # ---------- 读状态 ----------
    def status(self):
        return self._req("GET", "/api/status")

    def state(self):
        return self.status().get("state", {})

    # ---------- 环境自检 ----------
    def check_cdp(self, port=9223, timeout=2.0):
        """ChatGPT 网页桥接依赖本地 Chrome 的 CDP 端口，没开则整条链跑不动"""
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{port}/json/version")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                info = json.loads(r.read().decode("utf-8"))
            return {"ok": True, "browser": info.get("Browser")}
        except Exception as e:
            return {"ok": False, "reason": str(e)}

    def check_env(self):
        """一条命令看清：服务 / Chrome / 工作区 是否就绪"""
        st = self.state()
        cdp = self.check_cdp()
        images = []
        if self.images_dir.exists():
            images = [p.name for p in self.images_dir.iterdir()
                      if p.is_file() and p.suffix.lower() in VALID_EXT]
        blockers = []
        if not cdp["ok"]:
            blockers.append("Chrome CDP :9223 未开，生成跑不了")
        if st.get("chatUrl") or st.get("completedPhase"):
            blockers.append("工作区残留上一任务，需归档/遗弃（--force-clean）")
        if st.get("running") or st.get("autoRun"):
            blockers.append("引擎正在运行其它任务")
        return {
            "server": True,
            "chrome_cdp": cdp,
            "workflowMode": st.get("workflowMode"),
            "goal": st.get("standardWorkflowGoal"),
            "stage": st.get("stage"),
            "product_images": images,
            "blockers": blockers,
        }

    def wait_until(self, predicate, label, timeout=1800, interval=5.0):
        """轮询 /api/status 直到 predicate(state) 为真。返回末次 state。"""
        deadline = time.time() + timeout
        last_stage = None
        while time.time() < deadline:
            st = self.state()
            stage = st.get("stage")
            if stage != last_stage:
                print(f"  [{label}] stage={stage} {st.get('message') or ''}".rstrip())
                last_stage = stage
            if predicate(st):
                return st
            if stage in TERMINAL_BAD_STAGES:
                raise RuntimeError(f"流程停在 {stage}：{st.get('message') or st.get('error') or '需人工处理'}")
            if st.get("error"):
                raise RuntimeError(f"引擎报错：{st['error']}")
            time.sleep(interval)
        raise TimeoutError(f"{label} 超时（{timeout}s），末次 stage={last_stage}")

    def wait_idle(self, timeout=600):
        return self.wait_until(lambda s: not s.get("running") and not s.get("autoRun"),
                               "等待空闲", timeout=timeout)

    # ---------- 写状态 ----------
    def set_workflow_mode(self, mode="standard_listing"):
        return self._req("PUT", "/api/workflow-mode", {"mode": mode}).get("state", {})

    def set_goal(self, goal="seo_content_only"):
        return self._req("PUT", "/api/standard-workflow-goal", {"goal": goal}).get("state", {})

    def set_objective(self, product_name, category=None, notes=None):
        """objectiveInfo 格式与批量模式一致：产品名 / 类目 / 补充信息"""
        parts = [f"产品名：{product_name}"]
        if category:
            parts.append(f"类目：{category}")
        if notes:
            parts.append(f"补充信息：{notes}")
        return self._req("PUT", "/api/state/objective-info",
                         {"objectiveInfo": "\n".join(parts)}).get("state", {})

    def add_local_images(self, image_paths, clear=False):
        """直接复制进 当前产品/产品图/（引擎 scanProductImages 自动扫描，无需 multipart）"""
        self.images_dir.mkdir(parents=True, exist_ok=True)
        if clear:
            for p in self.images_dir.iterdir():
                if p.is_file() and p.suffix.lower() in VALID_EXT:
                    p.unlink()
        copied, skipped = [], []
        for raw in image_paths:
            src = Path(raw)
            if not src.is_file():
                skipped.append(f"{raw}（文件不存在）")
                continue
            if src.suffix.lower() not in VALID_EXT:
                skipped.append(f"{src.name}（扩展名不支持，仅 jpg/jpeg/png/webp）")
                continue
            if src.stat().st_size > MAX_IMAGE_BYTES:
                skipped.append(f"{src.name}（超过 15MB）")
                continue
            dst = self.images_dir / src.name
            if dst.exists() and dst.stat().st_size == src.stat().st_size:
                dst = self.images_dir / f"{src.stem}_{int(time.time())}{src.suffix}"
            shutil.copy2(src, dst)
            copied.append(str(dst))
        return copied, skipped

    def import_image_urls(self, urls):
        return self._req("POST", "/api/import-image-urls", {"urls": list(urls)})

    # ---------- 跑流程 ----------
    def run_all(self):
        """一键流程：MVP1 事实 → 市场调研 → SEO 词库 → Listing 文案（seo_content_only 自动跳过生图）"""
        return self._req("POST", "/api/run/all", {})

    def resume(self):
        return self._req("POST", "/api/run/resume", {})

    def abandon(self):
        """把当前产品移入 已遗弃产品/ 并清空工作区（后果性操作，需显式调用）"""
        return self._req("POST", "/api/product/abandon", {})

    def ensure_clean_workspace(self, auto_clean=False):
        """
        本地调用的头号阻塞点：引擎是单实例，只要残留 chatUrl / completedPhase /
        非 standard_listing 模式，切模式与设目标都会被拒（409）。
        默认只检测不处理；auto_clean=True 时才归档或遗弃。
        """
        st = self.state()
        if st.get("running") or st.get("autoRun"):
            raise RuntimeError("引擎正在运行其它任务，请等待结束再调用")
        # 真正的阻塞只有两项：残留会话 URL 与未归档进度。
        # workflowMode 不符不阻塞，set_workflow_mode 可直接切换（已实测）。
        dirty = bool(st.get("chatUrl")) or bool(st.get("completedPhase"))
        if not dirty:
            return st
        desc = (f"workflowMode={st.get('workflowMode')} stage={st.get('stage')} "
                f"completedPhase={st.get('completedPhase')} chatUrl={st.get('chatUrl')}")
        if not auto_clean:
            raise RuntimeError(
                "工作区被上一任务占用，无法切换模式：" + desc +
                "。处理办法：① 在 UI 上归档/遗弃当前任务；② 或加 --force-clean "
                "（可归档则归档，否则遗弃到 已遗弃产品/）"
            )
        if st.get("completedPhase") == "MVP5":
            print(f"  工作区占用，先归档：{desc}")
            self.next_product()
        else:
            print(f"  工作区占用且不可归档，执行遗弃：{desc}")
            self.abandon()
        return self.wait_idle()

    # ---------- 取产物 ----------
    def read_outputs(self):
        files = {}
        for name in ("03_SEO_KEYWORDS.md", "04_LISTING_CONTENT.md"):
            p = self.output_dir / name
            files[name] = p.read_text(encoding="utf-8") if p.exists() else None
        return files


def generate_seo_listing(client, product_name, category=None, notes=None,
                         images=None, image_urls=None, timeout=1800,
                         archive=True, clear_images=True, force_clean=False):
    """一站式：清洗工作区 → 设定目标 → 导入素材 → 跑到 MVP5 → 取产物 →（可选）归档"""
    print("[0/5] 检查并清洗引擎工作区")
    client.ensure_clean_workspace(auto_clean=force_clean)

    print("[1/5] 设置标准 Listing 模式 + 仅 SEO 与商品文案")
    client.set_workflow_mode("standard_listing")
    client.set_goal("seo_content_only")

    print("[2/5] 写入产品名 / 类目 / 补充信息")
    client.set_objective(product_name, category, notes)

    print("[3/5] 导入产品图")
    if images:
        copied, skipped = client.add_local_images(images, clear=clear_images)
        print(f"  已复制 {len(copied)} 张" + (f"；跳过 {skipped}" if skipped else ""))
    if image_urls:
        client.import_image_urls(image_urls)
    if not images and not image_urls:
        print("  无图模式：事实底稿完全依赖 产品名/类目/补充信息")

    print("[4/5] 启动一键流程（事实 → 调研 → SEO → 文案）")
    client.run_all()
    client.wait_until(
        lambda s: s.get("completedPhase") == "MVP5" and s.get("stage") == "COMPLETED",
        "生成中", timeout=timeout,
    )

    print("[5/5] 读取产物")
    outputs = client.read_outputs()

    archive_dir = None
    if archive:
        res = client.next_product()
        archive_dir = res.get("archiveDirectory")
        print(f"  已归档 → {archive_dir}")

    return {"outputs": outputs, "archiveDirectory": archive_dir}


def main():
    ap = argparse.ArgumentParser(description="一跨而境 · 仅 SEO 与商品文案 本地调用客户端")
    ap.add_argument("--name", help="产品名（必填，除非 --status）")
    ap.add_argument("--category", help="商品类目")
    ap.add_argument("--notes", help="补充信息（无图时强烈建议填写）")
    ap.add_argument("--images", help="本地图片路径，逗号分隔（可选）")
    ap.add_argument("--image-urls", help="图片 URL，逗号分隔（可选）")
    ap.add_argument("--no-archive", action="store_true", help="跑完不归档，保留在 当前产品/")
    ap.add_argument("--force-clean", action="store_true",
                    help="工作区被上一任务占用时自动归档或遗弃（后果性操作）")
    ap.add_argument("--timeout", type=int, default=1800, help="生成超时秒数，默认 1800")
    ap.add_argument("--out-dir", help="把 03/04 另存到该目录")
    ap.add_argument("--status", action="store_true", help="只打印引擎状态")
    ap.add_argument("--check", action="store_true", help="环境自检：服务/Chrome/工作区")
    ap.add_argument("--base", default=BASE, help="工作台地址")
    args = ap.parse_args()

    client = WorkbenchClient(base=args.base)

    if args.status:
        st = client.state()
        print(json.dumps({k: st.get(k) for k in
                          ("workflowMode", "standardWorkflowGoal", "running", "stage",
                           "completedPhase", "message", "error", "chatUrl")},
                         ensure_ascii=False, indent=2))
        return

    if args.check:
        print(json.dumps(client.check_env(), ensure_ascii=False, indent=2))
        return

    if not args.name:
        ap.error("缺少 --name")

    images = [s.strip() for s in args.images.split(",") if s.strip()] if args.images else None
    urls = [s.strip() for s in args.image_urls.split(",") if s.strip()] if args.image_urls else None

    try:
        result = generate_seo_listing(
            client, args.name, args.category, args.notes,
            images=images, image_urls=urls,
            timeout=args.timeout, archive=not args.no_archive,
            force_clean=args.force_clean,
        )
    except (ApiError, RuntimeError, TimeoutError) as e:
        print(f"失败：{e}", file=sys.stderr)
        sys.exit(1)

    for fname, text in result["outputs"].items():
        if text is None:
            print(f"警告：未找到 {fname}", file=sys.stderr)
            continue
        print(f"\n===== {fname}（{len(text)} 字符）=====")
        print(text[:600] + ("\n…（已截断）" if len(text) > 600 else ""))
        if args.out_dir:
            outdir = Path(args.out_dir)
            outdir.mkdir(parents=True, exist_ok=True)
            (outdir / fname).write_text(text, encoding="utf-8")
    if args.out_dir:
        print(f"\n已另存到 {args.out_dir}")
    if result["archiveDirectory"]:
        print(f"归档目录：{result['archiveDirectory']}")


if __name__ == "__main__":
    main()
