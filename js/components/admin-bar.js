/**
 * components/admin-bar.js — Верхня панель адміністратора
 *
 * Управляє вкладками:
 * - Віджет клієнта (client)
 * - Шахівниця розкладу (calendar)
 * - Мій графік та буфери (schedule)
 * - Налаштування та Послуги (settings)
 * - Клієнти (clients)
 */

import state from '../state.js';
import { $, show, hide } from '../utils/dom.js';

/** Поточний активний вид */
let currentView = 'client';

/**
 * Перемкнути вид (client | calendar | schedule | settings | clients)
 */
export function switchView(view) {
  currentView = view;
  ['client', 'calendar', 'schedule', 'settings', 'clients'].forEach(v => {
    const viewEl = $(`view-${v}`);
    if (viewEl) viewEl.classList.toggle('hidden', v !== view);

    const tab = $(`tab-${v}`);
    if (tab) {
      tab.className = v === view
        ? "px-3 py-1.5 rounded-md transition bg-indigo-600 text-white font-medium"
        : "px-3 py-1.5 rounded-md transition text-slate-300 hover:text-white";
    }
  });
  state.notify();
}

/**
 * Оновити індикатор підключення до сервера
 */
export function updateServerBadge() {
  const ind = $('server-indicator');
  const txt = $('server-status-text');
  if (!ind || !txt) return;

  if (state.serverConnected) {
    ind.className = "w-2.5 h-2.5 rounded-full bg-emerald-400";
    txt.textContent = "Сервер підключено (VPS)";
  } else {
    ind.className = "w-2.5 h-2.5 rounded-full bg-amber-400";
    txt.textContent = "Локальний режим (Браузер)";
  }
}

/**
 * Показати панель адміна
 */
export function showAdminBar() {
  show('admin-bar');
}

/**
 * Сховати панель адміна
 */
export function hideAdminBar() {
  hide('admin-bar');
}

/**
 * Отримати поточний вид
 */
export function getCurrentView() {
  return currentView;
}

/**
 * Ініціалізація: навісити обробники кнопок-вкладок
 */
export function initAdminBar() {
  const tabs = {
    'tab-client': 'client',
    'tab-calendar': 'calendar',
    'tab-schedule': 'schedule',
    'tab-settings': 'settings',
    'tab-clients': 'clients'
  };

  Object.entries(tabs).forEach(([btnId, view]) => {
    const btn = $(btnId);
    if (btn) btn.addEventListener('click', () => switchView(view));
  });

  state.subscribe(() => updateServerBadge());
}
