/**
 * state.js — Глобальний реактивний стан програми
 *
 * Усі модулі імпортують `state` і працюють з ним.
 * Підписка на зміни через subscribe() / сповіщення через notify().
 */

import { defaultDB, todayStr } from './config.js';

const listeners = [];

const state = {
  /** База даних салону (salon, masters, services, appointments) */
  db: JSON.parse(JSON.stringify(defaultDB)),

  /** Чи авторизований адміністратор */
  isAdmin: false,

  /** Чи підключений сервер (api-v2.php) */
  serverConnected: false,

  /** Стан клієнтського віджета запису */
  widget: {
    step: 1,
    masterId: null,
    serviceIds: [],
    date: todayStr,
    time: null
  },

  /** Підписатися на зміни стану */
  subscribe(fn) {
    listeners.push(fn);
  },

  /** Сповістити підписників про зміни */
  notify() {
    listeners.forEach(fn => fn(state));
  }
};

export default state;
