"""Serve byte ranges from public station files whose archive member URLs stream sequentially."""
from __future__ import annotations

import json
import logging
import os
import re
import select
import socket
import threading
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen

_LOG = logging.getLogger(__name__)
_ROOT = Path(__file__).resolve().parent
_CACHE = Path(os.getenv("XDG_CACHE_HOME") or Path.home() / ".cache") / "vicewave" / "broadcasts-v1"
_CHUNK = 64 * 1024
_AHEAD = 256 * 1024
_LIMIT = 1024**3
_IDLE = 5
_READ_TIMEOUT = 20
_WAIT = 60
_STATIONS = {s["stationId"]: s for s in json.loads((_ROOT / "data/broadcasts.json").read_text())}
_ENTRIES = {}
_MIRRORS = {}
_PREFIXES = {}
_REGISTRY = threading.Lock()
_UPSTREAM = threading.BoundedSemaphore(6)


class _Gone(Exception):
    """The requesting receiver has already tuned away."""


def _gone(handler):
    sock = handler.connection
    try:
        return bool(select.select([sock], [], [], 0)[0]) and sock.recv(1, socket.MSG_PEEK) == b""
    except (OSError, ValueError):
        return True


def byte_span(value, size):
    if value is None:
        return 0, size - 1
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value.strip())
    if not match or not any(match.groups()):
        raise ValueError
    left, right = match.groups()
    if left:
        start, end = int(left), min(int(right), size - 1) if right else size - 1
    else:
        start, end = max(0, size - int(right)), size - 1
    if not 0 <= start <= end < size:
        raise ValueError
    return start, end


def _old_process(path):
    """Identify abandoned partials without signalling a process on Windows."""
    pid_field = path.stem.rpartition(".")[2]
    if not pid_field.isdecimal() or pid_field == str(os.getpid()):
        return False
    if os.name != "posix":
        return False
    try:
        os.kill(int(pid_field), 0)
    except ProcessLookupError:
        return True
    except OSError:
        pass
    return False


