/**
 * pages/calendar.js — Шахівниця розкладу (адмінка) з підтримкою 3 режимів:
 * 1. День (погодинна сітка, всі майстри / 1 майстер, штриховка неробочих годин, блоки буферів)
 * 2. Тиждень (7 колонок Пн–Нд, сірий фон на вихідні, швидкий запис/перерва)
 * 3. Місяць (сітка 5–6 тижнів, індикатори змін майстрів, перехід на день, швидка зміна графіка)
 */

import state from '../state.js';
import { $, show, hide } from '../utils/dom.js';
import { timeToMin, minToTime } from '../utils/time.js';
import { todayStr } from '../config.js';
import { openEditBookingModal, openManualBookingModal } from '../components/booking-modal.js';
import { openSlotActionModal, openDateOverrideModal, openTimeBlockModal } from '../components/schedule-modal.js';
import { getMasterDaySchedule } from '../utils/schedule.js';

let calendarMode = 'day'; // 'day' | 'week' | 'month'
let masterFilter = 'all'; // 'all' | masterId
let currentDateStr = todayStr;

// =================== НАВІГАЦІЯ ПО ДАТАХ ===================

export function changeAdminDate(delta) {
  const d = new Date(currentDateStr + 'T00:00:00');

  if (calendarMode === 'day') {
    d.setDate(d.getDate() + delta);
  } else if (calendarMode === 'week') {
    d.setDate(d.getDate() + (delta * 7));
  } else if (calendarMode === 'month') {
    d.setMonth(d.getMonth() + delta);
  }

  currentDateStr = d.toISOString().split('T')[0];
  const picker = $('admin-date-picker');
  if (picker) picker.value = currentDateStr;

  renderAdminCalendar();
}

export function setAdminToday() {
  currentDateStr = todayStr;
  const picker = $('admin-date-picker');
  if (picker) picker.value = currentDateStr;
  renderAdminCalendar();
}

export function setCalendarMode(mode) {
  calendarMode = mode;
  ['day', 'week', 'month'].forEach(m => {
    const btn = $(`cal-mode-${m}`);
    if (btn) {
      btn.className = m === mode
        ? "px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold transition text-xs shadow-sm"
        : "px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition text-xs font-medium";
    }
  });
  renderAdminCalendar();
}

export function setMasterFilter(mId) {
  masterFilter = mId;
  renderAdminCalendar();
}

// =================== ГОЛОВНИЙ РЕНДЕР ===================

export function renderAdminCalendar() {
  const picker = $('admin-date-picker');
  if (picker && !picker.value) picker.value = currentDateStr;
  if (picker) currentDateStr = picker.value;

  // Оновлюємо заголовок або поточну дату
  const titleEl = $('admin-cal-period-title');
  if (titleEl) {
    if (calendarMode === 'day') {
      titleEl.textContent = `День: ${currentDateStr}`;
    } else if (calendarMode === 'week') {
      const { startStr, endStr } = getWeekRange(currentDateStr);
      titleEl.textContent = `Тиждень: ${startStr} — ${endStr}`;
    } else {
      const d = new Date(currentDateStr + 'T00:00:00');
      const months = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
      titleEl.textContent = `${months[d.getMonth()]} ${d.getFullYear()}`;
    }
  }

  // Оновлення виручки за обраний день
  updateRevenueSummary();

  const container = $('calendar-content-container');
  if (!container) return;

  if (calendarMode === 'day') {
    renderDayView(container);
  } else if (calendarMode === 'week') {
    renderWeekView(container);
  } else if (calendarMode === 'month') {
    renderMonthView(container);
  }
}

function updateRevenueSummary() {
  const dayApps = state.db.appointments.filter(a => a.date === currentDateStr && a.status !== 'cancelled');
  const summaryParts = state.db.masters.map(m => {
    const sum = dayApps.filter(a => a.masterId === m.id).reduce((s, a) => s + Number(a.price || 0), 0);
    return `${m.name}: ${sum} ₴`;
  });
  const revEl = $('admin-revenue-summary');
  if (revEl) {
    revEl.textContent = `Виручка за день (${currentDateStr}): ${summaryParts.join(' | ')}`;
  }
}

// =================== 1. РЕЖИМ «ДЕНЬ» ===================

