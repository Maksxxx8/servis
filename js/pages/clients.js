/**
 * pages/clients.js — База клієнтів та історія записів (адмінка)
 */

import state from '../state.js';
import { $ } from '../utils/dom.js';
import { openEditBookingModal } from '../components/booking-modal.js';

// =================== РЕНДЕР СПИСКУ КЛІЄНТІВ ===================

export function renderClientsList() {
  const container = $('clients-list-body');
  if (!container) return;

  if (state.db.appointments.length === 0) {
    container.innerHTML = `<div class="py-6 text-center text-slate-400">Записів поки немає</div>`;
    return;
  }

  const sorted = [...state.db.appointments].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  container.innerHTML = sorted.map(a => {
    const m = state.db.masters.find(x => x.id === a.masterId);
    return `
      <div class="py-3 flex items-center justify-between">
        <div>
          <div class="font-bold text-slate-800">${a.clientName} <span class="text-xs font-normal text-slate-500">(${a.clientPhone})</span></div>
          <div class="text-xs text-slate-500">${a.date} о ${a.time} • Майстер: ${m ? m.name : ''} • ${a.price} ₴</div>
          ${a.notes ? `<div class="text-xs text-indigo-600 mt-0.5">📝 ${a.notes}</div>` : ''}
        </div>
        <button data-open-booking="${a.id}" class="text-xs px-3 py-1.5 rounded-lg border hover:bg-slate-50">Відкрити</button>
      </div>
    `;
  }).join('');

  // Навішування обробників кліку
  container.querySelectorAll('[data-open-booking]').forEach(btn => {
    btn.addEventListener('click', () => openEditBookingModal(btn.dataset.openBooking));
  });
}

// =================== ІНІЦІАЛІЗАЦІЯ ===================

export function initClients() {
  state.subscribe(() => {
    if (state.isAdmin) {
      renderClientsList();
    }
  });
}
