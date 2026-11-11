/**
 * http/api-client.js — HTTP-клієнт для спілкування з api-v2.php
 */

import state from '../state.js';

let activeApiUrl = 'api-v2.php';

/**
 * Знайти робочий URL бекенду
 */
async function resolveApiEndpoint() {
  const candidates = [activeApiUrl, 'api-v2.php', 'api.php'];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        activeApiUrl = url;
        return { res, url };
      }
    } catch (e) {
      // спробувати наступний
    }
  }
  return null;
}

/**
 * Завантажити базу даних із сервера (або localStorage як фолбек)
 */
export async function loadDatabase() {
  // Спробувати localStorage
  const localSaved = localStorage.getItem('salon_crm_db_uk');
  if (localSaved) {
    try {
      state.db = JSON.parse(localSaved);
    } catch (e) {
      console.warn('Помилка парсингу localStorage:', e);
    }
  }

  // Спробувати сервер
  try {
    const resolved = await resolveApiEndpoint();
    if (resolved && resolved.res) {
      const remote = await resolved.res.json();
      state.serverConnected = true;

      if (remote && remote.salon) {
        state.db = remote;
        localStorage.setItem('salon_crm_db_uk', JSON.stringify(state.db));
      } else if (remote && remote.status === 'empty') {
        await saveDatabase();
      }
    } else {
      state.serverConnected = false;
    }
  } catch (e) {
    state.serverConnected = false;
    console.info('Сервер недоступний, працюємо в локальному режимі');
  }

  state.notify();
}

/**
 * Зберегти базу даних на сервер та у localStorage
 * @param {Object|null} tgPayload — об'єкт { chatId, message } для Telegram-сповіщення
 */
export async function saveDatabase(tgPayload = null) {
  localStorage.setItem('salon_crm_db_uk', JSON.stringify(state.db));

  try {
    const payload = JSON.parse(JSON.stringify(state.db));
    if (tgPayload) payload._notify_telegram = tgPayload;

    const res = await fetch(activeApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      state.serverConnected = true;
    } else {
      state.serverConnected = false;
    }
  } catch (e) {
    state.serverConnected = false;
  }

  state.notify();
}
