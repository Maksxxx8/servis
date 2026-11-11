/**
 * pages/booking.js — Клієнтський віджет онлайн-запису (кроки 1–5)
 *
 * Крок 1: Вибір майстра
 * Крок 2: Вибір послуг
 * Крок 3: Вибір дати та часу
 * Крок 4: Контактні дані та підтвердження
 * Крок 5: Успіх
 */

import state from '../state.js';
import { $, show, hide, toggle } from '../utils/dom.js';
import { timeToMin, minToTime } from '../utils/time.js';
import { todayStr } from '../config.js';
import { saveDatabase } from '../http/api-client.js';

// =================== РЕНДЕР МАЙСТРІВ (Крок 1) ===================

export function renderWidgetMasters() {
  const container = $('widget-masters-list');
  if (!container) return;

  container.innerHTML = state.db.masters.map(m => `
    <div data-master-id="${m.id}" class="p-4 rounded-2xl border ${state.widget.masterId === m.id ? 'border-indigo-600 bg-indigo-50/40' : 'border-slate-200 hover:border-indigo-300'} cursor-pointer transition flex items-center justify-between">
      <div class="flex items-center gap-3.5">
        <div class="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-2xl font-bold">${m.avatar || '✨'}</div>
        <div>
          <div class="font-bold text-slate-900">${m.name}</div>
          <div class="text-xs text-indigo-600 font-medium">${m.role}</div>
          <div class="text-xs text-slate-500 mt-0.5">${m.bio || ''}</div>
        </div>
      </div>
      <span class="text-slate-400 text-lg">→</span>
    </div>
  `).join('');

  // Навісити обробники
  container.querySelectorAll('[data-master-id]').forEach(el => {
    el.addEventListener('click', () => selectMaster(el.dataset.masterId));
  });
}

function selectMaster(masterId) {
  if (state.widget.masterId !== masterId) {
    state.widget.masterId = masterId;
    state.widget.serviceIds = [];
  }
  goToStep(2);
}

// =================== РЕНДЕР ПОСЛУГ (Крок 2) ===================

