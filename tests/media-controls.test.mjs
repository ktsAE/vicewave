import test from 'node:test';
import assert from 'node:assert/strict';
import { connectMediaControls } from '../media-controls.js';

test('radio and podcasts publish different transport controls to one system session', (t) => {
  const handlers = new Map(), calls = [];
  const session = {
    setActionHandler: (name, handler) => handlers.set(name, handler),
    setPositionState: (state) => {
      if (state?.duration === Infinity) throw new TypeError('Finite timelines only');
      session.position = state;
    },
  };
  for (const [key, value] of Object.entries({
    navigator: { mediaSession: session }, document: { baseURI: 'https://example.org/vicewave/' },
    MediaMetadata: class { constructor(data) { Object.assign(this, data); } },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  const update = connectMediaControls({
    play: () => calls.push('play'), pause: () => calls.push('pause'), stop: () => calls.push('stop'),
    skip: (d) => calls.push(d), seek: (...args) => calls.push(args),
  });
  const radio = { title: 'Flash FM', artist: 'Vicewave', album: 'Live radio', artwork: 'assets/icon-192.png', playing: true };
  update(radio);
  assert.equal(session.metadata.artwork[0].src, 'https://example.org/vicewave/assets/icon-192.png');
  assert.equal(session.playbackState, 'playing');
  for (const action of ['play','pause','stop','nexttrack','previoustrack']) handlers.get(action)();
  assert.deepEqual(calls, ['play','pause','stop',1,-1]);
  assert.equal(handlers.get('seekto'), null);
  update({ ...radio, title: 'An excerpt', playing: false, episode: {
    audio: { currentTime: 155, playbackRate: 1 }, item: { startSeconds: 140, duration: 100 },
  } });
  assert.equal(session.playbackState, 'paused');
  assert.deepEqual(session.position, { duration: 100, position: 15, playbackRate: 1 });
  handlers.get('seekbackward')({ seekOffset: 5 });
  handlers.get('seekto')({ seekTime: 20 });
  assert.deepEqual(calls.slice(-2), [[-5,true],[20,false]]);
  update(radio);
  assert.equal(handlers.get('seekforward'), null);
  assert.equal(session.position, undefined);
});
