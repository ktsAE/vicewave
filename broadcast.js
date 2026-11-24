import { norm } from './ui.js';
// Each station has a deterministic loop. Wall time advances every loop even when the
// station is silent on this device. Only the audible station and nearby cues need audio.
export function hash(text) {
  let value = 2166136261;
  for (const c of text) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return value >>> 0;
}

export function stationOrigin(station) {
  const key = 'vicewave:air-session';
  const sharedKey = 'vicewave:air-origin';
  const now = Date.now();
  const valid = (value) => value > 0 && value <= now;
  let epoch;
  try {
    const session = Number(sessionStorage.getItem(key));
    if (valid(session)) epoch = session;
  } catch {}
  try {
    const shared = Number(localStorage.getItem(sharedKey));
    if (valid(shared)) return shared;
  } catch {}
  epoch ??= now - Math.round(firstTuneElapsed(station) * 1000);
  try {
    localStorage.setItem(sharedKey, String(epoch));
  } catch {}
  try {
    sessionStorage.setItem(key, String(epoch));
  } catch {}
  return epoch;
}

function take(asset, start = 0, end = asset.duration) {
  return { ...asset, start, duration: end - start };
}

export function buildStation(station, sources, local = {}) {
  const id = station.id;
  const feed = sources.broadcasts.find((x) => x.stationId === id);
  const clip = sources.media.promos.find((x) => x.stationId === id);
  const sheet = sources.chapters[id];
  const tracks = sources.nativeTracks
    .map((x, i) => ({ ...x, url: sources.direct ? x.audioUrl : '/signal/track/' + i }))
    .filter((x) => x.stationId === id);
  const imported = local.tracks || [];
  const game = (sources.acceptsGameAudio === false ? [] : sources.gameRecordings?.tracks || [])
    .filter((x) => x.stations.includes(id))
    .map((x) => ({
      kind: 'track',
      title: x.title,
      description: x.artist,
      artist: x.artist,
      duration: x.duration,
      url: (sources.direct ? sources.gameRecordings.audioBase : '/signal/game/') + x.file,
    }));
  const remaining = new Set(game);
  const nameKey = (value) => norm(value).replaceAll(' ', '');
  const artistKey = (value) =>
    norm(value)
      .replace(/\b(?:featuring|feat|ft)\b/g, '')
      .replaceAll(' ', '');
  function credit(chapter) {
    const title = nameKey(chapter.title),
      artist = artistKey(chapter.artist);
    return game.find(
      (x) =>
        nameKey(x.title) === title && (artist ? artistKey(x.artist) === artist : x.artist === chapter.artist),
    );
  }
  const cuts = [];
  let musicSinceBreak = 0,
    breakCount = 0;
  function adBreak() {
    if (!sources.ads.length) return;
    cuts.push({ adSlot: breakCount++ });
    musicSinceBreak = 0;
  }
  function songs(items) {
    for (const x of items) {
      cuts.push(take({ ...x, kind: 'track', description: x.artist || station.name }));
      if (++musicSinceBreak === 3) adBreak();
    }
  }
  function program() {
    if (!feed) return;
    const indexed =
      sheet && Math.abs(sheet.duration - feed.duration) < 2
        ? sheet.chapters.map((chapter, i, chapters) => {
            const song = chapter.kind === 'music' && credit(chapter);
            if (!song) return chapter;
            remaining.delete(song);
            const span = (chapters[i + 1]?.start ?? feed.duration) - chapter.start;
            // A much longer song file may be a different edit. Joining its
            // middle by timestamp could skip or repeat whole phrases.
            if (song.duration > span + Math.max(8, span * 0.05)) return chapter;
            return { ...chapter, game: song };
          })
        : [];
    const asset = {
      ...feed,
      url: sources.direct ? feed.archiveUrl : feed.audioUrl,
      title: station.name,
      description: 'Station reconstruction',
      chapters: indexed,
    };
    // Keep the source running across songs. Split only at verified chapter
    // boundaries for a commercial, so a track never gets cut off mid-phrase.
    let beginning = 0,
      count = 0;
    const hasBakedAds = indexed.some((c) => c.kind === 'ad');
    for (const chapter of indexed) {
      if (chapter.kind !== 'music' && chapter.kind !== 'track') continue;
      if (!hasBakedAds && count === 3 && chapter.start > beginning + 10) {
        cuts.push(take(asset, beginning, chapter.start));
        adBreak();
        beginning = chapter.start;
        count = 0;
      }
      count++;
    }
    if (beginning < feed.duration) cuts.push(take(asset, beginning));
  }

  if (local.capture) cuts.push(take(local.capture));
  else if (station.kind === 'talk' && sources.talk[id]) {
    const recording = sources.talk[id];
    cuts.push(
      take({
        title: station.name,
        description: 'Recorded broadcast',
        url: sources.direct ? recording.audioUrl : '/signal/talk/' + id,
        duration: recording.recordingDuration,
        chapters: sources.talkChapters[id],
        kind: 'recording',
      }),
    );
    if (feed) program();
  } else {
    if (clip) {
      cuts.push(
        take({
          ...clip,
          url: sources.direct ? clip.audioUrl : '/signal/preview/' + id,
          kind: 'preview',
          title: station.name,
          description: 'Rockstar station preview',
        }),
      );
      adBreak();
    }
    songs(imported);
    program();
    // Complete each rotation with credited game recordings missing from the
    // sourced mix. On the mixtape station the credits provide the whole order.
    songs([...remaining]);
    songs(tracks.filter((x) => !credit(x)));
    if (feed || tracks.length || imported.length) {
      if (cuts.at(-1)?.adSlot === undefined) adBreak();
    }
    if (!cuts.length) {
      // Audible, identified fallback for stations that lack a native music source.
      for (let n = 0; n < sources.ads.length; n++) adBreak();
    }
  }
  // Vary the advertisements on subsequent passes through the music. Include
  // each break's real duration so reopening the tuner keeps every cue in sync.
  const sequence = [],
    pool = sources.ads;
  let length = 0;
  const firstAd = hash(id) % Math.max(1, pool.length);
  let rotation = 0;
  do {
    for (const item of cuts) {
      const cut = item.adSlot === undefined ? item : pool[(firstAd + rotation + item.adSlot) % pool.length];
      if (!Number.isFinite(cut.duration) || cut.duration <= 0.2) continue;
      sequence.push({ ...cut, at: length });
      length += cut.duration;
    }
    rotation = breakCount ? (rotation + breakCount) % pool.length : 0;
  } while (rotation);
  return { id, cuts: sequence, length, offset: 14 + (hash(id) % 39) };
}

