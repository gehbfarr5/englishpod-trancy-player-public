#!/usr/bin/env python3
"""
pipeline/transcode_audio.py

把 EnglishPod 原始 mp3 批量转码为微信小程序友好的 m4a（AAC 64kbps 单声道）。

输出结构（与小程序端 config/env.ts 的 LESSON_AUDIO_PATH_TEMPLATE 一致）：
    <out-dir>/audio/<lessonId>/dg.m4a
    <out-dir>/audio/<lessonId>/pb.m4a

设计要点：
    - 幂等：输出已存在且不比源文件旧时跳过（可用 --force 强制重转）。
    - 并发可控：--jobs（默认 2）。
    - 失败隔离：单个文件失败不影响其他文件，结束时汇总失败清单并以非零码退出。
    - --dry-run：只打印计划，绝不执行 ffmpeg。

依赖：系统需安装 ffmpeg（macOS: `brew install ffmpeg`）。
源目录来源优先级：--src-dir  >  环境变量 EP_SOURCE_DIR。

示例：
    python3 pipeline/transcode_audio.py --dry-run
    python3 pipeline/transcode_audio.py --src-dir "/path/to/source" --lessons 1-30 --jobs 4
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

# 匹配形如 englishpod_B0001dg.mp3 / C0123pb.mp3 的文件名，捕获 (字母, 4 位编号, 音轨)
_FILENAME_RE = re.compile(r"([A-Za-z])(\d{4})(dg|pb|rv)\.mp3$", re.IGNORECASE)
# 4 位纯数字目录名（作为编号兜底来源）
_DIR_ID_RE = re.compile(r"^\d{4}$")


@dataclass(frozen=True)
class TranscodeTask:
    """单个待转码任务。"""

    lesson_id: str      # 例如 "0001"
    track: str          # "dg" | "pb"
    src_path: str       # 源 mp3 绝对/相对路径
    dst_path: str       # 目标 m4a 路径

    @property
    def label(self) -> str:
        return f"{self.lesson_id}/{self.track}"


def parse_lesson_filter(spec: str):
    """
    解析课程过滤表达式，如 "1-30,45" -> {1..30, 45}。
    返回 None 表示不过滤（全量）。
    """
    if not spec:
        return None
    result = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_s, end_s = part.split("-", 1)
            result.update(range(int(start_s), int(end_s) + 1))
        else:
            result.add(int(part))
    return result


def derive_lesson_id(path: str):
    """从文件名优先推导课程编号，其次回退到父目录名。"""
    basename = os.path.basename(path)
    match = _FILENAME_RE.search(basename)
    if match:
        return match.group(2)
    parent = os.path.basename(os.path.dirname(path))
    if _DIR_ID_RE.match(parent):
        return parent
    return None


def derive_track(path: str):
    """从文件名后缀推导音轨（dg/pb/rv）。"""
    match = _FILENAME_RE.search(os.path.basename(path))
    if match:
        return match.group(3).lower()
    name = os.path.basename(path).lower()
    for track in ("dg", "pb", "rv"):
        if f"{track}.mp3" in name:
            return track
    return None


def discover_tasks(src_dir: str, out_dir: str, tracks, lesson_filter):
    """
    扫描源目录，产出待转码任务列表。

    @param tracks: 允许的音轨集合，如 {"dg", "pb"}
    @param lesson_filter: set[int] 或 None
    """
    tasks = []
    skipped_unknown = 0
    for root, _dirs, files in os.walk(src_dir):
        for name in files:
            if not name.lower().endswith(".mp3"):
                continue
            src_path = os.path.join(root, name)
            track = derive_track(src_path)
            if track is None or track not in tracks:
                continue
            lesson_id = derive_lesson_id(src_path)
            if lesson_id is None:
                skipped_unknown += 1
                continue
            if lesson_filter is not None and int(lesson_id) not in lesson_filter:
                continue
            dst_path = os.path.join(out_dir, "audio", lesson_id, f"{track}.m4a")
            tasks.append(TranscodeTask(lesson_id, track, src_path, dst_path))
    # 去重：同一 (lesson_id, track) 只保留一个（多源时取字典序最小，保证确定性）
    unique = {}
    for task in tasks:
        key = (task.lesson_id, task.track)
        if key not in unique or task.src_path < unique[key].src_path:
            unique[key] = task
    return sorted(unique.values(), key=lambda t: (t.lesson_id, t.track)), skipped_unknown


def needs_transcode(task: TranscodeTask, force: bool) -> bool:
    """幂等判定：目标不存在或比源旧（或强制）时返回 True。"""
    if force:
        return True
    dst = task.dst_path
    if not os.path.exists(dst):
        return True
    try:
        return os.path.getmtime(task.src_path) > os.path.getmtime(dst)
    except OSError:
        return True


def build_ffmpeg_cmd(task: TranscodeTask, bitrate: str, sample_rate: int) -> list:
    """构造 ffmpeg 转码命令：AAC / 单声道 / 指定码率，faststart 友好于流式播放。"""
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", task.src_path,
        "-vn",
        "-ac", "1",
        "-ar", str(sample_rate),
        "-c:a", "aac",
        "-b:a", bitrate,
        "-movflags", "+faststart",
        task.dst_path,
    ]


def run_one(task: TranscodeTask, bitrate: str, sample_rate: int) -> tuple:
    """执行单个转码任务，返回 (task, ok, message)。"""
    os.makedirs(os.path.dirname(task.dst_path), exist_ok=True)
    cmd = build_ffmpeg_cmd(task, bitrate, sample_rate)
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        return task, False, "未找到 ffmpeg，请先安装（macOS: brew install ffmpeg）"
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip().splitlines()
        tail = err[-1] if err else f"ffmpeg 退出码 {proc.returncode}"
        return task, False, tail
    return task, True, "ok"


def _index_file_candidates(lessons_dir: str):
    """索引文件的候选路径：显式目录 + 仓库根下的 processed_lessons。"""
    yield os.path.join(lessons_dir, "index.json")
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    yield os.path.join(repo_root, "processed_lessons", "index.json")


def resolve_src_dir(cli_src: str, lessons_dir: str):
    """
    源目录解析链（对齐 upload_to_cloudbase.py 的便利性）：
      1) --src-dir 参数
      2) 环境变量 EP_SOURCE_DIR
      3) 从 processed_lessons/index.json 的 audio.dg 取 dirname
         （若该目录名为 4 位课程号，则上溯一级以覆盖整批）
    返回 (src_dir, origin)；均不可用时返回 ("", None)。
    """
    if cli_src:
        return cli_src, "--src-dir"
    env_dir = os.environ.get("EP_SOURCE_DIR", "")
    if env_dir:
        return env_dir, "EP_SOURCE_DIR"

    for index_path in _index_file_candidates(lessons_dir):
        if not os.path.isfile(index_path):
            continue
        try:
            with open(index_path, "r", encoding="utf-8") as handle:
                items = json.load(handle)
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(items, list):
            continue
        for item in items:
            audio_dg = (item.get("audio") or {}).get("dg") if isinstance(item, dict) else None
            if not isinstance(audio_dg, str) or not audio_dg:
                continue
            candidate = os.path.dirname(audio_dg)
            if _DIR_ID_RE.match(os.path.basename(candidate)):
                candidate = os.path.dirname(candidate)
            if os.path.isdir(candidate):
                return candidate, f"{index_path} 的 audio.dg"
    return "", None


def main() -> int:
    parser = argparse.ArgumentParser(description="EnglishPod 音频批量转码为 m4a(64k 单声道)")
    parser.add_argument("--src-dir", default="",
                        help="原始 mp3 源目录；缺省时依次回退到 EP_SOURCE_DIR、processed_lessons/index.json 的 audio.dg 目录")
    parser.add_argument("--lessons-dir", default="processed_lessons",
                        help="用于推断源目录的 processed_lessons 目录（默认 processed_lessons）")
    parser.add_argument("--out-dir", default="dist",
                        help="转码输出根目录（默认 ./dist，会生成 <out-dir>/audio/<lessonId>/<track>.m4a）")
    parser.add_argument("--jobs", type=int, default=2, help="并发数（默认 2）")
    parser.add_argument("--bitrate", default="64k", help="AAC 码率（默认 64k）")
    parser.add_argument("--sample-rate", type=int, default=44100, help="采样率（默认 44100）")
    parser.add_argument("--tracks", default="dg,pb", help="要转码的音轨，逗号分隔（默认 dg,pb）")
    parser.add_argument("--lessons", default="", help="课程过滤，如 1-30,45（默认全量）")
    parser.add_argument("--force", action="store_true", help="强制重转（忽略幂等跳过）")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不实际执行")
    args = parser.parse_args()

    src_dir, src_origin = resolve_src_dir(args.src_dir, args.lessons_dir)
    if not src_dir:
        print(
            "❌ 无法确定源目录：请用 --src-dir、设置环境变量 EP_SOURCE_DIR，"
            "或确保 processed_lessons/index.json 存在且其 audio.dg 指向真实目录。",
            file=sys.stderr,
        )
        return 2
    if not os.path.isdir(src_dir):
        print(f"❌ 源目录不存在：{src_dir}（来源：{src_origin}）", file=sys.stderr)
        return 2

    jobs = max(1, args.jobs)
    tracks = {t.strip().lower() for t in args.tracks.split(",") if t.strip()}
    lesson_filter = parse_lesson_filter(args.lessons)

    all_tasks, skipped_unknown = discover_tasks(src_dir, args.out_dir, tracks, lesson_filter)
    pending = [t for t in all_tasks if needs_transcode(t, args.force)]
    skipped = len(all_tasks) - len(pending)

    mode = "DRY-RUN" if args.dry_run else "RUN"
    print(f"=== transcode_audio [{mode}] ===")
    print(f"源目录      : {src_dir}  [来源：{src_origin}]")
    print(f"输出目录    : {os.path.abspath(args.out_dir)}/audio/<lessonId>/<track>.m4a")
    print(f"音轨        : {sorted(tracks)}   码率: {args.bitrate}   采样率: {args.sample_rate}   并发: {jobs}")
    print(f"发现任务    : {len(all_tasks)}（待转码 {len(pending)}，幂等跳过 {skipped}，无法识别编号 {skipped_unknown}）")
    print("-" * 72)

    for task in pending:
        print(f"[{mode}] {task.label:>8}  {task.src_path}\n            -> {task.dst_path}")

    if args.dry_run:
        print("-" * 72)
        print(f"[dry-run] 计划转码 {len(pending)} 个文件（未执行）。")
        return 0

    if not pending:
        print("没有需要转码的文件。")
        return 0

    if shutil.which("ffmpeg") is None:
        print("❌ 未检测到 ffmpeg，请先安装后重试。", file=sys.stderr)
        return 2

    failures = []
    done = 0
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = {pool.submit(run_one, t, args.bitrate, args.sample_rate): t for t in pending}
        for future in as_completed(futures):
            task = futures[future]
            try:
                _task, ok, message = future.result()
            except Exception as exc:  # noqa: BLE001  兜底：任何异常都记为失败，不中断整体
                ok, message = False, str(exc)
            if ok:
                done += 1
                print(f"[ok]   {task.label}")
            else:
                failures.append((task, message))
                print(f"[fail] {task.label}: {message}", file=sys.stderr)

    print("-" * 72)
    print(f"完成 {done} 个，失败 {len(failures)} 个，跳过 {skipped} 个。")
    if failures:
        print("失败清单：", file=sys.stderr)
        for task, message in failures:
            print(f"  - {task.label} ({task.src_path}): {message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
