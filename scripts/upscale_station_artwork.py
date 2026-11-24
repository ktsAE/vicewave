"""Rebuild the local dial artwork from cached station-mix covers."""
import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageStat

from cache_station_artwork import COVERS, ROOT

OUTPUT_SIZE = (1600, 1600)
# These flat marks show stair-stepping already present in the video source.
SOFT_MARKS = {"emotion-98-3", "honey-fm", "symphony-fm", "the-wipe", "vice-city-rap-radio", "wktt"}
# Retain print texture, small lettering and facial detail in the two posters.
POSTERS = {"the-vault-radio", "the-sniper-of-la-perle"}


def trace_worldwide(source, work):
    width, height = source.size
    orange = source.getpixel((width // 2, height // 8))
    ink = source.getpixel((width // 4, height // 2))
    threshold = (orange[0] + ink[0]) / 2
    mask = source.getchannel("R").filter(ImageFilter.GaussianBlur(0.9))
    mask = mask.resize((width * 2, height * 2), Image.Resampling.BICUBIC)
    bitmap = work / "mark.pbm"
    mask.point(lambda level: 255 if level > threshold else 0, "1").save(bitmap)
    alpha = work / "curves.pgm"
    subprocess.run([
        "potrace", "-b", "pgm", "-x", str(OUTPUT_SIZE[0] / mask.width),
        "-t", "8", "-a", "0.82", "-O", "0.65", "-o", str(alpha), str(bitmap),
    ], check=True)
    with Image.open(alpha) as coverage:
        return Image.composite(Image.new("RGB", coverage.size, orange),
                               Image.new("RGB", coverage.size, ink), coverage)


def restore(station, source, work, models):
    exe = shutil.which("realesrgan-ncnn-vulkan")
    if not exe:
        raise ValueError("realesrgan-ncnn-vulkan is required")
    input_file, output_file = work / "input.png", work / "output.png"
    soft = station in SOFT_MARKS
    scale = 4 if soft else 3
    model_input = source.resize((400, 400), Image.Resampling.LANCZOS) if soft else source
    model_input.save(input_file)
    subprocess.run([
        exe, "-m", str(models or Path(exe).resolve().parent / "models"),
        "-n", "realesr-animevideov3", "-s", str(scale), "-t", "160",
        "-i", str(input_file), "-o", str(output_file),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    with Image.open(output_file) as output:
        if output.size != (model_input.width * scale, model_input.height * scale):
            raise ValueError("Unexpected model output size")
        enhanced = output.convert("RGB").resize(OUTPUT_SIZE, Image.Resampling.LANCZOS)
    if station in POSTERS:
        enhanced = Image.blend(source.resize(OUTPUT_SIZE, Image.Resampling.LANCZOS), enhanced, 0.55)
    # Keep the source palette while retaining the restored edges and lettering.
    reference = source.resize((32, 32), Image.Resampling.BOX)
    preview = enhanced.resize(reference.size, Image.Resampling.BOX)
    if max(ImageStat.Stat(ImageChops.difference(reference, preview)).mean) > 18:
        raise ValueError("Restoration differs too much from the source cover")
    correction = ImageChops.subtract(reference, preview, offset=128).filter(ImageFilter.GaussianBlur(1))
    return ImageChops.add(enhanced, correction.resize(OUTPUT_SIZE, Image.Resampling.BICUBIC), offset=-128)


def build(station, models):
    with Image.open(COVERS / f"{station}-mix.webp") as image:
        source = image.convert("RGB")
    if source.width != source.height:
        raise ValueError("Station cover must be square")
    with tempfile.TemporaryDirectory(dir=COVERS) as directory:
        work = Path(directory)
        traced = station == "worldwide-fm"
        cover = trace_worldwide(source, work) if traced else restore(station, source, work, models)
        if cover.size != OUTPUT_SIZE:
            raise ValueError("Unexpected cover size")
        result = work / "restored.webp"
        cover.save(result, lossless=traced, quality=95, method=6)
        result.replace(COVERS / f"{station}-restored.webp")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stations", nargs="*", help="Station IDs. Defaults to all mix covers.")
    parser.add_argument("--models", type=Path, help="Directory containing the Real-ESRGAN models.")
    args = parser.parse_args()
    frames = json.loads((ROOT / "data" / "artwork.json").read_text())["frames"]
    stations = args.stations or frames
    if unknown := set(stations) - frames.keys():
        parser.error("No mix artwork for " + ", ".join(sorted(unknown)))
    failed = False
    for station in stations:
        try:
            build(station, args.models)
            print(f"{station}: 1600 × 1600", flush=True)
        except (OSError, ValueError, subprocess.CalledProcessError) as error:
            print(f"{station}: {error}", flush=True)
            failed = True
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
