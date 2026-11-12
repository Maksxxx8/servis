/**
 * pages/schedule.js — Особистий кабінет майстра: «Мій графік та буфери»
 * 
 * Керування:
 * 1. Шаблоном робочого тижня (Weekly Schedule) + регулярними перервами
 * 2. Буферами майстра (globalBuffer, slotStep)
 * 3. Винятками по датах (Date Overrides)
 * 4. Разовими перервами (Time Blocks)
 * 5. Персональною iCal-підпискою для календаря iOS / Google Calendar
 */

import state from '../state.js';
import { $, show, hide } from '../utils/dom.js';
import { saveDatabase } from '../http/api-client.js';
import { openDateOverrideModal, openTimeBlockModal, deleteTimeBlock } from '../components/schedule-modal.js';

let activeMasterId = 'm1';

const DAY_NAMES = [
  { index: 1, name: 'Понеділок', short: 'Пн' },
  { index: 2, name: 'Вівторок', short: 'Вт' },
  { index: 3, name: 'Середа', short: 'Ср' },
  { index: 4, name: 'Четвер', short: 'Чт' },
  { index: 5, name: "П'ятниця", short: 'Пт' },
  { index: 6, name: 'Субота', short: 'Сб' },
  { index: 0, name: 'Неділя', short: 'Нд' }
];

