/**
 * pages/calendar.js — Календар розкладу (адмінка) з підтримкою 3 режимів:
 * 1. День (погодинна сітка, всі майстри / 1 майстер, штриховка неробочих годин, блоки буферів)
 * 2. Тиждень (7 колонок Пн–Нд, сірий фон на вихідні, швидкий запис/перерва)
 * 3. Місяць (сітка 5–6 тижнів, індикатори змін майстрів, перехід на день, швидка зміна графіка)
 */

import state from '../state.js';
import { $, show, hide } from '../utils/dom.js';
import { timeToMin, minToTime, parseLocalDate, formatLocalDate, addDays, addMonths, formatUADate } from '../utils/time.js';
import { todayStr } from '../config.js';
import { openEditBookingModal, openManualBookingModal } from '../components/booking-modal.js';
import { openSlotActionModal, openDateOverrideModal, openTimeBlockModal } from '../components/schedule-modal.js';
import { getMasterDaySchedule } from '../utils/schedule.js';

let calendarMode = 'day'; // 'day' | 'week' | 'month'
let masterFilter = 'all'; // 'all' | masterId
let currentDateStr = todayStr;

// =================== НАВІГАЦІЯ ПО ДАТАХ ===================

export function changeAdminDate(delta) {
  if (calendarMode === 'day') {
    currentDateStr = addDays(currentDateStr, delta);
  } else if (calendarMode === 'week') {
    currentDateStr = addDays(currentDateStr, delta * 7);
  } else if (calendarMode === 'month') {
    currentDateStr = addMonths(currentDateStr, delta);
  }

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

export function populateCalMasterFilter() {
  const filterSelect = $('cal-master-filter');
  if (!filterSelect) return;
  const currentVal = filterSelect.value || masterFilter;
  filterSelect.innerHTML = `
    <option value="all">👥 Всі майстри</option>
    ${state.db.masters.map(m => `<option value="${m.id}">${m.avatar || '✨'} ${m.name}</option>`).join('')}
  `;
  if (['all', ...state.db.masters.map(m => m.id)].includes(currentVal)) {
    filterSelect.value = currentVal;
    masterFilter = currentVal;
  } else {
    filterSelect.value = 'all';
    masterFilter = 'all';
  }
}

export function setMasterFilter(mId) {
  masterFilter = mId;
  const filterSelect = $('cal-master-filter');
  if (filterSelect && filterSelect.value !== mId) {
    filterSelect.value = mId;
  }
  renderAdminCalendar();
}

// =================== ГОЛОВНИЙ РЕНДЕР ===================

export function renderAdminCalendar() {
  const picker = $('admin-date-picker');
  if (picker && !picker.value) picker.value = currentDateStr;
  if (picker && picker.value) currentDateStr = picker.value;

  const filterSelect = $('cal-master-filter');
  if (filterSelect) {
    if (filterSelect.value && filterSelect.value !== masterFilter) {
      masterFilter = filterSelect.value;
    } else if (masterFilter && filterSelect.value !== masterFilter) {
      filterSelect.value = masterFilter;
    }
  }

  // Оновлюємо заголовок або поточну дату
  const titleEl = $('admin-cal-period-title');
  if (titleEl) {
    if (calendarMode === 'day') {
      titleEl.textContent = `День: ${formatUADate(currentDateStr)}`;
    } else if (calendarMode === 'week') {
      const { startStr, endStr } = getWeekRange(currentDateStr);
      titleEl.textContent = `Тиждень: ${startStr} — ${endStr}`;
    } else {
      const d = parseLocalDate(currentDateStr);
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
  const mastersToShow = masterFilter === 'all'
    ? state.db.masters
    : state.db.masters.filter(m => m.id === masterFilter);

  const summaryParts = mastersToShow.map(m => {
    const sum = dayApps.filter(a => a.masterId === m.id).reduce((s, a) => s + Number(a.price || 0), 0);
    return `${m.name}: ${sum} ₴`;
  });

  const totalSum = dayApps
    .filter(a => masterFilter === 'all' || a.masterId === masterFilter)
    .reduce((s, a) => s + Number(a.price || 0), 0);

  const revEl = $('admin-revenue-summary');
  if (revEl) {
    const label = masterFilter === 'all'
      ? `Виручка за день (${currentDateStr}): ${summaryParts.join(' | ')} (Всього: ${totalSum} ₴)`
      : `Виручка за день (${currentDateStr}) • ${summaryParts.join('')}`;
    revEl.textContent = label;
  }
}

// =================== 1. РЕЖИМ «ДЕНЬ» ===================

function renderDayView(container) {
  const masters = masterFilter === 'all'
    ? state.db.masters
    : state.db.masters.filter(m => m.id === masterFilter);

  const dayApps = state.db.appointments.filter(a => a.date === currentDateStr);
  const timeBlocks = (state.db.timeBlocks || []).filter(tb => tb.date === currentDateStr);

  const gridColsStyle = `grid-cols-[64px_repeat(${masters.length},_minmax(0,_1fr))]`;

  // Шапка колонок
  const headerCols = masters.map((m, idx) => {
    const sched = getMasterDaySchedule(m, currentDateStr);
    const borderR = (idx < masters.length - 1) ? 'border-r border-slate-200' : '';
    const badge = sched.isWorking
      ? `<span class="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-normal ml-1.5">${sched.workStart}–${sched.workEnd}</span>`
      : `<span class="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-normal ml-1.5">🏖️ Вихідний</span>`;

    return `
      <div class="p-3 ${borderR} flex items-center justify-between min-w-0">
        <div class="font-bold text-slate-800 flex items-center truncate">
          <span>${m.avatar || '👤'} ${m.name}</span>
          ${badge}
        </div>
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
      return `<div class="p-1.5 ${borderR} min-w-0">${cellContent}</div>`;
    }).join('');

    rows.push(`
      <div class="grid ${gridColsStyle} min-h-[56px] border-b border-slate-100 last:border-b-0">
        <div class="p-2 text-center text-slate-400 font-mono text-xs border-r border-slate-100 flex items-center justify-center bg-slate-50/50">${t}</div>
        ${cells}
      </div>
    `);
  }

  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div class="grid ${gridColsStyle} bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
        <div class="p-3 text-center border-r border-slate-200">Час</div>
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

  // 3. Запис клієнта, що починається на цей слот
  const app = dayApps.find(a => a.masterId === master.id && a.time === slotTime && a.status !== 'cancelled');
  if (app) {
    const srv = (app.serviceIds || []).map(id => state.db.services.find(x => x.id === id)).filter(Boolean)[0];
    const srvColor = srv?.color || '#63ade2';
    const srvDesc = srv ? srv.title : 'Послуга салону';

    return `
      <div class="flex flex-col shadow-xs group cursor-pointer transition hover:shadow-md" data-edit-booking="${app.id}">
        <!-- Основна картка візиту з кольором послуги (один слотом) -->
        <div class="p-2.5 rounded-xl border border-l-4 transition"
             style="background-color: ${srvColor}18; border-color: ${srvColor}55; border-left-color: ${srvColor};">
          <div class="flex items-center justify-between font-bold text-slate-900">
            <div class="flex items-center gap-1.5 truncate">
              <span class="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs" style="background-color: ${srvColor};"></span>
              <span class="truncate">${app.clientName}</span>
            </div>
            <span class="font-extrabold text-xs whitespace-nowrap ml-1 text-slate-800">${app.price} ₴</span>
          </div>
          
          <div class="text-[11px] font-semibold truncate mt-1" style="color: ${srvColor}; filter: brightness(0.65);">
            ✨ ${srvDesc} (${app.duration} хв)
          </div>

          <div class="text-[11px] text-slate-600 mt-1 flex items-center justify-between">
            <span class="font-mono font-medium">📞 ${app.clientPhone}</span>
            <span class="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-white/90 border border-slate-200">${app.status}</span>
          </div>
          ${app.notes ? `<div class="text-[10px] text-slate-500 mt-1 truncate">📝 ${app.notes}</div>` : ''}
        </div>
      </div>
    `;
  }

  // 4. Триваючий запис клієнта (слоти процедури після початку — без окремого блоку продовження)
  const ongoingApp = dayApps.find(a => {
    if (a.masterId !== master.id || a.status === 'cancelled') return false;
    const aStart = timeToMin(a.time);
    const aEnd = aStart + Number(a.duration || 60);
    return slotMin > aStart && slotMin < aEnd;
  });
  if (ongoingApp) {
    return `<div class="w-full h-full min-h-[44px] cursor-pointer" data-edit-booking="${ongoingApp.id}"></div>`;
  }

  // 5. Регулярна перерва (обід) — один слотом на час початку, без повторів
  const regularBreak = (sched.regularBreaks || []).find(b => {
    const bs = timeToMin(b.start);
    const be = timeToMin(b.end);
    return slotMin >= bs && slotMin < be;
  });
  if (regularBreak) {
    const bs = timeToMin(regularBreak.start);
    const be = timeToMin(regularBreak.end);

    // Якщо на цей час призначено запис клієнта (обід замінено записом) — не показуємо обід
    const lunchReplaced = dayApps.some(a => {
      if (a.masterId !== master.id || a.status === 'cancelled') return false;
      const aStart = timeToMin(a.time);
      const aEnd = aStart + Number(a.duration || 60);
      return Math.max(aStart, bs) < Math.min(aEnd, be);
    });

    if (!lunchReplaced) {
      if (slotMin === bs) {
        return `
          <div class="w-full h-full min-h-[44px] rounded-xl bg-amber-50/80 border border-dashed border-amber-200 flex items-center justify-center text-amber-800 text-xs font-medium select-none">
            ☕ ${regularBreak.name || 'Обід'} (${regularBreak.start}–${regularBreak.end})
          </div>
        `;
      } else {
        // Продовження обіду не дублюється текстом
        return `<div class="w-full h-full min-h-[44px]"></div>`;
      }
    }
  }

  // 6. Разова перерва (TimeBlock) — один слотом на час початку
  const tb = timeBlocks.find(b => {
    if (b.masterId !== master.id) return false;
    const bs = timeToMin(b.startTime);
    const be = timeToMin(b.endTime);
    return slotMin >= bs && slotMin < be;
  });
  if (tb) {
    const bs = timeToMin(tb.startTime);
    if (slotMin === bs) {
      return `
        <div class="w-full h-full min-h-[44px] p-2 rounded-xl bg-amber-100 border border-amber-300 text-amber-950 flex items-center justify-between text-xs font-semibold shadow-xs">
          <span class="truncate">☕ ${tb.reason} (${tb.startTime}–${tb.endTime})</span>
          <button type="button" data-del-tb-quick="${tb.id}" class="text-amber-800 hover:text-rose-600 px-1.5 font-bold" title="Видалити перерву">✕</button>
        </div>
      `;
    } else {
      return `<div class="w-full h-full min-h-[44px]"></div>`;
    }
  }

  // 8. Порожній вільний слот
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
        const prevTb = [...(state.db.timeBlocks || [])];
        state.db.timeBlocks = (state.db.timeBlocks || []).filter(tb => tb.id !== btn.dataset.delTbQuick);
        renderAdminCalendar();
        const ok = await saveDatabase();
        if (!ok) {
          state.db.timeBlocks = prevTb;
          renderAdminCalendar();
        }
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
  const d = parseLocalDate(dateStr);
  const day = d.getDay(); // 0 is Sun, 1 is Mon...
  const diff = d.getDate() - (day === 0 ? 6 : day - 1); // Monday of this week
  const mon = new Date(d.setDate(diff));

  const days = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(mon);
    cur.setDate(mon.getDate() + i);
    days.push(formatLocalDate(cur));
  }

  return {
    days,
    startStr: days[0],
    endStr: days[6]
  };
}

function renderWeekView(container) {
  const { days } = getWeekRange(currentDateStr);
  const isAll = masterFilter === 'all';
  const master = isAll ? null : (state.db.masters.find(m => m.id === masterFilter) || state.db.masters[0]);

  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

  // Шапка днів тижня
  const headerCols = days.map((dStr, idx) => {
    const isToday = dStr === todayStr;
    const dayDate = parseLocalDate(dStr);
    const dNum = dayDate.getDate();

    let subBadge = '';
    if (isAll) {
      const workingCount = state.db.masters.filter(m => getMasterDaySchedule(m, dStr).isWorking).length;
      subBadge = `<span class="text-[9px] bg-indigo-50 text-indigo-700 px-1 py-0.5 rounded font-medium">Майстрів: ${workingCount}</span>`;
    } else {
      const sched = getMasterDaySchedule(master, dStr);
      subBadge = sched.isWorking
        ? `<span class="text-[9px] bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded font-medium">${sched.workStart.slice(0,2)}-${sched.workEnd.slice(0,2)}</span>`
        : `<span class="text-[9px] bg-slate-200 text-slate-600 px-1 py-0.5 rounded font-medium">Вихідний</span>`;
    }

    return `
      <div class="col-span-1 p-2 text-center border-r border-slate-200 last:border-r-0 ${isToday ? 'bg-indigo-50/70' : ''}">
        <div class="text-[11px] text-slate-500 font-semibold">${dayNames[idx]}</div>
        <div class="text-sm font-bold ${isToday ? 'text-indigo-600 font-extrabold' : 'text-slate-800'}">${dNum}</div>
        <div class="mt-0.5">${subBadge}</div>
      </div>
    `;
  }).join('');

  // Сітка годин 09:00 - 20:00
  const rows = [];
  for (let m = 9 * 60; m < 20 * 60; m += 60) {
    const t = minToTime(m);
    const dayCells = days.map(dStr => {
      if (!isAll) {
        const sched = getMasterDaySchedule(master, dStr);
        if (!sched.isWorking) {
          return `<div class="col-span-1 p-1 bg-slate-100/70 border-r border-slate-100 last:border-r-0 flex items-center justify-center text-slate-400 text-[10px]">Вихідний</div>`;
        }
      }

      // Шукаємо записи на цю годину з урахуванням фільтра майстра
      const apps = state.db.appointments.filter(a => {
        if (a.date !== dStr || !a.time.startsWith(t.slice(0, 2)) || a.status === 'cancelled') return false;
        if (!isAll && a.masterId !== master.id) return false;
        return true;
      });

      const timeBlocks = (state.db.timeBlocks || []).filter(tb => {
        if (tb.date !== dStr || !tb.startTime.startsWith(t.slice(0, 2))) return false;
        if (!isAll && tb.masterId !== master.id) return false;
        return true;
      });

      let inner = '';
      if (apps.length > 0) {
        inner = apps.map(a => {
          const mObj = state.db.masters.find(x => x.id === a.masterId);
          const masterPrefix = isAll && mObj ? `${mObj.avatar || '👤'} ` : '';
          const srv = (a.serviceIds || []).map(id => state.db.services.find(x => x.id === id)).filter(Boolean)[0];
          const srvColor = srv?.color || '#63ade2';
          return `
            <div data-edit-booking="${a.id}" class="p-1 rounded-lg border text-[10px] font-bold truncate mb-0.5 cursor-pointer shadow-xs transition hover:brightness-95"
                 style="background-color: ${srvColor}25; border-color: ${srvColor}; border-left-width: 3px; border-left-color: ${srvColor}; color: #0f172a;">
              <span class="w-1.5 h-1.5 rounded-full inline-block mr-1 align-middle" style="background-color: ${srvColor};"></span>
              ${masterPrefix}${a.time} ${a.clientName} (${srv ? srv.title : `${a.price}₴`})
            </div>
          `;
        }).join('');
      } else if (timeBlocks.length > 0) {
        inner = timeBlocks.map(tb => {
          const mObj = state.db.masters.find(x => x.id === tb.masterId);
          const masterPrefix = isAll && mObj ? `${mObj.name.slice(0,2)}: ` : '';
          return `
            <div class="p-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-semibold truncate mb-0.5">
              ☕ ${masterPrefix}${tb.reason}
            </div>
          `;
        }).join('');
      } else {
        const defaultMId = isAll ? (state.db.masters[0]?.id || 'm1') : master.id;
        inner = `
          <button type="button" data-slot-action="${defaultMId}|${dStr}|${t}" class="w-full h-full min-h-[36px] rounded hover:bg-slate-50 text-transparent hover:text-slate-400 text-xs text-center transition">
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

  const titleHeader = isAll
    ? `Тижневий розклад: <span class="text-indigo-600">Всі майстри</span> (показ записів усіх спеціалістів)`
    : `Тижневий розклад: <span class="text-indigo-600">${master.name}</span> (${master.role})`;

  container.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div class="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
        <div class="font-bold text-slate-700">${titleHeader}</div>
        <div class="text-slate-400 text-[11px]">Клік по слоту дозволяє записати клієнта або поставити перерву</div>
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
  const d = parseLocalDate(currentDateStr);
  const year = d.getFullYear();
  const month = d.getMonth();

  const firstDayOfMonth = new Date(year, month, 1, 12, 0, 0);
  const lastDayOfMonth = new Date(year, month + 1, 0, 12, 0, 0);

  // Визначення початкового дня (понеділок)
  let startOffset = firstDayOfMonth.getDay() - 1;
  if (startOffset === -1) startOffset = 6; // Sunday is 0

  const totalCells = Math.ceil((startOffset + lastDayOfMonth.getDate()) / 7) * 7;
  const calDays = [];

  for (let i = 0; i < totalCells; i++) {
    const curDate = new Date(year, month, 1 - startOffset + i, 12, 0, 0);
    calDays.push(formatLocalDate(curDate));
  }

  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  const headerCols = dayNames.map(name => `
    <div class="p-2.5 text-center font-bold text-slate-600 border-r border-slate-200 last:border-r-0 text-xs bg-slate-50">
      ${name}
    </div>
  `).join('');

  const gridCells = calDays.map(dateStr => {
    const cur = parseLocalDate(dateStr);
    const isCurrentMonth = cur.getMonth() === month;
    const isToday = dateStr === todayStr;

    // Записи на цей день з урахуванням фільтра майстра
    const dayApps = state.db.appointments.filter(a => {
      if (a.date !== dateStr || a.status === 'cancelled') return false;
      if (masterFilter !== 'all' && a.masterId !== masterFilter) return false;
      return true;
    });
    const totalRev = dayApps.reduce((s, a) => s + Number(a.price || 0), 0);

    // Індикатори змін майстрів (тільки обрані майстри)
    const mastersForBadges = masterFilter === 'all'
      ? state.db.masters
      : state.db.masters.filter(m => m.id === masterFilter);

    const masterBadges = mastersForBadges.map(m => {
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
          ${dayApps.length > 0 ? `<span class="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">${dayApps.length} зап.</span>` : ''}
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

  // Клік на число місяця -> перейти в режим «День»
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
  populateCalMasterFilter();

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
  $('btn-cal-new-timeblock')?.addEventListener('click', () => openTimeBlockModal(masterFilter === 'all' ? (state.db.masters[0]?.id || 'm1') : masterFilter, currentDateStr));
  $('btn-cal-edit-override')?.addEventListener('click', () => openDateOverrideModal(masterFilter === 'all' ? (state.db.masters[0]?.id || 'm1') : masterFilter, currentDateStr));

  state.subscribe(() => {
    if (state.isAdmin) {
      populateCalMasterFilter();
      renderAdminCalendar();
    }
  });
}
