#!/usr/bin/env python3
"""Start the local Vicewave radio player. No packages or accounts required."""
import argparse
from functools import lru_cache, partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import webbrowser
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
import json
import shutil

from archive_audio import byte_span, serve_archive
from track_audio import TrackCache

ROOT = Path(__file__).resolve().parent
TRACKS = TrackCache()


@lru_cache(maxsize=1)
def native_sources():
    def catalog(name):
        path = ROOT / "data" / (name + ".json")
        return json.loads(path.read_text()) if path.exists() else []

    sources = {"/signal/preview/" + p["stationId"]: p["audioUrl"] for p in catalog("media")["promos"]}
    for p in catalog("programs"):
        if p.get("audioUrl") and p.get("station"):
            sources["/signal/talk/" + p["station"].lower().replace(" ", "-")] = p["audioUrl"]
    for i, entry in enumerate(catalog("native-tracks")):
        sources["/signal/track/" + str(i)] = entry["audioUrl"]
    games = catalog("game-recordings")
    for entry in games["tracks"]:
        sources["/signal/game/" + entry["file"]] = games["audioBase"] + entry["file"]
    return sources


class ReceiverHandler(SimpleHTTPRequestHandler):
    def _serve_podcast(self, path, head):
        directory = ROOT / "assets" / "podcasts"
        local = (directory / path.removeprefix("/assets/podcasts/")).resolve()
        content_types = {".mp3": "audio/mpeg", ".ogg": "audio/ogg"}
        if local.parent != directory or local.suffix not in content_types or not local.is_file():
            self.send_error(404)
            return
        with local.open("rb") as audio:
            size = local.stat().st_size
            requested = self.headers.get("Range")
            try:
                start, end = byte_span(requested, size)
            except (ValueError, OverflowError):
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(206 if requested else 200)
            self.send_header("Content-Type", content_types[local.suffix])
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "private, max-age=86400")
            if requested:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            if head:
                return
            audio.seek(start)
            remaining = end - start + 1
            try:
                while remaining:
                    block = audio.read(min(remaining, 65536))
                    if not block:
                        break
                    self.wfile.write(block)
                    remaining -= len(block)
            except OSError:
                self.close_connection = True

    def _serve_audio(self, head=False):
        path = urlsplit(self.path).path
        if path == "/data/runtime.json":
            assets = ROOT / "assets"
            config = {
                "proxy": True,
                "podcasts": sorted(p.stem for p in (assets / "podcasts").glob("*.mp3") if p.is_file()),
                "opusPodcasts": sorted(p.stem for p in (assets / "podcasts").glob("*.ogg") if p.is_file()),
                "covers": sorted(p.stem for p in (assets / "covers").glob("*.webp") if p.is_file()),
                "localScene": (assets / "scenes" / "vice-city-dusk.webp").is_file(),
            }
            body = json.dumps(config).encode()
            self.send_response(200)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if not head:
                self.wfile.write(body)
            return True
        if path.startswith("/assets/podcasts/"):
            self._serve_podcast(path, head)
            return True
        if path.startswith("/radio-audio/"):
            serve_archive(self, path.removeprefix("/radio-audio/"), head=head)
            return True
        if not path.startswith("/signal/"):
            return False
        # Only catalog origins can be relayed. Same-origin audio can use a
        # Web Audio gain envelope on devices with fixed HTML media volume.
        origin = native_sources().get(path)
        if not origin:
            self.send_error(404)
            return True
        headers = {"User-Agent": "Vicewave/1.0", "Accept-Encoding": "identity"}
        requested = self.headers.get("Range")
        if requested:
            headers["Range"] = requested
        entry, owner = (None, False)
        if not head and path.startswith("/signal/game/"):
            entry, owner = TRACKS.claim(path, requested)
        if entry and not owner and TRACKS.serve(self, requested, entry):
            return True
        captured = None
        try:
            req = Request(origin, headers=headers, method="HEAD" if head else "GET")
            with urlopen(req, timeout=20) as response:
                self.send_response(response.status)
                for name in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges",
                             "ETag", "Last-Modified"):
                    if response.headers.get(name):
                        self.send_header(name, response.headers[name])
                self.send_header("Cache-Control", "private, max-age=3600")
                self.end_headers()
                if not head:
                    try:
                        if owner:
                            captured = TRACKS.capture(response, self.wfile)
                        else:
                            shutil.copyfileobj(response, self.wfile, 64 * 1024)
                    except OSError:
                        self.close_connection = True
        except HTTPError as error:
            self.send_error(error.code)
        except (URLError, TimeoutError, OSError):
            self.send_error(502)
        finally:
            if owner:
                TRACKS.finish(path, entry, captured)
        return True

    def do_GET(self):
        if not self._serve_audio():
            super().do_GET()

    def do_HEAD(self):
        if not self._serve_audio(head=True):
            super().do_HEAD()

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=6177)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    url = f"http://127.0.0.1:{args.port}/"
    try:
        server = ThreadingHTTPServer(
            ("127.0.0.1", args.port), partial(ReceiverHandler, directory=str(ROOT))
        )
    except OSError as error:
        try:
            with urlopen(url, timeout=1) as response:
                existing = b"<title>Vicewave" in response.read(1500)
        except OSError:
            existing = False
        if not existing:
            sys.exit(f"Could not start the radio on port {args.port}. {error}")
        print(f"Vicewave is already running at {url}")
        if not args.no_browser:
            webbrowser.open(url)
        return
    print(f"Vicewave is ready at {url}", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    with server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
