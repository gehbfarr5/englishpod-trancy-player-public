import http.server
import os
import socketserver
import urllib.parse

PORT = int(os.environ.get("EP_PREVIEW_PORT", "8765"))

# ⚠️ 不再硬编码本机绝对路径（原默认值内含压缩包密码）。
#    统一改为环境变量可配置，未配置时由入口处给出清晰中文报错。
_PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_PIPELINE_DIR)
_SOURCE_ROOT = os.environ.get("EP_SOURCE_DIR", "")

PROCESSED_DIR = os.environ.get("EP_OUTPUT_DIR", os.path.join(_REPO_ROOT, "processed_lessons"))
EP_AUDIO_DIR = os.environ.get(
    "EP_AUDIO_DIR",
    os.path.join(_SOURCE_ROOT, "1-30") if _SOURCE_ROOT else "",
)
WEB_DIR = os.environ.get("EP_WEB_DIR", os.path.join(_REPO_ROOT, "web_preview"))


class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        if path.startswith("/data/"):
            fname = os.path.basename(path)
            fpath = os.path.join(PROCESSED_DIR, fname)
            if os.path.isfile(fpath):
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                with open(fpath, "rb") as f:
                    self.wfile.write(f.read())
                return
            self.send_error(404, "JSON not found")
            return

        if path.startswith("/audio/"):
            # /audio/0001/englishpod_B0001dg.mp3
            rel = path[len("/audio/"):]
            fpath = os.path.join(EP_AUDIO_DIR, rel)
            if os.path.isfile(fpath):
                file_size = os.path.getsize(fpath)
                range_header = self.headers.get("Range")
                if range_header:
                    # Support byte range requests for instant seeking!
                    byte1, byte2 = 0, None
                    m = range_header.strip().split("=")[1]
                    if "-" in m:
                        p = m.split("-")
                        byte1 = int(p[0]) if p[0] else 0
                        byte2 = int(p[1]) if p[1] else file_size - 1
                    length = byte2 - byte1 + 1
                    self.send_response(206)
                    self.send_header("Content-Type", "audio/mpeg")
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Range", f"bytes {byte1}-{byte2}/{file_size}")
                    self.send_header("Content-Length", str(length))
                    self.end_headers()
                    with open(fpath, "rb") as f:
                        f.seek(byte1)
                        self.wfile.write(f.read(length))
                    return
                else:
                    self.send_response(200)
                    self.send_header("Content-Type", "audio/mpeg")
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Length", str(file_size))
                    self.end_headers()
                    with open(fpath, "rb") as f:
                        self.wfile.write(f.read())
                    return
            self.send_error(404, "Audio not found")
            return

        return super().do_GET()


if __name__ == "__main__":
    if not PROCESSED_DIR or not os.path.isdir(PROCESSED_DIR):
        raise SystemExit(
            f"❌ processed_lessons 目录不可用：{PROCESSED_DIR!r}\n"
            "   请设置环境变量 EP_OUTPUT_DIR 指向课程 JSON 目录。"
        )
    if not EP_AUDIO_DIR or not os.path.isdir(EP_AUDIO_DIR):
        raise SystemExit(
            f"❌ 音频目录不可用：{EP_AUDIO_DIR!r}\n"
            "   请设置环境变量 EP_SOURCE_DIR（源根目录）或 EP_AUDIO_DIR（如 …/1-30）。"
        )
    os.makedirs(WEB_DIR, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), PreviewHandler) as httpd:
        print(f"Serving EnglishPod Trancy Preview at http://localhost:{PORT}")
        httpd.serve_forever()
