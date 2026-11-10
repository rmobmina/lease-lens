// Motion: the one place UI animation is coordinated.
//
//   animate(key, { duration, easing, step, done })
//     Runs one requestAnimationFrame loop with timestamp-based progress. Each animation has a key
//     ('clusters', 'panel', …). Starting a new animation with the same key cancels the running one
//     first: new user intent always wins, nothing queues, and input is never blocked. step(e, t) gets
//     the eased and the raw progress, so a caller can read where an interrupted animation stood and
//     continue from there instead of jumping back to its origin.
//   cancel(key)          stop it where it is (done(false) is called)
//   cameraDuration(px)   map flights: 0.35–0.7 s depending on the distance travelled on screen
//
// prefers-reduced-motion: every animation jumps straight to its end state.
// Map camera moves use Leaflet's own flyTo (interruptible by any new move or by the user); CSS handles
// small hover/press transitions. Nothing else should start its own animation loop.

const running = new Map();

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ease = {
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  linear: (t) => t,
};

export const DUR = { micro: 160, panel: 260, split: 340 };

export function animate(key, { duration = DUR.panel, easing = ease.out, step, done } = {}) {
  cancel(key);
  if (reducedMotion() || duration <= 0) { step?.(1, 1); done?.(true); return; }
  const a = { id: 0, start: 0, t: 0, done };
  const frame = (now) => {
    if (!a.start) a.start = now;
    a.t = Math.min(1, (now - a.start) / duration);
    step?.(easing(a.t), a.t);
    if (a.t < 1) a.id = requestAnimationFrame(frame);
    else { running.delete(key); done?.(true); }
  };
  a.id = requestAnimationFrame(frame);
  running.set(key, a);
}

export function cancel(key) {
  const a = running.get(key);
  if (!a) return;
  cancelAnimationFrame(a.id);
  running.delete(key);
  a.done?.(false);
}

export const isRunning = (key) => running.has(key);

export function cameraDuration(px) {
  if (reducedMotion()) return 0;
  return Math.min(0.7, Math.max(0.35, 0.35 + px / 2400));
}
