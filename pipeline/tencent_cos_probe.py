"""Read one verified COS key in memory; never persist or print its contents."""
import hashlib
import logging
import os
import sys

MAX_OBJECT_BYTES = 32 * 1024 * 1024
OBJECT_KEY = "audio/0001/dg.mp3"


class ProbeError(Exception):
    pass


def probe(client, bucket, key=OBJECT_KEY):
    response = client.get_object(Bucket=bucket, Key=key)
    body = response.get("Body")
    get_raw_stream = getattr(body, "get_raw_stream", None)
    if not callable(get_raw_stream):
        raise ProbeError("INVALID_OBJECT_RESPONSE")
    stream = get_raw_stream()
    if not callable(getattr(stream, "read", None)):
        raise ProbeError("INVALID_OBJECT_RESPONSE")
    digest = hashlib.sha256()
    total = 0
    try:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_OBJECT_BYTES:
                raise ProbeError("OBJECT_TOO_LARGE")
            digest.update(chunk)
    finally:
        close = getattr(stream, "close", None)
        if callable(close):
            close()
    if total == 0:
        raise ProbeError("EMPTY_OBJECT")
    return total, digest.hexdigest()


def main():
    bucket = os.environ.get("TENCENT_COS_BUCKET", "")
    region = os.environ.get("TENCENT_COS_REGION", "ap-shanghai")
    credentials = [os.environ.get(name, "") for name in
                  ("COS_SECRET_ID", "COS_SECRET_KEY", "COS_SESSION_TOKEN")]
    if not bucket or not all(credentials):
        raise ProbeError("CONFIGURATION_MISSING")
    if region != "ap-shanghai":
        raise ProbeError("REGION_NOT_ALLOWLISTED")

    logging.disable(logging.CRITICAL)
    from qcloud_cos import CosConfig, CosS3Client
    config = CosConfig(Region=region, SecretId=credentials[0],
                       SecretKey=credentials[1], Token=credentials[2], Scheme="https")
    client = CosS3Client(config)
    size, sha256 = probe(client, bucket, OBJECT_KEY)
    print(f"COS_READ=PASS key={OBJECT_KEY} size={size} sha256={sha256}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        category = str(exc) if isinstance(exc, ProbeError) else type(exc).__name__
        print("COS_READ=FAIL category=" + category, file=sys.stderr)
        raise SystemExit(1)
