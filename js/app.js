/**
 * app.js — Головна точка входу додатку
 * Ініціалізує компоненти, сторінки, стан та зв'язок з сервером.
 */

import state from './state.js';
import { loadDatabase } from './http/api-client.js';
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

  // Завантаження бази даних (сервер або локальне сховище)
  await loadDatabase();

  // Перевірка сесії адміністратора
  const urlParams = new URLSearchParams(window.location.search);
  if (sessionStorage.getItem('salon_admin_auth') === '1') {
    state.isAdmin = true;
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
}

// Запуск після завантаження DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
