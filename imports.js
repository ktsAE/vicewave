// Import exact title/artist matches from files the listener selects. Audio never leaves the browser.
import { recording } from './recordings.js';
import { norm } from './ui.js';

const extensions = /\.(mp3|m4a|mp4|aac|flac|ogg|oga|opus|wav|wave|aif|aiff|webm)$/i;
const MAX_TAG = 1024 * 1024;
const utf8 = new TextDecoder();
const latin = new TextDecoder('latin1');
const text = (bytes) => utf8.decode(bytes).replace(/\0/g, ' ').trim();
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const uint32 = (b, i) => view(b).getUint32(i);
const syncsafe = (b, i) => b[i] * 2097152 + b[i + 1] * 16384 + b[i + 2] * 128 + b[i + 3];
const part = async (file, offset, length) =>
  new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());

export function recordingKey(stationId, track) {
  return 'track:' + [stationId, norm(track.title), norm(track.artist)].join('|');
}

export async function measureAudio(file) {
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(null), 10000);
      function finish(duration) {
        clearTimeout(timer);
        audio.onloadedmetadata = null;
        audio.onerror = null;
        if (Number.isFinite(duration) && duration > 0) resolve(duration);
        else reject(new Error('This browser could not read the audio duration.'));
      }
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => finish(audio.duration);
      audio.onerror = () => finish(null);
      audio.src = url;
    });
  } finally {
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
  }
}

// Old station and track blobs keep their original keys. Duration metadata uses a separate key.
export async function readDuration(key, file) {
  const cached = await recording('get', 'duration:' + key);
  if (!cached) return null;
  if (file && (cached.size !== file.size || cached.modified !== (file.lastModified || 0))) return null;
  return Number.isFinite(cached.seconds) && cached.seconds > 0 ? cached.seconds : null;
}

export const saveDuration = (key, file, seconds) =>
  recording('put', 'duration:' + key, { seconds, size: file.size, modified: file.lastModified || 0 });

export async function durationFor(key, file) {
  file ??= await recording('get', key);
  if (!file) return null;
  const cached = await readDuration(key, file);
  if (cached) return cached;
  const seconds = await measureAudio(file);
  await saveDuration(key, file, seconds);
  return seconds;
}

function id3Tags(b) {
  const version = b[3];
  if (![2, 3, 4].includes(version) || b[5] & 0xc0) return {};
  const tags = {};
  const size = Math.min(b.length, 10 + syncsafe(b, 6));
  const header = version === 2 ? 6 : 10;
  for (let pos = 10; pos + header <= size;) {
    const name = latin.decode(b.subarray(pos, pos + (version === 2 ? 3 : 4)));
    const length =
      version === 2
        ? b[pos + 3] * 65536 + b[pos + 4] * 256 + b[pos + 5]
        : version === 3
          ? uint32(b, pos + 4)
          : syncsafe(b, pos + 4);
    if (!length || pos + header + length > size) break;
    const field = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist' }[name];
    pos += header;
    if (field) {
      const utf16 = b[pos + 1] === 0xfe && b[pos + 2] === 0xff ? 'utf-16be' : 'utf-16le';
      const decoder = ['windows-1252', utf16, 'utf-16be', 'utf-8'][b[pos]];
      if (decoder)
        tags[field] = new TextDecoder(decoder)
          .decode(b.subarray(pos + 1, pos + length))
          .replace(/\0/g, ' ')
          .trim();
    }
    pos += length;
  }
  return tags;
}

function vorbisTags(b, offset) {
  const d = view(b);
  const length = () => {
    const n = d.getUint32(offset, true);
    offset += 4;
    return n;
  };
  const vendorLength = length();
  offset += vendorLength;
  const count = length();
  const tags = {};
  for (let i = 0; i < count && offset + 4 <= b.length; i++) {
    const n = length();
    if (offset + n > b.length) break;
    const comment = text(b.subarray(offset, offset + n));
    const match = /^(TITLE|ARTIST)=(.+)$/i.exec(comment);
    if (match) tags[match[1].toLowerCase()] ??= match[2];
    offset += n;
  }
  return tags;
}

function flacTags(b) {
  for (let pos = 4; pos + 4 <= b.length;) {
    const type = b[pos] & 127;
    const size = b[pos + 1] * 65536 + b[pos + 2] * 256 + b[pos + 3];
    if (type === 4) return vorbisTags(b.subarray(pos + 4, pos + 4 + size), 0);
    if (b[pos] & 128) break;
    pos += 4 + size;
  }
  return {};
}

