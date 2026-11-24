// Hold D-pad left and use a shoulder button to tune, or Cross/A for radio power.
export function connectGamepad({ isOpen, browse, togglePower }) {
  let running = false,
    previous = [];
  function connected() {
    try {
      return Array.from(navigator.getGamepads?.() || []).find(
        (p) => p?.connected && p.mapping === 'standard',
      );
    } catch {
      return null;
    }
  }
  function poll() {
    const pad = connected();
    if (!pad) {
      running = false;
      previous = [];
      return;
    }
    const buttons = pad.buttons.map((b) => b.pressed);
    if (buttons[14] && isOpen()) {
      if (buttons[4] && !previous[4]) browse(-1);
      if (buttons[5] && !previous[5]) browse(1);
      if (buttons[0] && !previous[0]) togglePower();
    }
    previous = buttons;
    requestAnimationFrame(poll);
  }
  function start() {
    if (!running) {
      running = true;
      requestAnimationFrame(poll);
    }
  }
  addEventListener('gamepadconnected', start);
  if (connected()) start();
}
