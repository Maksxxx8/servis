/**
 * utils/dom.js — Хелпери для роботи з DOM
 */

/** Знайти елемент за id */
export function $(id) {
  return document.getElementById(id);
}

/** Знайти елементи за CSS-селектором */
export function $$(selector) {
  return document.querySelectorAll(selector);
}

/** Показати елемент (видалити hidden) */
export function show(el) {
  if (typeof el === 'string') el = $(el);
  if (el) el.classList.remove('hidden');
}

/** Сховати елемент (додати hidden) */
export function hide(el) {
  if (typeof el === 'string') el = $(el);
  if (el) el.classList.add('hidden');
}

/** Переключити hidden клас */
export function toggle(el, shouldHide) {
  if (typeof el === 'string') el = $(el);
  if (el) el.classList.toggle('hidden', shouldHide);
}
