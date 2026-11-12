/**
 * utils/time.js — Утиліти роботи з часом та датами
 */

/**
 * Перетворити рядок часу "HH:MM" у хвилини від початку доби
 */
export function timeToMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Перетворити хвилини від початку доби у рядок "HH:MM"
 */
export function minToTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Парсить рядок дати "YYYY-MM-DD" у локальний об'єкт Date (опівдні 12:00:00,
 * щоб повністю уникнути зсувів через літній/зимовий час та часові пояси)
 */
export function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return new Date(dateStr.getTime());
  const parts = String(dateStr).split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    return new Date(y, m, d, 12, 0, 0);
  }
  return new Date(dateStr);
}

/**
 * Форматує об'єкт Date у локальний календарний рядок "YYYY-MM-DD"
 */
export function formatLocalDate(date) {
  if (!date) return '';
  const d = (typeof date === 'string') ? parseLocalDate(date) : date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Додати/відняти n днів від дати "YYYY-MM-DD" без часових артефактів
 */
export function addDays(dateStr, days) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

/**
 * Додати/відняти n місяців від дати "YYYY-MM-DD"
 */
export function addMonths(dateStr, months) {
  const d = parseLocalDate(dateStr);
  d.setMonth(d.getMonth() + months);
  return formatLocalDate(d);
}

/**
 * Отримати красивий людинозрозумілий формат дати українською (напр. "12 Листопада 2026, Четвер")
 */
export function formatUADate(dateStr) {
  if (!dateStr) return '';
  const d = parseLocalDate(dateStr);
  const months = [
    'Січня', 'Лютого', 'Березня', 'Квітня', 'Травня', 'Червня',
    'Липня', 'Серпня', 'Вересня', 'Жовтня', 'Листопада', 'Грудня'
  ];
  const daysOfWeek = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П’ятниця', 'Субота'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${daysOfWeek[d.getDay()]}`;
}
