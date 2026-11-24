import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildStation, firstTuneElapsed, locate, nativeAds, reelKey, songAt } from '../broadcast.js';

function load(name) {
  return JSON.parse(readFileSync(new URL('../data/' + name + '.json', import.meta.url), 'utf8'));
}
const { stations } = load('catalog'),
  programs = load('programs');
const sources = {
  broadcasts: load('broadcasts'),
  chapters: load('broadcast-chapters'),
  media: load('media'),
  nativeTracks: load('native-tracks'),
  gameRecordings: load('game-recordings'),
  ads: nativeAds(programs),
  talkChapters: load('talk-chapters'),
  talk: Object.fromEntries(
    stations
      .filter((s) => s.kind === 'talk')
      .map((s) => [s.id, programs.find((p) => p.station === s.name && p.audioUrl)]),
  ),
};

test('every static station cue, ad and alternate song streams from an HTTPS source', () => {
  const direct = { ...sources, direct: true, ads: nativeAds(programs, false, true) };
  for (const station of stations) {
    const plan = buildStation(station, direct);
    assert.ok(plan.length > 0, station.id);
    for (const cut of plan.cuts) {
      assert.match(cut.url, /^https:\/\//, station.id);
      for (const c of cut.chapters || []) {
        if (c.game) assert.match(c.game.url, /^https:\/\//, station.id);
      }
    }
  }
});

test('every dial station has continuous timed audio, including at wrap and across recorded breaks', () => {
  for (const station of stations) {
    const program = buildStation(station, sources);
    assert.ok(program.length > program.offset, station.id);
    const opening = locate(program, 0);
    assert.ok(opening.time > 0 && opening.left > 0, station.id);
    for (const [index, cut] of program.cuts.entries()) {
      const elapsed = cut.at - program.offset + 0.00001;
      const here = locate(program, elapsed);
      assert.equal(here.index, index, station.id);
      assert.ok(cut.url, station.id);
      assert.ok(Math.abs(here.time - (cut.start || 0)) < 0.00002, station.id);
      const end = locate(program, elapsed + cut.duration);
      assert.equal(end.index, (index + 1) % program.cuts.length, station.id);
    }
    const repeat = locate(program, program.length);
    assert.notEqual(opening.key, repeat.key);
    assert.ok(Math.abs(opening.time - repeat.time) < 0.00001);
  }
});

test('a seekable game recording joins at the chapter offset and hands back at the first source boundary', () => {
  const station = buildStation(
    stations.find((s) => s.id === 'gloriana-blues-radio'),
    sources,
  );
  const cue = locate(station, 1),
    song = songAt(cue);
  assert.equal(song.cut.title, 'I Got What It Takes');
  assert.match(song.cut.url, /^\/signal\/game\//);
  assert.equal(song.time, cue.time);
  assert.ok(song.left <= cue.left);
  const cut = {
    kind: 'reconstruction',
    chapters: [
      { start: 10, game: { duration: 30, title: 'Song' } },
      { start: 36, kind: 'ident' },
    ],
  };
  assert.equal(songAt({ cut, time: 15, left: 8 }).left, 8);
  assert.equal(songAt({ cut, time: 15, left: 80 }).left, 21);
  assert.equal(songAt({ cut, time: 36, left: 10 }), null);
});

test('the mixtape uses the matched game editions once per music pass and rotates its commercials', () => {
  const station = buildStation(
    stations.find((s) => s.id === 'the-sniper-of-la-perle'),
    sources,
  );
  const tracks = station.cuts.filter((c) => c.kind === 'track');
  assert.equal(new Set(tracks.map((x) => x.url)).size, 20);
  assert.ok(tracks.every((t) => t.url.startsWith('/signal/game/')));
  assert.equal(
    new Set(station.cuts.filter((c) => c.kind === 'ad').map((c) => c.title)).size,
    sources.ads.length,
  );
});

test('the matching local reel supplies every cataloged ad from its original time span', () => {
  const ads = nativeAds(programs, true);
  assert.equal(ads.length, 170);
  assert.ok(ads.every((a) => a.fileKey === reelKey));
  assert.equal(ads.at(-1).start + ads.at(-1).duration, 8615);
  assert.ok(ads.every((a, i) => i === 0 || ads[i - 1].start + ads[i - 1].duration === a.start));
  const station = buildStation(
    stations.find((s) => s.id === 'the-sniper-of-la-perle'),
    { ...sources, ads },
  );
  assert.equal(new Set(station.cuts.filter((c) => c.kind === 'ad').map((c) => c.start)).size, 170);
});

test('a same-title song by a different artist is never used when tuning', () => {
  for (const [id, title, artist, other] of [
    ['flash-fm', 'Candy', 'Rosalía', 'Mandy Moore'],
    ['leonida-jazz-radio', 'Forever More', 'Moloko', 'Tom Browne'],
  ]) {
    const p = buildStation(
      stations.find((s) => s.id === id),
      sources,
    );
    const mix = p.cuts.find((c) => c.kind === 'reconstruction');
    const chapter = mix.chapters.find((c) => c.title === title && c.artist === artist);
    assert.ok(chapter);
    assert.equal(chapter.game, undefined);
    assert.ok(
      p.cuts.some(
        (c) => c.kind === 'track' && c.title.toLowerCase() === title.toLowerCase() && c.artist === other,
      ),
    );
  }
});

test('abridged DJ mix tracks use the actual station edit', () => {
  const p = buildStation(
    stations.find((s) => s.id === 'worldwide-fm'),
    sources,
  );
  const mix = p.cuts.find((c) => c.kind === 'reconstruction');
  const chapter = mix.chapters.find((c) => c.title === 'Free As The Wind');
  assert.ok(chapter);
  assert.equal(chapter.game, undefined);
});

test('a new Flash FM clock joins a seekable full song at different positions', () => {
  const p = buildStation(
    stations.find((s) => s.id === 'flash-fm'),
    sources,
  );
  const positions = [0, 0.25, 0.65, 0.98].map((f) => firstTuneElapsed(p, () => f));
  for (const elapsed of positions) {
    const song = songAt(locate(p, elapsed));
    assert.ok(song.time > 0 && song.left > 0);
  }
  assert.equal(new Set(positions).size, 4);
});
