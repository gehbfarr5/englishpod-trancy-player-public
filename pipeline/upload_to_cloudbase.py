#!/usr/bin/env python3
"""
pipeline/upload_to_cloudbase.py

把「转码后的音频 + 单课 JSON（gzip） + 轻量索引」上传到微信云开发（CloudBase）。

============================================================================
 选型说明（二选一，本项目选定 CloudBase CLI）
============================================================================
 选型：CloudBase CLI（npm 包 `@cloudbase/cli`，命令 `tcb`）。

 理由：CloudBase 官方目前没有成熟的 Python 数据库 SDK，而 `@cloudbase/cli`
 同时覆盖「云存储上传」与「数据库导入」两种能力，可作为**单一工具链**完成
 本脚本全部工作，避免引入多套 SDK。

 安装：npm i -g @cloudbase/cli

 真实执行所需环境变量：
   TENCENTCLOUD_SECRETID      腾讯云 API 密钥 SecretId（必填）
   TENCENTCLOUD_SECRETKEY     腾讯云 API 密钥 SecretKey（必填）
   TENCENTCLOUD_SESSIONTOKEN  临时密钥 Token（使用临时凭证时必填）
   TENCENTCLOUD_REGION        地域，默认 ap-shanghai（可选）
   TCB_ENV_ID                 云开发环境 ID（必填，也可用 --env-id 覆盖）
   CLOUD_FILEID_PREFIX        云存储 fileID 前缀，形如
                              `cloud://<envId>.<envId>-xxxxxxxx/`
                              （CLI 上传后不直接回传 fileID，用它拼接；
                                不设置则 fileid-map.json 仅记录相对路径）

============================================================================
 产物
============================================================================
   <out-dir>/upload_state.json   幂等 / 断点续传状态（remotePath -> 内容 MD5）
   <out-dir>/fileid-map.json     lessonId -> { dg, pb } 的 fileID 映射
   <out-dir>/gz/lessons/*.json.gz 打包好的单课 gzip（上传源）

 幂等策略：
   - 每个待上传对象计算内容 MD5，与 upload_state.json 中记录的 MD5 比对；
     未变更则跳过（可用 --force 强制重传）。
   - 每成功上传一个对象即更新状态文件，支持中断后断点续传。

 用法：
   python3 pipeline/upload_to_cloudbase.py --dry-run --limit 30
   python3 pipeline/upload_to_cloudbase.py --audio-dir audio \
           --lessons-dir processed_lessons --limit 30
============================================================================
"""

import argparse
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field

# 大文件在 dry-run 下跳过 MD5 计算（仅展示体积），阈值 4MB
_MD5_DRY_RUN_MAX_BYTES = 4 * 1024 * 1024

# ---------------------------------------------------------------------------
# 单课 JSON 清洗（P0：防止把本机绝对路径 / 压缩包密码上传到云端）
# ---------------------------------------------------------------------------
# 存量 processed_lessons/*.json 的 audio.{dg,pb,rv} 仍为本机绝对路径，且目录名内嵌
# 压缩包密码。上传前必须重写为相对逻辑路径，并递归扫描是否仍有泄漏特征串。
LEAK_PATTERNS = ("/Users/", "/home/", "Downloads", "（密码", "密码：")
_AUDIO_PREFIX = "audio/"


class LessonSanitizeError(ValueError):
    """单课 JSON 清洗失败（含泄漏特征串或结构非法）。"""


def normalize_audio_paths(audio_raw, lesson_id: str, extension: str = "m4a") -> dict:
    """
    把 audio 归一化为相对逻辑路径，口径与 build_lessons.py 改造后完全一致：
        {"dg": "audio/<id>/dg.m4a" | None, "pb": "audio/<id>/pb.m4a" | None, "rv": None}
    仅当原字段存在（非空）时才生成路径，否则为 None。本函数幂等。
    """
    if extension not in ("mp3", "m4a"):
        raise LessonSanitizeError("unsupported audio extension")
    audio = audio_raw if isinstance(audio_raw, dict) else {}
    return {
        "dg": f"{_AUDIO_PREFIX}{lesson_id}/dg.{extension}" if audio.get("dg") else None,
        "pb": f"{_AUDIO_PREFIX}{lesson_id}/pb.{extension}" if audio.get("pb") else None,
        "rv": None,
    }


