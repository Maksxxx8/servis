/**
 * pages/clients.js — База клієнтів та історія записів (адмінка)
 * Підтримує:
 * - Фільтрацію за майстрами
 * - Фільтрацію за датою
 * - Пошук за ім'ям або номером телефону
 * - Групування історії записів за днями
 */

import state from '../state.js';
import { $ } from '../utils/dom.js';
import { formatUADate, formatLocalDate, addDays } from '../utils/time.js';
import { todayStr } from '../config.js';
import { openEditBookingModal } from '../components/booking-modal.js';

let clientsMasterFilter = 'all';
let clientsDateFilter = '';
let clientsSearchQuery = '';

/**
 * Заповнити випадаючий список фільтра майстрів
 */
export function populateClientsMasterFilter() {
  const select = $('clients-filter-master');
  if (!select) return;

  const currentVal = select.value || clientsMasterFilter;
  select.innerHTML = `
    <option value="all">👥 Всі майстри</option>
    ${state.db.masters.map(m => `<option value="${m.id}">${m.avatar || '✨'} ${m.name}</option>`).join('')}
  `;

  if (['all', ...state.db.masters.map(m => m.id)].includes(currentVal)) {
    select.value = currentVal;
    clientsMasterFilter = currentVal;
  } else {
    select.value = 'all';
    clientsMasterFilter = 'all';
  }
}

/**
 * Рендер списку записів із групуванням за днями
 */