export function renderWidgetServices() {
  if (!state.widget.masterId) return;
  const master = state.db.masters.find(m => m.id === state.widget.masterId);
  const badge = $('selected-master-badge');
  if (badge) badge.textContent = master ? `${master.name} (${master.role})` : '';

  const list = state.db.services.filter(s => s.masterId === state.widget.masterId);
  const container = $('widget-services-list');
  if (!container) return;

  container.innerHTML = list.map(s => {
    const checked = state.widget.serviceIds.includes(s.id);
    return `
      <div data-service-id="${s.id}" class="p-3.5 rounded-2xl border ${checked ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300'} cursor-pointer transition flex items-center justify-between gap-3">
        <div>
          <div class="font-semibold text-sm text-slate-800">${s.title}</div>
          <div class="text-xs text-slate-500 mt-0.5">⏱ ${s.duration} хв</div>
        </div>
        <div class="flex items-center gap-3">
          <span class="font-bold text-sm text-slate-900 whitespace-nowrap">${s.price} ₴</span>
          <div class="w-5 h-5 rounded-md border flex items-center justify-center ${checked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300'} text-xs">
            ${checked ? '✓' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Навісити обробники
  container.querySelectorAll('[data-service-id]').forEach(el => {
    el.addEventListener('click', () => toggleService(el.dataset.serviceId));
  });

  // Підсумок
  const selectedObjs = state.db.services.filter(s => state.widget.serviceIds.includes(s.id));
  const totalDur = selectedObjs.reduce((acc, s) => acc + Number(s.duration), 0);
  const totalPrice = selectedObjs.reduce((acc, s) => acc + Number(s.price), 0);

  const durEl = $('widget-total-duration');
  const priceEl = $('widget-total-price');
  if (durEl) durEl.textContent = totalDur;
  if (priceEl) priceEl.textContent = totalPrice;

  toggle('widget-services-footer', selectedObjs.length === 0);
}

function toggleService(serviceId) {
  const idx = state.widget.serviceIds.indexOf(serviceId);
  if (idx > -1) state.widget.serviceIds.splice(idx, 1);
  else state.widget.serviceIds.push(serviceId);
  renderWidgetServices();
}

// =================== РЕНДЕР СЛОТІВ ЧАСУ (Крок 3) ===================

export function renderTimeSlots() {
  const dateInput = $('widget-date-picker');
  if (!dateInput) return;
  if (!dateInput.value) dateInput.value = state.widget.date;
  state.widget.date = dateInput.value;

  const selectedObjs = state.db.services.filter(s => state.widget.serviceIds.includes(s.id));
  const neededDuration = selectedObjs.reduce((acc, s) => acc + Number(s.duration), 0) || 60;
  const startMin = (Number(state.db.salon.workStart) || 9) * 60;
  const endMin = (Number(state.db.salon.workEnd) || 20) * 60;

  const busy = state.db.appointments.filter(a =>
    a.masterId === state.widget.masterId &&
    a.date === state.widget.date &&
    a.status !== 'cancelled'
  );

  const slots = [];
  for (let m = startMin; m + neededDuration <= endMin; m += 30) {
    const slotStart = m;
    const slotEnd = m + neededDuration;
    const hasConflict = busy.some(b => {
      const bStart = timeToMin(b.time);
      const bEnd = bStart + Number(b.duration || 60);
      return slotStart < bEnd && slotEnd > bStart;
    });
    if (!hasConflict) slots.push(minToTime(m));
  }

  const container = $('widget-time-slots');
  if (!container) return;

  if (slots.length === 0) {
    container.innerHTML = `<div class="col-span-3 text-center py-6 text-xs text-slate-400">На обрану дату немає вільних вікон достатньої тривалості</div>`;
    return;
  }

  container.innerHTML = slots.map(t => `
    <button data-time="${t}" class="py-2.5 rounded-xl border text-xs font-semibold transition ${state.widget.time === t ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 hover:border-indigo-400 text-slate-700'}">
      ${t}
    </button>
  `).join('');

  container.querySelectorAll('[data-time]').forEach(btn => {
    btn.addEventListener('click', () => selectTimeSlot(btn.dataset.time));
  });
}

function selectTimeSlot(t) {
  state.widget.time = t;
  goToStep(4);
}

// =================== НАВІГАЦІЯ ПО КРОКАХ ===================

export function goToStep(step) {
  if (step === 2 && !state.widget.masterId) return;
  if (step === 3 && state.widget.serviceIds.length === 0) return;
  if (step === 4 && !state.widget.time) return;

  state.widget.step = step;
  for (let i = 1; i <= 5; i++) {
    const el = $(`widget-step-${i}`);
    if (el) el.classList.toggle('hidden', i !== step);
    const btn = $(`step-btn-${i}`);
    if (btn) {
      btn.className = i === step
        ? "text-left py-1.5 px-2 rounded-lg bg-white/25 text-white font-semibold truncate"
        : "text-left py-1.5 px-2 rounded-lg bg-white/5 text-slate-300 truncate";
    }
  }

  if (step === 2) renderWidgetServices();
  if (step === 3) renderTimeSlots();
  if (step === 4) fillConfirmation();
}

function fillConfirmation() {
  const master = state.db.masters.find(m => m.id === state.widget.masterId);
  const selectedObjs = state.db.services.filter(s => state.widget.serviceIds.includes(s.id));
  const totalDur = selectedObjs.reduce((acc, s) => acc + Number(s.duration), 0);
  const totalPrice = selectedObjs.reduce((acc, s) => acc + Number(s.price), 0);

  const nameEl = $('confirm-master-name');
  if (nameEl) nameEl.textContent = `${master.name} (${master.role})`;

  const srvEl = $('confirm-services-list');
  if (srvEl) srvEl.textContent = selectedObjs.map(s => s.title).join(', ');

  const dtEl = $('confirm-datetime');
  if (dtEl) dtEl.textContent = `📅 ${state.widget.date} о ${state.widget.time} (${totalDur} хв)`;

  const prEl = $('confirm-price');
  if (prEl) prEl.textContent = `${totalPrice} ₴`;
}

// =================== ПІДТВЕРДЖЕННЯ ЗАПИСУ КЛІЄНТОМ ===================

export async function submitClientBooking() {
  const name = $('client-name').value.trim();
  const phone = $('client-phone').value.trim();
  const comment = $('client-comment').value.trim();

  if (!name || !phone) {
    alert("Будь ласка, вкажіть ваше ім'я та телефон");
    return;
  }

  const master = state.db.masters.find(m => m.id === state.widget.masterId);
  const selectedObjs = state.db.services.filter(s => state.widget.serviceIds.includes(s.id));
  const totalDur = selectedObjs.reduce((acc, s) => acc + Number(s.duration), 0);
  const totalPrice = selectedObjs.reduce((acc, s) => acc + Number(s.price), 0);

  const newBooking = {
    id: 'a' + Date.now(),
    masterId: state.widget.masterId,
    serviceIds: [...state.widget.serviceIds],
    date: state.widget.date,
    time: state.widget.time,
    duration: totalDur,
    price: totalPrice,
    clientName: name,
    clientPhone: phone,
    status: 'pending',
    notes: comment
  };

  state.db.appointments.push(newBooking);

  const tgMessage = `🔔 <b>Новий онлайн-запис!</b>
Майстер: <b>${master.name}</b>
Послуги: ${selectedObjs.map(s => s.title).join(', ')}
Дата: <b>${newBooking.date} о ${newBooking.time}</b>
Клієнт: ${name} (${phone})
Сума: ${totalPrice} ₴`;

  await saveDatabase({ chatId: master.tgChatId || state.db.salon.tgChatId, message: tgMessage });

  const successEl = $('success-details');
  if (successEl) successEl.textContent = `${master.name} чекає на вас ${newBooking.date} о ${newBooking.time}. Вартість: ${totalPrice} ₴.`;

  goToStep(5);
}

// =================== СКИДАННЯ ВІДЖЕТА ===================

export function resetWidget() {
  state.widget = {
    step: 1,
    masterId: null,
    serviceIds: [],
    date: todayStr,
    time: null
  };
  const nameEl = $('client-name');
  if (nameEl) nameEl.value = '';
  const phoneEl = $('client-phone');
  if (phoneEl) phoneEl.value = '';
  const commentEl = $('client-comment');
  if (commentEl) commentEl.value = '';

  goToStep(1);
  renderWidgetMasters();
}

// =================== ІНІЦІАЛІЗАЦІЯ ===================

export function initBooking() {
  // Дата
  const datePicker = $('widget-date-picker');
  if (datePicker) {
    datePicker.value = todayStr;
    datePicker.addEventListener('change', renderTimeSlots);
  }

  // Кнопка «Обрати дату та час»
  const btnToStep3 = document.querySelector('[data-action="to-step-3"]');
  if (btnToStep3) btnToStep3.addEventListener('click', () => goToStep(3));

  // Кнопки навігації кроків
  document.querySelectorAll('[data-step-nav]').forEach(btn => {
    btn.addEventListener('click', () => goToStep(Number(btn.dataset.stepNav)));
  });

  // Кнопка підтвердження
  const btnSubmit = document.querySelector('[data-action="submit-booking"]');
  if (btnSubmit) btnSubmit.addEventListener('click', submitClientBooking);

  // Кнопка ще один запис
  const btnReset = document.querySelector('[data-action="reset-widget"]');
  if (btnReset) btnReset.addEventListener('click', resetWidget);

  // Підписка на оновлення
  state.subscribe(() => {
    const salonNameEl = $('widget-salon-name');
    if (salonNameEl) salonNameEl.textContent = state.db.salon.name;
    const salonAddrEl = $('widget-salon-address');
    if (salonAddrEl) salonAddrEl.textContent = state.db.salon.address;
    renderWidgetMasters();
  });
}