// Walk MP4 boxes by offset, skipping the audio payload even if metadata is at the end of the file.
async function mp4Tags(file) {
  const tags = {};
  const containers = new Set(['moov', 'udta', 'meta', 'ilst', '©nam', '©ART']);
  let remaining = 750;
  async function visit(start, end, parent, depth) {
    for (let pos = start; pos + 8 <= end && remaining-- > 0;) {
      const h = await part(file, pos, 16);
      const kind = latin.decode(h.subarray(4, 8));
      const base = uint32(h, 0);
      const header = base === 1 ? 16 : 8;
      const size = base === 1 ? Number(view(h).getBigUint64(8)) : base || end - pos;
      if (size < header || size > end - pos) break;
      if (kind === 'data' && (parent === '©nam' || parent === '©ART') && size <= 65536 && size > header + 8) {
        const field = parent === '©nam' ? 'title' : 'artist';
        tags[field] = text(await part(file, pos + header + 8, size - header - 8));
      } else if (containers.has(kind) && depth < 6) {
        await visit(pos + header + (kind === 'meta' ? 4 : 0), pos + size, kind, depth + 1);
      }
      if (tags.artist && tags.title) return;
      pos += size;
    }
  }
  await visit(0, file.size, '', 0);
  return tags;
}

async function tagsFor(file) {
  const header = await part(file, 0, 12);
  const format = latin.decode(header);
  if (format.startsWith('ID3'))
    return id3Tags(await part(file, 0, Math.min(MAX_TAG, 10 + syncsafe(header, 6))));
  if (format.startsWith('fLaC')) return flacTags(await part(file, 0, MAX_TAG));
  if (format.slice(4, 8) === 'ftyp') return mp4Tags(file);
  return {};
}

function lookupIndex(stations) {
  const pairs = new Map();
  const names = new Map();
  function add(index, name, entry) {
    if (!index.has(name)) index.set(name, []);
    index.get(name).push(entry);
  }
  for (const station of stations) {
    for (const track of station.tracks) {
      const title = norm(track.title);
      if (!title || !track.artist) continue;
      const key = recordingKey(station.id, track);
      const namesForArtist = new Set([track.artist, track.performer].filter(Boolean).map(norm));
      const entry = { key, stationId: station.id, title: track.title, artist: track.artist, namesForArtist };
      for (const artist of namesForArtist) {
        add(pairs, artist + '|' + title, entry);
        add(names, artist + ' ' + title, entry);
        add(names, title + ' ' + artist, entry);
      }
    }
  }
  return { pairs, names };
}

function identify(file, tags, catalog) {
  const candidates = new Map();
  function add(list) {
    for (const row of list || []) candidates.set(row.key, row);
  }
  if (tags.artist && tags.title) {
    // Explicit tag conflicts take precedence over a suggestive filename.
    add(catalog.pairs.get(norm(tags.artist) + '|' + norm(tags.title)));
  } else {
    const stem = file.name.replace(/\.[^.]+$/, '');
    const base = stem.replace(/^\s*(?:\d{1,2}[-.]\d{1,3}|\d{1,3})\s*(?:[.\-–—_)]+\s*|\s+)/, '');
    const parents = (file.webkitRelativePath || '').split('/').slice(0, -1);
    for (const value of new Set([stem, base])) {
      add(catalog.names.get(norm(value)));
      const title = norm(tags.title || value);
      for (const artist of [tags.artist, ...parents].filter(Boolean))
        add(catalog.pairs.get(norm(artist) + '|' + title));
    }
  }
  const entries = [...candidates.values()].filter(
    (e) =>
      (!tags.artist || e.namesForArtist.has(norm(tags.artist))) &&
      (!tags.title || norm(e.title) === norm(tags.title)),
  );
  const credits = new Set(entries.map((e) => norm(e.artist) + '|' + norm(e.title)));
  return credits.size === 1 ? entries : [];
}

export async function importFolder(files, stations, onProgress = () => {}) {
  const catalog = lookupIndex(stations);
  const audioFiles = Array.from(files).filter((f) => extensions.test(f.name) || f.type.startsWith('audio/'));
  const keys = new Set(await recording('keys'));
  const result = { matched: 0, unmatched: 0, skipped: 0, failed: 0, processed: 0, total: audioFiles.length };
  const imported = [];
  onProgress({ ...result });
  for (const file of audioFiles) {
    try {
      const tags = await tagsFor(file).catch(() => ({}));
      const entries = identify(file, tags, catalog);
      if (!entries.length) result.unmatched++;
      else {
        result.matched++;
        const fresh = entries.filter((e) => !keys.has(e.key));
        if (!fresh.length) result.skipped++;
        else {
          const duration = await measureAudio(file);
          let added = 0;
          for (const entry of fresh) {
            try {
              await recording('add', entry.key, file);
            } catch (error) {
              if (error?.name === 'ConstraintError') {
                keys.add(entry.key);
                continue;
              }
              throw error;
            }
            keys.add(entry.key);
            const { key, stationId, title, artist } = entry;
            imported.push({ key, stationId, title, artist, duration });
            await saveDuration(entry.key, file, duration);
            added++;
          }
          if (!added) result.skipped++;
        }
      }
    } catch {
      result.failed++;
    }
    result.processed++;
    onProgress({ ...result });
  }
  return { ...result, imported };
}
