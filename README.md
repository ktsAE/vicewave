# Vicewave

Vicewave is an unofficial, account-free GTA VI radio dial. Slide the station covers left or right to join a broadcast in progress. Each station keeps time while you listen elsewhere, browse the tracklists or switch off the receiver.

## Listen

Open the site in a browser, or run the local launcher with Python 3.9 or newer.

```sh
python3 radio.py
```

The launcher opens [the radio](http://127.0.0.1:6177/). If the browser asks for an interaction before playing sound, tap the dial or the power switch once. Use the arrows, a swipe, a trackpad or the channel markers to tune. On a standard gamepad, hold D-pad left and use the shoulder buttons to tune or Cross/A to toggle power.

Open **Tracklists** at the top to search all stations by track, artist, show or commercial. **Station tracklist** at the foot of the dial opens the current station. **Open playlist on Spotify** takes you to that station’s playlist when available. Use **+** there to save it. Listening to the dial requires no Spotify account.

To keep the browser closed on startup, run `python3 radio.py --no-browser`. To choose another port, add `--port 6178`. Use the same browser and address to retain imported audio and the last selected station.

## GitHub Pages

The site runs directly from the repository root. In the repository’s **Settings → Pages**, choose **Deploy from a branch**, select **main** and **/(root)**, and save. The station dial, tracklists and On Demand work under the repository URL without a build step or API key. [GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

On a static host, the browser streams audio and loads station artwork directly from the credited external sources. Availability and buffering depend on those hosts and on the browser’s audio codecs. The public repository contains the app, catalogs, source links and licensed fonts. Optional local media stays in the ignored assets folders. Rockstar Games, Take-Two and the respective rights holders retain their rights in the game, artwork and recordings.

## On Demand

Open **On Demand** and expand a series to choose an episode. The library links 20 full episodes, totaling 3 hours, 36 minutes and 18 seconds. Each episode remembers its place in this browser. Finishing an episode or returning to the dial rejoins the live broadcast if the radio was on. The five WKTT and The Wipe specials use their original online talk-radio excerpts.

| Podcast | Episodes included |
| --- | --- |
| Drunk Kings | #402 Family, #403 The Real Dimez, #404 DWNPLY, #405 Wax, #406 Stevie J |
| Final Act | I Was In a Titty Bar, Juggling with Dog Turds, Sucked Into a Girl-Pool, Meltdown |
| Fuck, Marry, Murder | Eddie Low, Russo Assassination, Fatal Incursion, Brenda Strokes, Bohan Beach Killer, Crime Couples |
| The Safe Trap | #021 Countdown to Lockdown, #022 The Alchemist, #023 Too Late Now |
| Vice City True Stories | #047 Camila Fuentes, #048 The Last Frontier |

Episode titles come from the English media text in Xbox build 1.0.2.1 (table 1111). The source audio index groups these unnamed files with Radio La Ola. The shows, guests and stories can be identified in the recordings themselves. Each podcast entry in `data/programs.json` links to its original Opus file. When a local MP3 exists at the episode’s `audioUrl` path under `assets/podcasts/`, the Python launcher uses that copy and the episode also works offline. [Game text index](https://github.com/psviethoa/gta6-text-en/tree/6c4cd177a46fa4cb08eac4da69dffcfc8bf01949) · [Original audio index](https://six.mics.dev/explorer/data/radio_music.json) · [Rockstar credits](https://www.rockstargames.com/VI/credits#gta-media)

The **Special stations** shortcuts tune directly to The Vault Radio, The Sniper of La Perle or the local Thrillbilly Mud Club Radio signal.

## What you hear

| Broadcast material | Coverage on November 24, 2026 |
| --- | --- |
| Station dial | 22 regular stations, two unlockables and the local Thrillbilly Mud Club signal |
| Station mixes | 24 community reconstructions totaling 66 hours and 14 minutes, indexed against the creators’ chapter timings |
| Individually seekable game recordings | 760 recordings matched by title and artist to 763 station placements |
| DJ previews | Seven official Rockstar station previews |
| Talk radio | Recorded WKTT and The Wipe broadcasts with the original shows, breaks and IDs |
| The Sniper of La Perle | 20 of the 22 credited mixtape tracks in rotation with commercials |
| Catalog | 847 track placements and 26 additional reported placements, labeled separately |
| Commercial archive | 170 indexed chapters grouping 215 spots. The rotation can insert 37 identified ad segments from the talk recordings. An imported copy of the indexed reel supplies all 170 chapters. |

Recorded broadcasts retain their source order. The music mixes generally run continuously through three tracks at a time. The scheduler inserts a rotating recorded commercial at a known track boundary and resumes with the next song. Mixes with indexed commercials keep their built-in breaks. Stations share a clock that persists across tabs, refreshes and browser restarts on this device. When a new listener opens Flash FM, the clock starts partway through one of its early songs. When an archived station buffers, the dial can join a recording matched by title and artist at the current song position. Shortened station edits stay with the archived mix. It returns to the mix at a chapter boundary or the end of the song. Credited game recordings missing from a mix also rotate on that station. The receiver starts buffering both neighbors while the selected station loads. It also prepares upcoming breaks, the station under the pointer or keyboard focus, and the next station in the direction you are scrolling. Recent stations can reuse their buffered audio. Switching to a ready station starts the crossfade immediately.

Some source mixes omit or mute songs. The public recordings establish portions of the original broadcasts. The game’s exact rotation, every DJ transition and the complete advertising schedule remain unverified. All 24 current mix recordings support byte-range seeking. A slow source can still require buffering. During a station change, the old signal fades within about half a second, even if the incoming station is slow. A longer wait can leave a gap. Tuning indicates a station change or startup. Buffering indicates a wait on the station you are already listening to. Retrying audio means the current source failed to play and will be tried again after its 20-second cooldown if it is still scheduled.

## Recordings and sources

Under **Tracklists → My recordings**, import a complete station capture to hear its timing, dialogue and ads intact. Alternatively, select a music folder to match artist and title against the credits. You can attach an individual recording from a track’s details. The **Add commercial reel** option accepts your own 2h 23m 35s copy of the linked commercial compilation and schedules its documented breaks. Imported audio stays in the browser’s IndexedDB.

Music assignments and official previews come from Rockstar. The guide links the source of each entry and station mix. [Rockstar credits](https://www.rockstargames.com/VI/credits) · [Rockstar music](https://www.rockstargames.com/VI/music) · [Game recordings](https://six.mics.dev/radio) · [Station reconstruction archive](https://archive.org/details/gta-6-radio-audio-bk-20261124-v2) · [Commercial index recording](https://www.youtube.com/watch?v=hGZ3ocHlRk4) · [WKTT recording](https://gta.guide/gta-6/soundtrack/wktt) · [The Wipe recording](https://gta.guide/gta-6/soundtrack/the-wipe)

The Python launcher streams cataloged audio from its source and serves browser byte-range requests. It binds to the loopback address. It keeps recently heard game recordings in a 64 MiB memory cache for quick seeks. While audio is playing, the dial gradually requests the first 64 KiB of each station mix so the launcher can answer future MP3 seek-table requests locally. Data Saver skips speculative station and header requests. For sequential sources the archive cache uses `$XDG_CACHE_HOME/vicewave/broadcasts-v1` or `~/.cache/vicewave/broadcasts-v1` and evicts inactive files above a 1 GiB target.

The project ships its source indexes in `data/`. The optional catalog refresh tools in `scripts/` use Requests and Beautiful Soup. The media refresh can use ffprobe to verify durations.
