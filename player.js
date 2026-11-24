// A small bank of native audio elements keeps the dial, its neighbors and the next
// transition warm. A single AudioContext controls gain for click-free handovers.
import { locate, songAt, stationOrigin } from './broadcast.js';
import { recording } from './recordings.js';

const JOIN = 0.12;
const PRELOAD = 12;
const SWITCH_GRACE_MS = 250;
const BUFFER_GRACE_MS = 350;

function ready(bank) {
  return bank && !bank.loading && !bank.audio.seeking && bank.audio.readyState >= 3;
}

function downloading(bank) {
  return !ready(bank) || bank.audio.networkState === 2;
}

export class Receiver {
  constructor(stations, onChange, epoch = stationOrigin(), archives = [], { direct = false } = {}) {
    this.stations = stations;
    this.onChange = onChange;
    this.epoch = epoch;
    this.selected = 0;
    this.powered = false;
    this.phase = 'off';
    this.live = null;
    this.candidate = null;
    this.turn = 0;
    this.faults = new Map();
    this.direction = 0;
    this.archiveHeaders = new Map(archives);
    this.direct = direct;
    this.headerAfter = performance.now() + 2000;
    this.banks = Array.from({ length: 6 }, () => {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.playsInline = true;
      const bank = {
        audio,
        key: null,
        generation: 0,
        stamp: 0,
        retirement: 0,
        retired: false,
        queued: false,
      };
      audio.addEventListener('ended', () => this.tick());
      audio.addEventListener('playing', () => {
        bank.waiting = false;
      });
      audio.addEventListener('waiting', () => {
        bank.waiting = true;
      });
      for (const event of ['canplay', 'seeked', 'timeupdate']) {
        audio.addEventListener(event, () => {
          if (
            this.powered &&
            (bank === this.candidate ||
              bank === this.live ||
              (this.phase === 'tuning' && bank.target?.id === this.station().id))
          )
            this.tick();
        });
      }
      return bank;
    });
    this.timer = setInterval(() => this.tick(), 85);
    this.sync = () => this.tick();
    document.addEventListener('visibilitychange', this.sync);
    window.addEventListener('pageshow', this.sync);
  }
  elapsed() {
    return (Date.now() - this.epoch) / 1000;
  }
  station() {
    return this.stations[this.selected];
  }
  unlock() {
    try {
      if (!this.context) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.context = new AudioCtx();
          // Third-party recordings without CORS headers go silent in Web Audio.
          // A static site plays those through the media elements' native output.
          for (const b of this.direct ? [] : this.banks) {
            b.gain = this.context.createGain();
            b.gain.gain.value = this.live === b ? 1 : 0;
            b.audio.volume = 1;
            b.source = this.context.createMediaElementSource(b.audio);
            b.source.connect(b.gain).connect(this.context.destination);
          }
          this.context.addEventListener('statechange', this.sync);
        }
      }
      if (this.context?.state === 'suspended')
        this.context
          .resume()
          .then(() => {
            if (this.powered && this.phase === 'gesture') this.phase = 'tuning';
            this.tick();
          })
          .catch(() => {});
    } catch {}
    if (this.phase === 'gesture' && this.powered) {
      this.phase = 'tuning';
      this.tick();
    }
  }
  power(value, gesture = false) {
    if (gesture) this.unlock();
    if (value === this.powered) {
      if (value) this.tick();
      return;
    }
    this.turn++;
    this.powered = value;
    if (!value) {
      this.live = null;
      this.candidate = null;
      this.lastHeard = null;
      this.lastWarm = null;
      this.intent = null;
      this.headerRequest?.abort();
      this.leaveAt = 0;
      for (const b of this.banks) this.reset(b);
      this.phase = 'off';
      this.emit();
      return;
    }
    this.phase = 'tuning';
    this.tick();
  }
  tune(index, gesture = false) {
    if (gesture) this.unlock();
    if (index !== this.selected) {
      const n = this.stations.length;
      const distance = (index - this.selected + n) % n;
      this.direction = distance === 1 ? 1 : distance === n - 1 ? -1 : 0;
      this.switchedAt = performance.now();
      this.headerAfter = this.switchedAt + 2000;
      this.headerRequest?.abort();
      this.intent = null;
      this.lastWarm = null;
      this.turn++;
      this.selected = index;
      this.candidate = null;
      if (this.live?.target.id === this.station().id) this.leaveAt = 0;
      else if (this.live && !this.leaveAt) this.leaveAt = performance.now() + SWITCH_GRACE_MS;
      for (const b of this.banks) {
        if (
          b.key &&
          b !== this.live &&
          !b.retired &&
          (b.queued || (downloading(b) && !this.nearby(b.target.id)))
        )
          this.reset(b);
      }
    }
    this.tick();
  }
  preview(index) {
    if (!this.powered || index === this.selected || globalThis.navigator?.connection?.saveData) return;
    this.intent = { index, until: performance.now() + 2500 };
    this.lastWarm = null;
    this.tick();
  }
  nearby(id) {
    const n = this.stations.length;
    return [-1, 0, 1].some((d) => this.stations[(this.selected + d + n) % n].id === id);
  }
  reset(b) {
    b.generation++;
    b.audio.pause();
    b.audio.onerror = null;
    b.audio.onloadedmetadata = null;
    b.key = null;
    b.queued = false;
    b.retired = false;
    b.loading = false;
    b.target = null;
    b.error = false;
    b.waiting = false;
    b.blockedSince = null;
    if (b.audio.hasAttribute('src')) {
      b.audio.removeAttribute('src');
      b.audio.load();
    }
    if (b.objectUrl) {
      URL.revokeObjectURL(b.objectUrl);
      b.objectUrl = null;
    }
    this.level(b, 0);
  }
  level(b, amount, seconds = 0) {
    if (b.gain) {
      const now = this.context.currentTime,
        param = b.gain.gain;
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
      else {
        const value = param.value;
        param.cancelScheduledValues(now);
        param.setValueAtTime(value, now);
      }
      if (seconds) param.linearRampToValueAtTime(amount, now + seconds);
      else param.setValueAtTime(amount, now);
    } else if (this.direct && seconds && !b.fixedVolume && b.audio.volume !== amount) {
      clearInterval(b.fade);
      const start = performance.now(), from = b.audio.volume;
      b.fade = setInterval(() => {
        const fraction = Math.min(1, (performance.now() - start) / (seconds * 1000));
        b.audio.volume = from + (amount - from) * fraction;
        if (fraction === 1) clearInterval(b.fade);
      }, 12);
    } else {
      clearInterval(b.fade);
      b.audio.volume = amount;
      if (this.direct && (b.fixedVolume || b.audio.volume !== amount)) {
        b.fixedVolume = true;
        b.audio.muted = amount === 0;
      }
    }
  }
  retire(b) {
    if (!b) return;
    b.retired = true;
    const retirement = ++b.retirement;
    this.level(b, 0, JOIN);
    const generation = b.generation;
    setTimeout(
      () => {
        if (generation === b.generation && retirement === b.retirement && b.retired && b !== this.live) {
          b.audio.pause();
          b.retired = false;
          if (!this.nearby(b.target.id) && downloading(b)) this.reset(b);
        }
      },
      JOIN * 1000 + 25,
    );
  }
  seek(b, time, tolerance) {
    const a = b.audio;
    if (a.readyState < 1 || a.seeking || Math.abs(a.currentTime - time) <= tolerance) return;
    if (Number.isFinite(a.duration)) time = Math.min(time, Math.max(0, a.duration - 0.05));
    try {
      a.currentTime = Math.max(0, time);
    } catch {}
  }
  prepare(cue, wanted, keep) {
    const held = this.banks.find((b) => b.key === cue.key);
    if (held) {
      if (held.error) return null;
      held.stamp = performance.now();
      held.target = cue;
      if (held !== this.live && !held.queued && !held.retired) {
        const tolerance = wanted ? 0.72 : ready(held) ? 1.1 : 5;
        this.seek(held, cue.time, tolerance);
      }
      return held;
    }
    const url = cue.cut.fileKey || cue.cut.url;
    if ((this.faults.get(url) || 0) > Date.now()) return null;
    const candidates = this.banks.filter(
      (b) => b !== this.live && b !== this.candidate && !b.retired && !b.queued && !keep?.has(b.key),
    );
    const b = candidates.find((b) => !b.key) || candidates.sort((a, b) => a.stamp - b.stamp)[0];
    if (!b) return null;
    this.reset(b);
    const generation = b.generation;
    b.key = cue.key;
    b.target = cue;
    b.stamp = performance.now();
    b.loading = true;
    b.audio.onloadedmetadata = () => {
      if (generation === b.generation) {
        b.loading = false;
        this.seek(b, b.target.time, 0.08);
      }
    };
    b.audio.onerror = () => {
      if (generation !== b.generation) return;
      b.error = true;
      this.faults.set(url, Date.now() + 20000);
      if (this.live === b) {
        this.live = null;
        this.level(b, 0);
      }
      if (this.candidate === b) this.candidate = null;
      this.reset(b);
    };
    const assign = (source) => {
      if (generation !== b.generation) return;
      b.audio.src = source;
      b.audio.load();
    };
    if (cue.cut.fileKey) {
      recording('get', cue.cut.fileKey)
        .then((file) => {
          if (generation !== b.generation) return;
          if (!file) {
            b.audio.onerror();
            return;
          }
          b.objectUrl = URL.createObjectURL(file);
          assign(b.objectUrl);
        })
        .catch(() => {
          if (generation === b.generation) b.audio.onerror();
        });
    } else assign(cue.cut.url);
    return b;
  }
  activate(b, cue) {
    if (b.queued || !ready(b)) return;
    this.seek(b, cue.time, 0.72);
    if (b.audio.seeking) return;
    if (b.retired) {
      b.retired = false;
      b.retirement++;
    }
    const turn = this.turn,
      generation = b.generation;
    b.queued = true;
    b.audio
      .play()
      .then(() => {
        if (generation !== b.generation) return;
        b.queued = false;
        if (!this.powered || turn !== this.turn || this.candidate !== b) {
          if (this.live !== b) b.audio.pause();
          return;
        }
        // Drop a stale handover if a new segment began during buffering.
        const here = locate(this.station(), this.elapsed() + JOIN);
        const current = here?.key === b.key ? here : songAt(here);
        if (current?.key !== b.key) {
          b.audio.pause();
          return;
        }
        // A delayed play() promise can resolve seconds after the original seek.
        // Align the silent deck to the broadcast before raising its gain.
        if (Math.abs(b.audio.currentTime - current.time) > 0.85) {
          b.audio.pause();
          this.seek(b, current.time, 0.25);
          return;
        }
        const old = this.live;
        this.live = b;
        this.lastHeard = current.id;
        this.leaveAt = 0;
        b.target = current;
        b.blockedSince = null;
        this.candidate = null;
        this.phase = 'live';
        this.level(b, 1, JOIN);
        if (old !== b) this.retire(old);
        this.emit();
      })
      .catch((error) => {
        if (generation !== b.generation) return;
        b.queued = false;
        if (turn !== this.turn) return;
        if (error.name === 'NotAllowedError') {
          this.phase = 'gesture';
          this.emit();
        } else if (error.name !== 'AbortError') b.audio.onerror?.();
      });
  }
  async primeHeader(direction) {
    const n = this.stations.length;
    for (let i = 0; i < n; i++) {
      const distance = Math.ceil(i / 2) * (i % 2 ? direction : -direction);
      const id = this.stations[(this.selected + distance + n) % n].id;
      const url = this.archiveHeaders.get(id);
      if (!url) continue;
      this.archiveHeaders.delete(id);
      const controller = new AbortController();
      this.headerRequest = controller;
      try {
        // This small range lets the launcher answer MP3 seek-table probes locally.
        const response = await fetch(url, {
          headers: { Range: 'bytes=0-65535' },
          priority: 'low',
          signal: controller.signal,
        });
        if (response.status === 206) await response.arrayBuffer();
        else await response.body?.cancel();
      } catch {
        if (controller.signal.aborted) this.archiveHeaders.set(id, url);
      } finally {
        this.headerRequest = null;
        this.headerAfter = performance.now() + 1000;
      }
      break;
    }
  }
  warm(now, scheduled, cue) {
    const stamp = performance.now();
    if (this.lastWarm != null && stamp - this.lastWarm < 450) return;
    this.lastWarm = stamp;
    const keep = new Set([scheduled.key, cue.key, songAt(scheduled)?.key]);
    const prime = (next) => {
      if (!next) return;
      const audio = songAt(next) || next;
      if (keep.has(audio.key)) return;
      keep.add(audio.key);
      this.prepare(audio, false, keep);
    };
    if (cue.left < PRELOAD) prime(locate(this.station(), now + JOIN + cue.left + 0.006));
    if (globalThis.navigator?.connection?.saveData) return;
    if (this.intent?.until > stamp) prime(locate(this.stations[this.intent.index], now + JOIN));
    const n = this.stations.length;
    const nextToDial = (offset) => this.stations[(this.selected + offset + n) % n];
    const direction = this.direction || 1;
    prime(locate(nextToDial(direction), now + JOIN));
    prime(locate(nextToDial(-direction), now + JOIN));
    if (this.direction && this.live && n > 3) prime(locate(nextToDial(2 * direction), now + JOIN));
    if (
      this.archiveHeaders.size &&
      !this.headerRequest &&
      stamp >= this.headerAfter &&
      this.phase === 'live' &&
      this.live?.target.id === scheduled.id &&
      !document.hidden
    )
      this.primeHeader(direction);
  }
  tick() {
    if (!this.powered) {
      this.emit();
      return;
    }
    const now = this.elapsed(),
      station = this.station(),
      scheduled = locate(station, now + JOIN);
    if (!scheduled) {
      if (this.live) {
        const last = this.live;
        this.live = null;
        this.retire(last);
      }
      this.phase = 'missing';
      this.emit();
      return;
    }
    const alternate = songAt(scheduled);
    if (this.live && this.live.key !== scheduled.key && this.live.key !== alternate?.key) {
      const old = this.live,
        cut = old.target.cut;
      const leftStation = this.leaveAt && performance.now() >= this.leaveAt && old.target.id !== station.id;
      if (leftStation || old.audio.ended || old.audio.currentTime >= (cut.start || 0) + cut.duration + 0.05) {
        this.live = null;
        this.retire(old);
      }
    }
    // An autoplay block does not advance, start or unmute any audio element.
    if (this.context?.state === 'suspended') {
      this.prepare(alternate || scheduled, true);
      this.warm(now, scheduled, alternate || scheduled);
      this.phase = 'gesture';
      this.emit();
      return;
    }
    if (this.phase === 'gesture') {
      this.emit();
      return;
    }
    const active = this.live;
    if (active) {
      if (!ready(active) || active.waiting || active.audio.ended) active.blockedSince ??= performance.now();
      else active.blockedSince = null;
    }
    const stalled =
      active?.blockedSince != null && performance.now() - active.blockedSince >= BUFFER_GRACE_MS;
    let cue = scheduled;
    if (alternate) {
      if (active?.key === scheduled.key) {
        if (stalled && ready(this.prepare(alternate, true))) cue = alternate;
      } else if (active?.key === alternate.key) {
        if (!stalled || !ready(this.prepare(scheduled, true))) cue = alternate;
      } else {
        const mix = this.banks.find((b) => b.key === scheduled.key);
        const song = this.banks.find((b) => b.key === alternate.key);
        // Give the song already on the dial first use of the connection. Race
        // the archive if it stalls, or use the station mix if it is ready now.
        if (!ready(mix) && song && (ready(song) || performance.now() - this.switchedAt < 450))
          cue = alternate;
        else if (!ready(this.prepare(scheduled, true)) && this.prepare(alternate, true)) cue = alternate;
      }
    }
    if (this.live?.key === cue.key) {
      const audio = this.live.audio;
      if (ready(active) && Math.abs(audio.currentTime - cue.time) > 1.8) this.seek(active, cue.time, 1.8);
      this.phase = stalled ? 'buffering' : 'live';
    } else {
      const b = this.prepare(cue, true);
      this.candidate = b;
      if (!b && (this.faults.get(cue.cut.fileKey || cue.cut.url) || 0) > Date.now())
        this.phase = 'unavailable';
      else if (this.lastHeard !== station.id) this.phase = 'tuning';
      else if (this.live?.target.id === station.id && !stalled && ready(this.live) && ready(b))
        this.phase = 'live';
      else this.phase = 'buffering';
      if (b) this.activate(b, cue);
    }
    if (cue !== scheduled && this.live?.key === cue.key) {
      if (cue.left < PRELOAD) this.prepare(scheduled, true);
      else if (!stalled) {
        const mix = this.banks.find((bank) => bank.key === scheduled.key);
        if (mix && !mix.retired && !mix.queued && mix.audio.networkState === 2) this.reset(mix);
      }
    }
    this.warm(now, scheduled, cue);
    this.emit();
  }
  emit(force = false) {
    // Keep the outgoing track label through a ready crossfade. A cold switch
    // still reports tuning as soon as the selected recording needs to load.
    if (!force && this.phase === 'tuning' && this.live && this.candidate?.queued && ready(this.candidate))
      return;
    const cue = this.live?.target,
      a = this.live?.audio;
    const chapter = cue?.cut.chapters?.findLast((c) => c.start <= a.currentTime);
    const state = {
      phase: this.phase,
      powered: this.powered,
      station: this.station()?.id,
      audible: cue?.id,
      kind: chapter?.kind || cue?.cut.kind,
      title: chapter?.title || cue?.cut.title,
      artist: chapter?.artist || cue?.cut.description,
    };
    const key = JSON.stringify(state);
    if (force || key !== this.lastState) {
      this.lastState = key;
      this.onChange(state);
    }
  }
  replace(stations) {
    const changed = new Set(stations.filter((s, i) => s !== this.stations[i]).map((s) => s.id));
    if (changed.has(this.station().id)) this.turn++;
    this.stations = stations;
    for (const b of this.banks) {
      if (!changed.has(b.target?.id)) continue;
      if (b === this.candidate) this.candidate = null;
      if (b === this.live) b.key = null;
      else this.reset(b);
    }
    this.tick();
  }
}
