#!/usr/bin/env python3
"""把 GitHub 最新正式 Release 同步到本地静态目录。

只拉取最新 exe/msi/sig，生成服务器版 latest.json（安装包 URL 指向本机），
旧安装包由 rsync --delete 清掉；CHANGELOG.md 保留历史。

运行用户需要能写 DEST，不需要 sudo。
"""
from __future__ import annotations

import base64
import html
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = os.environ.get("HANDPULSE_REPO", "HuoHanDu/HandPulse")
BASE_URL = os.environ.get("HANDPULSE_BASE_URL", "https://huohandu.cn/handpulse").rstrip("/")
DEST = Path(os.environ.get("HANDPULSE_DEST", "/var/www/handpulse"))
API = f"https://api.github.com/repos/{REPO}/releases/latest"


def log(msg: str) -> None:
    print(f"[{datetime.now().isoformat(timespec='seconds')}] {msg}", flush=True)


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "HandPulse-mirror",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "HandPulse-mirror"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def current_version() -> str | None:
    try:
        return json.loads((DEST / "latest.json").read_text("utf-8")).get("version")
    except Exception:
        return None


def render_index(version: str, notes: str) -> str:
    v = html.escape(version)
    n = html.escape(notes)
    return f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>HandPulse 下载</title>
<style>body{{margin:0;background:#08090b;color:#e9edf3;font-family:Inter,system-ui,sans-serif;line-height:1.6}}
.wrap{{max-width:760px;margin:0 auto;padding:64px 24px}}h1{{font-size:42px;margin:0 0 8px}}p{{color:#9aa6b4}}
.tag{{display:inline-block;border:1px solid #2c3540;border-radius:999px;padding:3px 10px;color:#69b6ff;font-size:12px}}
.card{{margin-top:28px;border:1px solid #252c35;border-radius:10px;background:#0e1115;padding:18px 20px}}
a{{color:#69b6ff}}code{{color:#c7d2df}}.row{{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid #1b2027}}
.row:last-child{{border:0}}.muted{{color:#6f7b88;font-size:12px}}pre{{white-space:pre-wrap;background:#0a0d11;border:1px solid #1b2027;border-radius:8px;padding:14px;color:#9aa6b4;font-size:13px}}
</style></head><body><div class="wrap"><span class="tag">最新版本</span><h1>HandPulse</h1>
<p>Windows 本地键盘、鼠标、手柄使用分析工具。</p><div class="card">
<div class="row"><b>版本</b><code>v{v}</code></div>
<div class="row"><span>NSIS 安装包</span><a href="{BASE_URL}/HandPulse_{v}_x64-setup.exe">下载 .exe</a></div>
<div class="row"><span>MSI 安装包</span><a href="{BASE_URL}/HandPulse_{v}_x64_en-US.msi">下载 .msi</a></div>
<div class="row"><span>更新日志</span><a href="{BASE_URL}/CHANGELOG.md">CHANGELOG.md</a></div>
</div><h2 style="margin-top:32px;font-size:18px">更新日志</h2><pre>{n}</pre>
<p class="muted">服务器只保留最新安装包和更新日志；旧版本请从 GitHub Releases 获取。</p>
</div></body></html>"""


def update_changelog(staging: Path, version: str, notes: str) -> None:
    old = ""
    p = DEST / "CHANGELOG.md"
    if p.exists():
        old = p.read_text("utf-8")
    if f"## v{version}" in old:
        text = old
    else:
        header = "# HandPulse 更新日志\n"
        body = old[len(header):] if old.startswith(header) else old
        text = header + f"\n## v{version}\n\n{notes}\n" + body
    (staging / "CHANGELOG.md").write_text(text, "utf-8")


def main() -> int:
    release = get_json(API)
    if release.get("draft"):
        log("latest release is draft; skip")
        return 0
    version = str(release.get("tag_name", "")).lstrip("v")
    if not version:
        log("no tag_name; skip")
        return 1
    old = current_version()
    if old and old == version:
        log(f"already at {version}; skip")
        return 0
    if old:
        try:
            if tuple(map(int, old.split("."))) > tuple(map(int, version.split("."))):
                log(f"remote {version} < local {old}; skip downgrade")
                return 0
        except ValueError:
            pass

    assets = {a["name"]: a["browser_download_url"] for a in release.get("assets", [])}
    required = [
        f"HandPulse_{version}_x64-setup.exe",
        f"HandPulse_{version}_x64-setup.exe.sig",
        f"HandPulse_{version}_x64_en-US.msi",
        f"HandPulse_{version}_x64_en-US.msi.sig",
    ]
    missing = [n for n in required if n not in assets]
    if missing:
        log(f"missing assets: {missing}")
        return 1

    notes = (release.get("body") or "").strip() or f"HandPulse v{version}"
    staging = Path(tempfile.mkdtemp(prefix="handpulse-mirror-", dir="/tmp"))
    try:
        for name in required:
            log(f"download {name}")
            download(assets[name], staging / name)
        sig = base64.b64encode((staging / required[1]).read_bytes()).decode("ascii")
        manifest = {
            "version": version,
            "notes": notes,
            "pub_date": release.get("published_at") or datetime.now(timezone.utc).isoformat(),
            "platforms": {
                "windows-x86_64": {
                    "signature": sig,
                    "url": f"{BASE_URL}/HandPulse_{version}_x64-setup.exe",
                }
            },
        }
        (staging / "latest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8")
        (staging / "index.html").write_text(render_index(version, notes), "utf-8")
        update_changelog(staging, version, notes)

        # rsync --delete 保证旧安装包不占空间；CHANGELOG 已在 staging 中保留历史。
        subprocess.run(["rsync", "-a", "--delete", f"{staging}/", f"{DEST}/"], check=True)
        log(f"published {version} -> {DEST}")
        return 0
    finally:
        shutil.rmtree(staging, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
