"""Refresh listening links against the station catalog. Requires requests, bs4 and ffprobe."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unicodedata
from urllib.parse import quote, urljoin

from bs4 import BeautifulSoup
import requests


ROOT = Path(__file__).resolve().parents[1]
ROCKSTAR = "https://www.rockstargames.com"
MUSIC = ROCKSTAR + "/VI/music"
GUIDE = "https://gta.guide/gta-6/soundtrack"
SPOTIFY = "https://open.spotify.com"
DELUXE_ALBUM = SPOTIFY + "/album/2O7j5mKjiyJRLNUo4RZKzs"
EDITORIAL = "https://newsroom.spotify.com/2026-11-20/grand-theft-auto-vi-spotify/"
COMMUNITY = "https://www.reddit.com/r/GTAVI/comments/1y3dwpm/all_radio_stations_as_spotify_playlists/"
# Spotify station editions from the launch guides and the curator's linked collection.
# The embed metadata below verifies the identity, owner and available track listings.
PLAYLIST_IDS = {
    "afrobank-fm": ("37i9dQZF1DXcGCMmxwmtXk", "78KofRsrJuxxIERsUwB29p"),
    "back-country-radio": ("37i9dQZF1DX6wHAaQgEaql", "55co1YrRBojltkoWRb529c"),
    "circoloco-records-radio": ("37i9dQZF1DWSl1fPFVnb1Q", "3MEMCprk4ADKxc2OXfFKzp"),
    "cocoteo-fm": ("37i9dQZF1DXbPiTvBXRA4K", "43ouLDyqfMJojplM5No1mm"),
    "dirty-south-classics": ("37i9dQZF1DXcsfnAtkn9GL", "73Q6d5NMwKED7bLPHiyZg9"),
    "emotion-98-3": ("37i9dQZF1DX1ZcUqIGOF7E", "2TdFTDj2zHd1iOaYKhd7Hb"),
    "flash-fm": ("37i9dQZF1DWW3zGGXBB1qW", "3Y0rvudcTFudnZPCd9P0zN"),
    "gloriana-blues-radio": (None, "3XcU1TZv88cf3h6JS4MJ8p"),
    "honey-fm": ("37i9dQZF1DX2esb8L2ZuIN", "6Xyu4b7HiQX4DjvyxrPebY"),
    "kaleidoscope-fm": ("37i9dQZF1DWWLeCsyejmsh", "3e5SJE5eodeENlOzbHNt5r"),
    "leonida-jazz-radio": ("37i9dQZF1DX4fmN0DulRNZ", "2GX6ULaEPy7SEaYRVMwasJ"),
    "radio-la-ola": ("37i9dQZF1DWXTWbz68EG90", "2pCkQVm9N8rNToJTDG6Vwz"),
    "radio-on-u": ("37i9dQZF1DWSsYu3Tj6uGn", "51NkvBe3E1tWe0D922ilUD"),
    "stockyard-fm": ("37i9dQZF1DXdGIiMhKyPsA", "7oYLH18JClFgILmZo6mEt6"),
    "symphony-fm": ("37i9dQZF1DX5PWb8VgtRes", "1arv3Uq0vv76LTiv1pY3Zj"),
    "the-chamber-106-6": ("37i9dQZF1DWSRdro1ZJ0nG", "4NAn1hqrxdhmrrZbbNZzoR"),
    "the-sniper-of-la-perle": (None, "1Kx703Ud00u9k7vVB3SJfO"),
    "the-vault-radio": (None, "2SfjpwQZD0dr7vKbBz4ALu"),
    "v-rock": ("37i9dQZF1DXaWImNAzqnz6", "55x6P5rx55HFEkLDMEwRcw"),
    "vice-city-fm": ("37i9dQZF1DWX5C5DqVMcOk", "2Sz7cpwnFd76Vi8Vw9oewq"),
    "vice-city-rap-radio": ("37i9dQZF1DWURyzas9h4zm", "31x25723hBHIc2alR6UqZ6"),
    "worldwide-fm": ("37i9dQZF1DXaPd3e6CWiCG", "2Zp4qrABQJluiaJxf9HZgE"),
}
ROCKSTAR_KEYS = {
    "afrobank": "afrobank-fm",
    "circoloco": "circoloco-records-radio",
    "the-chamber": "the-chamber-106-6",
}


def fetch(url, **params):
    for attempt in range(3):
        try:
            response = requests.get(url, params=params, timeout=25)
            response.raise_for_status()
            return response
        except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as error:
            status = error.response.status_code if error.response is not None else None
            if attempt == 2 or (status and status < 500 and status != 429):
                raise
            time.sleep(2 ** attempt)


def next_payload(url):
    doc = BeautifulSoup(fetch(url).content, "html.parser")
    chunks = []
    for tag in doc.select("script"):
        content = tag.get_text()
        if content.startswith("self.__next_f.push([1,"):
            chunks.append(json.loads(content.removeprefix("self.__next_f.push(").removesuffix(")"))[1])
    return "".join(chunks)


def mp3_duration(url):
    file = fetch(url)
    if not file.headers.get("Content-Type", "").startswith("audio/"):
        raise ValueError(f"Unexpected audio response at {url}")
    with tempfile.NamedTemporaryFile() as media:
        media.write(file.content)
        media.flush()
        result = subprocess.check_output([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "csv=p=0", media.name,
        ], text=True)
    return round(float(result), 3)


def get_promos(stations):
    payload = next_payload(MUSIC)
    raw, _ = json.JSONDecoder().raw_decode(payload.split('"playlistKey":"radio","playlist":', 1)[1])

    def build(source):
        slug = source["key"]
        station_id = ROCKSTAR_KEYS.get(slug, slug)
        audio_url = urljoin(ROCKSTAR, quote(source["src"]))
        chapters = [{
            "title": chapter["title"], "artist": chapter["artists"],
            "start": chapter["startPosition"],
            "kind": "dj" if chapter["title"] == source["chapters"][0]["title"] else "music",
        } for chapter in source["chapters"]]
        return {
            "stationId": station_id, "station": stations[station_id]["name"], "slug": slug,
            "audioUrl": audio_url, "artUrl": urljoin(ROCKSTAR, quote(source["albumArt"]["src"])),
            "sourceUrl": MUSIC + "/" + slug, "duration": mp3_duration(audio_url), "chapters": chapters,
        }

    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(build, raw))


def fold(text):
    normalized = unicodedata.normalize("NFKD", text.casefold())
    return re.sub(r"[^a-z0-9]", "", normalized.replace("&", "and")) or text.strip()


def title_key(title):
    # Featured artist credits sometimes appear in the title field on a music service.
    title = re.sub(r"\s*[\[(](?:ft\.?|feat\.?|featuring|with)\s+[^\])]+[\])]", "", title, flags=re.I)
    # A remaster label describes a mastering edition. Keep live, edit, mix and cover labels intact.
    suffix = r"(?:\d{4}\s+)?re-?master(?:ed)?(?:\s+(?:version|in|\d{4}))*"
    title = re.sub(rf"\s*(?:-\s*{suffix}|[\[(]{suffix}[\])])\s*$", "", title, flags=re.I)
    return fold(title)


def artist_keys(artist):
    names = re.split(r"\s+(?:ft\.?|feat\.?|featuring|with|and|&)\s+|,\s*|\s+·\s+", artist, flags=re.I)
    return {key for name in [artist, *names] if (key := fold(name))}


def track_matches(candidate_artist, artist):
    return bool(artist_keys(candidate_artist) & artist_keys(artist))


def spotify_entity(path):
    page = BeautifulSoup(fetch(SPOTIFY + "/embed/" + path).content, "html.parser")
    state = json.loads(page.select_one("script#__NEXT_DATA__").get_text())
    return state["props"]["pageProps"]["state"]["data"]["entity"]


def spotify_tracks(entity):
    return [{
        "title": entry["title"], "artist": entry["subtitle"], "spotifyUrl": SPOTIFY + "/track/" + entry["uri"].split(":")[-1],
    } for entry in entity["trackList"] if entry.get("uri", "").startswith("spotify:track:")]


def get_playlist(task):
    station_id, name, playlist_id, official = task
    url = SPOTIFY + "/playlist/" + playlist_id
    entity = spotify_entity("playlist/" + playlist_id)
    if entity["id"] != playlist_id or not entity.get("trackList") or official != (entity["subtitle"] == "Spotify"):
        raise ValueError(f"Review changed playlist {url}")
    playlist = {
        "stationId": station_id, "station": name, "url": url, "curator": entity["subtitle"],
        "official": official, "sourceUrl": EDITORIAL if official else COMMUNITY,
    }
    return playlist, spotify_tracks(entity)


def guide_tracks():
    payload = next_payload(GUIDE)
    start = re.search(r'"tracks":(?=\[\[")', payload).end()
    rows, _ = json.JSONDecoder().raw_decode(payload[start:])
    songs = []
    for _, title, artist, _, links in rows:
        song = {"title": title, "artist": artist}
        for platform, path in links:
            for name, pattern, prefix, field in [
                ("appleMusic", r"us/song/\d+", "https://music.apple.com/", "appleMusicUrl"),
                ("youtube", r"watch\?v=[\w-]{11}", "https://www.youtube.com/", "youtubeUrl"),
            ]:
                if name == platform and re.fullmatch(pattern, path):
                    song[field] = prefix + path
        if len(song) > 2:
            songs.append(song)
    # A discovery guide sometimes links to another edit, cover or movement. Check
    # the listening provider's own labels before attaching it to a game credit.
    apple_ids = sorted({song["appleMusicUrl"].rsplit("/", 1)[-1] for song in songs if "appleMusicUrl" in song})
    by_id = {}
    for i in range(0, len(apple_ids), 100):
        query = {"id": ",".join(apple_ids[i:i + 100]), "country": "us", "limit": 200}
        response = fetch("https://itunes.apple.com/lookup", **query)
        by_id.update({str(r["trackId"]): r for r in response.json()["results"] if "trackId" in r})
    for song in songs:
        if "appleMusicUrl" in song:
            url = song.pop("appleMusicUrl")
            release = by_id.get(url.rsplit("/", 1)[-1])
            if release and title_key(release["trackName"]) == title_key(song["title"]):
                if track_matches(release["artistName"], song["artist"]):
                    song["appleMusicUrl"] = url
    return songs


def match_links(track, candidates):
    # Never substitute an uncredited artist, live performance, cover or remix by title alone.
    result = {}
    key = title_key(track["title"])
    artists = [track.get("performer") or track["artist"]]
    for candidate in candidates:
        if title_key(candidate["title"]) != key:
            continue
        if not any(track_matches(candidate["artist"], artist) for artist in artists):
            continue
        for field in ("spotifyUrl", "appleMusicUrl", "youtubeUrl"):
            if field in candidate:
                result.setdefault(field, candidate[field])
    return result


def main():
    catalog = json.loads((ROOT / "data/catalog.json").read_text())
    stations = {s["id"]: s for s in catalog["stations"]}
    promos = get_promos(stations)
    tasks = [(sid, stations[sid]["name"], pid, i == 0)
             for sid, ids in PLAYLIST_IDS.items() for i, pid in enumerate(ids) if pid]
    playlists = []
    candidates = {sid: [] for sid in stations}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for playlist, songs in pool.map(get_playlist, tasks):
            playlists.append(playlist)
            candidates[playlist["stationId"]].extend(songs)
    additional = spotify_tracks(spotify_entity(DELUXE_ALBUM.removeprefix(SPOTIFY + "/"))) + guide_tracks()
    # Individually checked artist uploads and classical recordings identified by movement
    # and performer when the service catalogs the same recording under a different title.
    checked = json.loads((ROOT / "scripts/recordings.json").read_text())
    checked_by_song = {(song["title"], song["artist"]): song for song in checked}
    songs = []
    for station_id, station in stations.items():
        available = candidates[station_id] + additional
        for entry in station["tracks"]:
            links = match_links(entry, available)
            recording = checked_by_song.get((entry["title"], entry["artist"]), {})
            if recording.get("performer") == entry.get("performer"):
                links.update({field: value for field, value in recording.items() if field.endswith("Url")})
            if links:
                songs.append({"stationId": station_id, "station": station["name"],
                              "title": entry["title"], "artist": entry["artist"], **links})
    payload = {
        "checked": date.today().isoformat(), "officialHub": "https://spotify.link/grandtheftauto",
        "trackLinkSources": [GUIDE, EDITORIAL, COMMUNITY, DELUXE_ALBUM], "promos": promos, "playlists": playlists, "songs": songs,
    }
    output = ROOT / "data/media.json"
    pending = output.with_suffix(".tmp")
    pending.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    pending.replace(output)
    print(f"{len(promos)} station promos, {len(playlists)} station playlists, {len(songs)} linked catalog entries.")


if __name__ == "__main__":
    main()
