/**
 * components/schedule-modal.js — Модальні вікна для керування графіком, перервами (timeBlocks) та вирішення конфліктів
 */

import state from '../state.js';
import { $, show, hide } from '../utils/dom.js';
import { saveDatabase } from '../http/api-client.js';
import { openManualBookingModal, openEditBookingModal } from './booking-modal.js';
import { detectScheduleConflicts } from '../utils/schedule.js';

let pendingConflictCallback = null;

// =================== 1. ШВИДКІ ДІЇ ПО КЛІКУ НА ЧАС ===================

export function openSlotActionModal(masterId, dateStr, slotTime) {
  const master = state.db.masters.find(m => m.id === masterId) || state.db.masters[0];
  $('slot-action-info').textContent = `${master.name} • ${dateStr} о ${slotTime}`;

  $('btn-slot-create-booking').onclick = () => {
    closeSlotActionModal();
    openManualBookingModal(masterId, dateStr, slotTime);
  };

  $('btn-slot-create-break').onclick = () => {
    closeSlotActionModal();
    openTimeBlockModal(masterId, dateStr, slotTime);
  };

  $('btn-slot-edit-day').onclick = () => {
    closeSlotActionModal();
    openDateOverrideModal(masterId, dateStr);
  };

  show('slot-action-modal');
}

export function closeSlotActionModal() {
  hide('slot-action-modal');
}

// =================== 2. МОДАЛКА ПЕРЕРВИ / ОСОБИСТОГО ЧАСУ (timeBlocks) ===================

export function openTimeBlockModal(masterId = 'm1', dateStr = '', startTime = '14:00') {
  $('tb-modal-master').innerHTML = state.db.masters
    .map(m => `<option value="${m.id}">${m.name}</option>`)
    .join('');
  $('tb-modal-master').value = masterId;
  $('tb-modal-date').value = dateStr || state.widget.date;
  $('tb-modal-start').value = startTime;

  // За замовчуванням кінець + 45 хв
  const [h, m] = startTime.split(':').map(Number);
  const endTotal = h * 60 + m + 45;
  const eh = String(Math.floor(endTotal / 60)).padStart(2, '0');
  const em = String(endTotal % 60).padStart(2, '0');
  $('tb-modal-end').value = `${eh}:${em}`;
  $('tb-modal-reason').value = '☕ Особистий час / Перерва';

  show('timeblock-modal');
}

export function closeTimeBlockModal() {
  hide('timeblock-modal');
}

export async function saveTimeBlockFromModal() {
  const masterId = $('tb-modal-master').value;
  const dateStr = $('tb-modal-date').value;
  const startTime = $('tb-modal-start').value;
  const endTime = $('tb-modal-end').value;
  const reason = $('tb-modal-reason').value.trim() || 'Перерва';

  if (!dateStr || !startTime || !endTime) {
    alert('Будь ласка, заповніть дату та час перерви');
    return;
  }

  // Перевірка на конфлікти з наявними записами клієнтів
  const conflicts = detectScheduleConflicts(masterId, dateStr, {
    type: 'timeBlock',
    startTime,
    endTime
  }, state.db);

  const applySave = async () => {
    if (!state.db.timeBlocks) state.db.timeBlocks = [];
    const prevTimeBlocks = [...state.db.timeBlocks];
    state.db.timeBlocks.push({
      id: 'tb_' + Date.now(),
      masterId,
      date: dateStr,
      startTime,
      endTime,
      reason
    });
    const ok = await saveDatabase();
    if (!ok) {
      state.db.timeBlocks = prevTimeBlocks;
      state.notify();
      return;
    }
    closeTimeBlockModal();
  };

  if (conflicts.length > 0) {
    openConflictModal(conflicts, applySave, 'Додавання перерви перетинається з записами клієнтів!');
  } else {
    await applySave();
  }
}

export async function deleteTimeBlock(tbId) {
  if (!confirm('Видалити цю перерву?')) return;
  const prevTimeBlocks = [...(state.db.timeBlocks || [])];
  state.db.timeBlocks = (state.db.timeBlocks || []).filter(tb => tb.id !== tbId);
  const ok = await saveDatabase();
  if (!ok) {
    state.db.timeBlocks = prevTimeBlocks;
    state.notify();
  }
}

// =================== 3. МОДАЛКА ВИНЯТКУ ДАТИ (dateOverrides) ===================

export function openDateOverrideModal(masterId = 'm1', dateStr = '') {
  const master = state.db.masters.find(m => m.id === masterId) || state.db.masters[0];
  $('override-modal-master').innerHTML = state.db.masters
    .map(m => `<option value="${m.id}">${m.name}</option>`)
    .join('');
  $('override-modal-master').value = master.id;
  $('override-modal-date').value = dateStr || state.widget.date;

  const currentOverride = master.dateOverrides && master.dateOverrides[dateStr];
  if (currentOverride) {
    if (currentOverride.type === 'day_off') {
      $('override-type-dayoff').checked = true;
      toggleOverrideCustomHours(false);
    } else {
      $('override-type-hours').checked = true;
      toggleOverrideCustomHours(true);
      $('override-start').value = currentOverride.workStart || '10:00';
      $('override-end').value = currentOverride.workEnd || '17:00';
    }
  } else {
    $('override-type-dayoff').checked = true;
    toggleOverrideCustomHours(false);
    $('override-start').value = '10:00';
    $('override-end').value = '17:00';
  }

  show('override-modal');
}

export function closeDateOverrideModal() {
  hide('override-modal');
}

export function toggleOverrideCustomHours(isCustom) {
  $('override-hours-container')?.classList.toggle('hidden', !isCustom);
}

