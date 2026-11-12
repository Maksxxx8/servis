/**
 * http/api-client.js — HTTP-клієнт для спілкування з api-v2.php
 * Забезпечує:
 * - Захист від кешування (cache-busting query parameter + no-store)
 * - Автоматичну фонову синхронізацію між пристроями (Auto-Sync)
 * - Оновлення даних при поверненні на вкладку (Visibility / Focus)
 */

import state from '../state.js';

let activeApiUrl = 'api-v2.php';
let syncIntervalId = null;
let silentSaveNoticeShown = false;

/**
 * Знайти робочий URL бекенду без використання кешу
 */
async function resolveApiEndpoint() {
  const candidates = [activeApiUrl, 'api-v2.php', 'api.php'];
  const cacheBuster = `_t=${Date.now()}`;

  for (const url of candidates) {
    try {
      const endpoint = `${url}?${cacheBuster}`;
      const res = await fetch(endpoint, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
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
 * @param {boolean} silent — якщо true, викликає notify() лише у разі фактичної зміни даних
 */
export async function loadDatabase(silent = false) {
  let hasChanges = false;

  // При первинному запуску завантажуємо з localStorage для миттєвого рендеру
  if (!silent) {
    const localSaved = localStorage.getItem('salon_crm_db_uk');
    if (localSaved) {
      try {
        const parsed = JSON.parse(localSaved);
        if (parsed && parsed.salon && Array.isArray(parsed.masters)) {
          state.db = parsed;
        }
      } catch (e) {
        console.warn('Помилка парсингу localStorage:', e);
      }
    }
  }

  // Запит актуальних даних із сервера
  try {
    const resolved = await resolveApiEndpoint();
    if (resolved && resolved.res) {
      const remote = await resolved.res.json();
      state.serverConnected = true;

      if (remote && remote.salon && Array.isArray(remote.masters)) {
        const currentJson = JSON.stringify(state.db);
        const remoteJson = JSON.stringify(remote);

        if (currentJson !== remoteJson) {
          state.db = remote;
          localStorage.setItem('salon_crm_db_uk', remoteJson);
          hasChanges = true;
        }
      } else if (remote && remote.status === 'empty') {
        await saveDatabase();
      }
    } else {
      state.serverConnected = false;
    }
  } catch (e) {
    state.serverConnected = false;
  }

  if (!silent || hasChanges) {
    state.notify();
  }
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

    const res = await fetch(`${activeApiUrl}?_t=${Date.now()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({ ok: true }));
      if (data && data.ok) {
        state.serverConnected = true;
      } else {
        state.serverConnected = false;
        console.error('Помилка сервера при збереженні:', data);
      }
    } else {
      state.serverConnected = false;
      const errData = await res.json().catch(() => null);
      if (errData && errData.error) {
        console.error('Помилка запису на сервері:', errData.error);
        if (state.isAdmin && !silentSaveNoticeShown) {
          silentSaveNoticeShown = true;
          alert('⚠️ ' + errData.error + (errData.fix_command ? '\n\nКоманда для VPS:\n' + errData.fix_command : ''));
        }
      }
    }
  } catch (e) {
    state.serverConnected = false;
  }

  state.notify();
}

/**
 * Запустити автоматичну фонову синхронізацію між пристроями
 * @param {number} intervalMs — періодичність опитування сервера (за замовчуванням 15 сек)
 */
export function startAutoSync(intervalMs = 15000) {
  if (syncIntervalId) clearInterval(syncIntervalId);

  // 1. Періодичний запит у фоні
  syncIntervalId = setInterval(() => {
    loadDatabase(true);
  }, intervalMs);

  // 2. Миттєве оновлення при поверненні користувача на вкладку
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadDatabase(true);
    }
  });

  // 3. Миттєве оновлення при отриманні фокусу вікном
  window.addEventListener('focus', () => {
    loadDatabase(true);
  });
}
