/**
 * components/pin-modal.js — Модальне вікно PIN-коду для входу майстрів
 */

import state from '../state.js';
import { $, show, hide } from '../utils/dom.js';
import { showAdminBar, hideAdminBar, switchView } from './admin-bar.js';
import { loadDatabase } from '../http/api-client.js';

/**
 * Відкрити модалку введення PIN
 */
export function openPinModal() {
  const input = $('pin-input');
  if (input) input.value = '';
  show('pin-modal');
  setTimeout(() => input?.focus(), 50);
}

/**
 * Закрити модалку PIN
 */
export function closePinModal() {
  hide('pin-modal');
}

/**
 * Серверна перевірка PIN-коду з видачею захищеного токена сесії
 */
export async function verifyPin() {
  const input = $('pin-input');
  const entered = input ? input.value.trim() : '';
  if (!entered) {
    alert('Будь ласка, введіть PIN-код');
    return;
  }

  const btnVerify = document.querySelector('#pin-modal [data-action="verify-pin"]') || document.querySelector('#pin-modal button:last-child');
  if (btnVerify) {
    btnVerify.disabled = true;
    btnVerify.textContent = '⏳ Перевірка...';
  }

  try {
    const res = await fetch(`api-v2.php?action=login&_t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: entered })
    });

    const data = await res.json().catch(() => ({ ok: false }));
    if (res.ok && data.ok && data.token) {
      state.isAdmin = true;
      sessionStorage.setItem('salon_admin_token', data.token);
      closePinModal();
      showAdminBar();
      // Завантажуємо повні конфіденційні дані адміністратора з сервера
      await loadDatabase(false);
      switchView('calendar');
    } else {
      alert('❌ ' + (data.error || 'Невірний PIN-код! Перевірте правильність коду.'));
      if (input) {
        input.value = '';
        input.focus();
      }
    }
  } catch (e) {
    alert('❌ Помилка перевірки PIN-коду: ' + e.message);
  } finally {
    if (btnVerify) {
      btnVerify.disabled = false;
      btnVerify.textContent = 'Увійти в кабінет';
    }
  }
}

/**
 * Вийти з режиму адміна (серверний Logout)
 */
export async function logoutAdmin() {
  const token = sessionStorage.getItem('salon_admin_token');
  if (token) {
    try {
      await fetch(`api-v2.php?action=logout&_t=${Date.now()}`, {
        method: 'POST',
        headers: { 'X-Admin-Token': token }
      });
    } catch (e) {}
  }
  state.isAdmin = false;
  sessionStorage.removeItem('salon_admin_token');
  sessionStorage.removeItem('salon_admin_auth');
  hideAdminBar();
  switchView('client');
  // Очищаємо приватні дані зі стейту та завантажуємо безпечний публічний стан
  await loadDatabase(false);
}

/**
 * Ініціалізація: навісити обробники
 */
export function initPinModal() {
  // Кнопки модалки
  const btnVerify = document.querySelector('#pin-modal [data-action="verify-pin"]') || document.querySelector('#pin-modal button:last-child');
  if (btnVerify) btnVerify.addEventListener('click', verifyPin);

  const btnCancel = document.querySelector('#pin-modal [data-action="close-pin"]') || document.querySelector('#pin-modal button:first-of-type');
  if (btnCancel) btnCancel.addEventListener('click', closePinModal);

  $('pin-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifyPin();
  });

  // Кнопка входу для майстрів внизу віджета
  const loginBtn = document.querySelector('[data-action="open-pin"]');
  if (loginBtn) loginBtn.addEventListener('click', openPinModal);

  // Кнопка виходу
  const logoutBtn = document.querySelector('[data-action="logout"]');
  if (logoutBtn) logoutBtn.addEventListener('click', logoutAdmin);
}
