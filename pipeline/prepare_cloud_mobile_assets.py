#!/usr/bin/env python3
"""Stage real CloudBase COS audio for Flutter; never upload to the cloud."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter
from tempfile import TemporaryDirectory
import json
import hashlib
import os
from pathlib import Path
import re
import sys
import time

from check_distribution import validate_document, scan_distribution
from prepare_flutter_lessons import prepare

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "flutter_app/assets/lessons"
SAFE = ROOT / "flutter_app/assets/lessons_safe"
AUDIO = ROOT / "flutter_app/assets/audio"
EXPECTED_COUNT = 335
IDS = re.compile(r"^[0-9]{4}$")
PREFIX = re.compile(r"^[a-zA-Z0-9_/-]+$")
MIN_BYTES = 1024
MAX_BYTES = 160 * 1024 * 1024


def read_ids(source=SOURCE, count=EXPECTED_COUNT):
    index = json.loads((Path(source) / "index.json").read_text(encoding="utf-8"))
    if not isinstance(index, list) or len(index) != count:
        raise ValueError("invalid index count")
    ids = [row.get("lesson_id") if isinstance(row, dict) else None for row in index]
    if len(set(ids)) != count or any(not isinstance(v, str) or not IDS.fullmatch(v) for v in ids):
        raise ValueError("invalid or duplicate lesson ID")
    return ids


def cloud_key(prefix, lesson_id, track, extension="m4a"):
    if extension not in ("m4a", "mp3"):
        raise ValueError("unsupported audio extension")
    prefix = prefix.strip("/")
    if (prefix and (not PREFIX.fullmatch(prefix) or ".." in prefix.split("/"))
            or not IDS.fullmatch(lesson_id) or track not in ("dg", "pb")):
        raise ValueError("invalid cloud object key")
    return "/".join(part for part in (prefix, lesson_id, track + "." + extension) if part)


def stage_metadata(source=SOURCE, output=SAFE, count=EXPECTED_COUNT, extension="m4a"):
    cloud_key("audio", "0001", "dg", extension)
    ids = read_ids(source, count)
    prepare(source, output, count)
    output = Path(output)
    for name in ["index.json"] + [f"lesson_{i}.json" for i in ids]:
        file = output / name
        data = json.loads(file.read_text(encoding="utf-8"))
        records = data if isinstance(data, list) else [data]
        for row in records:
            if not row["audio"].get("dg") or not row["audio"].get("pb"):
                raise ValueError("missing source audio metadata")
            row["audio"] = {"dg": "dg." + extension, "pb": "pb." + extension, "rv": None}
        validate_document(data)
        file.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if scan_distribution(output) != count + 1:
        raise ValueError("incomplete JSON distribution")
    return ids


def is_m4a(file):
    with Path(file).open("rb") as f:
        header = f.read(12)
    return len(header) == 12 and header[4:8] == b"ftyp"


def is_audio(file, extension):
    if extension == "m4a":
        return is_m4a(file)
    if extension != "mp3":
        raise ValueError("unsupported audio extension")
    with Path(file).open("rb") as stream:
        header = stream.read(10)
    # ID3v2 header or a valid MPEG audio sync/version/layer prefix.
    return (len(header) >= 10 and header[:3] == b"ID3"
            and header[3] in (2, 3, 4) and all(b < 128 for b in header[6:10])) or (
        len(header) >= 4 and header[0] == 255 and header[1] & 224 == 224
        and header[1] & 24 != 8 and header[1] & 6 != 0
        and header[2] >> 4 not in (0, 15) and header[2] & 12 != 12)


def read_manifest(client, bucket, ids, prefix, extension):
    """MP3 migration requires the verified, bucket-bound content manifest."""
    key = cloud_key(prefix, ids[0], "dg", extension).rsplit("/", 2)[0] + "/manifest.json"
    with TemporaryDirectory(prefix="cos-manifest-") as tmp:
        path = Path(tmp) / "manifest.json"
        response = client.get_object(Bucket=bucket, Key=key)
        response["Body"].get_stream_to_file(str(path))
        if path.stat().st_size > 1024 * 1024:
            raise ValueError("oversized audio manifest")
        manifest = json.loads(path.read_text(encoding="utf-8"))
    expected = {cloud_key(prefix, lid, track, extension) for lid in ids for track in ("dg", "pb")}
    entries = manifest.get("objects", [])
    if (manifest.get("bucket") != bucket or manifest.get("extension") != extension
            or len(entries) != len(expected) or {x.get("key") for x in entries} != expected):
        raise ValueError("audio manifest target or inventory mismatch")
    for item in entries:
        if (not isinstance(item.get("size"), int) or not MIN_BYTES <= item["size"] <= MAX_BYTES
                or not re.fullmatch(r"[a-f0-9]{64}", item.get("sha256", ""))):
            raise ValueError("invalid audio manifest entry")
    return {item["key"]: item for item in entries}



class CloudAudioFailure(ValueError):
    """Redacted, stable diagnostic category; never put SDK error bodies in logs."""

    def __init__(self, category):
        self.category = category
        super().__init__(category)


def error_category(exc):
    """Classify the HTTP status only; error bodies may contain private URLs."""
    if isinstance(exc, CloudAudioFailure):
        return exc.category
    get_status = getattr(exc, "get_status_code", None)
    try:
        status = int(get_status()) if callable(get_status) else 0
    except (TypeError, ValueError):
        status = 0
    if status in (401, 403):
        return "ACCESS_DENIED_OR_IP_RESTRICTED"
    if status == 404:
        return "OBJECT_NOT_FOUND"
    if status in (408, 429) or 500 <= status <= 599:
        return "REMOTE_TRANSIENT"
    return "TRANSPORT_OR_UNCLASSIFIED"


def probe_audio(client, bucket, ids, prefix="audio", extension="m4a"):
    """8 tiny read-only ranged GETs. A probe failure prevents 670 full downloads."""
    priority_ids = ("0001", "0030", "0031", "0365")
    samples = [lesson for lesson in priority_ids if lesson in ids]
    if len(samples) < 2:
        raise CloudAudioFailure("NO_KNOWN_SAMPLE_LESSONS")
    results = Counter()
    with TemporaryDirectory(prefix="cos-audio-probe-") as tmp:
        for lesson in samples:
            for track in ("dg", "pb"):
                key = cloud_key(prefix, lesson, track, extension)
                try:
                    response = client.get_object(Bucket=bucket, Key=key, Range="bytes=0-31")
                    staged = Path(tmp) / (lesson + "-" + track + ".probe")
                    response["Body"].get_stream_to_file(str(staged))
                    if not 12 <= staged.stat().st_size <= 65536 or not is_audio(staged, extension):
                        raise CloudAudioFailure("INVALID_MEDIA_HEADER")
                    category = "OK"
                except Exception as exc:
                    category = error_category(exc)
                results[category] += 1
                # Only fixed lesson IDs and sanitized categories; no COS SDK response text.
                print(f"COS sample {lesson}/{track}: {category}", flush=True)
    print("COS sample summary: " + ", ".join(
        f"{category}={results[category]}" for category in sorted(results)
    ), flush=True)
    if results["OK"] != len(samples) * 2:
        raise CloudAudioFailure("COS_PREFLIGHT_FAILED")
    return results["OK"]

def fetch_one(client, bucket, key, dest, retries=3, extension="m4a", expected=None):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_symlink():
        raise ValueError("symlink in destination")
    for attempt in range(retries):
        temp = dest.with_name(dest.name + ".partial")
        try:
            temp.unlink(missing_ok=True)
            response = client.get_object(Bucket=bucket, Key=key)
            response["Body"].get_stream_to_file(str(temp))
            size = temp.stat().st_size
            if not MIN_BYTES <= size <= MAX_BYTES or not is_audio(temp, extension):
                raise CloudAudioFailure("INVALID_MEDIA_OBJECT")
            if expected is not None:
                with temp.open("rb") as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                if size != expected["size"] or digest != expected["sha256"]:
                    raise CloudAudioFailure("CONTENT_CHECKSUM_MISMATCH")
            temp.replace(dest)
            return size
        except Exception as exc:
            temp.unlink(missing_ok=True)
            category = error_category(exc)
            # Do not retry 403/404 or invalid media: this wastes minutes on absent files.
            if category in ("ACCESS_DENIED_OR_IP_RESTRICTED", "OBJECT_NOT_FOUND",
                            "INVALID_MEDIA_OBJECT", "CONTENT_CHECKSUM_MISMATCH") or attempt + 1 >= retries:
                raise CloudAudioFailure(category) from None
            time.sleep(min(2 ** attempt, 4))
    raise AssertionError("unreachable")


def download_audio(client, bucket, ids, prefix="audio", audio_dir=AUDIO, workers=6,
                   extension="m4a", manifest=None):
    if extension == "mp3" and manifest is None:
        raise ValueError("MP3 requires verified manifest")
    root = Path(audio_dir)
    if root.is_symlink():
        raise ValueError("symlink in audio root")
    items = [(cloud_key(prefix, lesson, track, extension), root / lesson / (track + "." + extension))
             for lesson in ids for track in ("dg", "pb")]
    if len(items) != EXPECTED_COUNT * 2:
        raise ValueError("unexpected audio inventory")
    total = 0
    failures = Counter()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fetch_one, client, bucket, key, dest, extension=extension,
                               expected=manifest[key] if manifest is not None else None) for key, dest in items]
        for future in as_completed(futures):
            try:
                total += future.result()
            except CloudAudioFailure as exc:
                failures[exc.category] += 1
    if failures:
        print("COS full-download failures: " + ", ".join(
            f"{kind}={count}" for kind, count in sorted(failures.items())
        ), flush=True)
    if failures or total < len(items) * MIN_BYTES:
        raise CloudAudioFailure("INCOMPLETE_AUDIO_INVENTORY")
    return len(items), total


def main():
    parser = argparse.ArgumentParser(description="Build 335-lesson, real-audio Flutter staging")
    parser.add_argument("--prefix", default="audio")
    parser.add_argument("--audio-extension", choices=("m4a", "mp3"),
                        default=os.environ.get("COS_AUDIO_EXTENSION", "m4a"))
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--probe-only", action="store_true",
                        help="Try small GET ranges for representative lessons; no full media download")
    args = parser.parse_args()
    try:
        if not 1 <= args.workers <= 8:
            raise ValueError("worker limit exceeded")
        bucket = os.environ["COS_BUCKET"]
        region = os.environ["COS_REGION"]
        secret_id = os.environ["COS_SECRET_ID"]
        secret_key = os.environ["COS_SECRET_KEY"]
        if not all((bucket, region, secret_id, secret_key)):
            raise ValueError("missing COS settings")
        from qcloud_cos import CosConfig, CosS3Client
        ids = read_ids()
        client = CosS3Client(CosConfig(Region=region, SecretId=secret_id,
                            SecretKey=secret_key, Token=os.environ.get("COS_SESSION_TOKEN") or None,
                            Scheme="https"))
        probe_audio(client, bucket, ids, prefix=args.prefix, extension=args.audio_extension)
        if args.probe_only:
            print("COS preflight OK. No complete audio files were downloaded.", flush=True)
            return 0
        manifest = (read_manifest(client, bucket, ids, args.prefix, args.audio_extension)
                    if args.audio_extension == "mp3" else None)
        stage_metadata(extension=args.audio_extension)
        n, size = download_audio(client, bucket, ids, prefix=args.prefix, workers=args.workers,
                                 extension=args.audio_extension, manifest=manifest)
        print(f"Verified {len(ids)} lesson metadata records and {n} {args.audio_extension.upper()} files ({size // 1048576} MiB).")
        print("Actual decoding/OS playback still require physical device tests.")
    except Exception as exc:
        # COS exceptions may embed signed URLs or token-bearing headers.
        if isinstance(exc, CloudAudioFailure):
            print(f"FAIL cloud asset staging: {exc.category}; SDK response redacted.", file=sys.stderr)
        else:
            print(f"FAIL cloud asset staging: {type(exc).__name__}; details redacted.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
