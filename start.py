"""
英语配音工具 — 一键启动器
"""

import subprocess
import sys
import os
import time
import urllib.request
import webbrowser
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _kill_port(port):
    try:
        result = subprocess.run(
            ["cmd", "/c", f"netstat -ano | findstr :{port}"],
            capture_output=True, encoding="utf-8", errors="replace",
        )
        for line in result.stdout.split("\n"):
            if f":{port}" in line and "LISTENING" in line:
                pid = line.strip().split()[-1]
                if pid.isdigit() and pid != "0":
                    subprocess.run(["taskkill", "/F", "/T", "/PID", pid], capture_output=True)
                    subprocess.run(["powershell", "-Command",
                        f"Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue"], capture_output=True)
        time.sleep(0.5)
    except Exception:
        pass


def _find_exe(name):
    path = shutil.which(name)
    if path:
        return path
    for ext in (".cmd", ".exe", ".bat"):
        p = shutil.which(name + ext)
        if p:
            return p
    return None


def _run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, check=False, **kw)


def main():
    print()
    print("  === 英语配音工具 - 一键启动 ===")
    print()

    # Python
    print(f"  [OK] Python {sys.version_info.major}.{sys.version_info.minor}")

    # Node.js
    node_exe = _find_exe("node")
    npm_exe = _find_exe("npm")
    if not node_exe or not npm_exe:
        print("  [安装] Node.js ...")
        r = _run(["winget", "install", "--id", "OpenJS.NodeJS.LTS",
                   "--accept-source-agreements", "--accept-package-agreements"])
        if r.returncode != 0:
            print("  [错误] Node.js 安装失败, 请手动安装: https://nodejs.org")
            input("  按回车退出..."); return
        node_exe = _find_exe("node") or "node"
        npm_exe = _find_exe("npm") or "npm"
    else:
        print("  [OK] Node.js")

    # ffmpeg
    ffmpeg_found = False
    ffmpeg_dir = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    for d in ffmpeg_dir.glob("Gyan.FFmpeg_*"):
        for b in d.glob("ffmpeg-*/bin/ffmpeg.exe"):
            os.environ["PATH"] = str(b.parent) + os.pathsep + os.environ.get("PATH", "")
            ffmpeg_found = True
            break
    if not ffmpeg_found and not shutil.which("ffmpeg"):
        print("  [安装] ffmpeg ...")
        r = _run(["winget", "install", "--id", "Gyan.FFmpeg",
                   "--accept-source-agreements", "--accept-package-agreements"])
        if r.returncode != 0:
            print("  [错误] ffmpeg 自动安装失败")
            print()
            print("  请按以下步骤手动安装：")
            print("  1. 打开 https://www.gyan.dev/ffmpeg/builds/")
            print("  2. 下载 ffmpeg-release-full.7z")
            print("  3. 右键解压到 文档 文件夹里")
            print("  4. 回到这里，粘贴解压后 ffmpeg.exe 所在文件夹的完整路径")
            print("     （例如：C:\Users\你的用户名\Documents\ffmpeg-xxx\bin）")
            ffmpeg_path = input("  > ").strip()
            if ffmpeg_path and os.path.isdir(ffmpeg_path):
                os.environ["PATH"] = ffmpeg_path + os.pathsep + os.environ.get("PATH", "")
                print("  [OK] ffmpeg 已就绪")
            else:
                print("  路径无效，请重新运行本程序")
                input("  按回车退出..."); return
        for d in ffmpeg_dir.glob("Gyan.FFmpeg_*"):
            for b in d.glob("ffmpeg-*/bin/ffmpeg.exe"):
                os.environ["PATH"] = str(b.parent) + os.pathsep + os.environ.get("PATH", "")
                break
    print("  [OK] ffmpeg")

    # Python 依赖
    print("  [检查] Python 依赖...")
    _run([sys.executable, "-m", "pip", "install", "-r", str(ROOT / "backend" / "requirements.txt"), "-q"])
    print("  [OK] Python 依赖")

    # 前端依赖
    if not (ROOT / "frontend" / "node_modules").exists():
        print("  [安装] 前端依赖 (首次约3分钟)...")
        _run([npm_exe, "install", "--silent"], cwd=str(ROOT / "frontend"))
    print("  [OK] 前端依赖")

    # 清理端口
    print()
    print("  启动服务...")
    _kill_port(8765)
    for p in range(5173, 5185):
        _kill_port(p)
    time.sleep(1)

    # 启动后端
    backend_proc = subprocess.Popen(
        [sys.executable, "main.py"],
        cwd=str(ROOT / "backend"),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(30):
        try:
            urllib.request.urlopen("http://127.0.0.1:8765/api/health", timeout=1)
            break
        except Exception:
            time.sleep(1)
    else:
        print("  [错误] 后端启动失败")
        input("  按回车退出...")
        backend_proc.kill()
        return

    # 启动前端
    frontend_proc = subprocess.Popen(
        [npm_exe, "run", "dev"],
        cwd=str(ROOT / "frontend"),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(3)

    # 打开浏览器
    print()
    print("  ================================")
    print("  正在打开浏览器 http://localhost:5173")
    print("  关闭本窗口即可停止所有服务")
    print("  ================================")
    print()
    webbrowser.open("http://localhost:5173")

    try:
        backend_proc.wait()
    except KeyboardInterrupt:
        pass
    finally:
        backend_proc.kill()
        frontend_proc.kill()
        _kill_port(8765)
        print("  已停止.")


if __name__ == "__main__":
    main()