class _Entry:
    def __init__(self, meta):
        self.meta = meta
        name = meta["stationId"]
        self.final = _CACHE / f"{name}.audio"
        # Partial files are private to a serving process. A verified complete
        # file is atomically shared with other instances on this device.
        self.part = _CACHE / f"{name}.{os.getpid()}.part"
        self.cond = threading.Condition()
        self.requests = {}
        self.worker = None
        self.available = 0
        self.error = None

    def join(self):
        with self.cond:
            if self.worker is None:
                if self.final.exists() and self.final.stat().st_size == self.meta["bytes"]:
                    self.available = self.meta["bytes"]
                    if not self.requests:
                        self.final.touch()
                else:
                    if not self.part.exists():
                        # Reuse a prefix from a previous launcher process.
                        for old in sorted(_CACHE.glob(f"{self.meta['stationId']}.*.part")):
                            if _old_process(old):
                                try:
                                    old.replace(self.part)
                                    break
                                except FileNotFoundError:
                                    continue
                    self.available = self.part.stat().st_size if self.part.exists() else 0
            if not self.requests and self.worker is None:
                self.error = None
            ticket = object()
            self.requests[ticket] = 0
            return ticket

    def leave(self, ticket):
        with self.cond:
            self.requests.pop(ticket, None)
            self.cond.notify_all()

    def read(self, ticket, offset, stop, handler):
        deadline = time.monotonic() + _WAIT
        with self.cond:
            self.requests[ticket] = stop
            self.cond.notify_all()
            if self.available <= offset and self.worker is None and not self.error:
                self.worker = threading.Thread(target=self.fill, daemon=True)
                self.worker.start()
            while self.available <= offset:
                if self.error:
                    raise OSError(self.error)
                if _gone(handler):
                    raise _Gone
                if time.monotonic() >= deadline:
                    raise TimeoutError("The requested broadcast position is still buffering")
                self.cond.wait(timeout=0.3)
            path = self.final if self.available == self.meta["bytes"] and self.final.exists() else self.part
            with path.open("rb") as stream:
                stream.seek(offset)
                block = stream.read(min(stop, self.available) - offset)
            if not block:
                raise OSError("Cached audio is unavailable")
            return block

    def wants(self, offset):
        with self.cond:
            # A metadata probe or a departed client never asks for the full file.
            def wanted():
                return bool(self.requests) and offset < max(self.requests.values()) + _AHEAD

            return wanted() or self.cond.wait_for(wanted, timeout=_IDLE)

    def transfer(self):
        position = self.available
        headers = {"Range": f"bytes={position}-", "User-Agent": "Vicewave/1.0"}
        url = self.meta["archiveUrl"]
        with urlopen(Request(url, headers=headers), timeout=_READ_TIMEOUT) as remote:
            if remote.status == 206:
                expected = f"bytes {position}-"
                if not (remote.headers.get("Content-Range") or "").startswith(expected):
                    raise OSError("Archive returned a different byte range")
                cursor = position
            elif remote.status == 200:
                cursor = 0
            else:
                raise OSError(f"Archive HTTP status {remote.status}")
            # An IA member's 200 response ignores Range. Skip an already
            # cached prefix, retaining it for immediate playback on re-tuning.
            while cursor < position:
                if not self.wants(position):
                    return
                block = remote.read(min(256 * 1024, position - cursor))
                if not block:
                    raise OSError("Archive member ended before cached prefix")
                cursor += len(block)
            size = self.meta["bytes"]
            with self.part.open("ab", buffering=0) as local:
                if local.tell() != position:
                    raise OSError("Cached prefix changed")
                while position < size:
                    if not self.wants(position):
                        return
                    block = remote.read(min(_CHUNK, size - position))
                    if not block:
                        raise OSError("Archive member ended early")
                    if position == 0:
                        aac = block[4:8] == b"ftyp"
                        mp3 = block.startswith(b"ID3") or block[:1] == b"\xff"
                        if not (aac if self.meta["contentType"] == "audio/mp4" else mp3):
                            raise OSError("Archive returned non-audio content")
                    local.write(block)
                    position += len(block)
                    with self.cond:
                        self.available = position
                        self.cond.notify_all()
                    if position % (8 * 1024 * 1024) < len(block):
                        _trim()
            with self.cond:
                self.part.replace(self.final)
                self.cond.notify_all()

    def fill(self):
        try:
            _CACHE.mkdir(parents=True, exist_ok=True)
            while not _UPSTREAM.acquire(timeout=0.2):
                with self.cond:
                    if not self.requests:
                        return
            try:
                for attempt in range(2):
                    try:
                        with self.cond:
                            if not self.requests:
                                return
                        self.transfer()
                    except (OSError, EOFError) as error:
                        if attempt or not self.requests:
                            raise
                        _LOG.debug("Retrying station %s: %s", self.meta["stationId"], error)
                    else:
                        break
            finally:
                _UPSTREAM.release()
        except Exception as error:
            _LOG.warning("Station %s could not buffer: %s", self.meta["stationId"], error)
            with self.cond:
                self.error = str(error)
        finally:
            with self.cond:
                self.worker = None
                if self.available < self.meta["bytes"] and not self.error and any(
                    limit > self.available for limit in self.requests.values()
                ):
                    self.worker = threading.Thread(target=self.fill, daemon=True)
                    self.worker.start()
                self.cond.notify_all()
            _trim()


def _trim():
    with _REGISTRY:
        if not _CACHE.is_dir():
            return
        protected = set()
        for entry in _ENTRIES.values():
            with entry.cond:
                if entry.requests or entry.worker is not None:
                    protected.update((entry.part, entry.final))
        files = []
        for path in _CACHE.iterdir():
            if path.suffix not in {".audio", ".part"}:
                continue
            try:
                stat = path.stat()
            except FileNotFoundError:
                continue
            files.append((stat.st_mtime, stat.st_size, path))
        total = sum(size for _, size, _ in files)
        for modified, size, path in sorted(files):
            if total <= _LIMIT:
                break
            if path in protected:
                continue
            if path.suffix == ".part" and path.stem.rpartition(".")[2] != str(os.getpid()):
                if not _old_process(path):
                    # On other platforms the OS may still have the file open.
                    if os.name == "posix" or time.time() - modified < 86400:
                        continue
            try:
                path.unlink(missing_ok=True)
            except OSError:
                continue
            total -= size


