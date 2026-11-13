/**
 * pages/booking.js — Клієнтський віджет онлайн-запису (кроки 1–5)
 * З підтримкою 3-рівневого розкладу, буферного часу, підказки вільних дат та експорту в календар
 */

import state from '../state.js';
import { $, show, hide, toggle } from '../utils/dom.js';
import { todayStr } from '../config.js';
import { saveDatabase } from '../http/api-client.js';
import { calculateAvailableSlots, findNextAvailableDays, generateGoogleCalendarUrl, downloadIcsFile } from '../utils/schedule.js';

let lastCreatedBooking = null;

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
    const buf = s.bufferTime !== undefined ? s.bufferTime : (master ? master.globalBuffer || 15 : 15);
    return `
      <div data-service-id="${s.id}" class="p-3.5 rounded-2xl border ${checked ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300'} cursor-pointer transition flex items-center justify-between gap-3">
        <div>
          <div class="font-semibold text-sm text-slate-800">${s.title}</div>
          <div class="text-xs text-slate-500 mt-0.5">
            <span>⏱ ${s.duration} хв</span>
          </div>
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

  container.querySelectorAll('[data-service-id]').forEach(el => {
    el.addEventListener('click', () => toggleService(el.dataset.serviceId));
  });

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

  const master = state.db.masters.find(m => m.id === state.widget.masterId);
  const selectedObjs = state.db.services.filter(s => state.widget.serviceIds.includes(s.id));

  const container = $('widget-time-slots');
  if (!container || !master) return;

  // Розрахунок за трирівневою системою розкладу (DateOverrides > WeeklySchedule > Bookings/TimeBlocks)
  const calc = calculateAvailableSlots(master, selectedObjs, state.widget.date, state.db);

  const summaryEl = $('step3-summary');
  if (summaryEl) {
    if (calc.isWorking) {
      summaryEl.textContent = `Робочий день: ${calc.daySched.workStart}–${calc.daySched.workEnd} • Тривалість: ${calc.totalDuration} хв`;
    } else {
      summaryEl.textContent = `⚠️ ${calc.reason || 'Вихідний день'}`;
    }
  }

  // Якщо майстер вихідний або немає слотів — показуємо підказку найближчих вільних днів
  if (!calc.isWorking || calc.slots.length === 0) {
    const nextDays = findNextAvailableDays(master, selectedObjs, state.widget.date, state.db, 3);
    
    let nextDaysHtml = '';
    if (nextDays.length > 0) {
      nextDaysHtml = `
        <div class="mt-4 pt-3 border-t border-slate-200">
          <div class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Найближчі доступні дні:</div>
          <div class="flex flex-wrap gap-2">
            ${nextDays.map(d => `
              <button type="button" data-pick-suggested-date="${d.date}" class="px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold border border-indigo-200 transition flex items-center gap-1.5">
                <span>📅 ${d.formatted}</span>
                <span class="text-[10px] bg-indigo-200 text-indigo-800 px-1.5 py-0.5 rounded-md">${d.slotsCount} слотів</span>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="col-span-3 text-center py-6 px-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
        <div class="text-2xl mb-1">${calc.isWorking ? '⏳' : '🏖️'}</div>
        <div class="text-xs font-semibold text-slate-700">
          ${calc.isWorking ? 'На обрану дату всі вільні вікна зайняті' : (calc.reason || 'Майстер не працює на обрану дату')}
        </div>
        <div class="text-[11px] text-slate-400 mt-0.5">Оберіть іншу дату для запису</div>
        ${nextDaysHtml}
      </div>
    `;

    container.querySelectorAll('[data-pick-suggested-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.widget.date = btn.dataset.pickSuggestedDate;
        dateInput.value = state.widget.date;
        renderTimeSlots();
      });
    });
    return;
  }

  // Рендер кнопок слотів
  container.innerHTML = calc.slots.map(t => `
    <button type="button" data-time="${t}" class="py-2.5 rounded-xl border text-xs font-semibold transition ${state.widget.time === t ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'border-slate-200 hover:border-indigo-400 text-slate-700 bg-white'}">
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

  const maxServiceBuffer = selectedObjs.reduce((acc, s) => Math.max(acc, Number(s.bufferTime !== undefined ? s.bufferTime : 0)), 0);
  const buffer = maxServiceBuffer > 0 ? maxServiceBuffer : (Number(master.globalBuffer) || 15);

  const newBooking = {
    id: 'a' + Date.now(),
    masterId: state.widget.masterId,
    serviceIds: [...state.widget.serviceIds],
    date: state.widget.date,
    time: state.widget.time,
    duration: totalDur,
    bufferTime: buffer,
    price: totalPrice,
    clientName: name,
    clientPhone: phone,
    status: 'pending',
    notes: comment
  };

  lastCreatedBooking = newBooking;
  state.db.appointments.push(newBooking);

  const tgMessage = `🔔 <b>Новий онлайн-запис!</b>
Майстер: <b>${master.name}</b>
Послуги: ${selectedObjs.map(s => s.title).join(', ')}
Дата: <b>${newBooking.date} о ${newBooking.time}</b> (тривалість: ${totalDur} хв)
Клієнт: ${name} (${phone})
Сума: ${totalPrice} ₴
${comment ? 'Коментар: ' + comment : ''}`;

  const ok = await saveDatabase({ 
    chatId: master.tgChatId || state.db.salon.tgChatId, 
    message: tgMessage,
    appointmentId: newBooking.id 
  });

  if (!ok) {
    state.db.appointments = state.db.appointments.filter(a => a.id !== newBooking.id);
    state.notify();
    return;
  }

  const successEl = $('success-details');
  if (successEl) {
    successEl.textContent = `${master.name} чекає на вас ${newBooking.date} о ${newBooking.time}. Вартість: ${totalPrice} ₴.`;
  }

  goToStep(5);
}

// =================== СКИДАННЯ ВІДЖЕТА ===================

export function resetWidget() {
  lastCreatedBooking = null;
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

// =================== ЕКСПОРТ В КАЛЕНДАР (КРОК 5) ===================

function addSuccessCalendarButtons() {
  const container = $('widget-step-5');
  if (!container) return;

  const existing = $('success-calendar-actions');
  if (existing) existing.remove();

  const actionsDiv = document.createElement('div');
  actionsDiv.id = 'success-calendar-actions';
  actionsDiv.className = 'flex flex-col gap-2 pt-3 max-w-xs mx-auto';
  actionsDiv.innerHTML = `
    <button type="button" id="btn-success-google" class="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition shadow-sm">
      <span>📅</span>
      <span>Додати в Google Calendar</span>
    </button>
    <button type="button" id="btn-success-ics" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition">
      <span>📥</span>
      <span>Завантажити .ics (Apple / Outlook)</span>
    </button>
  `;

  // Вставити перед кнопкою скидання
  const resetBtn = container.querySelector('[data-action="reset-widget"]');
  if (resetBtn && resetBtn.parentElement) {
    resetBtn.parentElement.insertBefore(actionsDiv, resetBtn);
  } else {
    container.appendChild(actionsDiv);
  }

  $('btn-success-google')?.addEventListener('click', () => {
    if (!lastCreatedBooking) return;
    const master = state.db.masters.find(m => m.id === lastCreatedBooking.masterId);
    const services = state.db.services.filter(s => lastCreatedBooking.serviceIds && lastCreatedBooking.serviceIds.includes(s.id));
    const url = generateGoogleCalendarUrl(lastCreatedBooking, master, services, state.db.salon);
    window.open(url, '_blank');
  });

  $('btn-success-ics')?.addEventListener('click', () => {
    if (!lastCreatedBooking) return;
    const master = state.db.masters.find(m => m.id === lastCreatedBooking.masterId);
    const services = state.db.services.filter(s => lastCreatedBooking.serviceIds && lastCreatedBooking.serviceIds.includes(s.id));
    downloadIcsFile(lastCreatedBooking, master, services, state.db.salon);
  });
}

// =================== ІНІЦІАЛІЗАЦІЯ ===================

export function initBooking() {
  const datePicker = $('widget-date-picker');
  if (datePicker) {
    datePicker.value = todayStr;
    datePicker.addEventListener('change', renderTimeSlots);
  }

  const btnToStep3 = document.querySelector('[data-action="to-step-3"]');
  if (btnToStep3) btnToStep3.addEventListener('click', () => goToStep(3));

  document.querySelectorAll('[data-step-nav]').forEach(btn => {
    btn.addEventListener('click', () => goToStep(Number(btn.dataset.stepNav)));
  });

  const btnSubmit = document.querySelector('[data-action="submit-booking"]');
  if (btnSubmit) btnSubmit.addEventListener('click', submitClientBooking);

  const btnReset = document.querySelector('[data-action="reset-widget"]');
  if (btnReset) btnReset.addEventListener('click', resetWidget);

  // Додаємо календарні кнопки на 5 кроці
  addSuccessCalendarButtons();

  state.subscribe(() => {
    const salonNameEl = $('widget-salon-name');
    if (salonNameEl) salonNameEl.textContent = state.db.salon.name;
    const salonAddrEl = $('widget-salon-address');
    if (salonAddrEl) salonAddrEl.textContent = state.db.salon.address;
    renderWidgetMasters();
  });
}
