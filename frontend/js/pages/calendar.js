/**
 * pages/calendar.js — Шахівниця розкладу (адмінка)
 */

import state from '../state.js';
import { $, show, hide } from '../utils/dom.js';
import { timeToMin, minToTime } from '../utils/time.js';
import { todayStr } from '../config.js';
import { openEditBookingModal, openManualBookingModal } from '../components/booking-modal.js';

// =================== НАВІГАЦІЯ ПО ДАТІ ===================

export function changeAdminDate(delta) {
  const picker = $('admin-date-picker');
  const d = new Date(picker.value || todayStr);
  d.setDate(d.getDate() + delta);
  picker.value = d.toISOString().split('T')[0];
  renderAdminCalendar();
}

export function setAdminToday() {
  $('admin-date-picker').value = todayStr;
  renderAdminCalendar();
}

// =================== РЕНДЕР ШАХІВНИЦІ ===================

export function renderAdminCalendar() {
  const picker = $('admin-date-picker');
  if (!picker) return;
  if (!picker.value) picker.value = todayStr;
  const dateStr = picker.value;

  const m1 = state.db.masters[0] || { id: 'm1', name: 'Світлана', role: '' };
  const m2 = state.db.masters[1] || { id: 'm2', name: 'Марія', role: '' };

  const h1 = $('cal-header-m1');
  const h2 = $('cal-header-m2');
  if (h1) h1.textContent = `${m1.name} (${m1.role || ''})`;
  if (h2) h2.textContent = `${m2.name} (${m2.role || ''})`;

  // Виручка за день
  const dayApps = state.db.appointments.filter(a => a.date === dateStr);
  const rev1 = dayApps.filter(a => a.masterId === m1.id && a.status !== 'cancelled').reduce((s, a) => s + Number(a.price || 0), 0);
  const rev2 = dayApps.filter(a => a.masterId === m2.id && a.status !== 'cancelled').reduce((s, a) => s + Number(a.price || 0), 0);
  const revEl = $('admin-revenue-summary');
  if (revEl) revEl.textContent = `Виручка за день: ${m1.name}: ${rev1} ₴ | ${m2.name}: ${rev2} ₴`;

  // Побудова рядків
  const startMin = (Number(state.db.salon.workStart) || 9) * 60;
  const endMin = (Number(state.db.salon.workEnd) || 20) * 60;
  const rows = [];

  for (let m = startMin; m < endMin; m += 30) {
    const t = minToTime(m);
    const cell1 = renderMasterCell(m1.id, dateStr, t, dayApps);
    const cell2 = renderMasterCell(m2.id, dateStr, t, dayApps);
    rows.push(`
      <div class="grid grid-cols-12 min-h-[54px]">
        <div class="col-span-2 sm:col-span-1 p-2 text-center text-slate-400 font-mono border-r border-slate-100 flex items-center justify-center">${t}</div>
        <div class="col-span-5 sm:col-span-5 p-1.5 border-r border-slate-100">${cell1}</div>
        <div class="col-span-5 sm:col-span-6 p-1.5">${cell2}</div>
      </div>
    `);
  }

  const body = $('calendar-grid-body');
  if (body) body.innerHTML = rows.join('');

  // Навісити обробники після рендеру
  bindCalendarEvents();
}

function renderMasterCell(masterId, dateStr, slotTime, dayApps) {
  const app = dayApps.find(a => a.masterId === masterId && a.time === slotTime);

  if (app) {
    const statusColors = {
      pending: 'bg-indigo-50 border-indigo-300 text-indigo-950',
      confirmed: 'bg-sky-50 border-sky-300 text-sky-950',
      paid: 'bg-emerald-50 border-emerald-300 text-emerald-950',
      cancelled: 'bg-slate-100 border-slate-300 text-slate-400 line-through'
    };
    const srvNames = (app.serviceIds || []).map(id => {
      const s = state.db.services.find(x => x.id === id);
      return s ? s.title : '';
    }).filter(Boolean).join(', ');

    return `
      <div data-edit-booking="${app.id}" class="p-2 rounded-xl border ${statusColors[app.status] || statusColors.pending} cursor-pointer hover:shadow transition">
        <div class="flex items-center justify-between font-bold">
          <span>${app.clientName} (${app.duration} хв)</span>
          <span>${app.price} ₴</span>
        </div>
        <div class="text-[11px] opacity-80 truncate">${srvNames}</div>
        <div class="text-[11px] opacity-75 mt-0.5">📞 ${app.clientPhone} ${app.notes ? '• 📝 ' + app.notes : ''}</div>
      </div>
    `;
  }

  return `
    <button data-add-booking="${masterId}|${dateStr}|${slotTime}" class="w-full h-full min-h-[40px] rounded-lg hover:bg-slate-50 text-transparent hover:text-slate-400 text-left px-2 transition">
      + Записати на ${slotTime}
    </button>
  `;
}

function bindCalendarEvents() {
  // Кліки по існуючих записах
  document.querySelectorAll('[data-edit-booking]').forEach(el => {
    el.addEventListener('click', () => openEditBookingModal(el.dataset.editBooking));
  });

  // Кліки на порожні слоти
  document.querySelectorAll('[data-add-booking]').forEach(el => {
    el.addEventListener('click', () => {
      const [masterId, dateStr, slotTime] = el.dataset.addBooking.split('|');
      openManualBookingModal(masterId, dateStr, slotTime);
    });
  });
}

// =================== ІНІЦІАЛІЗАЦІЯ ===================

export function initCalendar() {
  const picker = $('admin-date-picker');
  if (picker) {
    picker.value = todayStr;
    picker.addEventListener('change', renderAdminCalendar);
  }

  const btnPrev = document.querySelector('[data-action="date-prev"]');
  if (btnPrev) btnPrev.addEventListener('click', () => changeAdminDate(-1));

  const btnNext = document.querySelector('[data-action="date-next"]');
  if (btnNext) btnNext.addEventListener('click', () => changeAdminDate(1));

  const btnToday = document.querySelector('[data-action="date-today"]');
  if (btnToday) btnToday.addEventListener('click', setAdminToday);

  const btnNewBooking = document.querySelector('[data-action="new-booking"]');
  if (btnNewBooking) btnNewBooking.addEventListener('click', () => openManualBookingModal());

  // Підписка на оновлення стану
  state.subscribe(() => {
    if (state.isAdmin) renderAdminCalendar();
  });
}
