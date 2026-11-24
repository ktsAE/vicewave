import io
import unittest
from unittest.mock import Mock, patch

from archive_audio import _MIRRORS, _PREFIXES, _open_range, _relay_range
from track_audio import TrackCache


def response(body, status=200, **headers):
    remote = io.BytesIO(body)
    remote.status = status
    remote.headers = {"Content-Length": str(len(body)), **headers}
    return remote


class TrackCacheTest(unittest.TestCase):
    def test_followup_seek_reads_the_correct_bytes_after_browser_disconnect(self):
        cache = TrackCache()
        entry, owner = cache.claim("song", "bytes=0-")
        self.assertTrue(owner)
        connection = Mock()
        connection.write.side_effect = BrokenPipeError
        result = cache.capture(response(b"0123456789"), connection)
        cache.finish("song", entry, result)
        handler = Mock()
        for requested, expected in [("bytes=3-5", b"345"), ("bytes=-2", b"89")]:
            cached, owner = cache.claim("song", requested)
            self.assertFalse(owner)
            self.assertTrue(cache.serve(handler, requested, cached))
            handler.send_response.assert_called_with(206)
            self.assertEqual(bytes(handler.wfile.write.call_args.args[0]), expected)

    def test_partial_files_and_inflight_downloads_do_not_displace_a_busy_slot(self):
        cache = TrackCache(slots=1, max_bytes=4)
        entry, _ = cache.claim("song", None)
        self.assertEqual(cache.claim("other", None), (None, False))
        for remote in [response(b"12345"), response(b"34", 206, **{"Content-Range": "bytes 2-3/5"})]:
            out = io.BytesIO()
            self.assertIsNone(cache.capture(remote, out))
            self.assertTrue(out.getvalue())
        cache.finish("song", entry, None)
        self.assertTrue(cache.claim("other", None)[1])

    def test_invalid_mirror_falls_back_to_the_catalog_source(self):
        origin, mirror = "https://example.test/source/file", "https://mirror.example.test/collection/file"
        meta = {"archiveUrl": origin, "bytes": 100}
        def valid():
            remote = response(b"audio", 206, **{"Content-Range": "bytes 5-9/100"})
            remote.geturl = lambda: mirror
            return remote
        with patch.dict(_MIRRORS, {}, clear=True), patch("archive_audio.urlopen") as op:
            op.side_effect = [valid(), response(b"wrong"), valid()]
            with _open_range(meta, 5, 9) as remote:
                self.assertEqual(remote.read(), b"audio")
            with _open_range(meta, 5, 9) as remote:
                self.assertEqual(remote.read(), b"audio")
            self.assertEqual([call.args[0].full_url for call in op.call_args_list], [origin, mirror, origin])

    def test_archive_prefix_is_served_locally_and_joins_the_exact_remaining_range(self):
        content = b"0123456789abcdef"
        meta = {"archiveUrl": "https://example.test/mix.mp3"}
        handler = Mock()
        connected = patch("archive_audio._gone", return_value=False)
        with patch.dict(_PREFIXES, {}, clear=True), connected, patch("archive_audio._open_range") as op:
            op.side_effect = lambda _, start, end: io.BytesIO(content[start:end + 1])
            for start, end in [(0, 7), (2, 4), (6, 12)]:
                handler.wfile = io.BytesIO()
                headers = Mock()
                _relay_range(handler, meta, start, end, headers)
                headers.assert_called_once()
                self.assertEqual(handler.wfile.getvalue(), content[start:end + 1])
            self.assertEqual([call.args[1:] for call in op.call_args_list], [(0, 7), (8, 12)])
