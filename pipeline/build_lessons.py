import glob
import json
import os
import re
import shutil
import sys
import time
import numpy as np
import stable_whisper
from stable_whisper.audio import load_audio
from parse_pdfs import BASE_DIR as _DEFAULT_BASE_DIR, clean_ligatures, parse_dialogue_pdf, parse_host_pdf

# ---------------------------------------------------------------------------
# 路径与输出配置
# ---------------------------------------------------------------------------
# ⚠️ 以下路径原为生产者本机硬编码绝对路径，现统一改为「环境变量可覆盖 + 仓库相对默认值」。
#      EP_SOURCE_DIR            原始 mp3/pdf 源目录（默认沿用 parse_pdfs.BASE_DIR）
#      EP_OUTPUT_DIR            processed_lessons 输出目录（默认 <repo>/processed_lessons）
#      EP_FLUTTER_LESSONS_DIR   可选：Flutter assets/lessons 目录（仅当显式启用 --copy-to-flutter 时使用）
_PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_PIPELINE_DIR)

BASE_DIR = os.environ.get("EP_SOURCE_DIR", _DEFAULT_BASE_DIR)
OUTPUT_DIR = os.environ.get("EP_OUTPUT_DIR", os.path.join(_REPO_ROOT, "processed_lessons"))
FLUTTER_LESSONS_DIR = os.environ.get(
    "EP_FLUTTER_LESSONS_DIR",
    os.path.join(_REPO_ROOT, "flutter_app/assets/lessons"),
)
os.makedirs(OUTPUT_DIR, exist_ok=True)


def make_relative_audio_path(lesson_id: str, track: str) -> str:
    """
    生成小程序端可用的音频「相对逻辑路径」。

    原 JSON 中 audio.{dg,pb,rv} 存的是生产者本机绝对路径，小程序完全不可用。
    这里统一改造为 `audio/{lessonId}/{track}.m4a`，与 pipeline/transcode_audio.py 的
    转码输出结构、以及小程序端 config/env.ts 的 LESSON_AUDIO_PATH_TEMPLATE 保持一致。
    """
    return f"audio/{lesson_id}/{track}.m4a"