def _open_range(meta, start, end):
    source = meta["archiveUrl"]
    directory, _, name = source.rpartition("/")
    with _REGISTRY:
        mirror = _MIRRORS.get(directory)
    urls = [source]
    if mirror and mirror[1] > time.monotonic():
        urls.insert(0, mirror[0] + "/" + name)
    for url in urls:
        try:
            request = Request(url, headers={"Range": f"bytes={start}-{end}", "User-Agent": "Vicewave/1.0"})
            remote = urlopen(request, timeout=_READ_TIMEOUT)
            if remote.status != 206 or remote.headers.get("Content-Range") != f"bytes {start}-{end}/{meta['bytes']}":
                remote.close()
                raise OSError("The upstream file did not return the requested byte range")
            if url == source and remote.geturl() != source:
                target = urlsplit(remote.geturl())
                mirror_dir, _, member = remote.geturl().rpartition("/")
                if target.scheme == "https" and not target.query and unquote(member) == unquote(name):
                    with _REGISTRY:
                        _MIRRORS[directory] = (mirror_dir, time.monotonic() + 900)
            return remote
        except OSError as error:
            if isinstance(error, HTTPError):
                error.close()
            if url == source:
                raise
            with _REGISTRY:
                if _MIRRORS.get(directory) == mirror:
                    _MIRRORS.pop(directory, None)


def _relay_range(handler, meta, start, end, send_headers):
    """Relay a genuine range-capable audio file directly, including cold deep seeks."""
    sent = False
    source = meta["archiveUrl"]
    try:
        # Browsers reopen byte zero to read the MP3 seek table before a deep
        # seek. Keep the first 64 KiB of each visited station locally.
        with _REGISTRY:
            prefix = _PREFIXES.get(source, b"")
        if start < len(prefix):
            header = prefix[start:end + 1]
            send_headers()
            sent = True
            handler.wfile.write(header)
            start += len(header)
            if start > end or _gone(handler):
                return
        with _open_range(meta, start, end) as remote:
            remaining = end - start + 1
            while remaining:
                block = remote.read1(min(_CHUNK, remaining))
                if not block:
                    raise EOFError("The upstream audio stream ended early")
                if start < _CHUNK:
                    with _REGISTRY:
                        prefix = _PREFIXES.get(source, b"")
                        if start <= len(prefix) < start + len(block):
                            _PREFIXES[source] = prefix + block[len(prefix) - start:_CHUNK - start]
                if not sent:
                    send_headers()
                    sent = True
                handler.wfile.write(block)
                remaining -= len(block)
                start += len(block)
    except ConnectionError:
        handler.close_connection = True
    except (OSError, EOFError) as error:
        if not sent:
            handler.send_error(503, "This station is buffering")
        else:
            handler.close_connection = True
        _LOG.debug("%s: %s", meta["stationId"], error)


def serve_archive(handler, station_id, head=False):
    """Serve one allowlisted recording to the local HTTP request handler."""
    meta = _STATIONS.get(station_id)
    if meta is None:
        handler.send_error(404, "Unknown station recording")
        return
    size = meta["bytes"]
    requested = handler.headers.get("Range")
    try:
        start, end = byte_span(requested, size)
    except (ValueError, OverflowError):
        handler.send_response(416)
        handler.send_header("Content-Range", f"bytes */{size}")
        handler.send_header("Content-Length", "0")
        handler.end_headers()
        return

    def send_headers():
        handler.send_response(206 if requested else 200)
        handler.send_header("Content-Type", meta["contentType"])
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Cache-Control", "private, max-age=3600")
        handler.send_header("Content-Length", str(end - start + 1))
        if requested:
            handler.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        handler.end_headers()

    if head:
        send_headers()
        return
    if meta.get("nativeRange"):
        _relay_range(handler, meta, start, end, send_headers)
        return
    with _REGISTRY:
        entry = _ENTRIES.get(station_id)
        if entry is None:
            entry = _ENTRIES[station_id] = _Entry(meta)
        ticket = entry.join()
    sent = False
    try:
        position = start
        while position <= end:
            block = entry.read(ticket, position, min(end + 1, position + _CHUNK), handler)
            if not sent:
                send_headers()
                sent = True
            handler.wfile.write(block)
            position += len(block)
    except (_Gone, ConnectionError):
        pass
    except (OSError, EOFError) as error:
        if not sent:
            handler.send_error(503, "This station is buffering")
        else:
            handler.close_connection = True
        _LOG.debug("%s: %s", station_id, error)
    finally:
        entry.leave(ticket)
