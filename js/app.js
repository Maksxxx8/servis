/**
 * app.js — Головна точка входу додатку
 * Ініціалізує компоненти, сторінки, стан та зв'язок з сервером.
 */

import state from './state.js';
import { loadDatabase, startAutoSync } from './http/api-client.js';
import { initAdminBar, showAdminBar, switchView } from './components/admin-bar.js';
import { initPinModal, openPinModal } from './components/pin-modal.js';
import { initServiceModal } from './components/service-modal.js';
import { initBookingModal } from './components/booking-modal.js';
import { initScheduleModals } from './components/schedule-modal.js';
import { initBooking, renderWidgetMasters, renderWidgetServices, renderTimeSlots } from './pages/booking.js';
import { initCalendar, renderAdminCalendar } from './pages/calendar.js';
import { initSchedule, renderScheduleCabinet } from './pages/schedule.js';
import { initSettings, renderSettingsForm } from './pages/settings.js';
import { initClients, renderClientsList } from './pages/clients.js';

async function bootstrap() {
  // Ініціалізація компонентів та навішування слухачів подій
  initAdminBar();
  initPinModal();
  initServiceModal();
  initBookingModal();
  initScheduleModals();
  initBooking();
  initCalendar();
  initSchedule();
  initSettings();
  initClients();

  // Серверна перевірка сесії адміністратора за токеном
  const savedToken = sessionStorage.getItem('salon_admin_token');
  if (savedToken) {
    try {
      const authRes = await fetch(`api-v2.php?action=check_auth&_t=${Date.now()}`, {
        headers: { 'X-Admin-Token': savedToken }
      });
      const authData = await authRes.json().catch(() => null);
      if (authData && authData.ok && authData.is_admin) {
        state.isAdmin = true;
      } else {
        sessionStorage.removeItem('salon_admin_token');
        sessionStorage.removeItem('salon_admin_auth');
        state.isAdmin = false;
      }
    } catch (e) {
      sessionStorage.removeItem('salon_admin_token');
      sessionStorage.removeItem('salon_admin_auth');
      state.isAdmin = false;
    }
  } else {
    sessionStorage.removeItem('salon_admin_auth');
    state.isAdmin = false;
  }

  // Завантаження бази даних (безпечна публічна або повна адмінська)
  await loadDatabase();

  // Навігація при відкритті
  const urlParams = new URLSearchParams(window.location.search);
  if (state.isAdmin) {
    showAdminBar();
    switchView('calendar');
  } else if (urlParams.get('admin') === '1' || window.location.hash === '#admin') {
    openPinModal();
    switchView('client');
  } else {
    switchView('client');
  }

  // Початковий рендер інтерфейсу
  renderWidgetMasters();
  renderWidgetServices();
  renderTimeSlots();

  if (state.isAdmin) {
    renderAdminCalendar();
    renderScheduleCabinet();
    renderSettingsForm();
    renderClientsList();
  }

  // Запуск фонової синхронізації між пристроями (кожні 15 сек + фокус вкладки)
  startAutoSync(15000);
}

// Запуск після завантаження DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