export function renderClientsList() {
  const container = $('clients-list-body');
  if (!container) return;

  // Оновлюємо випадаючий список майстрів
  populateClientsMasterFilter();

  const allApps = state.db.appointments || [];
  const q = clientsSearchQuery.trim().toLowerCase();

  // Фільтрація записів
  const filtered = allApps.filter(a => {
    // 1. Фільтр за майстром
    if (clientsMasterFilter !== 'all' && a.masterId !== clientsMasterFilter) {
      return false;
    }
    // 2. Фільтр за датою
    if (clientsDateFilter && a.date !== clientsDateFilter) {
      return false;
    }
    // 3. Пошук за ім'ям чи телефоном
    if (q) {
      const name = (a.clientName || '').toLowerCase();
      const phone = (a.clientPhone || '').toLowerCase();
      if (!name.includes(q) && !phone.includes(q)) {
        return false;
      }
    }
    return true;
  });

  // Оновлення верхніх лічильників
  const statCount = $('clients-stat-count');
  const statSum = $('clients-stat-sum');
  if (statCount) statCount.textContent = filtered.length;
  if (statSum) {
    const totalRevenue = filtered
      .filter(a => a.status !== 'cancelled')
      .reduce((sum, a) => sum + Number(a.price || 0), 0);
    statSum.textContent = `${totalRevenue} ₴`;
  }

  // Якщо немає записів
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl p-8 text-center border border-slate-200 shadow-sm space-y-3">
        <div class="text-3xl">🔍</div>
        <div class="text-sm font-bold text-slate-700">Записів за обраними критеріями не знайдено</div>
        <p class="text-xs text-slate-400">Спробуйте змінити дату, обрати іншого майстра або очистити пошуковий рядок.</p>
        <button id="btn-empty-reset" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-4 py-2 rounded-xl text-xs font-semibold transition">
          Скинути фільтри
        </button>
      </div>
    `;
    $('btn-empty-reset')?.addEventListener('click', resetClientsFilters);
    return;
  }

  // Групування за датами
  const groups = {};
  filtered.forEach(a => {
    const d = a.date || 'Без дати';
    if (!groups[d]) groups[d] = [];
    groups[d].push(a);
  });

  // Сортуємо дати: спочатку новіші
  const sortedDates = Object.keys(groups).sort((d1, d2) => d2.localeCompare(d1));
  const tomorrowStr = addDays(todayStr, 1);

  const statusLabels = {
    pending: { text: 'Очікує', class: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    confirmed: { text: 'Підтверджено', class: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    paid: { text: 'Оплачено', class: 'bg-sky-50 text-sky-800 border-sky-200' },
    cancelled: { text: 'Скасовано', class: 'bg-slate-100 text-slate-500 border-slate-200 line-through' }
  };

  const html = sortedDates.map(dateStr => {
    const dayApps = groups[dateStr];
    // Сортуємо всередині дня за часом зростання
    dayApps.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    const daySum = dayApps
      .filter(a => a.status !== 'cancelled')
      .reduce((s, a) => s + Number(a.price || 0), 0);

    let dateBadge = '';
    if (dateStr === todayStr) {
      dateBadge = `<span class="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Сьогодні</span>`;
    } else if (dateStr === tomorrowStr) {
      dateBadge = `<span class="bg-sky-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Завтра</span>`;
    }

    const cardsHtml = dayApps.map(a => {
      const master = state.db.masters.find(m => m.id === a.masterId);
      const srvNames = (a.serviceIds || []).map(id => {
        const s = state.db.services.find(x => x.id === id);
        return s ? s.title : '';
      }).filter(Boolean).join(', ') || 'Послуга не вказана';

      const st = statusLabels[a.status] || statusLabels.pending;
      const buffer = a.bufferTime !== undefined ? a.bufferTime : (master?.globalBuffer || 15);

      return `
        <div class="p-3.5 bg-white rounded-xl border border-slate-200/90 hover:border-indigo-300 transition shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <!-- Лівий блок: Час, майстер та послуги -->
          <div class="space-y-1.5 flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-bold text-slate-800 text-sm flex items-center gap-1">
                🕒 ${a.time}
                <span class="text-xs font-normal text-slate-400">(${a.duration} хв)</span>
              </span>

              ${master ? `
                <span class="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg font-medium flex items-center gap-1">
                  ${master.avatar || '👤'} ${master.name}
                </span>
              ` : ''}

              <span class="text-[11px] px-2 py-0.5 rounded-lg border font-semibold ${st.class}">
                ${st.text}
              </span>

              <span class="text-[10px] bg-amber-50 text-amber-800 border border-dashed border-amber-200 px-1.5 py-0.5 rounded">
                ⌛ ${buffer} хв буфер
              </span>
            </div>

            <!-- Інфо про клієнта -->
            <div class="text-xs flex flex-wrap items-center gap-x-2 text-slate-700 font-semibold">
              <span>👤 ${a.clientName}</span>
              <a href="tel:${a.clientPhone}" class="text-indigo-600 hover:underline font-normal">📞 ${a.clientPhone}</a>
            </div>

            <!-- Назва послуги -->
            <div class="text-xs text-slate-500 truncate">
              💅 ${srvNames}
            </div>

            ${a.notes ? `
              <div class="text-xs text-indigo-700 bg-indigo-50/70 rounded-lg px-2 py-1 font-normal inline-block">
                📝 ${a.notes}
              </div>
            ` : ''}
          </div>

          <!-- Правий блок: Ціна та дія -->
          <div class="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
            <div class="text-sm sm:text-base font-extrabold text-slate-800 whitespace-nowrap">
              ${a.price} ₴
            </div>
            <button data-open-booking="${a.id}" class="text-xs px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition font-semibold">
              ✏️ Редагувати
            </button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="bg-slate-50/70 rounded-2xl p-4 border border-slate-200 space-y-3">
        <!-- Шапка дня -->
        <div class="flex items-center justify-between pb-2 border-b border-slate-200/80">
          <div class="flex items-center gap-2">
            <span class="text-xs sm:text-sm font-bold text-slate-800">📅 ${formatUADate(dateStr)}</span>
            ${dateBadge}
          </div>
          <div class="text-xs font-semibold text-slate-600">
            ${dayApps.length} ${getRecordEnding(dayApps.length)} • <span class="text-slate-900 font-bold">${daySum} ₴</span>
          </div>
        </div>

        <!-- Список записів на цей день -->
        <div class="space-y-2">
          ${cardsHtml}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;

  // Навішування обробників відкриття редагування запису
  container.querySelectorAll('[data-open-booking]').forEach(btn => {
    btn.addEventListener('click', () => openEditBookingModal(btn.dataset.openBooking));
  });
}

function getRecordEnding(count) {
  const last = count % 10;
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 19) return 'записів';
  if (last === 1) return 'запис';
  if (last >= 2 && last <= 4) return 'записи';
  return 'записів';
}

function resetClientsFilters() {
  clientsMasterFilter = 'all';
  clientsDateFilter = '';
  clientsSearchQuery = '';

  const mSelect = $('clients-filter-master');
  if (mSelect) mSelect.value = 'all';

  const dInput = $('clients-filter-date');
  if (dInput) dInput.value = '';

  const sInput = $('clients-search');
  if (sInput) sInput.value = '';

  renderClientsList();
}

// =================== ІНІЦІАЛІЗАЦІЯ ===================

export function initClients() {
  populateClientsMasterFilter();

  // Фільтр майстра
  const masterSelect = $('clients-filter-master');
  if (masterSelect) {
    masterSelect.addEventListener('change', () => {
      clientsMasterFilter = masterSelect.value;
      renderClientsList();
    });
  }

  // Фільтр дати
  const dateInput = $('clients-filter-date');
  if (dateInput) {
    dateInput.addEventListener('change', () => {
      clientsDateFilter = dateInput.value;
      renderClientsList();
    });
  }

  // Очищення дати
  $('clients-clear-date')?.addEventListener('click', () => {
    clientsDateFilter = '';
    if (dateInput) dateInput.value = '';
    renderClientsList();
  });

  // Пошуковий рядок
  const searchInput = $('clients-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clientsSearchQuery = searchInput.value;
      renderClientsList();
    });
  }

  // Кнопка повного скидання
  $('clients-reset-filters')?.addEventListener('click', resetClientsFilters);

  // Підписка на оновлення стану
  state.subscribe(() => {
    if (state.isAdmin) {
      renderClientsList();
    }
  });
}
