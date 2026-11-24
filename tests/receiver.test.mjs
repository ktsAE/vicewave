import assert from 'node:assert/strict';
import test from 'node:test';
import { Receiver } from '../player.js';
import { locate, songAt } from '../broadcast.js';

class TestAudio extends EventTarget {
  currentTime = 0;
  readyState = 0;
  paused = true;
  playCount = 0;
  load() {
    this.readyState = this.src && !this.src.includes('slow') ? 4 : 0;
    if (this.readyState) this.onloadedmetadata?.();
  }
  play() {
    this.paused = false;
    this.playCount++;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  hasAttribute(name) {
    return name === 'src' && Boolean(this.src);
  }
  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }
}
const chapter = {
  start: 0,
  kind: 'music',
  title: 'First song',
  game: { url: '/game', kind: 'track', title: 'First song', duration: 20 },
};
const station = (id, url) => ({
  id,
  length: 30,
  offset: 0,
  cuts: [
    {
      kind: 'reconstruction',
      at: 0,
      start: 0,
      duration: 30,
      url,
      title: id,
      chapters: [chapter, { start: 20, kind: 'music', title: 'Second song' }],
    },
  ],
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

function receiver(t, plans) {
  t.mock.method(globalThis, 'setInterval', () => 0);
  t.mock.method(globalThis, 'setTimeout', (fn) => {
    setImmediate(fn);
    return 0;
  });
  const previous = { Audio: globalThis.Audio, document: globalThis.document, window: globalThis.window };
  Object.assign(globalThis, { Audio: TestAudio, document: new EventTarget(), window: new EventTarget() });
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const slow = station('slow', '/slow');
  slow.cuts[0].chapters = [];
  const r = new Receiver(plans || [station('first', '/mix'), slow], () => {}, Date.now());
  let now = 2;
  r.elapsed = () => now;
  r.power(true);
  return {
    r,
    setTime(value) {
      now = value;
    },
  };
}

test('chapter changes inside the mix leave the same audio element playing', async (t) => {
  const { r, setTime } = receiver(t);
  await settle();
  const bank = r.live;
  assert.equal(bank.audio.src, '/mix');
  setTime(22);
  bank.audio.currentTime = 22;
  r.tick();
  await settle();
  assert.equal(r.live, bank);
  assert.equal(bank.audio.playCount, 1);
  assert.equal(JSON.parse(r.lastState).title, 'Second song');
  assert.equal(r.phase, 'live');
});

test('a slow channel releases the old station after the short handoff', async (t) => {
  const { r } = receiver(t);
  await settle();
  const old = r.live;
  r.tune(1);
  assert.equal(r.phase, 'tuning');
  // Expire the actual switch deadline without waiting on a wall clock in CI.
  r.leaveAt = performance.now() - 1;
  r.tick();
  await settle();
  assert.equal(r.live, null);
  assert.equal(old.audio.paused, true);
});

test('only an external pause on the audible deck turns off the receiver', async (t) => {
  const { r, setTime } = receiver(t);
  await settle();
  const standby = r.banks.find((b) => b !== r.live);
  standby.audio.dispatchEvent(new Event('pause'));
  assert.equal(r.powered, true);
  const audible = r.live.audio;
  audible.pause();
  audible.dispatchEvent(new Event('pause'));
  assert.equal(r.powered, false);
  setTime(22);
  r.power(true);
  await settle();
  assert.equal(JSON.parse(r.lastState).title, 'Second song');
});

test('a previously live archive that runs out of audio can recover through the game track', async (t) => {
  const { r, setTime } = receiver(t);
  await settle();
  const archive = r.live;
  archive.audio.readyState = 2;
  archive.audio.dispatchEvent(new Event('waiting'));
  archive.blockedSince = performance.now() - 700;
  setTime(7);
  r.tick();
  await settle();
  assert.equal(r.live.audio.src, '/game');
  assert.ok(Math.abs(r.live.audio.currentTime - 7) < 0.2);
  assert.equal(r.phase, 'live');
});

test('a failed source retries at the current broadcast position after its cooldown', async (t) => {
  const { r, setTime } = receiver(t);
  await settle();
  setTime(22);
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  r.live.audio.onerror();
  r.tick();
  assert.equal(r.phase, 'unavailable');
  clock += 19999;
  r.tick();
  assert.equal(r.phase, 'unavailable');
  clock += 1;
  setTime(25);
  r.tick();
  await settle();
  assert.equal(r.phase, 'live');
  assert.equal(r.live.audio.src, '/mix');
  assert.ok(Math.abs(r.live.audio.currentTime - 25) < 0.2);
});

test('tuning to an empty schedule releases the old signal and asks for a recording', async (t) => {
  const { r } = receiver(t);
  await settle();
  const previous = r.live;
  r.stations[1] = { id: 'empty', length: 0, offset: 0, cuts: [] };
  r.tune(1);
  await settle();
  assert.equal(r.phase, 'missing');
  assert.equal(r.live, null);
  assert.ok(previous.audio.paused);
});

const singleCut = (id, url = '/' + id) => ({
  id,
  offset: 0,
  length: 300,
  cuts: [{ kind: 'track', title: id, at: 0, start: 0, duration: 300, url }],
});

for (const [condition, expected] of [
  ['aligned original', '/game'],
  ['different edit', '/mix'],
  ['seek required', '/mix'],
]) {
  test('a fresh tune with both sources buffered chooses ' + expected + ' for ' + condition, async (t) => {
    const next = structuredClone(station('next', '/mix'));
    if (condition === 'different edit') next.cuts[0].chapters[0].game.duration = 17;
    const { r } = receiver(t, [singleCut('initial'), next]);
    await settle();
    const cue = locate(next, r.elapsed());
    const song = r.prepare(songAt(cue), false);
    r.prepare(cue, false);
    if (condition === 'seek required') song.audio.currentTime += 3;
    r.tune(1);
    await settle();
    assert.equal(r.live.audio.src, expected);
    assert.equal(r.phase, 'live');
  });
}

test('neighbors and a pointed-at station buffer silently during a cold tune', async (t) => {
  const plans = ['slow', 'one', 'two', 'three', 'four'].map((id) => singleCut(id));
  const { r, setTime } = receiver(t, plans);
  const loaded = (id) => r.banks.find((b) => b.target?.id === id);
  assert.equal(r.live, null);
  assert.ok(loaded('one') && loaded('four'));
  r.preview(2);
  const bank = loaded('two');
  assert.ok(bank.audio.paused);
  setTime(13);
  r.tune(2);
  await settle();
  assert.equal(r.live, bank);
  assert.ok(Math.abs(bank.audio.currentTime - 13) < 0.2);
});

test('turning back during the crossfade reuses the fading deck at once', async (t) => {
  const { r } = receiver(t, [singleCut('a'), singleCut('b')]);
  await settle();
  const first = r.live;
  r.tune(1);
  await Promise.resolve();
  assert.equal(r.live.target.id, 'b');
  assert.ok(first.retired);
  r.tune(0);
  await Promise.resolve();
  assert.equal(r.live, first);
  await settle();
  assert.equal(first.audio.paused, false);
  assert.ok(r.banks.every((bank) => bank === first || bank.audio.paused));
});

test('a cold jump requests the matched song first and falls back if it stays slow', async (t) => {
  const next = structuredClone(station('distant', '/station-mix'));
  next.cuts[0].chapters[0].game.url = '/slow-song';
  const { r } = receiver(t, [singleCut('a'), singleCut('b'), next, singleCut('d'), singleCut('e')]);
  await settle();
  r.tune(2);
  assert.equal(r.candidate.audio.src, '/slow-song');
  assert.ok(!r.banks.some((b) => b.audio.src === '/station-mix'));
  r.switchedAt = performance.now() - 500;
  r.tick();
  await settle();
  assert.equal(r.live.audio.src, '/station-mix');
});

test('a buffered neighbor can join between warm passes without another seek', async (t) => {
  const plans = ['a', 'b', 'c'].map((id) => singleCut(id));
  const { r, setTime } = receiver(t, plans);
  await settle();
  const next = r.banks.find((bank) => bank.target?.id === 'b');
  next.audio.buffered = { length: 1, start: () => 0, end: () => 100 };
  r.prepare(locate(plans[1], 2.7), false);
  const prepared = next.audio.currentTime;
  setTime(3.2);
  r.tune(1);
  await settle();
  assert.equal(r.live, next);
  assert.equal(next.audio.currentTime, prepared);
  assert.ok(Math.abs(prepared - 3.2) < 0.72);
});
