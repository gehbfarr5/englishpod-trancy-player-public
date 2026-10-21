#!/usr/bin/env python3
"""
最小单测：验证 pipeline/build_lessons.py 的「音频路径改造」。

背景：build_lessons.py 顶层依赖 numpy / stable_whisper / parse_pdfs 等重依赖，
本机不一定具备，因此这里用 stub 占位这些模块，只针对**纯函数**
`make_relative_audio_path` 与 `--index-only` 的索引重写路径做验证。

运行：
    python3 pipeline/test_audio_path.py
"""

import importlib
import json
import os
import shutil
import sys
import tempfile
import types
import unittest

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(PIPELINE_DIR)
PROCESSED_DIR = os.path.join(REPO_ROOT, "processed_lessons")


def install_stubs():
    """用轻量 stub 替换 build_lessons 顶层的重依赖，避免安装 MLX/Whisper。"""
    if "numpy" not in sys.modules:
        numpy_stub = types.ModuleType("numpy")

        class _NdArray:  # 仅用于满足类型注解 np.ndarray
            pass

        numpy_stub.ndarray = _NdArray
        sys.modules["numpy"] = numpy_stub

    if "stable_whisper" not in sys.modules:
        sw_stub = types.ModuleType("stable_whisper")
        sw_stub.load_mlx_whisper = lambda *a, **k: None
        sw_audio_stub = types.ModuleType("stable_whisper.audio")
        sw_audio_stub.load_audio = lambda *a, **k: []
        sw_stub.audio = sw_audio_stub
        sys.modules["stable_whisper"] = sw_stub
        sys.modules["stable_whisper.audio"] = sw_audio_stub

    if "parse_pdfs" not in sys.modules:
        pp_stub = types.ModuleType("parse_pdfs")
        pp_stub.BASE_DIR = "/nonexistent/source"
        pp_stub.clean_ligatures = lambda text: text
        pp_stub.parse_dialogue_pdf = lambda *a, **k: ("Fake - Title (B0001)", [], [])
        pp_stub.parse_host_pdf = lambda *a, **k: []
        sys.modules["parse_pdfs"] = pp_stub


def import_build_lessons(output_dir, source_dir=None):
    """在指定输出目录下导入（重新加载）build_lessons 模块。"""
    os.environ["EP_OUTPUT_DIR"] = output_dir
    if source_dir is not None:
        os.environ["EP_SOURCE_DIR"] = source_dir
    install_stubs()
    if PIPELINE_DIR not in sys.path:
        sys.path.insert(0, PIPELINE_DIR)
    sys.modules.pop("build_lessons", None)
    return importlib.import_module("build_lessons")


class AudioPathTest(unittest.TestCase):
    def test_make_relative_audio_path(self):
        bl = import_build_lessons(tempfile.mkdtemp())
        self.assertEqual(bl.make_relative_audio_path("0001", "dg"), "audio/0001/dg.m4a")
        self.assertEqual(bl.make_relative_audio_path("0365", "pb"), "audio/0365/pb.m4a")

    def test_index_only_rewrites_audio_to_relative(self):
        source_lesson = os.path.join(PROCESSED_DIR, "lesson_0001.json")
        if not os.path.exists(source_lesson):
            self.skipTest("缺少 processed_lessons/lesson_0001.json，跳过集成用例")

        tmp_out = tempfile.mkdtemp()
        tmp_miniprogram = tempfile.mkdtemp()
        # 伪造一个源目录（含 0001 文件夹），以满足索引重建时对 all_ep_dirs 的依赖
        tmp_source = tempfile.mkdtemp()
        os.makedirs(os.path.join(tmp_source, "0001"), exist_ok=True)
        shutil.copy(source_lesson, os.path.join(tmp_out, "lesson_0001.json"))

        bl = import_build_lessons(tmp_out, source_dir=tmp_source)

        original_argv = sys.argv
        sys.argv = ["build_lessons.py", "--index-only", f"--miniprogram-dir={tmp_miniprogram}"]
        try:
            bl.main()
        finally:
            sys.argv = original_argv

        index_path = os.path.join(tmp_out, "index.json")
        self.assertTrue(os.path.exists(index_path), "应生成 index.json")

        with open(index_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)

        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["lesson_id"], "0001")
        self.assertEqual(data[0]["audio"]["dg"], "audio/0001/dg.m4a")
        self.assertEqual(data[0]["audio"]["pb"], "audio/0001/pb.m4a")
        self.assertIsNone(data[0]["audio"]["rv"])

        # --miniprogram-dir 应收到一份 index.json 副本
        self.assertTrue(os.path.exists(os.path.join(tmp_miniprogram, "index.json")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