def _iter_strings(node):
    """递归产出结构中的所有字符串值。"""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from _iter_strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from _iter_strings(value)


def assert_no_leak(payload, lesson_id: str) -> None:
    """递归扫描 payload，发现任何泄漏特征串即抛出 LessonSanitizeError。"""
    for text in _iter_strings(payload):
        for pattern in LEAK_PATTERNS:
            if pattern in text:
                raise LessonSanitizeError(
                    "课程数据检测到本机路径或敏感口令标记（详情已隐藏）"
                )


def sanitize_lesson_payload(payload: dict, lesson_id: str, extension: str = "m4a") -> dict:
    """
    清洗单课 JSON：重写 audio 为相对逻辑路径 + 递归校验无泄漏特征串。

    - 幂等：对已清洗的 payload 再跑一次，结果不变。
    - 不静默：发现泄漏或结构非法时抛 LessonSanitizeError。
    """
    if not isinstance(payload, dict):
        raise LessonSanitizeError(f"课程 {lesson_id}: 单课 JSON 顶层必须是对象")

    # 深拷贝，避免污染入参
    cleaned = json.loads(json.dumps(payload, ensure_ascii=False))
    cleaned["audio"] = normalize_audio_paths(payload.get("audio"), lesson_id, extension)
    assert_no_leak(cleaned, lesson_id)
    return cleaned


@dataclass
class UploadItem:
    """单个待上传对象。"""

    kind: str            # 'audio' | 'lesson'
    local_path: str      # 本地文件
    remote_path: str     # 云存储相对路径，如 audio/0001/dg.m4a
    lesson_id: str
    extra: dict = field(default_factory=dict)  # 例如 {'track': 'dg'}


def content_md5(path: str) -> str:
    """分块计算文件内容 MD5。"""
    digest = hashlib.md5()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: str, default):
    """读取 JSON，文件不存在时返回 default。"""
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: str, data) -> None:
    """原子写 JSON（先写临时文件再替换），避免中断损坏状态文件。"""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)))
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def build_gzip_from_payload(payload, dst_gz_path: str) -> int:
    """把（已清洗的）单课 payload 序列化 → gzip 落盘，返回压缩后字节数。"""
    os.makedirs(os.path.dirname(dst_gz_path), exist_ok=True)
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    compressed = gzip.compress(data, compresslevel=9)
    with open(dst_gz_path, "wb") as handle:
        handle.write(compressed)
    return len(compressed)


def pick_lesson_id(item: dict) -> str:
    """从索引项取课程 ID，兼容 lesson_id / LessonId 两种键名。"""
    return str(item.get("lesson_id") or item.get("LessonId") or "")


def build_fileid(prefix: str, remote_path: str) -> str:
    """拼接 fileID：prefix（可空）+ remote_path。"""
    if not prefix:
        return ""
    return f"{prefix.rstrip('/')}/{remote_path}"


def plan_uploads(index_items, audio_dir, lessons_dir, gz_dir, limit):
    """
    规划上传清单。

    返回 (audio_items, lesson_items, selected_lessons)
    """
    selected = index_items
    if limit and limit > 0:
        selected = index_items[:limit]

    audio_items = []
    lesson_items = []
    missing_audio = []

    for item in selected:
        lesson_id = pick_lesson_id(item)
        if not lesson_id:
            continue

        # 音频：优先用索引里的「相对」路径，其次回退到约定路径 audio/{id}/{track}.m4a
        #       （索引可能仍存着历史绝对路径，此时忽略之，采用约定路径）
        audio_map = item.get("audio") or {}
        for track in ("dg", "pb"):
            rel_from_index = audio_map.get(track)
            rel_candidates = []
            if isinstance(rel_from_index, str) and rel_from_index and not os.path.isabs(rel_from_index):
                rel_candidates.append(rel_from_index)
            rel_candidates.append(f"audio/{lesson_id}/{track}.m4a")

            resolved_local = ""
            resolved_rel = rel_candidates[-1]
            for candidate in rel_candidates:
                candidate_local = os.path.join(audio_dir, candidate)
                if os.path.exists(candidate_local):
                    resolved_local, resolved_rel = candidate_local, candidate
                    break

            if resolved_local:
                audio_items.append(
                    UploadItem("audio", resolved_local, resolved_rel, lesson_id, {"track": track})
                )
            else:
                missing_audio.append(
                    (lesson_id, track, os.path.join(audio_dir, resolved_rel))
                )

        # 单课 JSON
        src_json = os.path.join(lessons_dir, f"lesson_{lesson_id}.json")
        if os.path.exists(src_json):
            dst_gz = os.path.join(gz_dir, f"{lesson_id}.json.gz")
            lesson_items.append(
                UploadItem("lesson", src_json, f"lessons/{lesson_id}.json.gz", lesson_id,
                           {"gz_path": dst_gz})
            )

    return audio_items, lesson_items, selected, missing_audio


