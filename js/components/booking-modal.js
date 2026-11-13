/**
 * components/booking-modal.js — Модальне вікно ручного запису / редагування візиту (календар)
 * Підтримка буферного часу та експорту в Google Calendar / iCal
 */

import state from '../state.js';
import { $, show, hide } from '../utils/dom.js';
import { saveDatabase } from '../http/api-client.js';
import { todayStr } from '../config.js';
import { downloadIcsFile, generateGoogleCalendarUrl } from '../utils/schedule.js';

let currentModalAppointment = null;

/**
 * Заповнити список послуг за обраним майстром
 */
export function populateModalServices() {
  const mId = $('modal-booking-master').value;
  const srvs = state.db.services.filter(s => s.masterId === mId);
  $('modal-booking-service').innerHTML = srvs
    .map(s => `<option value="${s.id}" data-buffer="${s.bufferTime || 15}" data-duration="${s.duration}">${s.title} (${s.price} ₴, ⏱ ${s.duration} хв )</option>`)
    .join('');
  updateModalCalculations();
}

function updateModalCalculations() {
  const select = $('modal-booking-service');
  const opt = select.options[select.selectedIndex];
  if (opt) {
    const buf = opt.dataset.buffer || 15;
    const dur = opt.dataset.duration || 60;
    if ($('modal-booking-buffer')) $('modal-booking-buffer').value = buf;
    if ($('modal-booking-duration')) $('modal-booking-duration').value = dur;
  }
}

/**
 * Відкрити модалку для нового запису
 */
export function openManualBookingModal(masterId = 'm1', dateStr = todayStr, slotTime = '10:00') {
  currentModalAppointment = null;
  $('modal-booking-id').value = '';
  $('booking-modal-title').textContent = 'Новий запис клієнта';
  $('btn-delete-booking').classList.add('hidden');
  $('modal-booking-calendar-actions')?.classList.add('hidden');

  $('modal-booking-master').innerHTML = state.db.masters
    .map(m => `<option value="${m.id}">${m.name}</option>`)
    .join('');
  $('modal-booking-master').value = masterId;
  populateModalServices();

  $('modal-booking-status').value = 'confirmed';
  $('modal-booking-date').value = dateStr;
  $('modal-booking-time').value = slotTime;
  $('modal-booking-client').value = '';
  $('modal-booking-phone').value = '';
  $('modal-booking-notes').value = '';

  show('booking-modal');
}

/**
 * Відкрити модалку для редагування існуючого візиту
 */
export function openEditBookingModal(appId) {
  const app = state.db.appointments.find(a => a.id === appId);
  if (!app) return;

  currentModalAppointment = app;
  $('modal-booking-id').value = app.id;
  $('booking-modal-title').textContent = 'Картка візиту';
  $('btn-delete-booking').classList.remove('hidden');
  $('modal-booking-calendar-actions')?.classList.remove('hidden');

  $('modal-booking-master').innerHTML = state.db.masters
    .map(m => `<option value="${m.id}">${m.name}</option>`)
    .join('');
  $('modal-booking-master').value = app.masterId;
  populateModalServices();
  if (app.serviceIds && app.serviceIds[0]) {
    $('modal-booking-service').value = app.serviceIds[0];
  }

  $('modal-booking-status').value = app.status;
  $('modal-booking-date').value = app.date;
  $('modal-booking-time').value = app.time;
  if ($('modal-booking-duration')) $('modal-booking-duration').value = app.duration || 60;
  if ($('modal-booking-buffer')) $('modal-booking-buffer').value = app.bufferTime !== undefined ? app.bufferTime : 15;
  $('modal-booking-client').value = app.clientName;
  $('modal-booking-phone').value = app.clientPhone;
  $('modal-booking-notes').value = app.notes || '';

  show('booking-modal');
}

/**
 * Закрити модалку запису
 */
export function closeBookingModal() {
  hide('booking-modal');
  currentModalAppointment = null;
}

/**
 * Зберегти запис з модалки
 */
