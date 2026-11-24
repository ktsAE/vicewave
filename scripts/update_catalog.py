#!/usr/bin/env python3
"""Rebuild the radio metadata from Rockstar's rendered credits. Requires beautifulsoup4."""
import argparse
import json
import re
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
CREDITS = "https://www.rockstargames.com/VI/credits"
MIX_REFERENCE = "https://www.pcgamer.com/games/grand-theft-auto/gta-6-radio-songs/"
DIAL_REFERENCE = "https://allthings.how/gta-6-radio-stations-list/"
MUD_CLUB = "https://culturedvultures.com/gta-6-how-to-listen-to-korn-and-linkin-park/"
WIKI = "https://gta.wiki/w/Radio_Stations_in_GTA_VI"
PRESS_LIST = "https://consequence.net/2026/11/gta-6-radio-stations-songs-soundtrack/"
HONEY_REFERENCE = "https://www.gamerguides.com/grand-theft-auto-vi/database/radio-stations/r-b/honey-fm"
# Order from an R1 cycle of the in-game Chapter 1 dial, followed by unlockable playlists.
DIAL_ORDER = (
    "afrobank-fm back-country-radio the-chamber-106-6 circoloco-records-radio cocoteo-fm "
    "dirty-south-classics emotion-98-3 flash-fm gloriana-blues-radio honey-fm kaleidoscope-fm "
    "leonida-jazz-radio radio-la-ola radio-on-u stockyard-fm symphony-fm the-wipe "
    "vice-city-rap-radio vice-city-fm v-rock wktt worldwide-fm the-vault-radio the-sniper-of-la-perle"
).split()
STATION_NAMES = {
    "AFROBANK FM": "AfroBank FM",
    "CIRCOLOCO RECORDS RADIO": "CircoLoco Records Radio",
    "RADIO ON-U": "Radio On-U",
    "THE SNIPER OF LA PERLE": "The Sniper of La Perle",
    "THE WIPE TALK RADIO": "The Wipe",
    "WKTT TALK RADIO": "WKTT",
}
SHOW_NAMES = {"EARLY AF": "Early AF", "SHE GOT ASSETS": "She Got Assets",
              "ASK DR. NITA": "Ask Dr. Nita", "THE TAP IN": "The Tap In",
              "THE NOOK": "The Nook"}
TALK = {"THE WIPE TALK RADIO", "WKTT TALK RADIO"}


def words(element):
    return " ".join(element.get_text(" ", strip=True).split())


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def display(name):
    return STATION_NAMES.get(name, name.title().replace("Fm", "FM"))


def paragraphs(element):
    return [words(line) for line in element.find_all("p")]


def songs(credit_group, program=None):
    entries = []
    for row in credit_group.find_all("div", recursive=False):
        title = words(row.q)
        lines = paragraphs(row)
        artist = lines[0]
        entry = {"title": title, "artist": artist}
        if program:
            entry["program"] = program
        if program == "Liquid City":
            # The first line here names the writers. Rockstar credits Liquid Wilson as show host.
            entry["artist"] = "Liquid Wilson"
        elif artist.startswith("By:"):
            entry["artist"] = artist.removeprefix("By:").strip()
            if len(lines) > 1 and lines[1].lower().startswith("performed by"):
                performer = re.sub(r"^performed by:?\s*", "", lines[1], flags=re.I)
                if performer.endswith(",") and len(lines) > 2:
                    performer += " " + lines[2]
                entry["performer"] = performer
        entries.append(entry)
    return entries


def talk_program(section, station):
    name = SHOW_NAMES.get(words(section.h4), words(section.h4).title())
    # Each talk show's first cast credit names its presenter and actor.
    rows = section.find_all("div", recursive=False)
    host = f"{words(rows[0].p)} as {words(rows[0].q)}"
    station["programs"].append({"name": name, "hosts": [host]})
    station["hosts"].append(host)
    for row in rows[1:]:
        title = words(row.q) if row.q else ""
        lines = paragraphs(row)
        if title == "Touch & Go" or (title and not lines):
            station["tracks"].append({"title": title, "artist": lines[0] if lines else "",
                                      "program": name, "role": "theme"})


def imaging(group):
    return {"name": words(group.h4).title(), "credits": [
        {"role": words(row.q) if row.q else "Music", "names": paragraphs(row)}
        for row in group.find_all("div", recursive=False)
    ]}


def unresolved_placements(sections, groups):
    # Keep claims that disagree with the official station headings out of the simulated rotation.
    candidates = []
    for station_id, items in {
        "back-country-radio": [("Last Thing You Need", "Morgan Wallen")],
        "flash-fm": [("Ain’t in LA", "Adéla"), ("Gimme More", "Britney Spears"),
                     ("Havana", "Camila Cabello ft. Young Thug"), ("Mantra", "JENNIE"),
                     ("SWEET SPOT", "Justin Bieber ft. Sexyy Red"), ("Skrilla", "Kodak Black"),
                     ("Sawadika", "LISA"), ("Illegal", "PinkPantheress"),
                     ("Only Girl (In the World)", "Rihanna"), ("DANCE…", "Slayyyter")],
        "kaleidoscope-fm": [("Herz aus Glas", "Marianne Rosenberg")],
        "the-chamber-106-6": [("Battery", "Metallica"), ("In the End", "Linkin Park")],
        "v-rock": [("For What It’s Worth", "Stevie Nicks")],
    }.items():
        for title, artist in items:
            candidates.append({"stationId": station_id, "title": title, "artist": artist,
                               "source": PRESS_LIST, "placementStatus": "reported"})
    # Rockstar credits these recordings as additional music or score. GTA Wiki reports that
    # story progress adds them to the two stations; the station credits omit these assignments.
    for group in ("REAL DIMEZ", "DWNPLY"):
        for track in songs(groups["ADDITIONAL MUSIC"][group]):
            candidates.append({**track, "stationId": "vice-city-rap-radio",
                               "source": WIKI + "#Vice_City_Rap_Radio",
                               "placementStatus": "reported story unlock"})
    score_titles = {"The Night's Coming", "My Only Vice", "Flower In A Hurricane"}
    for row in sections["MAIN SCORE"].find_all("q"):
        if words(row) in score_titles:
            candidates.append({"stationId": "flash-fm", "title": words(row),
                               "artist": words(row.parent.p), "source": WIKI + "#Flash_FM",
                               "placementStatus": "reported story unlock"})
    return candidates


