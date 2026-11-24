"""Keep recently requested game songs available for the browser's follow-up seeks."""
from collections import OrderedDict
from concurrent.futures import Future, TimeoutError
from threading import Lock

from archive_audio import byte_span


class TrackCache:
    def __init__(self, slots=24, max_bytes=8 * 1024**2, budget=64 * 1024**2):
        self.slots = slots
        self.max_bytes = max_bytes
        self.budget = budget
        self.entries = OrderedDict()
        self.lock = Lock()

    def claim(self, key, requested):
        with self.lock:
            if key in self.entries:
                self.entries.move_to_end(key)
                return self.entries[key], False
            if requested not in (None, "bytes=0-"):
                return None, False
            # Reserve a full allowance for in-flight songs, and only their
            # actual length once complete. Short tracks can stay longer.
            reserved = sum(len(v.result()[0]) if v.done() else self.max_bytes for v in self.entries.values())
            while len(self.entries) >= self.slots or reserved + self.max_bytes > self.budget:
                oldest = next((k for k, value in self.entries.items() if value.done()), None)
                if oldest is None:
                    return None, False
                reserved -= len(self.entries.pop(oldest).result()[0])
            entry = self.entries[key] = Future()
            return entry, True

    def finish(self, key, entry, result):
        with self.lock:
            if result is None and self.entries.get(key) is entry:
                del self.entries[key]
            entry.set_result(result)

    def capture(self, remote, output):
        """Stream immediately. Finish a small download if the browser reopens it for seeking."""
        length = remote.headers.get("Content-Length") or ""
        size = int(length) if length.isdecimal() else 0
        whole = remote.status == 200 or remote.headers.get("Content-Range") == f"bytes 0-{size - 1}/{size}"
        body = bytearray() if whole and 0 < size <= self.max_bytes else None
        while block := remote.read1(65536):
            if body is not None:
                if len(body) + len(block) <= size:
                    body.extend(block)
                else:
                    body = None
            if output is not None:
                try:
                    output.write(block)
                except OSError:
                    if body is None:
                        return None
                    output = None
        if body is not None and len(body) == size:
            return body, remote.headers.get("Content-Type", "audio/ogg"), remote.headers.get("ETag")
        return None

    @staticmethod
    def serve(handler, requested, entry):
        # A slow origin must still allow an independent deep byte-range request.
        try:
            result = entry.result(timeout=0.55)
        except TimeoutError:
            return False
        if result is None:
            return False
        body, content_type, etag = result
        size = len(body)
        try:
            start, end = byte_span(requested, size)
        except (ValueError, OverflowError):
            handler.send_response(416)
            handler.send_header("Content-Range", f"bytes */{size}")
            handler.send_header("Content-Length", "0")
            handler.end_headers()
            return True
        handler.send_response(206 if requested else 200)
        handler.send_header("Content-Type", content_type)
        handler.send_header("Content-Length", str(end - start + 1))
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Cache-Control", "private, max-age=3600")
        if etag:
            handler.send_header("ETag", etag)
        if requested:
            handler.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        handler.end_headers()
        try:
            handler.wfile.write(memoryview(body)[start:end + 1])
        except OSError:
            pass
        return True