export async function saveBookingFromModal() {
  const id = $('modal-booking-id').value;
  const masterId = $('modal-booking-master').value;
  const serviceId = $('modal-booking-service').value;
  const srv = state.db.services.find(s => s.id === serviceId);

  const duration = $('modal-booking-duration') ? Number($('modal-booking-duration').value) : (srv ? Number(srv.duration) : 60);
  const bufferTime = $('modal-booking-buffer') ? Number($('modal-booking-buffer').value) : (srv && srv.bufferTime !== undefined ? Number(srv.bufferTime) : 15);

  const existingApp = id ? state.db.appointments.find(a => a.id === id) : null;

  const entry = {
    id: id || ('a' + Date.now()),
    masterId,
    serviceIds: serviceId ? [serviceId] : [],
    date: $('modal-booking-date').value,
    time: $('modal-booking-time').value,
    duration,
    bufferTime,
    price: srv ? Number(srv.price) : 500,
    clientName: $('modal-booking-client').value.trim() || 'Клієнт',
    clientPhone: $('modal-booking-phone').value.trim(),
    status: $('modal-booking-status').value,
    googleEventId: existingApp?.googleEventId || currentModalAppointment?.googleEventId || null,
    notes: $('modal-booking-notes').value.trim()
  };

  const prevAppointments = [...state.db.appointments];
  if (id) {
    const idx = state.db.appointments.findIndex(a => a.id === id);
    if (idx > -1) state.db.appointments[idx] = entry;
  } else {
    state.db.appointments.push(entry);
  }

  const ok = await saveDatabase();
  if (!ok) {
    state.db.appointments = prevAppointments;
    state.notify();
    return;
  }

  closeBookingModal();
}

/**
 * Видалити запис з модалки
 */
export async function deleteBookingFromModal() {
  const id = $('modal-booking-id').value;
  if (!confirm('Ви дійсно бажаєте видалити цей запис?')) return;
  const prevAppointments = [...state.db.appointments];
  state.db.appointments = state.db.appointments.filter(a => a.id !== id);

  const ok = await saveDatabase();
  if (!ok) {
    state.db.appointments = prevAppointments;
    state.notify();
    return;
  }

  closeBookingModal();
}

/**
 * Експорт поточного запису в Google Calendar
 */
export function exportToGoogleCalendar() {
  if (!currentModalAppointment) return;
  const master = state.db.masters.find(m => m.id === currentModalAppointment.masterId);
  const services = state.db.services.filter(s => currentModalAppointment.serviceIds && currentModalAppointment.serviceIds.includes(s.id));
  const url = generateGoogleCalendarUrl(currentModalAppointment, master, services, state.db.salon);
  window.open(url, '_blank');
}

/**
 * Завантажити файл .ics для поточного запису
 */
export function exportToIcsFile() {
  if (!currentModalAppointment) return;
  const master = state.db.masters.find(m => m.id === currentModalAppointment.masterId);
  const services = state.db.services.filter(s => currentModalAppointment.serviceIds && currentModalAppointment.serviceIds.includes(s.id));
  downloadIcsFile(currentModalAppointment, master, services, state.db.salon);
}

/**
 * Ініціалізація: навісити обробники
 */
export function initBookingModal() {
  const masterSelect = $('modal-booking-master');
  if (masterSelect) masterSelect.addEventListener('change', populateModalServices);

  const srvSelect = $('modal-booking-service');
  if (srvSelect) srvSelect.addEventListener('change', updateModalCalculations);

  const btnSave = document.querySelector('#booking-modal [data-action="save-booking"]');
  if (btnSave) btnSave.addEventListener('click', saveBookingFromModal);

  const btnCancel = document.querySelector('#booking-modal [data-action="cancel-booking"]');
  if (btnCancel) btnCancel.addEventListener('click', closeBookingModal);

  const btnDelete = $('btn-delete-booking');
  if (btnDelete) btnDelete.addEventListener('click', deleteBookingFromModal);

  const btnClose = document.querySelector('#booking-modal [data-action="close-booking"]');
  if (btnClose) btnClose.addEventListener('click', closeBookingModal);

  const btnGoogle = document.querySelector('[data-action="modal-export-google"]');
  if (btnGoogle) btnGoogle.addEventListener('click', exportToGoogleCalendar);

  const btnIcs = document.querySelector('[data-action="modal-export-ics"]');
  if (btnIcs) btnIcs.addEventListener('click', exportToIcsFile);
}
