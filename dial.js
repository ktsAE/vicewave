import { esc } from './ui.js';
import { stationFrame } from './artwork.js';

export function cover(station) {
  const label = '<span class="station-lettering">' + esc(station.name) + '</span>';
  const frame = stationFrame(station.artwork);
  const image = station.artwork ? '<img draggable="false" decoding="async" loading="lazy" ' +
    (frame ? 'class="station-frame" ' : '') + 'src="' + esc(station.artwork) + '" alt="">' : '';
  return '<span class="station-cover" aria-hidden="true">' + image + label + '</span>';
}
export function dial(root, stations, initial, { change, activate, preview, live = false }) {
  const strip = root.querySelector('.strip'),
    sleeves = strip.querySelector('.sleeves'),
    scale = root.querySelector('.scale');
  const previous = strip.querySelector('.step.left'), next = strip.querySelector('.step.right');
  const action = live ? 'Tune to ' : 'Browse ';
  const n = stations.length,
    wrap = (i) => ((i % n) + n) % n;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let position = initial,
    target = initial,
    selection = initial,
    motion,
    dragFrame,
    drag = null,
    lastWheel = -Infinity, lastWheelStep = -Infinity, wheelDirection = 0, wheelTravel = 0;
  sleeves.innerHTML = stations
    .map(
      (s, i) =>
        '<button type="button" class="sleeve" data-index="' +
        i +
        '" tabindex="-1" aria-current="false" aria-label="' + action +
        esc(s.name) +
        '"><span class="artwork">' +
        cover(s) +
        '</span></button>',
    )
    .join('');
  scale.innerHTML = stations
    .map(
      (s, i) =>
        '<button aria-pressed="false" aria-label="' + action +
        esc(s.name) +
        '" title="' +
        esc(s.name) +
        '" data-index="' +
        i +
        '"><span>' +
        ([0, 4, 9, 14, 19, n - 1].includes(i) ? String(i + 1).padStart(2, '0') : '') +
        '</span></button>',
    )
    .join('');
  const tiles = [...sleeves.children],
    ticks = [...scale.children];
  let pitch = 0;
  const distanceFrom = (i, at) => wrap(i - at + n / 2) - n / 2;
  function pose(delta) {
    const distance = Math.min(Math.abs(delta), 4);
    const inner = Math.min(distance, 1);
    const middle = Math.min(Math.max(distance - 1, 0), 1);
    const outer = Math.max(distance - 2, 0);
    const zoom = 1 - inner * 0.245 - middle * 0.165 - Math.min(outer, 1) * 0.1;
    const x = Math.sign(delta) * pitch * (inner + middle * 0.77 + outer * 0.58);
    return {
      transform: 'translate(-50%,-50%) translateX(' + x.toFixed(2) + 'px) scale(' + zoom.toFixed(4) + ')',
      opacity: String(Math.max(0, 1 - inner * 0.24 - Math.max(0, distance - 1) * 0.22)),
    };
  }
  function layout(from = position) {
    for (const [i, tile] of tiles.entries()) {
      const delta = distanceFrom(i, position), distance = Math.abs(delta);
      let oldDelta = distanceFrom(i, from);
      const visible = distance < 3.6 || (motion && Math.abs(oldDelta) < 3.6);
      if (tile.hidden !== !visible) tile.hidden = !visible;
      if (!visible) continue;
      // A sleeve wrapping around the back of the dial enters from its nearest edge.
      if (Math.abs(oldDelta - delta) > n / 2) oldDelta = Math.sign(delta) * 4;
      const end = pose(delta);
      tile.style.transform = end.transform;
      tile.style.opacity = end.opacity;
      tile.style.setProperty('--brightness', String(Math.max(0.53, 1 - distance * 0.15)));
      tile.style.zIndex = String(Math.round(8 - Math.min(distance, 3) * 2));
      tile.classList.toggle('settled', !motion && i === selection && distance < 0.0001);
      if (motion) {
        motion.effects.push(tile.animate([pose(oldDelta), end], {
          duration: motion.duration, easing: 'cubic-bezier(.333333,1,.666667,1)',
        }));
      }
    }
  }
  function measure() {
    const size = tiles[selection].offsetWidth;
    if (!size || !strip.clientWidth) return;
    const spacing = Math.min(size * 0.95, (strip.clientWidth + size) * 0.245);
    if (pitch === spacing) return;
    pitch = spacing;
    if (motion) animate(target);
    else layout();
  }
  function mark(i, selected) {
    tiles[i].classList.toggle('center', selected);
    tiles[i].setAttribute('aria-current', String(selected));
    ticks[i].classList.toggle('selected', selected);
    ticks[i].setAttribute('aria-pressed', String(selected));
  }
  function select(next) {
    if (next === selection) return;
    mark(selection, false);
    selection = next;
    mark(next, true);
    change(next);
  }
  function interrupt() {
    if (!motion) return;
    const progress = Math.min(1, (performance.now() - motion.start) / motion.duration);
    position = motion.from + (target - motion.from) * (1 - (1 - progress) ** 3);
    clearTimeout(motion.timer);
    for (const effect of motion.effects) effect.cancel();
    motion = null;
  }
  function animate(dest) {
    interrupt();
    cancelAnimationFrame(dragFrame);
    dragFrame = null;
    const from = position;
    position = target = dest;
    select(wrap(Math.round(dest)));
    if (reduce.matches || Math.abs(dest - from) < 0.001) {
      layout();
      return;
    }
    motion = { from, start: performance.now(), duration: 185, effects: [] };
    layout(from);
    motion.timer = setTimeout(() => {
      motion = null;
      layout();
    }, motion.duration);
  }
  function step(amount) {
    activate?.();
    animate(Math.round(target) + amount);
  }
  function jump(i) {
    activate?.();
    const base = Math.round(target);
    animate(base + wrap(i - wrap(base) + n / 2) - n / 2);
  }
  strip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.step')) return;
    if (motion) {
      interrupt();
      layout();
    }
    activate?.();
    if (!pitch) measure();
    if (!pitch) return;
    drag = {
      id: e.pointerId,
      start: e.clientX,
      origin: position,
      moved: false,
      hit: e.target.closest('[data-index]')?.dataset.index,
    };
    strip.setPointerCapture(e.pointerId);
    strip.classList.add('dragging');
  });
  strip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.start;
    if (Math.abs(dx) > 5) drag.moved = true;
    if (drag.moved) {
      position = drag.origin - dx / pitch;
      target = position;
      if (dragFrame == null) dragFrame = requestAnimationFrame(() => {
        dragFrame = null;
        select(wrap(Math.round(position)));
        layout();
      });
    }
  });
  function release(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, hit, start, origin } = drag;
    drag = null;
    strip.classList.remove('dragging');
    if (e.type === 'pointerup' && !moved && hit !== undefined) {
      jump(Number(hit));
      return;
    }
    let dest = Math.round(position);
    if (
      e.type === 'pointerup' &&
      moved &&
      Math.abs(e.clientX - start) > Math.min(48, pitch * 0.25) &&
      dest === Math.round(origin)
    )
      dest += Math.sign(start - e.clientX);
    animate(dest);
  }
  strip.addEventListener('pointerup', release);
  strip.addEventListener('pointercancel', release);
  sleeves.addEventListener('click', (e) => {
    if (e.detail === 0) {
      const b = e.target.closest('[data-index]');
      if (b) jump(+b.dataset.index);
    }
  });
  strip.addEventListener(
    'wheel',
    (e) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(d) < 3 || e.ctrlKey) return;
      e.preventDefault();
      const now = performance.now(), direction = Math.sign(d);
      const newGesture = direction !== wheelDirection || now - lastWheel > 110;
      lastWheel = now;
      wheelDirection = direction;
      wheelTravel = newGesture ? Math.abs(d) : wheelTravel + Math.abs(d);
      if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || newGesture ||
          (wheelTravel >= 64 && now - lastWheelStep >= 135)) {
        lastWheelStep = now;
        wheelTravel = 0;
        step(direction);
      }
    },
    { passive: false },
  );
  previous.onclick = () => step(-1);
  next.onclick = () => step(1);
  let hoverTimer;
  function hint(e) {
    const button = e.target.closest('button');
    if (!button || button.contains(e.relatedTarget)) return;
    const offset = button === previous ? -1 : button === next ? 1 : 0;
    const i = offset ? wrap(selection + offset) : Number(button.dataset.index);
    clearTimeout(hoverTimer);
    if (!Number.isInteger(i) || i === selection) return;
    const prime = () => {
      const img = tiles[i].querySelector('img');
      if (img) img.loading = 'eager';
      preview?.(i);
    };
    if (e.type === 'pointerover') hoverTimer = setTimeout(prime, 90);
    else prime();
  }
  for (const area of [strip, scale]) {
    area.addEventListener('pointerover', hint);
    area.addEventListener('focusin', hint);
    area.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
  }
  scale.onclick = (e) => {
    const b = e.target.closest('[data-index]');
    if (b) jump(+b.dataset.index);
  };
  mark(initial, true);
  new ResizeObserver(measure).observe(strip);
  measure();
  return { step, jump, layout: measure };
}