function renderDayView(container) {
  const masters = masterFilter === 'all'
    ? state.db.masters
    : state.db.masters.filter(m => m.id === masterFilter);

  const dayApps = state.db.appointments.filter(a => a.date === currentDateStr);
  const timeBlocks = (state.db.timeBlocks || []).filter(tb => tb.date === currentDateStr);

  const colWidthClass = masters.length === 1 ? 'col-span-11' : (masters.length === 2 ? 'col-span-5 sm:col-span-5' : 'col-span-3');

  // Шапка колонок
  const headerCols = masters.map((m, idx) => {
    const sched = getMasterDaySchedule(m, currentDateStr);
    const borderR = (idx < masters.length - 1) ? 'border-r border-slate-200' : '';
    const badge = sched.isWorking
      ? `<span class="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-normal ml-1.5">${sched.workStart}–${sched.workEnd}</span>`
      : `<span class="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-normal ml-1.5">🏖️ Вихідний</span>`;

    return `
      <div class="${colWidthClass} p-3 ${borderR} flex items-center justify-between">
        <div class="font-bold text-slate-800 flex items-center">
          <span>${m.avatar || '👤'} ${m.name}</span>
          ${badge}
        </div>
        <button type="button" data-day-override-quick="${m.id}|${currentDateStr}" class="text-[11px] text-indigo-600 hover:underline">⚙️ Графік</button>
      </div>
    `;
  }).join('');

  // Сітка годин 08:00 - 21:00
  const rows = [];
  for (let m = 8 * 60; m < 21 * 60; m += 30) {
    const t = minToTime(m);
    const cells = masters.map((master, idx) => {
      const borderR = (idx < masters.length - 1) ? 'border-r border-slate-100' : '';
      const cellContent = renderDayMasterCell(master, currentDateStr, t, m, dayApps, timeBlocks);
      return `<div class="${colWidthClass} p-1.5 ${borderR}">${cellContent}</div>`;
    }).join('');

    rows.push(`
      <div class="grid grid-cols-12 min-h-[56px] border-b border-slate-100 last:border-b-0">
        <div class="col-span-1 p-2 text-center text-slate-400 font-mono text-xs border-r border-slate-100 flex items-center justify-center bg-slate-50/50">${t}</div>
        ${cells}
      </div>
    `);
  }

  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div class="grid grid-cols-12 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
        <div class="col-span-1 p-3 text-center border-r border-slate-200">Час</div>
        ${headerCols}
      </div>
      <div class="divide-y divide-slate-100 text-xs">
        ${rows.join('')}
      </div>
    </div>
  `;

  bindDayEvents(container);
}

function renderDayMasterCell(master, dateStr, slotTime, slotMin, dayApps, timeBlocks) {
  const sched = getMasterDaySchedule(master, dateStr);

  // 1. Якщо день вихідний
  if (!sched.isWorking) {
    return `
      <div class="w-full h-full min-h-[44px] rounded-lg bg-slate-100/70 border border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-[11px] select-none">
        🏖️ Вихідний
      </div>
    `;
  }

  const workStartMin = timeToMin(sched.workStart);
  const workEndMin = timeToMin(sched.workEnd);

  // 2. Неробочі години (до початку або після кінця)
  if (slotMin < workStartMin || slotMin >= workEndMin) {
    return `
      <div class="w-full h-full min-h-[44px] rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300 text-[10px] select-none">
        Неробочий час
      </div>
    `;
  }

  // 3. Регулярна перерва (обід)
  const regularBreak = (sched.regularBreaks || []).find(b => {
    const bs = timeToMin(b.start);
    const be = timeToMin(b.end);
    return slotMin >= bs && slotMin < be;
  });
  if (regularBreak) {
    return `
      <div class="w-full h-full min-h-[44px] rounded-lg bg-amber-50/80 border border-dashed border-amber-200 flex items-center justify-center text-amber-800 text-xs font-medium">
        ☕ ${regularBreak.name || 'Обідня перерва'}
      </div>
    `;
  }

  // 4. Разова перерва (TimeBlock)
  const tb = timeBlocks.find(b => {
    if (b.masterId !== master.id) return false;
    const bs = timeToMin(b.startTime);
    const be = timeToMin(b.endTime);
    return slotMin >= bs && slotMin < be;
  });
  if (tb) {
    return `
      <div class="w-full h-full min-h-[44px] p-2 rounded-xl bg-amber-100 border border-amber-300 text-amber-950 flex items-center justify-between text-xs font-semibold shadow-xs">
        <span class="truncate">☕ ${tb.reason} (${tb.startTime}–${tb.endTime})</span>
        <button type="button" data-del-tb-quick="${tb.id}" class="text-amber-800 hover:text-rose-600 px-1.5 font-bold" title="Видалити перерву">✕</button>
      </div>
    `;
  }

  // 5. Запис клієнта (Appointment)
  const app = dayApps.find(a => a.masterId === master.id && a.time === slotTime);
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

    const bufferMin = app.bufferTime !== undefined ? app.bufferTime : (master.globalBuffer || 15);

    return `
      <div class="flex flex-col shadow-xs group cursor-pointer" data-edit-booking="${app.id}">
        <!-- Основна картка візиту -->
        <div class="p-2.5 rounded-t-xl border ${statusColors[app.status] || statusColors.pending} transition hover:shadow-sm">
          <div class="flex items-center justify-between font-bold">
            <span class="truncate">${app.clientName} (${app.duration} хв)</span>
            <span class="font-extrabold whitespace-nowrap">${app.price} ₴</span>
          </div>
          <div class="text-[11px] opacity-80 truncate mt-0.5">${srvNames}</div>
          <div class="text-[11px] opacity-75 mt-0.5 flex items-center justify-between">
            <span>📞 ${app.clientPhone}</span>
            <span class="text-[10px] uppercase font-bold tracking-wider">${app.status}</span>
          </div>
          ${app.notes ? `<div class="text-[10px] opacity-75 mt-0.5 truncate">📝 ${app.notes}</div>` : ''}
        </div>
        <!-- Візуальний штрих-блок технічного буфера знизу -->
        <div class="px-2 py-0.5 rounded-b-xl bg-amber-50/90 border-x border-b border-dashed border-amber-300 text-[10px] text-amber-800 font-medium flex items-center justify-between select-none">
          <span>⏱️ Буфер: ${bufferMin} хв</span>
          <span class="opacity-70 text-[9px]">провітрювання / стерилізація</span>
        </div>
      </div>
    `;
  }

  // 6. Порожній вільний слот
  return `
    <button type="button" data-slot-action="${master.id}|${dateStr}|${slotTime}" class="w-full h-full min-h-[44px] rounded-xl hover:bg-indigo-50/50 text-transparent hover:text-indigo-600 text-left px-2.5 transition flex items-center justify-between group border border-transparent hover:border-indigo-200">
      <span class="text-xs font-semibold">+ Записати на ${slotTime}</span>
      <span class="text-[11px] opacity-0 group-hover:opacity-100 text-indigo-400">☕ перерва</span>
    </button>
  `;
}

function bindDayEvents(container) {
  // Клік на запис
  container.querySelectorAll('[data-edit-booking]').forEach(el => {
    el.addEventListener('click', () => openEditBookingModal(el.dataset.editBooking));
  });

  // Клік на вільний слот -> модалка швидких дій
  container.querySelectorAll('[data-slot-action]').forEach(el => {
    el.addEventListener('click', () => {
      const [mId, dStr, sTime] = el.dataset.slotAction.split('|');
      openSlotActionModal(mId, dStr, sTime);
    });
  });

  // Швидке видалення TimeBlock
  container.querySelectorAll('[data-del-tb-quick]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Видалити цю перерву?')) {
        state.db.timeBlocks = (state.db.timeBlocks || []).filter(tb => tb.id !== btn.dataset.delTbQuick);
        renderAdminCalendar();
      }
    });
  });

  // Швидкий виняток дати в шапці
  container.querySelectorAll('[data-day-override-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [mId, dStr] = btn.dataset.dayOverrideQuick.split('|');
      openDateOverrideModal(mId, dStr);
    });
  });
}

// =================== 2. РЕЖИМ «ТИЖДЕНЬ» ===================

function getWeekRange(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0 is Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  const mon = new Date(d.setDate(diff));

  const days = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(mon);
    cur.setDate(mon.getDate() + i);
    days.push(cur.toISOString().split('T')[0]);
  }

  return {
    days,
    startStr: days[0],
    endStr: days[6]
  };
}

function renderWeekView(container) {
  const { days } = getWeekRange(currentDateStr);
  const master = state.db.masters.find(m => m.id === masterFilter) || state.db.masters[0];

  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

  // Шапка днів тижня
  const headerCols = days.map((dStr, idx) => {
    const sched = getMasterDaySchedule(master, dStr);
    const isToday = dStr === todayStr;
    const dayDate = new Date(dStr + 'T00:00:00');
    const dNum = dayDate.getDate();

    return `
      <div class="col-span-1 p-2 text-center border-r border-slate-200 last:border-r-0 ${isToday ? 'bg-indigo-50/70' : ''}">
        <div class="text-[11px] text-slate-500 font-semibold">${dayNames[idx]}</div>
        <div class="text-sm font-bold ${isToday ? 'text-indigo-600 font-extrabold' : 'text-slate-800'}">${dNum}</div>
        <div class="mt-0.5">
          ${sched.isWorking
            ? `<span class="text-[9px] bg-emerald-100 text-emerald-800 px-1 py-0.2 rounded font-medium">${sched.workStart.slice(0,2)}-${sched.workEnd.slice(0,2)}</span>`
            : `<span class="text-[9px] bg-slate-200 text-slate-600 px-1 py-0.2 rounded font-medium">Вихідний</span>`
          }
        </div>
      </div>
    `;
  }).join('');

  // Сітка годин 09:00 - 20:00
  const rows = [];
  for (let m = 9 * 60; m < 20 * 60; m += 60) {
    const t = minToTime(m);
    const dayCells = days.map(dStr => {
      const sched = getMasterDaySchedule(master, dStr);
      if (!sched.isWorking) {
        return `<div class="col-span-1 p-1 bg-slate-100/70 border-r border-slate-100 last:border-r-0 flex items-center justify-center text-slate-400 text-[10px]">Вихідний</div>`;
      }

      // Шукаємо записи на цю годину
      const apps = state.db.appointments.filter(a => a.masterId === master.id && a.date === dStr && a.time.startsWith(t.slice(0, 2)));
      const timeBlocks = (state.db.timeBlocks || []).filter(tb => tb.masterId === master.id && tb.date === dStr && tb.startTime.startsWith(t.slice(0, 2)));

      let inner = '';
      if (apps.length > 0) {
        inner = apps.map(a => `
          <div data-edit-booking="${a.id}" class="p-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-950 cursor-pointer text-[10px] font-bold truncate">
            ${a.time} ${a.clientName} (${a.price}₴)
          </div>
        `).join('');
      } else if (timeBlocks.length > 0) {
        inner = timeBlocks.map(tb => `
          <div class="p-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-semibold truncate">
            ☕ ${tb.reason}
          </div>
        `).join('');
      } else {
        inner = `
          <button type="button" data-slot-action="${master.id}|${dStr}|${t}" class="w-full h-full min-h-[36px] rounded hover:bg-slate-50 text-transparent hover:text-slate-400 text-xs text-center transition">
            +
          </button>
        `;
      }

      return `<div class="col-span-1 p-1 border-r border-slate-100 last:border-r-0 flex flex-col justify-center">${inner}</div>`;
    }).join('');

    rows.push(`
      <div class="grid grid-cols-8 min-h-[48px] border-b border-slate-100 last:border-b-0">
        <div class="col-span-1 p-2 text-center text-slate-400 font-mono text-xs border-r border-slate-100 bg-slate-50/50 flex items-center justify-center">${t}</div>
        ${dayCells}
      </div>
    `);
  }

  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div class="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
        <div class="font-bold text-slate-700">Тижневий розклад: <span class="text-indigo-600">${master.name}</span> (${master.role})</div>
        <div class="text-slate-400 text-[11px]">Клік по вільному слоту дозволяє швидко записати клієнта або поставити перерву</div>
      </div>
      <div class="grid grid-cols-8 bg-slate-50/80 border-b border-slate-200 text-xs">
        <div class="col-span-1 p-2 text-center border-r border-slate-200 font-bold text-slate-500">Час</div>
        ${headerCols}
      </div>
      <div class="divide-y divide-slate-100 text-xs">
        ${rows.join('')}
      </div>
    </div>
  `;

  bindDayEvents(container);
}