export async function saveDateOverrideFromModal() {
  const masterId = $('override-modal-master').value;
  const dateStr = $('override-modal-date').value;
  const isDayOff = $('override-type-dayoff').checked;
  const isReset = $('override-type-reset')?.checked;

  const master = state.db.masters.find(m => m.id === masterId);
  if (!master) return;
  if (!master.dateOverrides) master.dateOverrides = {};

  if (isReset) {
    const prevOverrides = JSON.parse(JSON.stringify(master.dateOverrides || {}));
    delete master.dateOverrides[dateStr];
    const ok = await saveDatabase();
    if (!ok) {
      master.dateOverrides = prevOverrides;
      state.notify();
      return;
    }
    closeDateOverrideModal();
    return;
  }

  const proposedChange = isDayOff
    ? { type: 'day_off' }
    : {
        type: 'custom_hours',
        workStart: $('override-start').value || '09:00',
        workEnd: $('override-end').value || '18:00'
      };

  // Перевірка конфліктів
  const conflicts = detectScheduleConflicts(masterId, dateStr, proposedChange, state.db);

  const applySave = async () => {
    const prevOverrides = JSON.parse(JSON.stringify(master.dateOverrides || {}));
    master.dateOverrides[dateStr] = proposedChange;
    const ok = await saveDatabase();
    if (!ok) {
      master.dateOverrides = prevOverrides;
      state.notify();
      return;
    }
    closeDateOverrideModal();
  };

  if (conflicts.length > 0) {
    const msg = isDayOff
      ? `Встановлення вихідного дня скасовує або переносить ${conflicts.length} запис(ів) клієнтів!`
      : `Нові робочі години не вміщують ${conflicts.length} запис(ів) клієнтів!`;
    openConflictModal(conflicts, applySave, msg);
  } else {
    await applySave();
  }
}

// =================== 4. МОДАЛКА ВИРІШЕННЯ КОНФЛІКТІВ ===================

export function openConflictModal(conflicts, onConfirmException, warningText) {
  pendingConflictCallback = onConfirmException;

  $('conflict-warning-text').textContent = warningText || 'Виявлено конфлікт з існуючими записами!';
  const listEl = $('conflict-bookings-list');
  if (listEl) {
    listEl.innerHTML = conflicts.map(app => `
      <div class="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs space-y-1">
        <div class="font-bold text-rose-900 flex justify-between">
          <span>${app.clientName} (${app.clientPhone})</span>
          <span>${app.time} • ${app.price} ₴</span>
        </div>
        <div class="text-rose-700">Тривалість: ${app.duration} хв • Статус: ${app.status}</div>
        <div class="flex gap-2 pt-1">
          <button type="button" data-conflict-reschedule="${app.id}" class="px-2.5 py-1 rounded-lg bg-white border border-rose-300 text-rose-800 font-semibold hover:bg-rose-100 transition">
            📅 Перенести
          </button>
          <button type="button" data-conflict-cancel="${app.id}" class="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-semibold hover:bg-rose-700 transition">
            ❌ Скасувати з сповіщенням
          </button>
        </div>
      </div>
    `).join('');

    // Кнопки перенесення
    listEl.querySelectorAll('[data-conflict-reschedule]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeConflictModal();
        openEditBookingModal(btn.dataset.conflictReschedule);
      });
    });

    // Кнопки скасування
    listEl.querySelectorAll('[data-conflict-cancel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const app = state.db.appointments.find(a => a.id === btn.dataset.conflictCancel);
        if (app) {
          app.status = 'cancelled';
          const master = state.db.masters.find(m => m.id === app.masterId);
          const tgMsg = `⚠️ <b>Запис скасовано через зміну графіка!</b>\nКлієнт: <b>${app.clientName}</b> (${app.clientPhone})\nДата: ${app.date} о ${app.time}\nМайстер: ${master ? master.name : ''}`;
          await saveDatabase({ chatId: master?.tgChatId || state.db.salon.tgChatId, message: tgMsg });
          alert(`Запис клієнта ${app.clientName} скасовано. Повідомлення надіслано.`);
          btn.closest('.p-3').remove();
          if (listEl.children.length === 0) {
            closeConflictModal();
            if (pendingConflictCallback) await pendingConflictCallback();
          }
        }
      });
    });
  }

  show('conflict-modal');
}

export function closeConflictModal() {
  hide('conflict-modal');
  pendingConflictCallback = null;
}

export async function confirmConflictAsException() {
  if (pendingConflictCallback) {
    const cb = pendingConflictCallback;
    closeConflictModal();
    await cb();
  } else {
    closeConflictModal();
  }
}

// =================== ІНІЦІАЛІЗАЦІЯ ===================

export function initScheduleModals() {
  // Дії з слотом
  $('btn-close-slot-action')?.addEventListener('click', closeSlotActionModal);

  // TimeBlock
  $('btn-save-timeblock')?.addEventListener('click', saveTimeBlockFromModal);
  $('btn-cancel-timeblock')?.addEventListener('click', closeTimeBlockModal);

  // Override
  $('override-type-dayoff')?.addEventListener('change', () => toggleOverrideCustomHours(false));
  $('override-type-hours')?.addEventListener('change', () => toggleOverrideCustomHours(true));
  $('override-type-reset')?.addEventListener('change', () => toggleOverrideCustomHours(false));
  $('btn-save-override')?.addEventListener('click', saveDateOverrideFromModal);
  $('btn-cancel-override')?.addEventListener('click', closeDateOverrideModal);

  // Конфлікти
  $('btn-conflict-keep-exception')?.addEventListener('click', confirmConflictAsException);
  $('btn-close-conflict')?.addEventListener('click', closeConflictModal);
}
