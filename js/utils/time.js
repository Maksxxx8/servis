/**
 * utils/time.js — Утиліти роботи з часом
 */

/**
 * Перетворити рядок часу "HH:MM" у хвилини від початку доби
 */
export function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Перетворити хвилини від початку доби у рядок "HH:MM"
 */
export function minToTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}