def run_cli(cli_bin: str, args_list) -> tuple:
    """执行 CloudBase CLI，返回 (ok, message)。"""
    cmd = [cli_bin] + list(args_list)
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        return False, f"未找到命令 {cli_bin}，请先安装 @cloudbase/cli"
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()
        return False, tail[-1] if tail else f"退出码 {proc.returncode}"
    return True, "ok"


# 索引 upsert 的每批文档数（避免单条 MongoDB 命令体积过大）
_INDEX_UPSERT_BATCH = 50


def main() -> int:
    parser = argparse.ArgumentParser(description="上传音频/课程 JSON/索引到 CloudBase")
    parser.add_argument("--audio-dir", default="dist",
                        help="转码输出根目录（含 <audio-dir>/audio/<lessonId>/<track>.m4a，默认 ./dist，"
                             "需与 transcode_audio.py 的 --out-dir 一致）")
    parser.add_argument("--lessons-dir", default="processed_lessons",
                        help="单课 JSON 目录（默认 processed_lessons）")
    parser.add_argument("--index", default="",
                        help="索引文件路径（默认 <lessons-dir>/index.json）")
    parser.add_argument("--out-dir", default=os.path.join("pipeline", ".cloudbase"),
                        help="状态与产物目录（默认 pipeline/.cloudbase）")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 课（0=全量）")
    parser.add_argument("--env-id", default=os.environ.get("TCB_ENV_ID", ""),
                        help="云开发环境 ID（默认取环境变量 TCB_ENV_ID）")
    parser.add_argument("--cli-bin", default="tcb", help="CloudBase CLI 可执行文件（默认 tcb）")
    parser.add_argument("--force", action="store_true", help="忽略幂等状态，强制上传")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不实际上传")
    args = parser.parse_args()

    index_path = args.index or os.path.join(args.lessons_dir, "index.json")
    if not os.path.exists(index_path):
        print(f"❌ 未找到索引文件：{index_path}", file=sys.stderr)
        return 2

    index_items = load_json(index_path, [])
    if not isinstance(index_items, list):
        print(f"❌ 索引格式非法（期望数组）：{index_path}", file=sys.stderr)
        return 2

    out_dir = args.out_dir
    gz_dir = os.path.join(out_dir, "gz", "lessons")
    state_path = os.path.join(out_dir, "upload_state.json")
    fileid_map_path = os.path.join(out_dir, "fileid-map.json")
    ndjson_path = os.path.join(out_dir, "lessons_index.ndjson")

    prefix = os.environ.get("CLOUD_FILEID_PREFIX", "").strip()

    audio_items, lesson_items, selected, missing_audio = plan_uploads(
        index_items, args.audio_dir, args.lessons_dir, gz_dir, args.limit
    )

    # ---- 清洗单课 JSON（P0：重写 audio 为相对路径 + 扫描泄漏特征串）----
    sanitize_failures = []
    clean_lesson_items = []
    for item in lesson_items:
        try:
            with open(item.local_path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            clean = sanitize_lesson_payload(payload, item.lesson_id)
            item.extra["sanitized_payload"] = clean
            clean_lesson_items.append(item)
        except LessonSanitizeError as exc:
            sanitize_failures.append((item.lesson_id, str(exc)))
        except Exception as exc:  # noqa: BLE001
            sanitize_failures.append((item.lesson_id, f"读取单课 JSON 失败: {exc}"))
    lesson_items = clean_lesson_items

    mode = "DRY-RUN" if args.dry_run else "RUN"
    env_id = args.env_id or "<未设置 TCB_ENV_ID>"
    print(f"=== upload_to_cloudbase [{mode}] ===")
    print(f"环境 ID     : {env_id}")
    print(f"索引文件    : {index_path}")
    print(f"音频目录    : {os.path.abspath(args.audio_dir)}")
    print(f"单课目录    : {os.path.abspath(args.lessons_dir)}")
    print(f"产物目录    : {os.path.abspath(out_dir)}")
    print(f"处理课程数  : {len(selected)}" + (f"（上限 {args.limit}）" if args.limit else "（全量）"))
    print(f"待上传音频  : {len(audio_items)}    待上传单课 JSON: {len(lesson_items)}")
    if missing_audio:
        print(f"⚠️ 索引声明但本地缺失的音频：{len(missing_audio)}（将跳过）")
    if sanitize_failures:
        print(f"⚠️ 单课 JSON 清洗失败：{len(sanitize_failures)}（这些课将中止上传）")
        for lesson_id, reason in sanitize_failures:
            print(f"   - {lesson_id}: {reason}")
    print("-" * 72)

    state = load_json(state_path, {})
    if not isinstance(state, dict):
        state = {}

    # ---------- 规划 + 幂等判定 ----------
    def should_upload(item: UploadItem) -> tuple:
        """返回 (need_upload, md5_or_empty, size)。"""
        size = os.path.getsize(item.local_path)
        do_md5 = (not args.dry_run) or (size <= _MD5_DRY_RUN_MAX_BYTES)
        md5 = content_md5(item.local_path) if do_md5 else ""
        if args.force:
            return True, md5, size
        if md5 and state.get(item.remote_path) == md5:
            return False, md5, size
        return True, md5, size

    plan = []
    skipped = 0
    for item in audio_items + lesson_items:
        need, md5, size = should_upload(item)
        if need:
            plan.append((item, md5, size))
        else:
            skipped += 1

    for item, _md5, size in plan:
        tag = "audio " if item.kind == "audio" else "lesson"
        print(f"[{mode}] upload {tag}  {item.remote_path}  ({size} B)")
    if missing_audio:
        for lesson_id, track, local in missing_audio:
            print(f"[{mode}] skip   audio   {lesson_id}/{track}（文件缺失，路径已隐藏）")

    # ---------- 索引文档（NDJSON，供 CLI db import 使用） ----------
    index_docs = []
    index_leak_failures = []
    for item in selected:
        lesson_id = pick_lesson_id(item)
        if not lesson_id:
            continue
        doc = json.loads(json.dumps(item, ensure_ascii=False))
        # ⚠️ 索引里的 audio 同样清洗为相对路径，防止把本机绝对路径 upsert 到数据库
        doc["audio"] = normalize_audio_paths(item.get("audio"), lesson_id)
        doc["file_ids"] = {
            "dg": build_fileid(prefix, f"audio/{lesson_id}/dg.m4a"),
            "pb": build_fileid(prefix, f"audio/{lesson_id}/pb.m4a"),
        }
        doc["json_file_id"] = build_fileid(prefix, f"lessons/{lesson_id}.json.gz")
        try:
            assert_no_leak(doc, lesson_id)
        except LessonSanitizeError as exc:
            index_leak_failures.append((lesson_id, str(exc)))
            continue
        index_docs.append(doc)
    if index_leak_failures:
        print(f"⚠️ 索引文档清洗失败：{len(index_leak_failures)}（已剔除）")
        for lesson_id, reason in index_leak_failures:
            print(f"   - {lesson_id}: {reason}")
    print(f"[{mode}] upsert lessons_index 文档 x {len(index_docs)}（唯一键 lesson_id）")

    fileid_map = {
        pick_lesson_id(doc): {
            "dg": doc["file_ids"]["dg"],
            "pb": doc["file_ids"]["pb"],
        }
        for doc in index_docs
    }

    print("-" * 72)
    print(f"计划：音频 {len(audio_items)}，单课 JSON {len(lesson_items)}，"
          f"索引文档 {len(index_docs)}，幂等跳过 {skipped}。")

    if args.dry_run:
        failure_count = len(sanitize_failures) + len(index_leak_failures)
        if failure_count:
            print(f"[dry-run] 存在 {failure_count} 项清洗失败，请先修复后再上传。")
            return 1
        print("[dry-run] 未执行任何上传。")
        return 0

    # ---------- 真实执行 ----------
    if not args.env_id:
        print("❌ 真实执行需要 --env-id 或环境变量 TCB_ENV_ID", file=sys.stderr)
        return 2
    if shutil.which(args.cli_bin) is None:
        print(f"❌ 未找到 CloudBase CLI：{args.cli_bin}，请先 `npm i -g @cloudbase/cli`", file=sys.stderr)
        return 2

    failures = []
    uploaded = 0

    for item, md5, _size in plan:
        # 单课 JSON 先用「已清洗的 payload」gzip 落地，再上传
        local_for_upload = item.local_path
        if item.kind == "lesson":
            gz_path = item.extra.get("gz_path")
            payload = item.extra.get("sanitized_payload")
            if payload is None:
                failures.append((item.remote_path, "缺少已清洗 payload，已中止"))
                print(f"[fail] {item.remote_path}: 缺少已清洗 payload", file=sys.stderr)
                continue
            try:
                build_gzip_from_payload(payload, gz_path)
                local_for_upload = gz_path
            except Exception as exc:  # noqa: BLE001
                failures.append((item.remote_path, f"gzip 失败: {exc}"))
                print(f"[fail] {item.remote_path}: gzip 失败: {exc}", file=sys.stderr)
                continue

        ok, message = run_cli(
            args.cli_bin,
            ["storage", "upload", local_for_upload, item.remote_path, "-e", args.env_id],
        )
        if ok:
            uploaded += 1
            if md5:
                state[item.remote_path] = md5
                save_json(state_path, state)
            print(f"[ok]   {item.remote_path}")
        else:
            failures.append((item.remote_path, message))
            print(f"[fail] {item.remote_path}: {message}", file=sys.stderr)

    # 索引 upsert
    #
    # 注意：`tcb db import` 在 CloudBase CLI 3.8.x 中已不存在，改为通过
    # `tcb db nosql execute` 执行原生 MongoDB 命令。每个文档一条 update +
    # `upsert: true`，以 `lesson_id` 为唯一键，保证重复执行幂等。
    if index_docs:
        os.makedirs(os.path.dirname(ndjson_path), exist_ok=True)
        with open(ndjson_path, "w", encoding="utf-8") as handle:
            for doc in index_docs:
                handle.write(json.dumps(doc, ensure_ascii=False) + "\n")

        collection = "lessons_index"
        upserted = 0
        for start in range(0, len(index_docs), _INDEX_UPSERT_BATCH):
            chunk = index_docs[start : start + _INDEX_UPSERT_BATCH]
            updates = [
                {"q": {"lesson_id": pick_lesson_id(doc)}, "u": {"$set": doc}, "upsert": True}
                for doc in chunk
                if pick_lesson_id(doc)
            ]
            if not updates:
                continue
            command = json.dumps(
                [
                    {
                        "TableName": collection,
                        "CommandType": "UPDATE",
                        "Command": json.dumps(
                            {"update": collection, "updates": updates, "ordered": False},
                            ensure_ascii=False,
                        ),
                    }
                ],
                ensure_ascii=False,
            )
            ok, message = run_cli(
                args.cli_bin,
                ["db", "nosql", "execute", "--command", command, "-e", args.env_id],
            )
            if ok:
                upserted += len(updates)
                print(f"[ok]   {collection} upsert {upserted}/{len(index_docs)}")
            else:
                failures.append((collection, message))
                print(f"[fail] {collection}: {message}", file=sys.stderr)

    # fileid-map 落盘
    save_json(fileid_map_path, fileid_map)
    print(f"已写出 fileid-map.json：{fileid_map_path}")

    all_failures = list(failures)
    all_failures += [(f"lesson {lid} (sanitize)", msg) for lid, msg in sanitize_failures]
    all_failures += [(f"index {lid} (sanitize)", msg) for lid, msg in index_leak_failures]

    print("-" * 72)
    print(f"完成上传 {uploaded} 个对象，失败 {len(all_failures)} 个，幂等跳过 {skipped} 个。")
    if all_failures:
        print("失败清单：", file=sys.stderr)
        for remote, message in all_failures:
            print(f"  - {remote}: {message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
