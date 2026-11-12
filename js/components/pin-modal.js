/**
 * components/pin-modal.js — Модальне вікно PIN-коду для входу майстрів
 */

import state from '../state.js';
import { $, show, hide } from '../utils/dom.js';
import { showAdminBar, hideAdminBar, switchView } from './admin-bar.js';

/**
 * Відкрити модалку введення PIN
 */
export function openPinModal() {
  $('pin-input').value = '';
  show('pin-modal');
  setTimeout(() => $('pin-input').focus(), 50);
}

/**
 * Закрити модалку PIN
 */
export function closePinModal() {
  hide('pin-modal');
}

/**
 * Перевірити PIN-код і увійти
 */
export function verifyPin() {
  const entered = $('pin-input').value.trim();
  const validPin = String(state.db?.salon?.adminPin || '1234');
  if (entered === validPin) {
    state.isAdmin = true;
    sessionStorage.setItem('salon_admin_auth', '1');
    closePinModal();
    showAdminBar();
    switchView('calendar');
  } else {
    alert('Невірний PIN-код! Перевірте правильність введеного коду.');
  }
}

/**
 * Вийти з режиму адміна
 */
export function logoutAdmin() {
  state.isAdmin = false;
  sessionStorage.removeItem('salon_admin_auth');
  hideAdminBar();
  switchView('client');
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
