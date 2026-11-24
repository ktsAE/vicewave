import { esc, icon } from './ui.js';
import { usesFrame } from './artwork.js';

export function cover(station) {
  const label = '<span class="station-lettering">' + esc(station.name) + '</span>';
  let image = '';
  if (usesFrame(station.artwork)) image = '<station-picture data-frame="' + esc(station.artwork) + '"></station-picture>';
  else if (station.artwork) image = '<img draggable="false" src="' + esc(station.artwork) + '" alt="">';
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
    animation,
    drag = null,
    lastWheel = 0;
  sleeves.innerHTML = stations
    .map(
      (s, i) =>
        '<button type="button" class="sleeve" data-index="' +
        i +
        '" tabindex="-1" aria-label="' + action +
        esc(s.name) +
        '"><span class="artwork">' +
        cover(s) +
        '</span>' + (live ? '<span class="plate">' + icon('antenna') + ' TUNED</span>' : '') + '</button>',
    )
    .join('');
  scale.innerHTML = stations
    .map(
      (s, i) =>
        '<button aria-label="' + action +
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
  function measure() {
    const size = tiles[selection].offsetWidth;
    if (!size || !strip.clientWidth) return;
    pitch = Math.min(size * 1.01, strip.clientWidth * 0.275 + (strip.clientWidth < 600 ? 48 : 0));
    layout();
  }
  function layout() {
    for (let i = 0; i < n; i++) {
      const delta = wrap(i - position + n / 2) - n / 2,
        distance = Math.abs(delta),
        near = distance < 3.6;
      const b = tiles[i];
      b.hidden = !near;
      b.classList.toggle('center', i === selection);
      b.classList.toggle('settled', i === selection && distance < 0.0001);
      b.setAttribute('aria-current', i === selection ? 'true' : 'false');
      if (!near) continue;
      const zoom =
        1 -
        Math.min(distance, 1) * 0.245 -
        Math.min(Math.max(distance - 1, 0), 1) * 0.165 -
        Math.min(Math.max(distance - 2, 0), 1) * 0.1;
      const x =
        Math.sign(delta) *
        pitch *
        (Math.min(distance, 1) +
          Math.min(Math.max(distance - 1, 0), 1) * 0.77 +
          Math.max(distance - 2, 0) * 0.58);
      b.style.transform =
        'translate(-50%,-50%) translateX(' + x.toFixed(2) + 'px) scale(' + zoom.toFixed(4) + ')';
      b.style.opacity = String(
        Math.max(0, 1 - Math.min(distance, 1) * 0.24 - Math.max(0, distance - 1) * 0.22),
      );
      b.style.setProperty('--brightness', String(Math.max(0.53, 1 - distance * 0.15)));
      b.style.zIndex = String(Math.round(8 - Math.min(distance, 3) * 2));
    }
  }
  function select(next) {
    if (next === selection) return;
    selection = next;
    ticks.forEach((b, i) => {
      b.classList.toggle('selected', i === next);
      b.setAttribute('aria-pressed', String(i === next));
    });
    change(next);
  }
  function animate(dest) {
    cancelAnimationFrame(animation);
    target = dest;
    select(wrap(Math.round(dest)));
    const from = position,
      start = performance.now(),
      duration = reduce.matches ? 0 : 245;
    function frame(t) {
      const progress = duration ? Math.max(0, Math.min(1, (t - start) / duration)) : 1;
      position = from + (dest - from) * (1 - (1 - progress) ** 3);
      layout();
      if (progress < 1) animation = requestAnimationFrame(frame);
    }
    frame(start);
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
    cancelAnimationFrame(animation);
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
      select(wrap(Math.round(position)));
      layout();
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
      if (performance.now() - lastWheel > 260) {
        lastWheel = performance.now();
        step(Math.sign(d));
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
    if (e.type === 'pointerover') hoverTimer = setTimeout(() => preview(i), 90);
    else preview(i);
  }
  for (const area of preview ? [strip, scale] : []) {
    area.addEventListener('pointerover', hint);
    area.addEventListener('focusin', hint);
    area.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
  }
  scale.onclick = (e) => {
    const b = e.target.closest('[data-index]');
    if (b) jump(+b.dataset.index);
  };
  ticks[initial].classList.add('selected');
  ticks[initial].setAttribute('aria-pressed', 'true');
  new ResizeObserver(measure).observe(strip);
  measure();
  return { step, jump, layout: measure };
}
