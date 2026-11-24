import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { onDemandItems, savedPosition } from '../on-demand.js';
const json = (name) =>
  JSON.parse(readFileSync(new URL('../data/' + name + '.json', import.meta.url), 'utf8'));
const programs = json('programs');
const items = onDemandItems(programs, json('runtime'));

test('all 20 episodes have stable IDs and distinct recordings on static hosting', () => {
  const podcasts = items.filter((item) => item.kind === 'podcast');
  const groupSizes = {};
  for (const p of podcasts) {
    groupSizes[p.series] = (groupSizes[p.series] || 0) + 1;
    assert.equal(p.url, p.source);
    assert.match(p.url, /^https:\/\/six\.mics\.dev\/.*\/radio_[0-9A-F]+\.ogg$/);
    assert.equal(p.startSeconds, 0);
    assert.ok(p.duration > 300);
  }
  assert.deepEqual(groupSizes, {
    'Drunk Kings': 5,
    'Final Act': 4,
    'Fuck, Marry, Murder': 6,
    'The Safe Trap': 3,
    'Vice City True Stories': 2,
  });
  for (const key of ['id', 'url', 'source']) assert.equal(new Set(podcasts.map((p) => p[key])).size, 20);
});

test('the launcher prefers only the episodes installed on this machine', () => {
  const local = onDemandItems(programs, { proxy: true, podcasts: ['final-act-1'] });
  assert.equal(local.find((p) => p.id === 'final-act-1').url, 'assets/podcasts/final-act-1.mp3');
  const online = local.find((p) => p.id === 'final-act-2');
  assert.equal(online.url, online.source);
  assert.ok(local.filter((p) => p.kind === 'show').every((p) => p.url.startsWith('/signal/talk/')));
});

test('local podcasts prefer the original Opus and keep the installed MP3 as fallback', () => {
  const runtime = { proxy: true, podcasts: ['final-act-1'], opusPodcasts: ['final-act-1', 'final-act-2'] };
  const select = (opus, id) => onDemandItems(programs, runtime, opus).find((p) => p.id === id);
  const both = select(true, 'final-act-1');
  assert.equal(both.url, 'assets/podcasts/final-act-1.ogg');
  assert.equal(both.fallback, 'assets/podcasts/final-act-1.mp3');
  assert.equal(select(false, 'final-act-1').url, both.fallback);
  const originalOnly = select(true, 'final-act-2');
  assert.equal(originalOnly.url, 'assets/podcasts/final-act-2.ogg');
  assert.ok(!originalOnly.fallback);
});

test('a bookmark from the older compilation follows the episode it belonged to', (t) => {
  const saved = new Map([['vicewave:episode:final-act', '935']]);
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  });
  assert.equal(savedPosition(items.find((p) => p.id === 'final-act-1')), 0);
  const second = items.find((p) => p.id === 'final-act-2');
  assert.equal(savedPosition(second), 141);
  saved.set('vicewave:episode:final-act-2', '0');
  assert.equal(savedPosition(second), 0);
});

test('every talk special begins with show audio and ends at a documented break', () => {
  const chapters = json('talk-chapters'),
    specials = items.filter((i) => i.kind === 'show');
  assert.equal(specials.length, 5);
  for (const s of specials) {
    const station = s.station.toLowerCase().replaceAll(' ', '-');
    assert.equal(s.url, s.audioUrl);
    assert.match(s.url, /^https:\/\//);
    assert.ok(chapters[station].some((c) => c.start === s.startSeconds && c.kind === 'show'));
    assert.ok(chapters[station].some((c) => c.start === s.endSeconds && c.kind !== 'show'));
  }
});
