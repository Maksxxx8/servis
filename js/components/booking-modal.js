/**
 * components/booking-modal.js — Модальне вікно ручного запису / редагування візиту (шахівниця)
 */

import state from '../state.js';
import { $, show, hide } from '../utils/dom.js';
import { saveDatabase } from '../http/api-client.js';
import { todayStr } from '../config.js';

/**
 * Заповнити список послуг за обраним майстром
 */
export function populateModalServices() {
  const mId = $('modal-booking-master').value;
  const srvs = state.db.services.filter(s => s.masterId === mId);
  $('modal-booking-service').innerHTML = srvs
    .map(s => `<option value="${s.id}">${s.title} (${s.price} ₴)</option>`)
    .join('');
}

/**
 * Відкрити модалку для нового запису
 */
export function openManualBookingModal(masterId = 'm1', dateStr = todayStr, slotTime = '10:00') {
  $('modal-booking-id').value = '';
  $('booking-modal-title').textContent = 'Новий запис клієнта';
  $('btn-delete-booking').classList.add('hidden');

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

  $('modal-booking-id').value = app.id;
  $('booking-modal-title').textContent = 'Картка візиту';
  $('btn-delete-booking').classList.remove('hidden');

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
}

/**
 * Зберегти запис з модалки
 */
export async function saveBookingFromModal() {
  const id = $('modal-booking-id').value;
  const masterId = $('modal-booking-master').value;
  const serviceId = $('modal-booking-service').value;
  const srv = state.db.services.find(s => s.id === serviceId);

  const entry = {
    id: id || ('a' + Date.now()),
    masterId,
    serviceIds: serviceId ? [serviceId] : [],
    date: $('modal-booking-date').value,
    time: $('modal-booking-time').value,
    duration: srv ? Number(srv.duration) : 60,
    price: srv ? Number(srv.price) : 500,
    clientName: $('modal-booking-client').value.trim() || 'Клієнт',
    clientPhone: $('modal-booking-phone').value.trim(),
    status: $('modal-booking-status').value,
    notes: $('modal-booking-notes').value.trim()
  };

  if (id) {
    const idx = state.db.appointments.findIndex(a => a.id === id);
    if (idx > -1) state.db.appointments[idx] = entry;
  } else {
    state.db.appointments.push(entry);
  }

  closeBookingModal();
  await saveDatabase();
}

/**
 * Видалити запис з модалки
 */
export async function deleteBookingFromModal() {
  const id = $('modal-booking-id').value;
  state.db.appointments = state.db.appointments.filter(a => a.id !== id);
  closeBookingModal();
  await saveDatabase();
}

/**
 * Ініціалізація: навісити обробники
 */
export function initBookingModal() {
  const masterSelect = $('modal-booking-master');
  if (masterSelect) masterSelect.addEventListener('change', populateModalServices);

  const btnSave = document.querySelector('#booking-modal [data-action="save-booking"]');
  if (btnSave) btnSave.addEventListener('click', saveBookingFromModal);

  const btnCancel = document.querySelector('#booking-modal [data-action="cancel-booking"]');
  if (btnCancel) btnCancel.addEventListener('click', closeBookingModal);

  const btnDelete = $('btn-delete-booking');
  if (btnDelete) btnDelete.addEventListener('click', deleteBookingFromModal);

  const btnClose = document.querySelector('#booking-modal [data-action="close-booking"]');
  if (btnClose) btnClose.addEventListener('click', closeBookingModal);
}
