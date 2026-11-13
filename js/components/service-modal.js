/**
 * components/service-modal.js — Модальне вікно додавання / редагування послуги з підтримкою буферного часу
 */

import state from '../state.js';
import { $, show, hide } from '../utils/dom.js';
import { saveDatabase } from '../http/api-client.js';

/**
 * Встановити вибраний колір послуги
 */
function setSelectedServiceColor(color) {
  const input = $('edit-service-color');
  if (input) input.value = color;

  const swatches = document.querySelectorAll('#service-color-swatches [data-service-color]');
  swatches.forEach(btn => {
    const isSelected = btn.dataset.serviceColor.toLowerCase() === color.toLowerCase();
    btn.className = isSelected
      ? "w-7 h-7 rounded-full border-2 border-indigo-600 shadow-md ring-2 ring-indigo-200 scale-110 transition"
      : "w-7 h-7 rounded-full border-2 border-transparent transition hover:scale-105";
  });
}

/**
 * Відкрити модалку послуги (нова або редагування)
 * @param {string|null} serviceId — id послуги для редагування, або null для нової
 */
export function openServiceModal(serviceId = null) {
  // Заповнити список майстрів
  $('edit-service-master').innerHTML = state.db.masters
    .map(m => `<option value="${m.id}">${m.name} (${m.role})</option>`)
    .join('');

  if (serviceId) {
    const s = state.db.services.find(x => x.id === serviceId);
    if (!s) return;
    $('service-modal-title').textContent = 'Редагувати послугу';
    $('edit-service-id').value = s.id;
    $('edit-service-master').value = s.masterId;
    $('edit-service-title').value = s.title;
    $('edit-service-duration').value = s.duration;
    $('edit-service-buffer').value = s.bufferTime !== undefined ? s.bufferTime : 15;
    $('edit-service-price').value = s.price;
    setSelectedServiceColor(s.color || '#63ade2');
  } else {
    $('service-modal-title').textContent = 'Нова послуга';
    $('edit-service-id').value = '';
    $('edit-service-title').value = '';
    $('edit-service-duration').value = 60;
    $('edit-service-buffer').value = 15;
    $('edit-service-price').value = 500;
    setSelectedServiceColor('#63ade2');
  }

  show('service-modal');
}

/**
 * Закрити модалку послуги
 */
export function closeServiceModal() {
  hide('service-modal');
}

/**
 * Зберегти послугу з модалки
 */
export async function saveServiceFromModal() {
  const id = $('edit-service-id').value;
  const masterId = $('edit-service-master').value;
  const title = $('edit-service-title').value.trim();
  const duration = Number($('edit-service-duration').value) || 60;
  const bufferTime = Number($('edit-service-buffer').value) || 0;
  const price = Number($('edit-service-price').value) || 0;
  const color = $('edit-service-color')?.value || '#63ade2';

  if (!title) return alert('Введіть назву послуги');

  const payload = { id: id || ('s' + Date.now()), masterId, title, duration, bufferTime, price, color };

  const prevServices = [...state.db.services];
  if (id) {
    const idx = state.db.services.findIndex(x => x.id === id);
    if (idx > -1) state.db.services[idx] = payload;
  } else {
    state.db.services.push(payload);
  }

  const ok = await saveDatabase();
  if (!ok) {
    state.db.services = prevServices;
    state.notify();
    return;
  }

  closeServiceModal();
}

/**
 * Видалити послугу
 * @param {string} serviceId
 */
export async function deleteService(serviceId) {
  if (!confirm('Видалити цю послугу з прайсу?')) return;
  const prevServices = [...state.db.services];
  state.db.services = state.db.services.filter(s => s.id !== serviceId);
  const ok = await saveDatabase();
  if (!ok) {
    state.db.services = prevServices;
    state.notify();
  }
}

/**
 * Ініціалізація: навісити обробники
 */
export function initServiceModal() {
  const btnSave = document.querySelector('#service-modal [data-action="save-service"]');
  if (btnSave) btnSave.addEventListener('click', saveServiceFromModal);

  const btnCancel = document.querySelector('#service-modal [data-action="cancel-service"]');
  if (btnCancel) btnCancel.addEventListener('click', closeServiceModal);

  // Вибір кольору послуги з палітри
  const swatches = document.querySelectorAll('#service-color-swatches [data-service-color]');
  swatches.forEach(btn => {
    btn.addEventListener('click', () => {
      setSelectedServiceColor(btn.dataset.serviceColor);
    });
  });

  const customColorInput = $('edit-service-custom-color');
  if (customColorInput) {
    customColorInput.addEventListener('input', () => {
      setSelectedServiceColor(customColorInput.value);
    });
  }
}
