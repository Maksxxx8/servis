/**
 * utils/format.js — Форматування дат, цін та рядків
 */

/**
 * Форматувати ціну: "650 ₴"
 */
export function formatPrice(price) {
  return `${Number(price)} ₴`;
}

/**
 * Форматувати тривалість: "90 хв"
 */
export function formatDuration(minutes) {
  return `${minutes} хв`;
}

/**
 * Форматувати дату та час для підтвердження
 */
export function formatDateTime(date, time, duration) {
  return `📅 ${date} о ${time} (${duration} хв)`;
}