def clean_for_alignment(text: str) -> str:
    """
    Prepare spoken query string for Whisper forced alignment without mutating display text:
    - Strip unspoken editorial notes/brackets
    - Strip duplicate parenthetical numbers like (35), (12%), (2,50), (500), (700), (20/20), (five hundred), (1500)
    - Normalize written backchannels ('Uhu' -> 'Uh huh', 'Aha' -> 'Uh huh') so Whisper's BPE tokenizer matches them
    - Strip written chuckle tokens ('Hehe', 'Haha') and '???' / transcriber timestamps
    """
    t = re.sub(r"\[(?:NOTE|Comment):.*?\]", "", text, flags=re.IGNORECASE)
    t = re.sub(r"\[([a-zA-Z]+)\]", r"\1", t)
    t = re.sub(r"\(\s*(?:\d+[\d,/%]*|five hundred|US:.*?)\s*\)", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\b(?:Uhu|Aha)\b", "Uh huh", t, flags=re.IGNORECASE)
    t = re.sub(r"\b(?:Hehe|Haha)\b[\.,!]?\s*", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\?+\s*\d{1,2}:\d{2}\b|\b\d{1,2}:\d{2}\s*\?+", "", t)
    t = t.replace("???", "").replace("??", "").replace("*", "")
    t = re.sub(r"\s+", " ", t).strip()
    return t


def compute_rms_envelope(audio: np.ndarray, sr: int = 16000, hop_sec: float = 0.01) -> np.ndarray:
    """Compute 100Hz (10ms) RMS energy envelope of 16kHz audio."""
    hop = int(sr * hop_sec)
    win = hop * 2
    if len(audio) < win:
        return np.zeros(max(1, len(audio) // max(1, hop)), dtype=np.float32)
    n_frames = (len(audio) - win) // hop + 1
    shape = (n_frames, win)
    strides = (audio.strides[0] * hop, audio.strides[0])
    frames = np.lib.stride_tricks.as_strided(audio, shape=shape, strides=strides)
    return np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)


def distribute_words_in_segment(seg: dict):
    """Ensure all words inside `seg` lie strictly within `[seg['start'], seg['end']]` with positive durations."""
    words = seg.get("words", [])
    s_start = round(float(seg["start"]), 3)
    s_end = round(float(seg["end"]), 3)
    if s_end <= s_start:
        s_end = round(s_start + 0.18, 3)
        seg["end"] = s_end
    if not words:
        return
    seg_dur = max(0.05, s_end - s_start)
    n_w = len(words)
    needs_redistribute = False
    for wi, w in enumerate(words):
        if w["end"] <= w["start"] or w["start"] < s_start - 0.05 or w["end"] > s_end + 0.05:
            needs_redistribute = True
            break
        if wi > 0 and w["start"] < words[wi - 1]["end"] - 0.02:
            needs_redistribute = True
            break

    if not needs_redistribute:
        words[0]["start"] = max(s_start, round(float(words[0]["start"]), 3))
        words[-1]["end"] = min(s_end, round(float(words[-1]["end"]), 3))
        if any(w["end"] <= w["start"] for w in words):
            needs_redistribute = True

    if needs_redistribute:
        weights = [max(1, len(w.get("word", ""))) for w in words]
        total_w = sum(weights)
        cur = s_start
        for wi, w in enumerate(words):
            dur = seg_dur * (weights[wi] / total_w)
            w["start"] = round(cur, 3)
            cur = s_end if wi == n_w - 1 else cur + dur
            w["end"] = round(max(w["start"] + 0.015, cur), 3)


def refine_segments_with_audio(
    model,
    mp3_path: str,
    segments: list[dict],
    preloaded_audio: np.ndarray | None = None,
) -> list[dict]:
    """
    1. Resolves any zero-duration or anomalously compressed segments strictly inside `[prev_end, next_start]`
       (with local window Whisper re-alignment for multi-word spans and RMS speech-island placement for short spans).
    2. Tightens segment onsets (`start`) to the true acoustic speech onset using 10ms RMS energy.
    3. Guarantees 100% strict monotonicity and zero overlap (`seg[i]['end'] <= seg[i+1]['start']`).
    """
    n = len(segments)
    if n == 0:
        return segments

    audio = preloaded_audio if preloaded_audio is not None else load_audio(mp3_path, sr=16000)
    audio_dur = len(audio) / 16000.0
    rms = compute_rms_envelope(audio, sr=16000, hop_sec=0.01)
    silence_thresh = float(np.percentile(rms, 22)) if len(rms) > 10 else 0.008
    speech_thresh = max(silence_thresh * 2.2, float(np.percentile(rms, 45)) * 0.55, 0.012)

    # Pre-step: Fix HEAD JUMPs and TAIL JUMPs where first/last words of a sentence jumped across a drum jingle or sound effect
    for idx_s, seg in enumerate(segments):
        words = seg.get("words", [])
        if not words:
            continue
        prev_e = segments[idx_s - 1]["end"] if idx_s > 0 else 0.0
        txt_lower = seg.get("text", "").strip().lower()
        is_short_header = bool(
            re.match(r"^(?:example\s+\w+|language\s+takeaway|putting\s+it\s+together|fluency\s+builder|vocabulary\s+preview)[\.!:]?$", txt_lower)
        )

        if is_short_header and len(words) >= 2 and (words[-1]["start"] - words[0]["end"]) > 1.0:
            cur_t = round(float(words[0]["end"]), 3)
            for w in words[1:]:
                w["start"] = cur_t
                cur_t = round(cur_t + 0.38, 3)
                w["end"] = cur_t
            seg["end"] = words[-1]["end"]
        else:
            # 1) Fix HEAD JUMP: first 1-2 words jumped backwards across a jingle/intro music (> 2.0s before the rest of the sentence)
            if len(words) >= 3 and (words[2]["start"] - words[1]["end"]) > 2.2:
                anchor_t = float(words[2]["start"])
                words[1]["end"] = round(anchor_t, 3)
                words[1]["start"] = round(max(prev_e, anchor_t - 0.32), 3)
                words[0]["end"] = words[1]["start"]
                words[0]["start"] = round(max(prev_e, words[1]["start"] - 0.32), 3)
                seg["start"] = words[0]["start"]
            elif len(words) >= 2 and (words[1]["start"] - words[0]["end"]) > 2.0:
                anchor_t = float(words[1]["start"])
                words[0]["end"] = round(anchor_t, 3)
                words[0]["start"] = round(max(prev_e, anchor_t - 0.36), 3)
                seg["start"] = words[0]["start"]

            # 2) Fix TAIL JUMP: last 1-2 words jumped forwards across a jingle/sound effect (> 1.8s after the rest of the sentence)
            if len(words) >= 3 and (words[-2]["start"] - words[-3]["end"]) > 2.0:
                anchor_e = float(words[-3]["end"])
                words[-2]["start"] = round(anchor_e, 3)
                words[-2]["end"] = round(anchor_e + 0.34, 3)
                words[-1]["start"] = words[-2]["end"]
                words[-1]["end"] = round(words[-2]["end"] + 0.36, 3)
                seg["end"] = words[-1]["end"]
            elif len(words) >= 2 and (words[-1]["start"] - words[-2]["end"]) > 1.8:
                anchor_e = float(words[-2]["end"])
                words[-1]["start"] = round(anchor_e, 3)
                words[-1]["end"] = round(anchor_e + 0.38, 3)
                seg["end"] = words[-1]["end"]

        # 3) Cap any abnormally stretched final word (> 1.35s duration)
        if words and (seg["end"] - seg["start"]) > 1.8:
            last_w = words[-1]
            if (last_w["end"] - last_w["start"]) > 1.35:
                last_w["end"] = round(last_w["start"] + 0.55, 3)
                seg["end"] = last_w["end"]

    def is_anomalous(idx: int) -> bool:
        s = segments[idx]
        dur = s["end"] - s["start"]
        n_words = len(s.get("align_text", s.get("text", "")).split())
        if dur <= 0.05:
            return True
        if n_words >= 4 and dur < max(0.45, 0.11 * n_words):
            return True
        if idx > 0 and s["start"] < segments[idx - 1]["end"] - 0.02:
            return True
        return False

    # Step 1: Identify contiguous runs of anomalous segments and resolve them strictly inside [prev_end, next_start]
    i = 0
    while i < n:
        if not is_anomalous(i):
            i += 1
            continue
        j = i
        while j + 1 < n and is_anomalous(j + 1):
            j += 1

        while True:
            prev_end = segments[i - 1]["end"] if i > 0 else 0.0
            next_start = segments[j + 1]["start"] if j + 1 < n else audio_dur
            min_needed = sum(
                max(0.28, 0.16 * max(1, len(segments[k].get("align_text", segments[k].get("text", "")).split())))
                for k in range(i, j + 1)
            )
            expanded = False
            if (next_start - prev_end) < min_needed * 1.35:
                if i > 0 and (segments[i - 1]["end"] - segments[i - 1]["start"]) < 0.95:
                    i -= 1
                    expanded = True
                elif j + 1 < n and (segments[j + 1]["end"] - segments[j + 1]["start"]) < 0.95:
                    j += 1
                    expanded = True
            if not expanded:
                break

        prev_end = segments[i - 1]["end"] if i > 0 else 0.0
        next_start = segments[j + 1]["start"] if j + 1 < n else audio_dur

        count = j - i + 1
        min_needed = sum(
            max(0.24, 0.14 * max(1, len(segments[k].get("align_text", segments[k].get("text", "")).split())))
            for k in range(i, j + 1)
        )

        if next_start - prev_end < min_needed:
            if i > 0:
                prev_seg = segments[i - 1]
                prev_words = max(1, len(prev_seg.get("align_text", prev_seg.get("text", "")).split()))
                prev_min_dur = max(0.30, 0.18 * prev_words)
                avail_from_prev = max(0.0, (prev_seg["end"] - prev_seg["start"]) - prev_min_dur)
                borrow_prev = min(avail_from_prev * 0.75, max(0.0, min_needed - (next_start - prev_end)))
                if borrow_prev > 0.05:
                    prev_seg["end"] = round(prev_seg["end"] - borrow_prev, 3)
                    distribute_words_in_segment(prev_seg)
                    prev_end = prev_seg["end"]

            if next_start - prev_end < min_needed and j + 1 < n:
                next_seg = segments[j + 1]
                next_words = max(1, len(next_seg.get("align_text", next_seg.get("text", "")).split()))
                next_min_dur = max(0.30, 0.18 * next_words)
                avail_from_next = max(0.0, (next_seg["end"] - next_seg["start"]) - next_min_dur)
                borrow_next = min(avail_from_next * 0.75, max(0.0, min_needed - (next_start - prev_end)))
                if borrow_next > 0.05:
                    next_seg["start"] = round(next_seg["start"] + borrow_next, 3)
                    distribute_words_in_segment(next_seg)
                    next_start = next_seg["start"]

        win_start = max(0.0, prev_end)
        win_end = max(win_start + 0.18 * count, min(audio_dur, next_start))
        if j + 1 < n and segments[j + 1]["start"] < win_end:
            segments[j + 1]["start"] = round(win_end, 3)
            if segments[j + 1]["end"] <= segments[j + 1]["start"]:
                segments[j + 1]["end"] = round(segments[j + 1]["start"] + 0.25, 3)
            distribute_words_in_segment(segments[j + 1])

        total_words_in_span = sum(
            len(segments[k].get("align_text", segments[k].get("text", "")).split()) for k in range(i, j + 1)
        )

        # Try local window re-alignment if span has >= 4 words and window >= 1.4s and count <= 14
        realigned_ok = False
        if total_words_in_span >= 4 and (win_end - win_start) >= 1.4 and count <= 14:
            try:
                s_sample = int(win_start * 16000)
                e_sample = int(win_end * 16000)
                local_audio = audio[s_sample:e_sample]
                local_texts = [segments[k].get("align_text") or segments[k]["text"] for k in range(i, j + 1)]
                local_res = model.align(
                    local_audio,
                    "\n".join(local_texts),
                    language="en",
                    original_split=True,
                )
                if len(local_res.segments) == count:
                    multi_ok = all(
                        (ls.end - ls.start) >= 0.28
                        for offset_k, ls in enumerate(local_res.segments)
                        if len(segments[i + offset_k].get("align_text", segments[i + offset_k].get("text", "")).split()) >= 4
                    )
                    if multi_ok:
                        for offset_k, ls in enumerate(local_res.segments):
                            seg_k = segments[i + offset_k]
                            seg_k["start"] = round(win_start + float(ls.start), 3)
                            seg_k["end"] = round(win_start + float(ls.end), 3)
                            seg_k["words"] = [
                                {
                                    "word": w.word.strip(),
                                    "start": round(win_start + float(w.start), 3),
                                    "end": round(win_start + float(w.end), 3),
                                }
                                for w in ls.words
                                if w.word.strip()
                            ]
                            distribute_words_in_segment(seg_k)
                        realigned_ok = True
            except Exception:
                realigned_ok = False

        if not realigned_ok:
            f0 = max(0, min(len(rms) - 1, int(win_start * 100)))
            f1 = max(f0 + 1, min(len(rms), int(win_end * 100)))
            sub_rms = rms[f0:f1]
            active_idx = np.where(sub_rms >= silence_thresh * 1.35)[0]
            if len(active_idx) >= 4:
                island_start = max(win_start, (f0 + int(active_idx[0]) - 2) * 0.01)
                island_end = min(win_end, (f0 + int(active_idx[-1]) + 3) * 0.01)
                if island_end - island_start >= 0.16 * count:
                    win_start, win_end = island_start, island_end

            weights = [
                max(1.0, len(segments[k].get("align_text", segments[k].get("text", "")).split()) * 1.0 + 0.25 * len(segments[k]["text"]))
                for k in range(i, j + 1)
            ]
            total_w = sum(weights)
            span_dur = max(0.16 * count, win_end - win_start)
            cur = win_start
            for k in range(i, j + 1):
                w_share = span_dur * (weights[k - i] / total_w)
                segments[k]["start"] = round(cur, 3)
                cur = win_end if k == j else cur + w_share
                segments[k]["end"] = round(max(segments[k]["start"] + 0.14, cur), 3)
                distribute_words_in_segment(segments[k])

        i = j + 1

    # Step 2: Acoustic Voice Onset Tightening using 10ms RMS envelope
    for idx in range(n):
        seg = segments[idx]
        prev_end = segments[idx - 1]["end"] if idx > 0 else 0.0
        s_sec = seg["start"]
        e_sec = seg["end"]
        dur = e_sec - s_sec
        if dur <= 0.22:
            continue

        gap_before = s_sec - prev_end
        if gap_before >= 0.14:
            look_back_sec = max(prev_end + 0.04, s_sec - min(0.18, gap_before - 0.04))
            fb0 = max(0, min(len(rms) - 1, int(look_back_sec * 100)))
            fb1 = max(fb0 + 1, min(len(rms), int(s_sec * 100)))
            if fb1 > fb0 + 2:
                pre_rms = rms[fb0:fb1]
                if pre_rms[0] < speech_thresh * 0.85:
                    rising = np.where(pre_rms >= speech_thresh)[0]
                    if len(rising) > 0:
                        onset_frame = fb0 + int(rising[0])
                        new_start = max(prev_end + 0.02, (onset_frame - 2) * 0.01)
                        if new_start < s_sec - 0.02:
                            seg["start"] = round(new_start, 3)
                            if seg.get("words"):
                                seg["words"][0]["start"] = seg["start"]

        s_sec = seg["start"]
        fs0 = max(0, min(len(rms) - 1, int(s_sec * 100)))
        fs1 = max(fs0 + 1, min(len(rms), int(min(e_sec - 0.18, s_sec + 0.35) * 100)))
        if fs1 - fs0 >= 9:
            lead_rms = rms[fs0:fs1]
            if np.max(lead_rms[:6]) < silence_thresh * 1.15:
                voiced = np.where(lead_rms >= speech_thresh * 0.85)[0]
                if len(voiced) > 0 and int(voiced[0]) >= 6:
                    trimmed_start = (fs0 + int(voiced[0]) - 2) * 0.01
                    if trimmed_start < e_sec - 0.20:
                        seg["start"] = round(trimmed_start, 3)
                        if seg.get("words"):
                            seg["words"][0]["start"] = seg["start"]

    # Step 3: Final Strict Monotonicity & Non-Overlap Guarantee
    for idx in range(n):
        seg = segments[idx]
        if idx > 0 and seg["start"] < segments[idx - 1]["end"]:
            mid = round((segments[idx - 1]["end"] + seg["start"]) / 2.0, 3)
            if mid > segments[idx - 1]["start"] + 0.12 and mid < seg["end"] - 0.12:
                segments[idx - 1]["end"] = mid
                distribute_words_in_segment(segments[idx - 1])
                seg["start"] = mid
            else:
                seg["start"] = round(segments[idx - 1]["end"], 3)
        if seg["end"] <= seg["start"] + 0.10:
            next_lim = segments[idx + 1]["start"] if idx + 1 < n else audio_dur
            seg["end"] = round(max(seg["start"] + 0.14, min(next_lim, seg["start"] + 0.30)), 3)
            if idx + 1 < n and segments[idx + 1]["start"] < seg["end"]:
                segments[idx + 1]["start"] = seg["end"]
        distribute_words_in_segment(seg)
        if "align_text" in seg:
            del seg["align_text"]

    return segments


def align_turns(model, mp3_path: str, turns: list[dict]) -> list[dict]:
    """Align spoken turns with `mp3_path` using `whisper-base.en-mlx` + acoustic envelope refinement."""
    spoken_indices = []
    spoken_align_texts = []
    pure_laugh_indices = set()

    for idx, t in enumerate(turns):
        if not t.get("is_section"):
            cleaned = clean_for_alignment(t["text"])
            if not cleaned:
                pure_laugh_indices.add(idx)
            else:
                spoken_indices.append(idx)
                spoken_align_texts.append(cleaned)

    joined_text = "\n".join(spoken_align_texts)
    res = model.align(mp3_path, joined_text, language="en", original_split=True)

    aligned_by_turn = {}
    for seg_idx, seg in enumerate(res.segments):
        if seg_idx >= len(spoken_indices):
            break
        turn_idx = spoken_indices[seg_idx]
        turn_meta = turns[turn_idx]
        orig_words = turn_meta.get("text", "").split()
        words = [
            {
                "word": w.word.strip(),
                "start": round(float(w.start), 3),
                "end": round(float(w.end), 3),
            }
            for w in seg.words
            if w.word.strip()
        ]
        if not words and orig_words:
            words = [{"word": ow, "start": round(float(seg.start), 3), "end": round(float(seg.end), 3)} for ow in orig_words]
        aligned_by_turn[turn_idx] = {
            "turn_idx": turn_idx,
            "speaker": turn_meta.get("speaker", ""),
            "text": turn_meta.get("text", seg.text.strip()),
            "align_text": spoken_align_texts[seg_idx],
            "is_section": False,
            "in_dialogue_block": bool(turn_meta.get("in_dialogue_block", False)),
            "start": round(float(seg.start), 3),
            "end": round(float(seg.end), 3),
            "words": words,
        }

    all_spoken = []
    for idx, t in enumerate(turns):
        if t.get("is_section"):
            continue
        if idx in aligned_by_turn:
            all_spoken.append(aligned_by_turn[idx])
        elif idx in pure_laugh_indices:
            prev_ts = all_spoken[-1]["end"] if all_spoken else 0.0
            all_spoken.append({
                "turn_idx": idx,
                "speaker": t.get("speaker", ""),
                "text": t.get("text", "Hehe."),
                "align_text": "Hehe",
                "is_section": False,
                "in_dialogue_block": bool(t.get("in_dialogue_block", False)),
                "start": prev_ts,
                "end": prev_ts,
                "words": [{"word": t.get("text", "Hehe."), "start": prev_ts, "end": prev_ts}],
            })

    all_spoken = refine_segments_with_audio(model, mp3_path, all_spoken)
    spoken_by_turn = {item["turn_idx"]: item for item in all_spoken}

    final_segments = []
    for idx, t in enumerate(turns):
        if idx in spoken_by_turn:
            item = spoken_by_turn[idx]
            item["id"] = len(final_segments)
            del item["turn_idx"]
            final_segments.append(item)
        else:
            next_spoken = None
            for lookahead in range(idx + 1, len(turns)):
                if lookahead in spoken_by_turn:
                    next_spoken = spoken_by_turn[lookahead]
                    break
            ts = next_spoken["start"] if next_spoken else (final_segments[-1]["end"] if final_segments else 0.0)
            final_segments.append({
                "id": len(final_segments),
                "speaker": "SECTION",
                "text": t["text"],
                "is_section": True,
                "in_dialogue_block": False,
                "start": ts,
                "end": ts,
                "words": [],
            })

    return final_segments


def estimate_pitch_hz(audio_slice: np.ndarray, sr: int = 16000) -> float:
    """Fast autocorrelation fundamental pitch (F0) estimator to distinguish Male (Marco ~115Hz) vs Female (Catherine/Erica ~205Hz)."""
    if len(audio_slice) < 800:
        return 140.0
    win = 640   # 40ms
    hop = 320   # 20ms
    n_f = (len(audio_slice) - win) // hop + 1
    if n_f <= 0:
        return 140.0
    f0s = []
    min_lag = int(sr / 300)  # 300 Hz max
    max_lag = int(sr / 75)   # 75 Hz min
    step = max(1, n_f // 35)
    for i in range(0, n_f, step):
        frame = audio_slice[i * hop : i * hop + win].astype(np.float32)
        frame = frame - np.mean(frame)
        energy = np.mean(frame ** 2)
        if energy < 1.2e-4:
            continue
        corr = np.correlate(frame, frame, mode="full")[win - 1 :]
        if max_lag < len(corr):
            sub = corr[min_lag:max_lag]
            if len(sub) > 0:
                lag = min_lag + int(np.argmax(sub))
                if corr[lag] > 0.35 * corr[0]:
                    f0s.append(sr / lag)
    return float(np.median(f0s)) if f0s else 140.0


def _is_voice_header(txt: str) -> bool:
    tl = txt.strip().lower()
    return bool(
        re.match(
            r"^(?:example\s+(?:one|two|three|four|five|1|2|3|4|5)|language\s+takeaway|putting\s+it\s+together|fluency\s+builder|vocabulary\s+preview)[\.!:\?]?$",
            tl,
        )
    )


def transcribe_and_splice_pb(
    model,
    pb_mp3: str,
    dialogue_turns: list[dict],
    dg_dur_hint: float = 60.0,
) -> list[dict]:
    """
    For episodes without a standalone host PDF in 主持人对话文本/:
    1. Transcribe `pb_mp3` with MLX Whisper (`word_timestamps=True`).
    2. Detect the 1-3 dialogue playback spans inside `pb_mp3` and align the ground-truth `dialogue_turns`
       directly onto those audio slices (`in_dialogue_block: True`) with `DIALOGUE, FIRST/SECOND/THIRD TIME` section headers.
    3. Merge sub-sentence Whisper fragments into natural sentences, classify announcer headers (`Voice`),
       example sentences (`A`), and host turns (`M` vs `C`/`E` via fundamental pitch F0).
    4. Run `refine_segments_with_audio` across all spoken segments for 100% monotonic, non-overlapping timestamps.
    """
    audio = load_audio(pb_mp3, sr=16000)
    audio_dur = len(audio) / 16000.0
    res = model.transcribe(pb_mp3, language="en", word_timestamps=True)
    raw_segs = [s for s in res.segments if s.text and s.text.strip()]
    if not raw_segs:
        return []

    intro_txt = " ".join(s.text for s in raw_segs[:12]).lower()
    female_spk = "C"
    if "erica" in intro_txt:
        female_spk = "E"
    elif "amira" in intro_txt:
        female_spk = "A"
    elif "sarah" in intro_txt:
        female_spk = "S"

    dlg_full_text = " ".join(d["text"] for d in dialogue_turns)
    dlg_words_list = re.findall(r"[a-z0-9']+", dlg_full_text.lower())
    dlg_vocab_set = set(w for w in dlg_words_list if len(w) >= 3)
    first_chunk_text = " ".join(d["text"] for d in dialogue_turns[:2]) if dialogue_turns else ""
    last_chunk_text = " ".join(d["text"] for d in dialogue_turns[-2:]) if dialogue_turns else ""
    first_turn_words = set(w for w in re.findall(r"[a-z0-9']+", first_chunk_text.lower()) if len(w) >= 2)
    last_turn_words = set(w for w in re.findall(r"[a-z0-9']+", last_chunk_text.lower()) if len(w) >= 2)

    n_raw = len(raw_segs)
    seg_words = [set(re.findall(r"[a-z0-9']+", s.text.lower())) for s in raw_segs]

    spans = []
    if dlg_vocab_set and len(dialogue_turns) >= 1:
        used = np.zeros(n_raw, dtype=bool)
        for _ in range(3):
            best_score = 0.0
            best_span = None
            for i in range(1, n_raw):
                if used[i]:
                    continue
                prev_txt = " ".join(raw_segs[k].text.lower() for k in range(max(0, i - 3), i))
                has_cue = any(
                    c in prev_txt
                    for c in ("dialogue", "listen", "first time", "second time", "third time", "last time", "one more time", "again")
                )
                gap_before = raw_segs[i].start - raw_segs[i - 1].end
                first_overlap = len(seg_words[i] & first_turn_words) / max(1, len(first_turn_words))
                first_pair_overlap = len(
                    set().union(*seg_words[i : min(n_raw, i + 3)]) & first_turn_words
                ) / max(1, len(first_turn_words))
                if not has_cue and gap_before < 0.8 and first_overlap < 0.25 and first_pair_overlap < 0.35:
                    continue
                if first_overlap < 0.18 and first_pair_overlap < 0.30:
                    continue

                for j in range(i, n_raw):
                    if used[j]:
                        break
                    span_dur = raw_segs[j].end - raw_segs[i].start
                    if span_dur < max(8.0, dg_dur_hint * 0.40):
                        continue
                    if span_dur > max(240.0, dg_dur_hint * 1.95):
                        break
                    last_w = set().union(*seg_words[max(i, j - 2) : j + 1])
                    last_overlap = len(last_w & last_turn_words) / max(1, len(last_turn_words))
                    if last_overlap < 0.22:
                        continue
                    union_w = set().union(*seg_words[i : j + 1])
                    cov = len(union_w & dlg_vocab_set) / max(1, len(dlg_vocab_set))
                    score = cov * 0.6 + max(first_overlap, first_pair_overlap) * 0.2 + last_overlap * 0.2 + (0.1 if has_cue else 0.0)
                    if cov >= 0.45 and score > best_score:
                        best_score = score
                        best_span = (i, j)
            if best_span:
                bi, bj = best_span
                used[max(0, bi - 2) : min(n_raw, bj + 3)] = True
                spans.append(best_span)
            else:
                break
        spans.sort(key=lambda x: x[0])

    span_by_start = {s[0]: s[1] for s in spans}
    section_names = ["DIALOGUE, FIRST TIME", "DIALOGUE, SECOND TIME", "DIALOGUE, THIRD TIME"]

    def convert_host_chunk(chunk_segs: list) -> list[dict]:
        # Merge sub-sentence Whisper fragments where gap < 0.42s and first doesn't end with .?!
        merged = []
        for s in chunk_segs:
            txt = clean_ligatures(s.text.strip())
            if not txt:
                continue
            words = [
                {"word": clean_ligatures(w.word.strip()), "start": round(float(w.start), 3), "end": round(float(w.end), 3)}
                for w in getattr(s, "words", [])
                if w.word and w.word.strip()
            ]
            if not words:
                words = [{"word": w, "start": round(float(s.start), 3), "end": round(float(s.end), 3)} for w in txt.split()]
            item = {
                "start": round(float(s.start), 3),
                "end": round(float(s.end), 3),
                "text": txt,
                "words": words,
            }
            if (
                merged
                and not _is_voice_header(merged[-1]["text"])
                and not _is_voice_header(txt)
                and not merged[-1]["text"].endswith((".", "?", "!"))
                and (item["start"] - merged[-1]["end"]) < 0.42
                and len(merged[-1]["words"]) + len(item["words"]) <= 28
            ):
                merged[-1]["text"] = f"{merged[-1]['text']} {item['text']}".strip()
                merged[-1]["end"] = item["end"]
                merged[-1]["words"].extend(item["words"])
            else:
                merged.append(item)

        out_turns = []
        prev_was_example_header = False
        for m_seg in merged:
            txt = m_seg["text"]
            # Normalize "English pod" -> "EnglishPod"
            txt = re.sub(r"\bEnglish\s+[Pp]od\b", "EnglishPod", txt)
            m_seg["text"] = txt
            if _is_voice_header(txt):
                spk = "Voice"
                prev_was_example_header = txt.lower().startswith("example")
            elif prev_was_example_header:
                spk = "A"
                prev_was_example_header = False
            else:
                prev_was_example_header = False
                tl = txt.lower()
                if "my name is marco" in tl or "i'm marco" in tl:
                    spk = "M"
                elif any(p in tl for p in ("my name is catherine", "i'm catherine", "my name is erica", "i'm erica")):
                    spk = female_spk
                else:
                    s_idx = max(0, int(m_seg["start"] * 16000))
                    e_idx = min(len(audio), int(m_seg["end"] * 16000))
                    f0 = estimate_pitch_hz(audio[s_idx:e_idx], sr=16000)
                    spk = "M" if f0 < 162.0 else female_spk

            out_turns.append({
                "speaker": spk,
                "text": txt,
                "align_text": clean_for_alignment(txt),
                "is_section": False,
                "in_dialogue_block": False,
                "start": m_seg["start"],
                "end": m_seg["end"],
                "words": m_seg["words"],
            })
        return out_turns

    assembled_items = []
    idx = 0
    span_ord = 0
    while idx < n_raw:
        if idx in span_by_start:
            end_idx = span_by_start[idx]
            sec_label = section_names[min(span_ord, len(section_names) - 1)]
            span_ord += 1

            t_win_start = max(0.0, float(raw_segs[idx].start) - 0.35)
            if assembled_items and not assembled_items[-1].get("is_section"):
                t_win_start = max(t_win_start, assembled_items[-1]["end"] + 0.05)
            t_win_end = min(audio_dur, float(raw_segs[end_idx].end) + 0.35)
            if end_idx + 1 < n_raw:
                t_win_end = min(t_win_end, float(raw_segs[end_idx + 1].start) - 0.05)

            spliced_ok = False
            if t_win_end - t_win_start >= 5.0 and dialogue_turns:
                try:
                    slice_audio = audio[int(t_win_start * 16000) : int(t_win_end * 16000)]
                    dlg_align_texts = [clean_for_alignment(d["text"]) or d["text"] for d in dialogue_turns]
                    dlg_res = model.align(
                        slice_audio,
                        "\n".join(dlg_align_texts),
                        language="en",
                        original_split=True,
                    )
                    if len(dlg_res.segments) == len(dialogue_turns):
                        sec_ts = round(t_win_start + float(dlg_res.segments[0].start), 3)
                        assembled_items.append({
                            "speaker": "SECTION",
                            "text": sec_label,
                            "is_section": True,
                            "in_dialogue_block": False,
                            "start": sec_ts,
                            "end": sec_ts,
                            "words": [],
                        })
                        for d_meta, d_seg, a_txt in zip(dialogue_turns, dlg_res.segments, dlg_align_texts):
                            w_list = [
                                {
                                    "word": w.word.strip(),
                                    "start": round(t_win_start + float(w.start), 3),
                                    "end": round(t_win_start + float(w.end), 3),
                                }
                                for w in d_seg.words
                                if w.word.strip()
                            ]
                            if not w_list:
                                w_list = [
                                    {
                                        "word": ow,
                                        "start": round(t_win_start + float(d_seg.start), 3),
                                        "end": round(t_win_start + float(d_seg.end), 3),
                                    }
                                    for ow in d_meta["text"].split()
                                ]
                            assembled_items.append({
                                "speaker": d_meta["speaker"],
                                "text": d_meta["text"],
                                "align_text": a_txt,
                                "is_section": False,
                                "in_dialogue_block": True,
                                "start": round(t_win_start + float(d_seg.start), 3),
                                "end": round(t_win_start + float(d_seg.end), 3),
                                "words": w_list,
                            })
                        spliced_ok = True
                except Exception:
                    spliced_ok = False

            if not spliced_ok:
                assembled_items.extend(convert_host_chunk(raw_segs[idx : end_idx + 1]))
            idx = end_idx + 1
        else:
            next_span_idx = min([s_start for s_start in span_by_start if s_start > idx], default=n_raw)
            assembled_items.extend(convert_host_chunk(raw_segs[idx:next_span_idx]))
            idx = next_span_idx

    # Refine all spoken segments while preserving section markers at the start of their dialogue blocks
    spoken_only = []
    for pos, item in enumerate(assembled_items):
        if not item.get("is_section"):
            item["_pos"] = pos
            spoken_only.append(item)

    spoken_only = refine_segments_with_audio(model, pb_mp3, spoken_only, preloaded_audio=audio)
    spoken_by_pos = {item["_pos"]: item for item in spoken_only}

    final_segments = []
    for pos, item in enumerate(assembled_items):
        if pos in spoken_by_pos:
            s_item = spoken_by_pos[pos]
            del s_item["_pos"]
            s_item["id"] = len(final_segments)
            final_segments.append(s_item)
        else:
            next_ts = item["start"]
            for look in range(pos + 1, len(assembled_items)):
                if look in spoken_by_pos:
                    next_ts = spoken_by_pos[look]["start"]
                    break
            final_segments.append({
                "id": len(final_segments),
                "speaker": "SECTION",
                "text": item["text"],
                "is_section": True,
                "in_dialogue_block": False,
                "start": next_ts,
                "end": next_ts,
                "words": [],
            })

    return final_segments


def parse_title_meta(raw_title: str, lesson_num: int):
    # Handle both "Elementary - Daily Life - Title (C0206)" and "Daily Life - Title (C0158)"
    m3 = re.match(r"^(.*?)\s*-\s*(.*?)\s*-\s*(.*?)(?:\s*\(([A-Z]\d{4})\))?$", raw_title)
    if m3:
        level = m3.group(1).strip()
        title = f"{m3.group(2).strip()} - {m3.group(3).strip()}"
        code = m3.group(4) or f"C{lesson_num:04d}"
        return level, title, code

    m = re.match(r"^(.*?)\s*-\s*(.*?)(?:\s*\(([A-Z]\d{4})\))?$", raw_title)
    if m:
        part1 = m.group(1).strip()
        part2 = m.group(2).strip()
        code = m.group(3) or f"C{lesson_num:04d}"
        if part1 in ("Elementary", "Intermediate", "Upper Intermediate", "Advanced", "Beginner"):
            level = part1
            title = part2
        else:
            level_map = {
                "B": "Elementary",
                "C": "Intermediate",
                "D": "Upper Intermediate",
                "E": "Advanced",
                "F": "Advanced Media",
            }
            level = level_map.get(code[0], "Intermediate")
            title = f"{part1} - {part2}"
    else:
        level = "Intermediate"
        title = raw_title
        code = f"C{lesson_num:04d}"
    return level, title, code


def main():
    t0 = time.time()
    force_all = "--force" in sys.argv
    index_only = "--index-only" in sys.argv
    # 是否把产物复制到 Flutter assets/lessons（默认关闭，消除历史遗留的 205MB 重复副本）
    copy_to_flutter = "--copy-to-flutter" in sys.argv
    miniprogram_dir = None
    start_ep = 1
    end_ep = 9999
    specific_eps = None
    for arg in sys.argv[1:]:
        if arg.startswith("--start="):
            start_ep = int(arg.split("=", 1)[1])
        elif arg.startswith("--end="):
            end_ep = int(arg.split("=", 1)[1])
        elif arg.startswith("--eps="):
            specific_eps = set(int(x) for x in arg.split("=", 1)[1].split(",") if x.strip())
        elif arg.startswith("--miniprogram-dir="):
            miniprogram_dir = arg.split("=", 1)[1]

    # 复制目标目录集合：默认为空（不复制），仅在显式开关下才写入
    copy_targets = []
    if copy_to_flutter:
        os.makedirs(FLUTTER_LESSONS_DIR, exist_ok=True)
        copy_targets.append(FLUTTER_LESSONS_DIR)
    if miniprogram_dir:
        os.makedirs(miniprogram_dir, exist_ok=True)
        copy_targets.append(miniprogram_dir)

    all_ep_dirs = {}
    for p in glob.glob(f"{BASE_DIR}/**/[0-9][0-9][0-9][0-9]", recursive=True):
        if os.path.isdir(p):
            all_ep_dirs[int(os.path.basename(p))] = p

    host_map = {}
    for p in glob.glob(f"{BASE_DIR}/主持人对话文本/*.pdf"):
        m = re.match(r"^(\d+)", os.path.basename(p))
        if m:
            host_map[int(m.group(1))] = p

    if specific_eps is not None:
        target_eps = [ep for ep in sorted(all_ep_dirs.keys()) if ep in specific_eps]
    else:
        target_eps = [ep for ep in sorted(all_ep_dirs.keys()) if start_ep <= ep <= end_ep]
    total_eps = len(target_eps)
    model = None
    if not index_only:
        print(f"Loading MLX Whisper model (mlx-community/whisper-base.en-mlx) for {total_eps} episodes ({start_ep}..{end_ep})...", flush=True)
        model = stable_whisper.load_mlx_whisper("mlx-community/whisper-base.en-mlx")

    for idx_ep, i in enumerate(target_eps, start=1):
        lt0 = time.time()
        folder = all_ep_dirs[i]
        out_path = os.path.join(OUTPUT_DIR, f"lesson_{i:04d}.json")

        if index_only or (not force_all and os.path.exists(out_path)):
            try:
                with open(out_path, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                if cached.get("tracks", {}).get("dg") and cached.get("tracks", {}).get("pb"):
                    for target_dir in copy_targets:
                        target_path = os.path.join(target_dir, f"lesson_{i:04d}.json")
                        if not os.path.exists(target_path):
                            shutil.copy2(out_path, target_path)
                    if not index_only:
                        print(f"[{idx_ep:03d}/{total_eps}] {cached['code']} {cached['title']}: cached (dg={len(cached['tracks']['dg'])}, pb={len(cached['tracks']['pb'])})", flush=True)
                    continue
            except Exception:
                if index_only:
                    continue

        pdfs = [x for x in glob.glob(f"{folder}/*.pdf") if "intro" not in os.path.basename(x).lower()]
        dlg_pdf = pdfs[0] if pdfs else ""
        dg_mp3_list = glob.glob(f"{folder}/*dg.mp3")
        pb_mp3_list = glob.glob(f"{folder}/*pb.mp3")
        rv_mp3_list = glob.glob(f"{folder}/*rv.mp3")

        dg_mp3 = dg_mp3_list[0] if dg_mp3_list else ""
        pb_mp3 = pb_mp3_list[0] if pb_mp3_list else ""
        rv_mp3 = rv_mp3_list[0] if rv_mp3_list else ""

        raw_title, dlgs, vocab = parse_dialogue_pdf(dlg_pdf, ep_num=i)
        level, clean_title, code = parse_title_meta(raw_title, i)

        dg_segments = align_turns(model, dg_mp3, dlgs) if dg_mp3 else []
        dg_dur_hint = (dg_segments[-1]["end"] - dg_segments[0]["start"]) if dg_segments else 60.0

        if i in host_map and pb_mp3:
            host_turns = parse_host_pdf(host_map[i], dlgs)
            for ht in host_turns:
                if ht.get("is_section") and not ht["text"].upper().startswith("DIALOGUE"):
                    ht["is_section"] = False
                    ht["speaker"] = "Voice"
            pb_segments = align_turns(model, pb_mp3, host_turns)
            mode_str = "host_pdf"
        elif pb_mp3:
            pb_segments = transcribe_and_splice_pb(model, pb_mp3, dlgs, dg_dur_hint=dg_dur_hint)
            mode_str = "mlx_whisper"
        else:
            pb_segments = []
            mode_str = "none"

        lesson_data = {
            "lesson_number": i,
            "LessonId": f"{i:04d}",
            "code": code,
            "level": level,
            "title": clean_title,
            "raw_title": raw_title,
            "audio": {
                # ⚠️ 改造为相对逻辑路径（小程序端可用）；rv 本期不上传，置为 None
                "dg": make_relative_audio_path(f"{i:04d}", "dg") if dg_mp3 else None,
                "pb": make_relative_audio_path(f"{i:04d}", "pb") if pb_mp3 else None,
                "rv": None,
            },
            "vocabulary": vocab,
            "tracks": {
                "dg": dg_segments,
                "pb": pb_segments,
            },
        }

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(lesson_data, f, ensure_ascii=False, indent=2)
        for target_dir in copy_targets:
            shutil.copy2(out_path, os.path.join(target_dir, f"lesson_{i:04d}.json"))

        print(
            f"[{idx_ep:03d}/{total_eps}] {code} {clean_title} ({mode_str}): "
            f"dg={len(dg_segments)}, pb={len(pb_segments)}, vocab={len(vocab)} ({time.time()-lt0:.1f}s)",
            flush=True,
        )

    # Rebuild index.json from all completed lesson_XXXX.json files if running full or index-only
    if start_ep == 1 and end_ep >= 365 or index_only:
        index_list = []
        for i in sorted(all_ep_dirs.keys()):
            out_path = os.path.join(OUTPUT_DIR, f"lesson_{i:04d}.json")
            if os.path.exists(out_path):
                with open(out_path, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                index_list.append({
                    "lesson_number": i,
                    "lesson_id": f"{i:04d}",
                    "code": cached["code"],
                    "level": cached["level"],
                    "title": cached["title"],
                    "dg_count": len(cached["tracks"]["dg"]),
                    "pb_count": len(cached["tracks"]["pb"]),
                    "vocab_count": len(cached.get("vocabulary", [])),
                    # ⚠️ 索引中的 audio 也统一规范化为相对逻辑路径（兼容旧的绝对路径缓存）
                    "audio": {
                        "dg": make_relative_audio_path(f"{i:04d}", "dg") if (cached.get("audio") or {}).get("dg") else None,
                        "pb": make_relative_audio_path(f"{i:04d}", "pb") if (cached.get("audio") or {}).get("pb") else None,
                        "rv": None,
                    },
                })
        index_path = os.path.join(OUTPUT_DIR, "index.json")
        with open(index_path, "w", encoding="utf-8") as f:
            json.dump(index_list, f, ensure_ascii=False, indent=2)
        for target_dir in copy_targets:
            shutil.copy2(index_path, os.path.join(target_dir, "index.json"))
        print(f"Updated index.json with {len(index_list)} lessons in {time.time()-t0:.1f}s!", flush=True)


if __name__ == "__main__":
    main()
