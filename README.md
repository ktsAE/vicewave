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

## Driving controls

Add Vicewave to your phone’s home screen for a standalone view. **Dash view** gives the two dials larger tuning arrows and a side-by-side layout on wide screens. It turns on automatically on short landscape displays. The header switch lets you choose a layout. On Demand keeps its own dial selection when you return to live radio.

On browsers with Media Session support, the lock screen and compatible Bluetooth stereos can show the station, track or episode. Next and Previous tune the live dial or move between episodes of the current show. Pause switches live radio off, and Play rejoins its broadcast clock. Episodes pause and resume in place. Supported system seek controls operate within the selected episode, including for excerpts of longer talk recordings. A plain AUX cable carries audio. The website runs in the browser on the phone or display.

## GitHub Pages

The site runs directly from the repository root. In the repository’s **Settings → Pages**, choose **Deploy from a branch**, select **main** and **/(root)**, and save. The station dial, tracklists and On Demand work under the repository URL without a build step or API key. [GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

On a static host, the browser streams audio and loads station artwork directly from the credited external sources. Availability and buffering depend on those hosts and on the browser’s audio codecs. The public repository contains the app, catalogs, source links and licensed fonts. Optional local media stays in the ignored assets folders. Rockstar Games, Take-Two and the respective rights holders retain their rights in the game, artwork and recordings.

Seven dial covers use Rockstar’s 1600 × 1600 artwork. Another 17 use the 400 × 400 station square inside a 1280 × 720 station-mix image. The browser takes the square at its original pixel size and shares it with Tracklists, On Demand and system media controls. The Vault uses its existing pink icon. Source URLs and crop coordinates are in `data/artwork.json`. For offline use, the launcher recognizes the corresponding square at `assets/covers/<station-id>-400.webp`. [Rockstar station artwork](https://www.rockstargames.com/VI/music) · [Honey FM station mix](https://www.youtube.com/watch?v=W_e5eUNgIqE)

## On Demand

Open **On Demand**, slide between show covers, and choose an episode from the selected collection. Browsing keeps the current audio playing. The library links 20 full episodes, totaling 3 hours, 36 minutes and 18 seconds. Each episode remembers its place in this browser. Finishing an episode or returning to the dial rejoins the live broadcast if the radio was on. The five WKTT and The Wipe specials use their original online talk-radio excerpts.

| Podcast | Episodes included |
| --- | --- |
| Drunk Kings | #402 Family, #403 The Real Dimez, #404 DWNPLY, #405 Wax, #406 Stevie J |
| Final Act | I Was In a Titty Bar, Juggling with Dog Turds, Sucked Into a Girl-Pool, Meltdown |
| Fuck, Marry, Murder | Eddie Low, Russo Assassination, Fatal Incursion, Brenda Strokes, Bohan Beach Killer, Crime Couples |
| The Safe Trap | #021 Countdown to Lockdown, #022 The Alchemist, #023 Too Late Now |
| Vice City True Stories | #047 Camila Fuentes, #048 The Last Frontier |

Episode titles come from the English media text in Xbox build 1.0.2.1 (table 1111). The source audio index groups these unnamed files with Radio La Ola. The shows, guests and stories can be identified in the recordings themselves. Each podcast entry in `data/programs.json` links to its original Opus file. For offline listening, the launcher looks for `assets/podcasts/<episode-id>.ogg` and plays the original Opus on compatible browsers. An installed `<episode-id>.mp3` serves as a fallback. [Game text index](https://github.com/psviethoa/gta6-text-en/tree/6c4cd177a46fa4cb08eac4da69dffcfc8bf01949) · [Original audio index](https://six.mics.dev/explorer/data/radio_music.json) · [Rockstar credits](https://www.rockstargames.com/VI/credits#gta-media)

The **Special Stations** collection tunes directly to The Vault Radio, The Sniper of La Perle or the local Thrillbilly Mud Club Radio signal.

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

## Audio quality

Vicewave plays each recording in its source format. The current stereo sources measured as follows on November 24, 2026.

| Source | Codec | Sample rate | Approximate bitrate |
| --- | --- | --- | --- |
| 760 individually matched songs | Opus | 48 kHz | 129 kbps median |
| 24 continuous station mixes | MP3 | 44.1 kHz | 145–186 kbps per mix, 176 kbps median |
| 20 original podcast episodes | Opus | 48 kHz | 129–130 kbps |
| WKTT and The Wipe talk recordings and their extracted ad segments | AAC-LC | 48 kHz | 81 kbps |
| Seven official DJ previews | MP3 | 44.1 or 48 kHz | 192–320 kbps |

Bitrates are averages and vary by codec and recording. When tuning, the receiver prefers an already buffered game song over a ready mix if its title, artist, chapter length and playback position match closely. A mix already playing continues across its chapter boundaries. A higher-quality station capture can be imported under **Tracklists → My recordings** and plays in its supplied format.

## Recordings and sources

Under **Tracklists → My recordings**, import a complete station capture to hear its timing, dialogue and ads intact. Alternatively, select a music folder to match artist and title against the credits. You can attach an individual recording from a track’s details. The **Add commercial reel** option accepts your own 2h 23m 35s copy of the linked commercial compilation and schedules its documented breaks. Imported audio stays in the browser’s IndexedDB.

Music assignments and official previews come from Rockstar. The guide links the source of each entry and station mix. [Rockstar credits](https://www.rockstargames.com/VI/credits) · [Rockstar music](https://www.rockstargames.com/VI/music) · [Game recordings](https://six.mics.dev/radio) · [Station reconstruction archive](https://archive.org/details/gta-6-radio-audio-bk-20261124-v2) · [Commercial index recording](https://www.youtube.com/watch?v=hGZ3ocHlRk4) · [WKTT recording](https://gta.guide/gta-6/soundtrack/wktt) · [The Wipe recording](https://gta.guide/gta-6/soundtrack/the-wipe)

The Python launcher streams cataloged audio from its source and serves browser byte-range requests. It binds to the loopback address. It keeps recently heard game recordings in a 64 MiB memory cache for quick seeks. While audio is playing, the dial gradually requests the first 64 KiB of each station mix so the launcher can answer future MP3 seek-table requests locally. Data Saver skips speculative station and header requests. For sequential sources the archive cache uses `$XDG_CACHE_HOME/vicewave/broadcasts-v1` or `~/.cache/vicewave/broadcasts-v1` and evicts inactive files above a 1 GiB target.

The project ships its source indexes in `data/`. The optional catalog refresh tools in `scripts/` use Requests and Beautiful Soup. The media refresh can use ffprobe to verify durations.

<details>
<summary>Original On Demand cover art</summary>

The six fan-designed covers in `assets/shows/` were generated as one sheet with the built-in ImageGen tool and exported as square WebP images. WKTT and The Wipe use their station art.

An original Vice City-inspired radio artwork sheet for the Vicewave fan radio project. Landscape 3:2 aspect ratio, EXACTLY three equal columns and two equal rows, six square album covers packed edge-to-edge with perfectly straight boundaries, no gutters, no borders or cast shadows between covers. Each mini sleeve is a different professionally art-directed, bold, screenprinted Florida radio poster, vintage halftone, slightly worn ink, frontal flat art, high-contrast and instantly recognizable in a car. Render ONLY each specified title, with exact spelling. Upper left: 'DRUNK KINGS', gold blackletter and a gold trophy goblet tilted against near-black and purple with bold yellow rays. Upper middle: 'FINAL ACT', large icy white condensed cinema lettering at the bottom, a dramatically spotlit empty red theatre chair and midnight blue backstage velvet. Upper right: 'FUCK, MARRY, MURDER', bold stacked hot-magenta typography and a red lipstick kiss on torn cream tabloid paper. Lower left: 'THE SAFE TRAP', bold cream lettering over an orange dusk, a small isolated illustrated wooden cabin and deep green pines. Lower middle: 'VICE CITY TRUE STORIES', black heavy title with hand-lettered smaller 'True Stories', a lilac and teal halftoned South Florida skyline with a palm silhouette on aged ivory. Lower right: 'SPECIAL STATIONS', burgundy and coral with a stylized chrome car aerial rising over the Florida coast at night, cream block lettering. No other lettering, no UI, no device mockups. Keep every title within the central 80% of its own square, and make typography substantial.
</details>