def build(html, as_of):
    soup = BeautifulSoup(html, "html.parser")
    media = soup.find(id="gta-media")
    sections = {words(h): h.parent for h in media.select("h3")}
    groups = {name: {words(h): h.parent for h in section.find_all("h4")}
              for name, section in sections.items()}
    stations = {}
    for name, section in groups.items():
        if name not in TALK and not any(host in section for host in ("RADIO HOST", "RADIO HOSTS", "HOSTED BY")):
            continue
        if name == "HONEY FM - LIQUID CITY":
            continue
        station = {"id": slug(display(name)), "name": display(name),
                   "kind": "talk" if name in TALK else "music", "hosts": [],
                   "tracks": [], "programs": []}
        stations[name] = station
        for label, group in section.items():
            if label in ("RADIO HOST", "RADIO HOSTS", "HOSTED BY"):
                station["hosts"] = paragraphs(group)
            elif label == "PRESENTED BY":
                station["presenters"] = paragraphs(group)
            elif label == "SONGS":
                station["tracks"] = songs(group)
            elif label in ("EARLY AF", "THE TAP IN", "THE NOOK"):
                station["programs"].append({"name": SHOW_NAMES[label], "hosts": paragraphs(group)})
            elif label in ("UNDERSCORE", "DOUG VAN DYKE THEME SONG", "THEME SONG & IDENT") or "MUSIC BEDS" in label:
                station.setdefault("imaging", []).append(imaging(group))
            elif name in TALK and "IMAGING" not in label:
                talk_program(group, station)
        if name in ("THE VAULT RADIO", "THE SNIPER OF LA PERLE"):
            station["unlockable"] = True

    liquid = groups["HONEY FM - LIQUID CITY"]
    honey = stations["HONEY FM"]
    honey["programs"].append({"name": "Liquid City", "hosts": paragraphs(liquid["RADIO HOST"])})
    honey["tracks"].extend(songs(liquid["ORIGINAL SONGS FOR LIQUID CITY"], "Liquid City"))
    honey.setdefault("imaging", []).append({**imaging(liquid["IDENT MUSIC BEDS"]), "program": "Liquid City"})
    cyclone = {"title": "Cyclone", "artist": "Baby Bash ft. T-Pain"}
    if not any(s["title"].casefold() == "cyclone" for s in honey["tracks"]):
        honey["tracks"].append({**cyclone, "placementStatus": "observed in game", "source": HONEY_REFERENCE})

    # The credits identify both sets separately. PC Gamer files the sets under VCRR.
    rap = stations["VICE CITY RAP RADIO"]
    for mix, title in [("BODEGA THE DJ", "Bodega the DJ"), ("DJ STEVIE J", "DJ Stevie J")]:
        rap["programs"].append({"name": title, "hosts": [title], "placementSource": MIX_REFERENCE})
        rap["tracks"].extend(songs(groups[mix]["SONGS"], title))

    ad_samples = []
    for label in paragraphs(groups["RADIO ADS"]["MUSIC SAMPLED"]):
        title, artist = re.fullmatch(r'["“](.+?)["”] by (.+)', label).groups()
        ad_samples.append({"title": title, "artist": artist})
    index = {station["id"]: station for station in stations.values()}
    ordered = [index.pop(station_id) for station_id in DIAL_ORDER]
    ordered.extend(index.values())  # Preserve new credited stations on a future refresh.
    local_tracks = [track for track in songs(groups["ADDITIONAL MUSIC"]["ADDITIONAL SONGS"])
                    if track["title"].casefold() in {"in the end", "freak on a leash"}]
    if len(local_tracks) != 2:
        raise ValueError("Verify Thrillbilly placements against Rockstar’s additional songs.")
    ordered.append({"id": "thrillbilly-mud-club-radio", "name": "Thrillbilly Mud Club Radio",
                    "local": True, "kind": "music", "hosts": [], "programs": [], "source": MUD_CLUB,
                    "tracks": [{**track, "source": MUD_CLUB, "placementStatus": "observed in game"}
                               for track in local_tracks]})
    return {"asOf": as_of, "source": CREDITS, "dialOrderSource": DIAL_REFERENCE, "stations": ordered,
            "adSamples": ad_samples, "unverifiedPlacements": unresolved_placements(sections, groups)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, help="Use a saved copy of the official HTML.")
    parser.add_argument("--as-of", default=date.today().isoformat())
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "catalog.json")
    args = parser.parse_args()
    if args.html:
        html = args.html.read_bytes()
    else:
        request = Request(CREDITS, headers={"User-Agent": "LeonidaRadioCatalog/1.0"})
        with urlopen(request, timeout=45) as response:
            html = response.read()
    catalog = build(html, args.as_of)
    if len(catalog["stations"]) < 24 or sum(len(s["tracks"]) for s in catalog["stations"]) < 800:
        raise ValueError("Unexpectedly small catalog. Check the structure of Rockstar's credits.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)


if __name__ == "__main__":
    main()