// On a first visit to a station with a promo opener, join an early song with
// seekable audio. Only new clocks are seeded. Saved clocks retain their epoch.
export function firstTuneElapsed(station, random = Math.random) {
  if (station?.cuts[0]?.kind !== 'preview') return 0;
  const block = station.cuts.find((c) => c.kind === 'reconstruction');
  if (!block) return 0;
  const songs = (block.chapters || []).filter(
    (c) => c.game && c.start >= block.start && c.start < block.start + block.duration,
  );
  if (!songs.length) return 0;
  const song = songs[Math.floor(random() * songs.length)];
  const next = block.chapters[block.chapters.indexOf(song) + 1];
  const span = Math.min(
    song.game.duration,
    (next?.start ?? Infinity) - song.start,
    block.start + block.duration - song.start,
  );
  const inside = span * (0.2 + random() * 0.55);
  return Math.max(0, block.at + song.start - block.start + inside - station.offset);
}

// While a long reconstruction buffers, the same credited game recording can
// supply the song at its current position. Its handoff ends at the chapter,
// the source recording's end or the advertising cut, whichever arrives first.
export function songAt(cue) {
  const chapters = cue?.cut.chapters;
  if (!chapters || cue.cut.kind !== 'reconstruction') return null;
  const i = chapters.findLastIndex((c) => c.start <= cue.time);
  const chapter = chapters[i],
    song = chapter?.game;
  if (!song) return null;
  const time = cue.time - chapter.start;
  const duration = Math.min(
    song.duration,
    (chapters[i + 1]?.start ?? Infinity) - chapter.start,
    time + cue.left,
  );
  if (time >= duration) return null;
  return {
    id: cue.id,
    key: cue.key + '/song/' + i,
    cut: { ...song, start: 0, duration },
    time,
    left: duration - time,
  };
}

export function locate(station, elapsed) {
  if (!station?.length) return null;
  const absolute = Math.max(0, elapsed + station.offset);
  const cycle = Math.floor(absolute / station.length);
  const t = absolute - cycle * station.length;
  let low = 0,
    high = station.cuts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (station.cuts[mid].at <= t) low = mid;
    else high = mid - 1;
  }
  const index = low;
  const cut = station.cuts[index],
    offset = t - cut.at;
  return {
    id: station.id,
    key: station.id + '/' + cycle + '/' + index,
    cut,
    index,
    cycle,
    time: (cut.start || 0) + offset,
    left: cut.duration - offset,
  };
}

export const reelKey = 'commercial-reel:hGZ3ocHlRk4';
export function nativeAds(programs, useReel = false, direct = false) {
  if (useReel)
    return programs
      .filter((p) => p.kind === 'ad' && p.videoId === 'hGZ3ocHlRk4')
      .map((p) => ({
        kind: 'ad',
        title: p.title,
        description: 'Commercial break',
        fileKey: reelKey,
        start: p.startSeconds,
        duration: p.endSeconds - p.startSeconds,
      }));
  return programs
    .filter((p) => p.kind === 'ad' && p.stationRecording?.audioUrl)
    .map((p) => {
      const hit = p.stationRecording;
      return {
        kind: 'ad',
        title: p.title,
        description: 'Commercial break',
        url: direct ? hit.audioUrl : '/signal/talk/' + p.station.toLowerCase().replaceAll(' ', '-'),
        start: hit.startSeconds,
        duration: hit.endSeconds - hit.startSeconds,
      };
    });
}