// =================== 3. РЕЖИМ «МІСЯЦЬ» ===================

function renderMonthView(container) {
  const d = new Date(currentDateStr + 'T00:00:00');
  const year = d.getFullYear();
  const month = d.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  // Визначення початкового дня (понеділок)
  let startOffset = firstDayOfMonth.getDay() - 1;
  if (startOffset === -1) startOffset = 6; // Sunday is 0

  const totalCells = Math.ceil((startOffset + lastDayOfMonth.getDate()) / 7) * 7;
  const calDays = [];

  for (let i = 0; i < totalCells; i++) {
    const curDate = new Date(year, month, 1 - startOffset + i);
    calDays.push(curDate.toISOString().split('T')[0]);
  }

  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  const headerCols = dayNames.map(name => `
    <div class="p-2.5 text-center font-bold text-slate-600 border-r border-slate-200 last:border-r-0 text-xs bg-slate-50">
      ${name}
    </div>
  `).join('');

  const gridCells = calDays.map(dateStr => {
    const cur = new Date(dateStr + 'T00:00:00');
    const isCurrentMonth = cur.getMonth() === month;
    const isToday = dateStr === todayStr;

    // Записи на цей день
    const dayApps = state.db.appointments.filter(a => a.date === dateStr && a.status !== 'cancelled');
    const totalRev = dayApps.reduce((s, a) => s + Number(a.price || 0), 0);

    // Індикатори змін майстрів
    const masterBadges = state.db.masters.map(m => {
      const sched = getMasterDaySchedule(m, dateStr);
      if (!sched.isWorking) {
        return `<span class="text-[9px] bg-slate-100 text-slate-500 font-semibold px-1 rounded truncate">${m.name.slice(0, 2)}: Вих</span>`;
      }
      if (sched.type === 'custom_hours') {
        return `<span class="text-[9px] bg-amber-100 text-amber-800 font-semibold px-1 rounded truncate">${m.name.slice(0, 2)}: ${sched.workStart.slice(0,2)}-${sched.workEnd.slice(0,2)}</span>`;
      }
      return `<span class="text-[9px] bg-emerald-100 text-emerald-800 font-semibold px-1 rounded truncate">${m.name.slice(0, 2)}: ${sched.workStart.slice(0,2)}-${sched.workEnd.slice(0,2)}</span>`;
    }).join('');

    return `
      <div data-month-day-click="${dateStr}" class="min-h-[96px] p-2 border-b border-r border-slate-200 last:border-r-0 hover:bg-indigo-50/30 cursor-pointer transition flex flex-col justify-between ${isCurrentMonth ? 'bg-white' : 'bg-slate-50/60 opacity-60'}">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold ${isToday ? 'w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center font-extrabold' : (isCurrentMonth ? 'text-slate-800' : 'text-slate-400')}">
            ${cur.getDate()}
          </span>
          ${dayApps.length > 0 ? `<span class="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded">${dayApps.length} зап.</span>` : ''}
        </div>

        <div class="flex flex-wrap gap-1 my-1">
          ${masterBadges}
        </div>

        <div class="text-[10px] text-slate-500 font-medium truncate mt-auto">
          ${totalRev > 0 ? `<span class="font-bold text-slate-800">${totalRev} ₴</span>` : '<span class="text-slate-300">вільно</span>'}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div class="grid grid-cols-7 border-b border-slate-200">
        ${headerCols}
      </div>
      <div class="grid grid-cols-7">
        ${gridCells}
      </div>
    </div>
  `;

  // Клік на число місяця -> відкрити модалку або перейти в день
  container.querySelectorAll('[data-month-day-click]').forEach(el => {
    el.addEventListener('click', () => {
      const dt = el.dataset.monthDayClick;
      currentDateStr = dt;
      const picker = $('admin-date-picker');
      if (picker) picker.value = dt;
      setCalendarMode('day');
    });
  });
}

// =================== ІНІЦІАЛІЗАЦІЯ ===================

export function initCalendar() {
  const picker = $('admin-date-picker');
  if (picker) {
    picker.value = currentDateStr;
    picker.addEventListener('change', () => {
      currentDateStr = picker.value;
      renderAdminCalendar();
    });
  }

  $('btn-cal-prev')?.addEventListener('click', () => changeAdminDate(-1));
  $('btn-cal-next')?.addEventListener('click', () => changeAdminDate(1));
  $('btn-cal-today')?.addEventListener('click', setAdminToday);

  // Перемикачі режимів
  $('cal-mode-day')?.addEventListener('click', () => setCalendarMode('day'));
  $('cal-mode-week')?.addEventListener('click', () => setCalendarMode('week'));
  $('cal-mode-month')?.addEventListener('click', () => setCalendarMode('month'));

  // Фільтр майстра
  const filterSelect = $('cal-master-filter');
  if (filterSelect) {
    filterSelect.addEventListener('change', () => {
      setMasterFilter(filterSelect.value);
    });
  }

  // Кнопки швидкого створення
  $('btn-cal-new-booking')?.addEventListener('click', () => openManualBookingModal());
  $('btn-cal-new-timeblock')?.addEventListener('click', () => openTimeBlockModal(masterFilter === 'all' ? 'm1' : masterFilter, currentDateStr));
  $('btn-cal-edit-override')?.addEventListener('click', () => openDateOverrideModal(masterFilter === 'all' ? 'm1' : masterFilter, currentDateStr));

  state.subscribe(() => {
    if (state.isAdmin) {
      renderAdminCalendar();
    }
  });
}