export function renderScheduleCabinet() {
  const container = $('schedule-cabinet-content');
  if (!container) return;

  const master = state.db.masters.find(m => m.id === activeMasterId) || state.db.masters[0];
  if (!master) return;
  activeMasterId = master.id;

  // Рендер вкладок вибору майстра
  const tabsContainer = $('schedule-master-tabs');
  if (tabsContainer) {
    tabsContainer.innerHTML = state.db.masters.map(m => `
      <button type="button" data-schedule-tab="${m.id}" class="px-4 py-2 rounded-xl text-xs font-semibold transition ${m.id === activeMasterId ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
        ${m.avatar || '👤'} ${m.name} (${m.role})
      </button>
    `).join('');

    tabsContainer.querySelectorAll('[data-schedule-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        activeMasterId = btn.dataset.scheduleTab;
        renderScheduleCabinet();
      });
    });
  }

  // Робочий тиждень майстра
  const weekly = master.weeklySchedule || {};
  const daysHtml = DAY_NAMES.map(d => {
    const s = weekly[d.index] || { isWorking: false, workStart: '09:00', workEnd: '19:00', regularBreaks: [] };
    const breaks = s.regularBreaks || [];

    const breaksHtml = breaks.map((brk, bIdx) => `
      <div class="flex items-center gap-2 mt-1.5 bg-slate-50 p-1.5 rounded-lg border border-slate-200 text-xs">
        <span class="text-slate-400">☕</span>
        <input type="text" data-break-name="${d.index}-${bIdx}" value="${brk.name || 'Обід'}" class="w-24 border rounded px-1.5 py-0.5 text-xs font-medium" placeholder="Назва">
        <input type="time" data-break-start="${d.index}-${bIdx}" value="${brk.start || '13:00'}" class="border rounded px-1.5 py-0.5 text-xs">
        <span class="text-slate-400">–</span>
        <input type="time" data-break-end="${d.index}-${bIdx}" value="${brk.end || '14:00'}" class="border rounded px-1.5 py-0.5 text-xs">
        <button type="button" data-del-break="${d.index}-${bIdx}" class="text-rose-500 hover:text-rose-700 ml-auto px-1.5 font-bold">✕</button>
      </div>
    `).join('');

    return `
      <div class="p-4 rounded-2xl border ${s.isWorking ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-80'} space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-bold text-sm text-slate-800">${d.name}</span>
            <span class="text-xs px-2 py-0.5 rounded-full font-medium ${s.isWorking ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}">
              ${s.isWorking ? 'Робочий' : 'Вихідний'}
            </span>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" data-day-toggle="${d.index}" ${s.isWorking ? 'checked' : ''} class="sr-only peer">
            <div class="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>

        <div class="${s.isWorking ? '' : 'hidden'} pt-1 space-y-2 text-xs" id="day-hours-${d.index}">
          <div class="flex items-center gap-2">
            <span class="text-slate-500 w-16">Години:</span>
            <input type="time" data-day-start="${d.index}" value="${s.workStart || '09:00'}" class="border rounded-lg px-2 py-1 font-semibold text-xs">
            <span class="text-slate-400">–</span>
            <input type="time" data-day-end="${d.index}" value="${s.workEnd || '20:00'}" class="border rounded-lg px-2 py-1 font-semibold text-xs">
            <button type="button" data-add-break="${d.index}" class="ml-auto text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1">
              + Перерва
            </button>
          </div>
          <div id="breaks-container-${d.index}">
            ${breaksHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Налаштування буферів майстра
  const globalBuffer = master.globalBuffer !== undefined ? master.globalBuffer : 15;
  const slotStep = master.slotStep || 30;

  // Винятки на дати (Date Overrides)
  const overrides = master.dateOverrides || {};
  const overrideKeys = Object.keys(overrides).sort();
  const overridesHtml = overrideKeys.length === 0
    ? `<div class="text-xs text-slate-400 py-2">Індивідуальних винятків на дати немає. Діє шаблон тижня.</div>`
    : overrideKeys.map(dt => {
        const ov = overrides[dt];
        return `
          <div class="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 bg-white text-xs">
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-800">📅 ${dt}</span>
              <span class="px-2 py-0.5 rounded-md font-semibold ${ov.type === 'day_off' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}">
                ${ov.type === 'day_off' ? 'Вихідний' : `Години: ${ov.workStart}–${ov.workEnd}`}
              </span>
            </div>
            <button type="button" data-del-override="${dt}" class="text-rose-500 hover:text-rose-700 px-2 py-1 font-bold">✕ Видалити</button>
          </div>
        `;
      }).join('');

  // Разові перерви (Time Blocks)
  const timeBlocks = (state.db.timeBlocks || []).filter(tb => tb.masterId === master.id).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  const timeBlocksHtml = timeBlocks.length === 0
    ? `<div class="text-xs text-slate-400 py-2">Немає запланованих разових перерв.</div>`
    : timeBlocks.map(tb => `
        <div class="flex items-center justify-between p-2.5 rounded-xl border border-amber-200 bg-amber-50 text-xs">
          <div>
            <span class="font-bold text-amber-900">☕ ${tb.date} (${tb.startTime}–${tb.endTime})</span>
            <span class="text-amber-700 ml-2 font-medium">${tb.reason}</span>
          </div>
          <button type="button" data-del-tb="${tb.id}" class="text-amber-800 hover:text-rose-700 px-2 py-1 font-bold">✕</button>
        </div>
      `).join('');

  // iCal синхронізація
  const icalKey = master.icalKey || `key_${master.id}_${master.name.toLowerCase()}`;
  master.icalKey = icalKey;
  const currentHost = window.location.origin + window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
  const icalFeedUrl = `${currentHost}/api-v2.php?action=ical&master=${master.id}&key=${icalKey}`;

  container.innerHTML = `
    <!-- Блок 1: Буфери та крок слотів -->
    <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="font-bold text-base text-slate-800">1. Налаштування буферного часу та слотів</h3>
          <p class="text-xs text-slate-500">Автоматичний захист від накладок та час на санітарну обробку</p>
        </div>
        <span class="text-2xl">${master.avatar || '✨'}</span>
      </div>

      <div class="grid sm:grid-cols-2 gap-4 text-xs">
        <div>
          <label class="block font-semibold text-slate-700 mb-1">Стандартний технічний буфер після кожної послуги (хв)</label>
          <select id="set-master-buffer" class="w-full border rounded-xl px-3 py-2 text-sm font-semibold">
            <option value="0" ${globalBuffer == 0 ? 'selected' : ''}>0 хв (без перерви)</option>
            <option value="5" ${globalBuffer == 5 ? 'selected' : ''}>5 хв</option>
            <option value="10" ${globalBuffer == 10 ? 'selected' : ''}>10 хв</option>
            <option value="15" ${globalBuffer == 15 ? 'selected' : ''}>15 хв (рекомендовано: дезінфекція)</option>
            <option value="20" ${globalBuffer == 20 ? 'selected' : ''}>20 хв</option>
            <option value="30" ${globalBuffer == 30 ? 'selected' : ''}>30 хв</option>
          </select>
          <p class="text-[11px] text-slate-400 mt-1">Використовується, якщо у самій послузі не вказано інший буфер.</p>
        </div>

        <div>
          <label class="block font-semibold text-slate-700 mb-1">Крок часової сітки онлайн-запису (slotStep)</label>
          <select id="set-master-step" class="w-full border rounded-xl px-3 py-2 text-sm font-semibold">
            <option value="15" ${slotStep == 15 ? 'selected' : ''}>Кожні 15 хвилин (напр. 10:00, 10:15, 10:30)</option>
            <option value="30" ${slotStep == 30 ? 'selected' : ''}>Кожні 30 хвилин (напр. 10:00, 10:30, 11:00)</option>
            <option value="60" ${slotStep == 60 ? 'selected' : ''}>Кожну 1 годину (напр. 10:00, 11:00, 12:00)</option>
            <option value="90" ${slotStep == 90 ? 'selected' : ''}>Кожні 1 год 30 хв (напр. 10:00, 11:30, 13:00)</option>
          </select>
          <p class="text-[11px] text-slate-400 mt-1">Крок, з яким клієнт бачить вільні варіанти запису.</p>
        </div>
      </div>
    </div>

    <!-- Блок 2: Шаблон робочого тижня -->
    <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="font-bold text-base text-slate-800">2. Шаблон тижня (Weekly Schedule)</h3>
          <p class="text-xs text-slate-500">Базовий графік роботи по днях тижня з регулярними обідами</p>
        </div>
      </div>

      <div class="grid sm:grid-cols-2 gap-3">
        ${daysHtml}
      </div>
    </div>

    <!-- Блок 3: Винятки на дати та TimeBlocks -->
    <div class="grid sm:grid-cols-2 gap-6">
      <!-- Date Overrides -->
      <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-bold text-sm text-slate-800">3. Винятки на дати (Date Overrides)</h3>
            <p class="text-[11px] text-slate-500">Вихідні дні або особливі години на конкретні дати</p>
          </div>
          <button type="button" id="btn-add-override-action" class="px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold transition">
            + Додати
          </button>
        </div>
        <div class="space-y-2">
          ${overridesHtml}
        </div>
      </div>

      <!-- Time Blocks -->
      <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-bold text-sm text-slate-800">4. Разові перерви (Time Blocks)</h3>
            <p class="text-[11px] text-slate-500">Особистий час, похід до лікаря або раптова відлучка</p>
          </div>
          <button type="button" id="btn-add-timeblock-action" class="px-3 py-1.5 rounded-xl bg-amber-50 text-amber-800 hover:bg-amber-100 text-xs font-semibold transition">
            + Перерва
          </button>
        </div>
        <div class="space-y-2">
          ${timeBlocksHtml}
        </div>
      </div>
    </div>

    <!-- Блок 4: iCal синхронізація -->
    <div class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="font-bold text-base text-slate-800">5. iCal Синхронізація (Apple Calendar, Google Calendar, Outlook)</h3>
          <p class="text-xs text-slate-500">Підпишіться на живий розклад у вашому телефоні — всі записи майстра з'являться в календарі</p>
        </div>
        <span class="text-xl">📅</span>
      </div>

      <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
        <label class="block font-semibold text-slate-600">Персональне посилання на iCal-стрім майстра:</label>
        <div class="flex gap-2">
          <input type="text" id="schedule-ical-url" readonly value="${icalFeedUrl}" class="flex-1 border bg-white rounded-xl px-3 py-2 text-xs font-mono text-slate-700">
          <button type="button" id="btn-copy-ical-url" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-semibold transition">
            Копіювати
          </button>
        </div>
        <p class="text-[11px] text-slate-500">
          💡 <b>Як підключити:</b> В Apple Calendar на iPhone натисніть <i>«Календарі» → «Додати підписку на календар»</i> і вставте це посилання. В Google Calendar: <i>«Інші календарі» → «За URL-адресою»</i>.
        </p>
      </div>
    </div>

    <!-- Кнопка збереження -->
    <div class="pt-2">
      <button type="button" id="btn-save-master-schedule" class="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-8 rounded-xl shadow-md transition text-sm">
        💾 Зберегти графік та налаштування майстра
      </button>
    </div>
  `;

  // Навішування подій тумблерів
  DAY_NAMES.forEach(d => {
    const toggleInput = container.querySelector(`[data-day-toggle="${d.index}"]`);
    const hoursDiv = container.querySelector(`#day-hours-${d.index}`);
    if (toggleInput && hoursDiv) {
      toggleInput.addEventListener('change', () => {
        hoursDiv.classList.toggle('hidden', !toggleInput.checked);
      });
    }

    // Кнопка + Перерва
    const addBrkBtn = container.querySelector(`[data-add-break="${d.index}"]`);
    if (addBrkBtn) {
      addBrkBtn.addEventListener('click', () => {
        if (!master.weeklySchedule) master.weeklySchedule = {};
        if (!master.weeklySchedule[d.index]) master.weeklySchedule[d.index] = { isWorking: true, workStart: '09:00', workEnd: '20:00', regularBreaks: [] };
        if (!master.weeklySchedule[d.index].regularBreaks) master.weeklySchedule[d.index].regularBreaks = [];
        master.weeklySchedule[d.index].regularBreaks.push({ name: 'Обід', start: '13:00', end: '14:00' });
        renderScheduleCabinet();
      });
    }
  });

  // Видалення регулярних перерв
  container.querySelectorAll('[data-del-break]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [dayIdx, brkIdx] = btn.dataset.delBreak.split('-').map(Number);
      if (master.weeklySchedule?.[dayIdx]?.regularBreaks) {
        master.weeklySchedule[dayIdx].regularBreaks.splice(brkIdx, 1);
        renderScheduleCabinet();
      }
    });
  });

  // Видалення винятку дати
  container.querySelectorAll('[data-del-override]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dt = btn.dataset.delOverride;
      delete master.dateOverrides[dt];
      await saveDatabase();
      renderScheduleCabinet();
    });
  });

  // Видалення TimeBlock
  container.querySelectorAll('[data-del-tb]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await deleteTimeBlock(btn.dataset.delTb);
      renderScheduleCabinet();
    });
  });

  // Відкриття модалок
  $('btn-add-override-action')?.addEventListener('click', () => openDateOverrideModal(activeMasterId));
  $('btn-add-timeblock-action')?.addEventListener('click', () => openTimeBlockModal(activeMasterId));

  // Копіювання посилання iCal
  $('btn-copy-ical-url')?.addEventListener('click', () => {
    const input = $('schedule-ical-url');
    if (input) {
      input.select();
      navigator.clipboard.writeText(input.value);
      alert('Посилання на iCal-потік скопійовано в буфер обміну!');
    }
  });

  // Збереження графіка майстра
  $('btn-save-master-schedule')?.addEventListener('click', async () => {
    master.globalBuffer = Number($('set-master-buffer').value) || 15;
    master.slotStep = Number($('set-master-step').value) || 30;

    DAY_NAMES.forEach(d => {
      const toggleInput = container.querySelector(`[data-day-toggle="${d.index}"]`);
      const isWorking = toggleInput ? toggleInput.checked : false;
      const startEl = container.querySelector(`[data-day-start="${d.index}"]`);
      const endEl = container.querySelector(`[data-day-end="${d.index}"]`);

      if (!master.weeklySchedule) master.weeklySchedule = {};
      const currentBreaks = master.weeklySchedule[d.index]?.regularBreaks || [];

      // Оновлюємо значення перерв з інпутів
      currentBreaks.forEach((brk, bIdx) => {
        const nameInp = container.querySelector(`[data-break-name="${d.index}-${bIdx}"]`);
        const startInp = container.querySelector(`[data-break-start="${d.index}-${bIdx}"]`);
        const endInp = container.querySelector(`[data-break-end="${d.index}-${bIdx}"]`);
        if (nameInp) brk.name = nameInp.value.trim() || 'Перерва';
        if (startInp) brk.start = startInp.value;
        if (endInp) brk.end = endInp.value;
      });

      master.weeklySchedule[d.index] = {
        isWorking,
        workStart: startEl ? startEl.value : '09:00',
        workEnd: endEl ? endEl.value : '20:00',
        regularBreaks: currentBreaks
      };
    });

    await saveDatabase();
    alert(`Графік та буфери для майстра ${master.name} успішно збережено!`);
    renderScheduleCabinet();
  });
}

// =================== ІНІЦІАЛІЗАЦІЯ ===================

export function initSchedule() {
  state.subscribe(() => {
    if (state.isAdmin) {
      renderScheduleCabinet();
    }
  });
}
