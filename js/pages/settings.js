/**
 * pages/settings.js — Налаштування салону, профілі майстрів та прайс-лист
 */

import state from '../state.js';
import { $ } from '../utils/dom.js';
import { saveDatabase } from '../http/api-client.js';
import { openServiceModal, deleteService } from '../components/service-modal.js';

// =================== РЕНДЕР ФОРМИ НАЛАШТУВАНЬ ===================

export function renderSettingsForm() {
  // Поля салону
  const f = (id, val) => { const el = $(id); if (el) el.value = val; };
  f('set-salon-name', state.db.salon.name || '');
  f('set-salon-address', state.db.salon.address || '');
  f('set-work-start', state.db.salon.workStart || 9);
  f('set-work-end', state.db.salon.workEnd || 20);
  f('set-admin-pin', state.db.salon.adminPin || '1234');
  f('set-tg-token', state.db.salon.tgBotToken || '');
  f('set-tg-chat-id', state.db.salon.tgChatId || '');

  // Кнопка тесту Telegram
  const testTgBtn = $('btn-test-tg');
  if (testTgBtn) {
    testTgBtn.onclick = async () => {
      const token = $('set-tg-token')?.value.trim() || state.db.salon.tgBotToken;
      const chatId = $('set-tg-chat-id')?.value.trim() || state.db.salon.tgChatId;
      if (!token || !chatId) {
        alert('Будь ласка, вкажіть Telegram Bot Token та Chat ID для відправки тесту.');
        return;
      }
      testTgBtn.disabled = true;
      testTgBtn.textContent = '⏳ Відправка...';
      try {
        const res = await fetch(`bot.php?action=test_send&chat_id=${encodeURIComponent(chatId)}`);
        const json = await res.json();
        if (json.ok) {
          alert('✅ Тестове сповіщення успішно надіслано в Telegram!');
        } else {
          alert('❌ Помилка Telegram: ' + (json.error || 'Перевірте токен або натисніть /start у боті'));
        }
      } catch (e) {
        alert('❌ Помилка зв\'язку з сервером: ' + e.message);
      } finally {
        testTgBtn.disabled = false;
        testTgBtn.textContent = '✈️ Надіслати тест у Telegram';
      }
    };
  }

  // Профілі майстрів
  const mastersEl = $('settings-masters-list');
  if (mastersEl) {
    mastersEl.innerHTML = state.db.masters.map((m, idx) => `
      <div class="p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
        <div class="font-bold text-slate-700">Майстер #${idx + 1}</div>
        <div>
          <label class="text-slate-400">Ім'я</label>
          <input type="text" id="m-name-${m.id}" value="${m.name}" class="w-full border rounded-lg px-2.5 py-1.5 mt-0.5 text-sm">
        </div>
        <div>
          <label class="text-slate-400">Спеціалізація</label>
          <input type="text" id="m-role-${m.id}" value="${m.role}" class="w-full border rounded-lg px-2.5 py-1.5 mt-0.5 text-sm">
        </div>
        <div>
          <label class="text-slate-400">Опис у віджеті</label>
          <input type="text" id="m-bio-${m.id}" value="${m.bio || ''}" class="w-full border rounded-lg px-2.5 py-1.5 mt-0.5 text-sm">
        </div>
        <div>
          <label class="text-slate-400">Telegram Chat ID майстра (для особистих сповіщень)</label>
          <input type="text" id="m-tg-${m.id}" value="${m.tgChatId || ''}" placeholder="напр. 987654321" class="w-full border rounded-lg px-2.5 py-1.5 mt-0.5 text-sm font-mono">
        </div>
      </div>
    `).join('');
  }

  // Прайс-лист послуг
  const servicesEl = $('settings-services-list');
  if (servicesEl) {
    servicesEl.innerHTML = state.db.services.map(s => {
      const m = state.db.masters.find(x => x.id === s.masterId);
      return `
        <div class="py-3 flex items-center justify-between gap-2">
          <div>
            <span class="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">${m ? m.name : ''}</span>
            <span class="font-semibold text-slate-800 ml-1">${s.title}</span>
            <span class="text-xs text-slate-400 ml-2">${s.duration} хв (+${s.bufferTime !== undefined ? s.bufferTime : 15} хв буфер) • ${s.price} ₴</span>
          </div>
          <div class="flex items-center gap-2">
            <button data-edit-service="${s.id}" class="text-xs px-2.5 py-1 rounded-lg border hover:bg-slate-50">✎ Змінити</button>
            <button data-delete-service="${s.id}" class="text-xs px-2.5 py-1 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100">✕</button>
          </div>
        </div>
      `;
    }).join('');

    // Навісити обробники
    servicesEl.querySelectorAll('[data-edit-service]').forEach(btn => {
      btn.addEventListener('click', () => openServiceModal(btn.dataset.editService));
    });
    servicesEl.querySelectorAll('[data-delete-service]').forEach(btn => {
      btn.addEventListener('click', () => deleteService(btn.dataset.deleteService));
    });
  }
}

// =================== ЗБЕРЕЖЕННЯ ===================

export async function saveSalonSettings() {
  const pinVal = $('set-admin-pin').value.trim() || '1234';
  state.db.salon.name = $('set-salon-name').value.trim() || 'Beauty Studio';
  state.db.salon.address = $('set-salon-address').value.trim();
  state.db.salon.workStart = Number($('set-work-start').value) || 9;
  state.db.salon.workEnd = Number($('set-work-end').value) || 20;
  state.db.salon.adminPin = pinVal;
  state.db.salon.tgBotToken = $('set-tg-token').value.trim();
  state.db.salon.tgChatId = $('set-tg-chat-id') ? $('set-tg-chat-id').value.trim() : '';
  await saveDatabase();
  alert(`Налаштування салону збережено!\nНовий PIN-код для входу майстрів: ${state.db.salon.adminPin}`);
}

export async function saveMastersSettings() {
  state.db.masters.forEach(m => {
    const nameEl = $(`m-name-${m.id}`);
    const roleEl = $(`m-role-${m.id}`);
    const bioEl = $(`m-bio-${m.id}`);
    const tgEl = $(`m-tg-${m.id}`);
    if (nameEl) m.name = nameEl.value.trim() || m.name;
    if (roleEl) m.role = roleEl.value.trim() || m.role;
    if (bioEl) m.bio = bioEl.value.trim();
    if (tgEl) m.tgChatId = tgEl.value.trim();
  });
  await saveDatabase();
  alert('Профілі майстрів оновлено!');
}

// =================== ІНІЦІАЛІЗАЦІЯ ===================

export function initSettings() {
  const btnSaveSalon = document.querySelector('[data-action="save-salon"]');
  if (btnSaveSalon) btnSaveSalon.addEventListener('click', saveSalonSettings);

  const btnSaveMasters = document.querySelector('[data-action="save-masters"]');
  if (btnSaveMasters) btnSaveMasters.addEventListener('click', saveMastersSettings);

  const btnAddService = document.querySelector('[data-action="add-service"]');
  if (btnAddService) btnAddService.addEventListener('click', () => openServiceModal());

  // Автозбереження нового PIN при зміні значення в полі
  const pinInput = $('set-admin-pin');
  if (pinInput) {
    pinInput.addEventListener('change', () => {
      const val = pinInput.value.trim();
      if (val && val !== state.db.salon.adminPin) {
        state.db.salon.adminPin = val;
        saveDatabase();
      }
    });
  }

  // Підписка на оновлення стану
  state.subscribe(() => {
    if (state.isAdmin) renderSettingsForm();
  });
}
