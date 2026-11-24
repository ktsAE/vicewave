"""Cache the original-size cover from a station mix for the local launcher."""
import argparse
import io
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen

from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
COVERS = ROOT / "assets" / "covers"


def cover_from_frame(frame, box):
    width, height = frame.size
    if width * box["height"] != height * box["width"]:
        raise ValueError("Unexpected frame aspect ratio")
    scale = width / box["width"]
    if scale <= 1:
        raise ValueError("Frame supplies no additional cover detail")
    left, top, size = (round(box[k] * scale) for k in ("left", "top", "size"))
    return frame.crop((left, top, left + size, top + size)).convert("RGB")


def reference_cover(station, thumbnail, box):
    cached = COVERS / f"{station}-{box['size']}.webp"
    if cached.is_file():
        with Image.open(cached) as image:
            return image.convert("RGB")
    with urlopen(thumbnail, timeout=20) as response, Image.open(io.BytesIO(response.read())) as image:
        if image.size != (box["width"], box["height"]):
            raise ValueError("Thumbnail does not contain the catalogued square")
        left, top, size = (box[k] for k in ("left", "top", "size"))
        return image.crop((left, top, left + size, top + size)).convert("RGB")


def cache_cover(station, frame, thumbnail, box):
    cover = cover_from_frame(frame, box)
    reference = reference_cover(station, thumbnail, box)
    # Reject intros, changed video layouts and different station art.
    small = (48, 48)
    difference = ImageChops.difference(
        cover.resize(small, Image.Resampling.LANCZOS),
        reference.resize(small, Image.Resampling.LANCZOS),
    )
    if max(ImageStat.Stat(difference).mean) > 18:
        raise ValueError("Frame differs from the station's reference artwork")
    destination = COVERS / f"{station}-mix.webp"
    if destination.exists():
        with Image.open(destination) as existing:
            if existing.width > cover.width:
                return existing.width
    COVERS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=COVERS) as work:
        output = Path(work) / "cover.webp"
        cover.save(output, lossless=True, method=6)
        output.replace(destination)
    return cover.width


def fetch_frame(thumbnail):
    video_id = urlsplit(thumbnail).path.split("/")[-2]
    # Resolve at build time. Expiring video URLs never enter the browser or catalog.
    source = subprocess.run(
        ["yt-dlp", "--no-playlist", "--no-warnings", "-q", "-f", "bv[height>=1080][protocol=https]",
         "-S", "res,vcodec:h264", "--get-url", "https://www.youtube.com/watch?v=" + video_id],
        capture_output=True, text=True, timeout=90,
    )
    if source.returncode or not source.stdout.strip():
        raise ValueError("Could not resolve an HD station mix")
    grab = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-threads", "2", "-ss", "3", "-i",
         source.stdout.strip(), "-frames:v", "1", "-threads", "1", "-f", "image2pipe", "-c:v", "png", "-"],
        capture_output=True, timeout=90,
    )
    if grab.returncode:
        raise ValueError("Could not read a still from the station mix")
    with Image.open(io.BytesIO(grab.stdout)) as image:
        return image.convert("RGB")


def main():
    catalog = json.loads((ROOT / "data" / "artwork.json").read_text())
    frames = catalog["frames"]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stations", nargs="*", help="Station IDs. Defaults to every station with a mix cover.")
    args = parser.parse_args()
    stations = args.stations or frames
    if unknown := set(stations) - frames.keys():
        parser.error("No mix artwork for " + ", ".join(sorted(unknown)))
    for command in ("yt-dlp", "ffmpeg"):
        if not shutil.which(command):
            parser.error(command + " is required to fetch a video still")
    failed = False
    for station in stations:
        try:
            thumbnail = frames[station]
            size = cache_cover(station, fetch_frame(thumbnail), thumbnail, catalog["dialFrame"])
            print(f"{station}: {size} × {size}", flush=True)
        except (OSError, ValueError, subprocess.TimeoutExpired) as error:
            # TimeoutExpired can include a signed media URL in its command line.
            message = "Video request timed out" if isinstance(error, subprocess.TimeoutExpired) else str(error)
            print(f"{station}: {message}", flush=True)
            failed = True
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
