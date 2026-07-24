"""
英语配音工具 — Python FastAPI 后端
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Request
import starlette.config
starlette.config.DEFAULT_MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024  # 2GB
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="英语配音工具")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECTS_DIR = BASE_DIR / "projects"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

# ffmpeg 路径（winget 安装位置）
FFMPEG_DIR = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
FFMPEG_BIN = ""
for d in FFMPEG_DIR.glob("Gyan.FFmpeg_*"):
    for b in d.glob("ffmpeg-*/bin/ffmpeg.exe"):
        FFMPEG_BIN = str(b.parent)
        break
os.environ["PATH"] = FFMPEG_BIN + os.pathsep + os.environ.get("PATH", "")

# 当前活动的项目
current_project: Optional[Path] = None

# 持久化：记住上次的项目路径
_PROJECT_STATE_FILE = PROJECTS_DIR / ".current_project"


def _save_project_state():
    if current_project:
        _PROJECT_STATE_FILE.write_text(str(current_project))


def _load_project_state():
    global current_project
    if _PROJECT_STATE_FILE.exists():
        p = Path(_PROJECT_STATE_FILE.read_text().strip())
        if p.exists():
            current_project = p
            return True
    return False


# ── 工具函数 ──────────────────────────────────────────────────

def _ffmpeg_bin(name: str) -> str:
    """返回 ffmpeg/ffprobe 的完整路径"""
    if FFMPEG_BIN:
        p = Path(FFMPEG_BIN) / f"{name}.exe"
        if p.exists():
            return str(p)
    return name  # fallback


def run_ffmpeg(args, **kwargs):
    """运行 ffmpeg 命令"""
    cmd = [_ffmpeg_bin("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error"] + args
    return subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="replace", **kwargs)


def run_ffprobe(args):
    """运行 ffprobe 并返回 JSON"""
    cmd = [_ffmpeg_bin("ffprobe"), "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams"] + args
    result = subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe 失败: {result.stderr}")
    if not result.stdout:
        raise RuntimeError(f"ffprobe 无输出 (returncode={result.returncode}, stderr={result.stderr})")
    return json.loads(result.stdout)


def get_duration_seconds(filepath: str) -> float:
    """获取视频/音频时长（秒）"""
    info = run_ffprobe([filepath])
    return float(info["format"]["duration"])


# ── WebSocket 管理 ────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                pass


manager = ConnectionManager()


# ── 健康检查 ──────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "python": sys.version}


@app.get("/api/diagnostics")
async def diagnostics():
    import platform
    info = {
        "os": f"{platform.system()} {platform.version()}",
        "python": sys.version,
        "cpu_count": os.cpu_count(),
        "project": str(current_project) if current_project else None,
    }
    try:
        info["disk_free"] = f"{shutil.disk_usage(BASE_DIR).free / (1024**3):.1f} GB"
    except Exception:
        pass
    return info


# ── WebSocket ─────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ── 项目管理 ──────────────────────────────────────────────────

@app.post("/api/project/resume")
async def resume_project(path: str = Form("")):
    """恢复之前的项目"""
    global current_project
    if path and os.path.isdir(path):
        current_project = Path(path)
        _save_project_state()
        return {"ok": True, "path": str(current_project)}
    return {"ok": False}


@app.post("/api/project/create")
async def create_project(name: str = Form("未命名作品")):
    global current_project
    project_id = uuid.uuid4().hex[:8]
    project_dir = PROJECTS_DIR / f"{name}_{project_id}"
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "source").mkdir(exist_ok=True)
    (project_dir / "separated").mkdir(exist_ok=True)
    (project_dir / "recordings").mkdir(exist_ok=True)
    (project_dir / "export").mkdir(exist_ok=True)

    current_project = project_dir
    _save_project_state()
    return {"id": project_id, "name": name, "path": str(project_dir)}


# ── 文件上传 ──────────────────────────────────────────────────

UPLOAD_DIR = Path("D:/projects/dubbing-uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    """接收拖拽上传的视频，流式写入本地"""
    saved = UPLOAD_DIR / file.filename
    with open(saved, "wb") as f:
        while chunk := await file.read(8 * 1024 * 1024):  # 8MB chunks
            f.write(chunk)
    return {"path": str(saved)}


# ── 文件选择对话框 ────────────────────────────────────────────

@app.get("/api/pick-file")
async def pick_file():
    """弹出原生文件选择框，返回选中路径"""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        path = filedialog.askopenfilename(
            title="选择视频文件",
            filetypes=[("视频文件", "*.mkv *.mp4 *.avi *.mov *.webm"), ("所有文件", "*.*")],
        )
        root.destroy()
        if path:
            return {"path": path}
        return {"path": ""}
    except Exception as e:
        return {"error": str(e)}


# ── 视频信息 ──────────────────────────────────────────────────

@app.post("/api/video/info")
async def video_info(path: str = Form("")):
    """获取视频文件的详细信息"""
    if not path or not os.path.isfile(path):
        return {"error": "文件不存在"}
    try:
        data = run_ffprobe([path])
        video_stream = None
        audio_stream = None
        for s in data.get("streams", []):
            if s["codec_type"] == "video" and not video_stream:
                video_stream = s
            elif s["codec_type"] == "audio" and not audio_stream:
                audio_stream = s

        return {
            "duration": float(data["format"].get("duration", 0)),
            "size_bytes": int(data["format"].get("size", 0)),
            "video": {
                "codec": video_stream.get("codec_name", ""),
                "width": video_stream.get("width", 0),
                "height": video_stream.get("height", 0),
                "fps": eval(video_stream.get("r_frame_rate", "0/1")),
            } if video_stream else None,
            "audio": {
                "codec": audio_stream.get("codec_name", ""),
                "channels": audio_stream.get("channels", 0),
                "sample_rate": int(audio_stream.get("sample_rate", 0)),
            } if audio_stream else None,
        }
    except Exception as e:
        return {"error": str(e)}


# ── 片段截取 ──────────────────────────────────────────────────

@app.post("/api/clip/extract")
async def extract_clip(
    source_path: str = Form(""),
    start_time: float = Form(0),
    end_time: float = Form(0),
):
    """从视频中精确截取片段（重编码，保证帧精确）"""
    global current_project

    if not current_project:
        return {"error": "请先创建或打开一个作品"}

    if not os.path.isfile(source_path):
        return {"error": "片源文件不存在"}

    duration = end_time - start_time
    if duration <= 0:
        return {"error": "结束时间必须大于开始时间"}

    output_path = current_project / "source" / "clip.mp4"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    await manager.broadcast({"type": "progress", "task": "extract", "percent": 50, "message": "正在截取片段..."})

    # 流复制截取：几乎瞬间完成
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", str(start_time),
        "-i", source_path,
        "-t", str(duration),
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        str(output_path)
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    await proc.communicate()

    if proc.returncode != 0:
        await manager.broadcast({"type": "progress", "task": "extract", "percent": 100, "message": "截取出错"})
        return {"error": "片段截取失败，请检查时间范围是否有效"}

    await manager.broadcast({"type": "progress", "task": "extract", "percent": 100, "message": "截取完成"})

    return {
        "ok": True,
        "output": str(output_path),
        "duration": round(duration, 2),
    }


# ── 人声分离 ──────────────────────────────────────────────────

@app.post("/api/separate")
async def separate_vocals():
    """对当前作品的 source/clip.mp4 执行人声分离"""
    global current_project

    if not current_project:
        return {"error": "请先创建或打开一个作品"}

    clip_path = current_project / "source" / "clip.mp4"
    if not clip_path.exists():
        return {"error": "请先截取片段"}

    # 提取音频为 WAV
    audio_path = current_project / "source" / "audio.wav"
    await manager.broadcast({"type": "progress", "task": "separate", "percent": 0, "message": "提取音频..."})

    run_ffmpeg(["-i", str(clip_path), "-vn", "-acodec", "pcm_s16le", "-ar", "44100", str(audio_path)])

    # 运行 demucs
    output_dir = current_project / "separated"
    output_dir.mkdir(parents=True, exist_ok=True)

    await manager.broadcast({"type": "progress", "task": "separate", "percent": 5, "message": "正在分离人声（CPU 推理，请耐心等待）..."})

    try:
        cmd = [
            sys.executable, "-m", "demucs",
            "--two-stems=vocals",
            "-o", str(output_dir),
            str(audio_path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        # 实时读取输出（tqdm 用 \r 更新进度，不能靠 readline）
        audio_duration = get_duration_seconds(str(audio_path))
        last_percent = 5
        buffer = b""

        while True:
            chunk = await proc.stdout.read(256)
            if not chunk:
                break
            buffer += chunk
            # 按 \r 分割，取最后一段（tqdm 的当前行）
            parts = buffer.split(b"\r")
            # 保留最后一个可能不完整的分段
            buffer = parts[-1]
            for part in parts[:-1]:
                text = part.decode("utf-8", errors="replace").strip()
                if "%" in text:
                    try:
                        pct_str = text.split("%")[0].strip()
                        # 去掉可能的前导空格和进度条字符
                        pct_str = pct_str.lstrip("\x1b[").split("\x1b")[0].strip()
                        if pct_str.isdigit():
                            pct = int(pct_str)
                        else:
                            # 比如 " 14" -> 提取数字
                            import re
                            nums = re.findall(r'\d+', pct_str)
                            if nums:
                                pct = int(nums[0])
                            else:
                                continue
                        if 0 <= pct <= 100 and pct > last_percent:
                            last_percent = pct
                            mapped = 5 + pct * 90 // 100
                            await manager.broadcast({
                                "type": "progress", "task": "separate",
                                "percent": mapped,
                                "message": "正在分离人声...",
                            })
                    except (ValueError, IndexError):
                        pass

        await proc.wait()

        if proc.returncode != 0:
            raise RuntimeError(f"demucs 退出码: {proc.returncode}")

    except Exception as e:
        await manager.broadcast({
            "type": "progress", "task": "separate",
            "percent": 100, "message": f"分离失败: {str(e)}",
        })
        return {"error": f"人声分离失败：{str(e)}"}

    # 查找输出文件
    audio_stem = audio_path.stem
    separated_dir = output_dir / "htdemucs" / audio_stem
    vocals_path = separated_dir / "vocals.wav"
    accomp_path = separated_dir / "no_vocals.wav"

    if not vocals_path.exists():
        return {"error": "分离完成但未找到输出文件，请检查 demucs 是否正常"}

    # 生成消原声版视频（视频流 + 伴奏音频）
    await manager.broadcast({
        "type": "progress", "task": "separate", "percent": 97,
        "message": "正在合成消原声视频...",
    })
    no_vocals_clip = current_project / "source" / "no_vocals.mp4"
    run_ffmpeg([
        "-i", str(clip_path),
        "-i", str(accomp_path),
        "-c:v", "copy",
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        str(no_vocals_clip),
    ])

    await manager.broadcast({
        "type": "progress", "task": "separate", "percent": 100,
        "message": "分离完成！",
    })

    return {
        "ok": True,
        "clip_original": str(clip_path),
        "clip_no_vocals": str(no_vocals_clip),
    }


# ── 语音转写（faster-whisper + medium 模型 + VAD） ─────────────

@app.post("/api/transcribe")
async def transcribe():
    """对当前片段做语音识别，返回句子列表"""
    global current_project
    if not current_project:
        return {"error": "请先创建项目"}

    clip_path = current_project / "source" / "clip.mp4"
    if not clip_path.exists():
        return {"error": "请先截取片段"}

    audio_path = current_project / "source" / "transcribe_audio.wav"
    run_ffmpeg(["-i", str(clip_path), "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", str(audio_path)])

    await manager.broadcast({
        "type": "progress", "task": "transcribe", "percent": 2,
        "message": "加载模型中...",
    })

    try:
        from faster_whisper import WhisperModel
        import os as _os, concurrent.futures

        if "HF_ENDPOINT" not in _os.environ:
            _os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

        await manager.broadcast({
            "type": "progress", "task": "transcribe", "percent": 2,
            "message": "加载模型中...",
        })

        # 模型加载在线程池中运行，不阻塞事件循环
        loop = asyncio.get_event_loop()
        model = await loop.run_in_executor(
            None, lambda: WhisperModel("medium", device="cpu", compute_type="int8")
        )

        audio_dur = get_duration_seconds(str(audio_path))

        await manager.broadcast({
            "type": "progress", "task": "transcribe", "percent": 15,
            "message": "识别对白中...",
        })

        # 转写放到线程池（不阻塞事件循环）
        def do_transcribe():
            segs, info = model.transcribe(
                str(audio_path), beam_size=5, vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=400, speech_pad_ms=500),
                language="en",
            )
            return list(segs), info

        segments, _info = await loop.run_in_executor(None, do_transcribe)

        await manager.broadcast({
            "type": "progress", "task": "transcribe", "percent": 90,
            "message": "处理结果中...",
        })

        sentences = []
        for seg in segments:
            text = seg.text.strip()
            # 跳过纯音效标记
            if (text.startswith("[") and text.endswith("]")) or \
               (text.startswith("(") and text.endswith(")")):
                continue
            if text:
                sentences.append({
                    "id": len(sentences) + 1,
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "text": text,
                })

        import json as _json
        sentences_path = current_project / "source" / "sentences.json"
        sentences_path.write_text(_json.dumps(sentences, ensure_ascii=False, indent=2), encoding="utf-8")

        await manager.broadcast({
            "type": "progress", "task": "transcribe", "percent": 100,
            "message": f"识别完成，共 {len(sentences)} 句",
        })

        return {"ok": True, "sentences": sentences}

    except Exception as e:
        return {"error": f"转写失败: {str(e)}"}


# ── 录音管理（简化版：一句一个录音，录音即覆盖） ──────────────

@app.post("/api/recordings/save")
async def save_recording(
    sentence_index: int = Form(0),
    file: UploadFile = File(None),
):
    """保存一句的录音（按句子序号，不受合并影响）"""
    global current_project
    if not current_project:
        return {"error": "请先创建项目"}

    if not file:
        return {"error": "没有收到录音文件"}

    take_dir = current_project / "recordings" / f"sentence_{sentence_index:02d}"
    take_dir.mkdir(parents=True, exist_ok=True)

    take_path = take_dir / "recording.wav"
    content = await file.read()
    take_path.write_bytes(content)

    return {"ok": True, "path": str(take_path)}


@app.post("/api/recordings/delete")
async def delete_recording(sentence_index: int = Form(0)):
    """删除某句的录音"""
    global current_project
    if not current_project: return {"error": "请先创建项目"}
    rec_path = current_project / "recordings" / f"sentence_{sentence_index:02d}" / "recording.wav"
    if rec_path.exists():
        os.remove(rec_path)
    # 也删目录
    rec_dir = current_project / "recordings" / f"sentence_{sentence_index:02d}"
    if rec_dir.exists():
        try: rec_dir.rmdir()
        except: pass
    return {"ok": True}


@app.post("/api/recordings/reindex")
async def reindex_recordings(merge_start: int = Form(0), merge_count: int = Form(0)):
    """合并后重排录音文件夹编号"""
    global current_project
    if not current_project: return {"error": "请先创建项目"}
    rec_dir = current_project / "recordings"
    if not rec_dir.exists(): return {"ok": True}

    # 被合并的已删除。把后面的文件夹往前移 merge_count-1 位
    # 例如合并了 2+3 (merge_start=2, merge_count=2): 删除 2,3 后, 4→2, 5→3, ...
    shift = merge_count - 1
    if shift <= 0: return {"ok": True}

    # 收集现有文件夹
    existing = sorted([int(d.name.split("_")[1]) for d in rec_dir.iterdir() if d.is_dir() and d.name.startswith("sentence_")])

    # 从后往前重命名，避免覆盖
    for old_idx in sorted(existing, reverse=True):
        if old_idx <= merge_start: continue
        new_idx = old_idx - shift
        old_dir = rec_dir / f"sentence_{old_idx:02d}"
        new_dir = rec_dir / f"sentence_{new_idx:02d}"
        if old_dir.exists() and not new_dir.exists():
            old_dir.rename(new_dir)

    return {"ok": True}


@app.get("/api/recordings/get")
async def get_recording(sentence_index: int = 0):
    """获取某句的录音路径（按序号）"""
    global current_project
    if not current_project:
        return {"error": "请先创建项目"}

    take_path = current_project / "recordings" / f"sentence_{sentence_index:02d}" / "recording.wav"
    if take_path.exists():
        return {"exists": True, "path": str(take_path)}
    return {"exists": False}


# ── 句子保存 ──────────────────────────────────────────────────

@app.post("/api/sentences/save")
async def save_sentences(request: Request):
    """保存句子列表到当前项目"""
    global current_project
    if not current_project: return {"error": "请先创建项目"}
    try:
        data = await request.json()
        sentences = data.get("sentences", [])
        sp = current_project / "source" / "sentences.json"
        import json as _json
        sp.write_text(_json.dumps(sentences, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}



# ── 快速恢复 ──────────────────────────────────────────────────

@app.post("/api/quick-resume")
async def quick_resume():
    """查找最近有数据的项目"""
    global current_project; import json as _json
    best = None; best_time = 0
    for d in PROJECTS_DIR.iterdir():
        if d.is_dir():
            sp = d / "source" / "sentences.json"
            if sp.exists() and (d / "source" / "clip.mp4").exists():
                mt = sp.stat().st_mtime
                if mt > best_time: best_time = mt; best = d
    if not best: return {"error": "没有历史数据"}
    current_project = best; _save_project_state()
    nv = best / "source" / "no_vocals.mp4"
    s = _json.loads((best / "source" / "sentences.json").read_text(encoding="utf-8"))
    return {"ok": True, "has_separated": nv.exists(), "sentences": s,
            "clip_path": str(best / "source" / "clip.mp4"),
            "no_vocals_path": str(nv) if nv.exists() else ""}


# ── 统一音轨生成 ──────────────────────────────────────────────

def _build_audio_track(sentences, clip_path, accomp_path, project_dir, prefix, rec_vol=1.0, orig_vol=1.0):
    """生成完整音轨：句子音频 + 句间空隙补原声"""
    export_dir = project_dir / "export"
    export_dir.mkdir(exist_ok=True)

    dur_result = run_ffprobe([str(clip_path)])
    clip_duration = float(dur_result["format"]["duration"])
    sorted_s = sorted(sentences, key=lambda x: x["start"])

    # 构建完整时间线
    timeline = []
    if sorted_s[0]["start"] > 0.1:
        timeline.append((0, sorted_s[0]["start"], "gap", None))

    for i, s in enumerate(sorted_s):
        rec_path = project_dir / "recordings" / f"sentence_{i+1:02d}" / "recording.wav"
        typ = "rec" if rec_path.exists() else "orig"
        timeline.append((s["start"], s["end"], typ, i))
        if i < len(sorted_s) - 1:
            ns = sorted_s[i + 1]
            if s["end"] < ns["start"] - 0.1:
                timeline.append((s["end"], ns["start"], "gap", None))

    if sorted_s[-1]["end"] < clip_duration - 0.1:
        timeline.append((sorted_s[-1]["end"], clip_duration, "gap", None))

    # 为每段生成音频
    segment_files = []
    for idx, (start, end, typ, s_idx) in enumerate(timeline):
        out_wav = export_dir / f"{prefix}_{idx+1:02d}.wav"
        dur = max(0.1, end - start)

        if typ == "gap":
            run_ffmpeg(["-i", str(clip_path), "-ss", str(start), "-t", str(dur),
                       "-vn", "-af", f"volume={orig_vol}", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", str(out_wav)])
        elif typ == "rec":
            rec_p = project_dir / "recordings" / f"sentence_{s_idx+1:02d}" / "recording.wav"
            a_seg = export_dir / f"{prefix}_ac_{idx+1:02d}.wav"
            r_wav = export_dir / f"{prefix}_rc_{idx+1:02d}.wav"
            run_ffmpeg(["-i", str(accomp_path), "-ss", str(start), "-t", str(dur),
                       "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", str(a_seg)])
            run_ffmpeg(["-i", str(rec_p), "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", str(r_wav)])
            if a_seg.exists() and r_wav.exists():
                vol = max(0.1, rec_vol * 2)
                run_ffmpeg(["-i", str(a_seg), "-i", str(r_wav),
                           "-filter_complex", f"[0:a]volume={rec_vol}[rv];[rv][1:a]amix=inputs=2:duration=first,volume={vol}",
                           "-acodec", "pcm_s16le", "-ar", "44100", str(out_wav)])
        else:
            run_ffmpeg(["-i", str(clip_path), "-ss", str(start), "-t", str(dur),
                       "-vn", "-af", f"volume={orig_vol}", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", str(out_wav)])

        if out_wav.exists() and os.path.getsize(out_wav) > 44:
            trimmed = export_dir / f'{prefix}_{idx+1:02d}_t.wav'
            run_ffmpeg(['-i', str(out_wav), '-t', str(dur),
                       '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', str(trimmed)])
            if trimmed.exists() and os.path.getsize(trimmed) > 44:
                segment_files.append(str(trimmed))

    if not segment_files:
        return None

    concat_list = export_dir / f"{prefix}_concat.txt"
    concat_list.write_text("\n".join([f"file '{f.replace(chr(92), '/')}'" for f in segment_files]), encoding="utf-8")
    audio_track = export_dir / f"{prefix}_audio.wav"
    run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(audio_track)])
    return audio_track


# ── 全片预览 ──────────────────────────────────────────────────

@app.post("/api/preview")
async def preview(request: Request):
    """生成预览音轨"""
    global current_project
    if not current_project:
        return {"error": "请先创建项目"}

    clip_path = current_project / "source" / "clip.mp4"
    accomp_path = current_project / "separated" / "htdemucs" / "audio" / "no_vocals.wav"
    sentences_path = current_project / "source" / "sentences.json"

    if not clip_path.exists(): return {"error": "请先截取片段"}
    if not accomp_path.exists(): return {"error": "请先分离人声"}

    import json as _json
    sentences = _json.loads(sentences_path.read_text(encoding="utf-8")) if sentences_path.exists() else []
    if not sentences: return {"error": "请先识别对白"}

    rec_vol = float(request.query_params.get("rec_vol", "1.0")) if request else 1.0
    orig_vol = float(request.query_params.get("orig_vol", "1.0")) if request else 1.0
    track = _build_audio_track(sentences, clip_path, accomp_path, current_project, "preview", rec_vol, orig_vol)
    if not track: return {"error": "音轨生成失败"}
    return {"ok": True, "audio_path": str(track)}


@app.post("/api/export")
async def export_video(
    intro_path: str = Form(""),
    outro_path: str = Form(""),
    intro_duration: float = Form(0),
    outro_duration: float = Form(0),
    subtitle_style: str = Form(""),
    recording_volume: float = Form(1.0),
    orig_volume: float = Form(1.0),
):
    """合成最终配音视频"""
    global current_project
    if not current_project:
        return {"error": "请先创建项目"}

    clip_path = current_project / "source" / "clip.mp4"
    accomp_path = current_project / "separated" / "htdemucs" / "audio" / "no_vocals.wav"
    sentences_path = current_project / "source" / "sentences.json"

    if not clip_path.exists(): return {"error": "请先截取片段"}
    if not accomp_path.exists(): return {"error": "请先分离人声"}

    import json as _json
    sentences = _json.loads(sentences_path.read_text(encoding="utf-8")) if sentences_path.exists() else []
    if not sentences: return {"error": "请先识别对白"}

    export_dir = current_project / "export"
    export_dir.mkdir(exist_ok=True)

    await manager.broadcast({"type": "progress", "task": "export", "percent": 10, "message": "生成音轨..."})

    audio_track = _build_audio_track(sentences, clip_path, accomp_path, current_project, "export", recording_volume, orig_volume)
    if not audio_track: return {"error": "音轨生成失败"}

    # 字幕
    ass_path = None
    if subtitle_style:
        ass_path = Path("D:/projects/dubbing-test/export_subtitles.ass")
        ass_path.parent.mkdir(parents=True, exist_ok=True)
        _generate_ass(sentences, ass_path, subtitle_style)

    output_path = export_dir / "final.mp4"

    await manager.broadcast({"type": "progress", "task": "export", "percent": 50, "message": "合成视频..."})

    vf_args = []
    if ass_path:
        ass_str = str(ass_path).replace(chr(92), chr(47)).replace(":", chr(92) + ":")
        vf_args = ["-vf", f"subtitles='{ass_str}'"]

    cmd = [_ffmpeg_bin("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(clip_path), "-i", str(audio_track),
    ] + vf_args + [
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "192k", str(output_path),
    ]

    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    _, stderr = await proc.communicate()
    if proc.returncode != 0 or not output_path.exists():
        err_msg = stderr.decode("utf-8", errors="replace")[:300] if stderr else "未知错误"
        return {"error": f"视频合成失败: {err_msg}"}

    # 片头片尾
    final_output = output_path
    concat_files = []
    for prefix, path, dur in [("intro", intro_path, intro_duration), ("outro", outro_path, outro_duration)]:
        if path and os.path.isfile(path):
            cut = export_dir / f"{prefix}_cut.mp4"
            cut_args = ["-ss", "0", "-t", str(dur)] if dur > 0 else []
            cut_args += ["-i", path, "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", str(cut)]
            run_ffmpeg(cut_args)
            if prefix == "intro": concat_files.insert(0, cut)
            else: concat_files.append(cut)

    if concat_files:
        await manager.broadcast({"type": "progress", "task": "export", "percent": 80, "message": "拼接片头片尾..."})
        all_parts = concat_files[0:1] + [output_path] + concat_files[1:]
        concat_list = export_dir / "concat.txt"
        concat_list.write_text("\n".join([f"file '{str(p).replace(chr(92), '/')}'" for p in all_parts]), encoding="utf-8")
        final_output = export_dir / "final_complete.mp4"
        run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(final_output)])

    await manager.broadcast({"type": "progress", "task": "export", "percent": 100, "message": "导出完成！"})
    return {"ok": True, "output": str(final_output)}


def _generate_ass(sentences, output_path, style):
    """生成 ASS 字幕文件"""
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1920",
        "PlayResY: 1080",
        "WrapStyle: 0",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ]

    if style == "classic":
        lines.append("Style: Default,Arial,20,&H00FFFFFF,&H00000000,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,2,2,20,20,40,1")
    else:
        lines.append("Style: Default,Arial,22,&H00FFFFFF,&H00000000,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,1.5,1.5,2,20,20,50,1")

    lines.append("")
    lines.append("[Events]")
    lines.append("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text")

    for s in sentences:
        start = _fmt_ass_time(s["start"])
        end = _fmt_ass_time(s["end"])
        text = s["text"].replace("\n", "\\N")
        lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")

    output_path.write_text("\n".join(lines), encoding="utf-8")


def _fmt_ass_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


# ── 文件服务（异步流式，支持 Range 请求） ──────────────────────

@app.get("/api/file")
async def serve_file(path: str = "", request: Request = None):
    """异步提供本地文件访问，浏览器 seek 不卡"""
    import aiofiles

    if not path or not os.path.isfile(path):
        return {"error": "文件不存在"}

    ext = Path(path).suffix.lower()
    mime_map = {
        ".wav": "audio/wav", ".mp3": "audio/mpeg",
        ".mp4": "video/mp4", ".mkv": "video/x-matroska",
        ".webm": "video/webm", ".avi": "video/x-msvideo",
        ".mov": "video/quicktime", ".srt": "text/plain",
        ".json": "application/json",
    }
    media_type = mime_map.get(ext, "application/octet-stream")
    file_size = os.path.getsize(path)

    # 处理 Range 请求
    range_header = request.headers.get("range") if request else None
    if range_header:
        start, end = 0, file_size - 1
        range_match = range_header.replace("bytes=", "").split("-")
        start = int(range_match[0]) if range_match[0] else 0
        end = int(range_match[1]) if len(range_match) > 1 and range_match[1] else file_size - 1

        async def ranged_stream():
            async with aiofiles.open(path, "rb") as f:
                await f.seek(start)
                remaining = end - start + 1
                chunk_size = 64 * 1024
                while remaining > 0:
                    size = min(chunk_size, remaining)
                    data = await f.read(size)
                    if not data:
                        break
                    yield data
                    remaining -= len(data)

        return StreamingResponse(
            ranged_stream(),
            status_code=206,
            media_type=media_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(end - start + 1),
            },
        )
    else:
        async def full_stream():
            async with aiofiles.open(path, "rb") as f:
                chunk_size = 64 * 1024
                while True:
                    data = await f.read(chunk_size)
                    if not data:
                        break
                    yield data

        return StreamingResponse(
            full_stream(),
            media_type=media_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
            },
        )


# ── 静态文件服务 ──────────────────────────────────────────────

frontend_dist = BASE_DIR / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
