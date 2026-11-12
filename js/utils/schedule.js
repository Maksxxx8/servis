/**
 * utils/schedule.js — Ядро розрахунку розкладу, доступності слотів, конфліктів та синхронізації iCal
 * 
 * 3 рівні пріоритету:
 * 1. dateOverrides (винятки на конкретну дату: day_off / custom_hours)
 * 2. weeklySchedule (шаблон робочого тижня майстра: isWorking, workStart, workEnd, regularBreaks)
 * 3. bookings & timeBlocks & bufferTime (зайняті інтервали)
 */

import { timeToMin, minToTime, formatLocalDate, parseLocalDate, addDays } from './time.js';
import { todayStr } from '../config.js';

/**
 * Отримати робочий графік майстра на конкретну дату (Рівні 1 і 2)
 * @param {Object} master
 * @param {string} dateStr YYYY-MM-DD
 * @returns {Object} { isWorking, type, workStart, workEnd, regularBreaks, reason }
 */
export function getMasterDaySchedule(master, dateStr) {
  if (!master) {
    return { isWorking: false, type: 'day_off', reason: 'Майстра не знайдено', regularBreaks: [] };
  }

  // Рівень 1 (Найвищий): dateOverrides
  if (master.dateOverrides && master.dateOverrides[dateStr]) {
    const override = master.dateOverrides[dateStr];
    if (override.type === 'day_off') {
      return {
        isWorking: false,
        type: 'day_off',
        reason: override.reason || 'Вихідний (індивідуальний виняток)',
        workStart: null,
        workEnd: null,
        regularBreaks: []
      };
    }
    if (override.type === 'custom_hours') {
      return {
        isWorking: true,
        type: 'custom_hours',
        workStart: override.workStart || '09:00',
        workEnd: override.workEnd || '18:00',
        regularBreaks: override.regularBreaks || []
      };
    }
  }

  // Рівень 2: weeklySchedule
  const dayOfWeek = new Date(dateStr + 'T00:00:00').getDay(); // 0 = Нд, 1 = Пн ... 6 = Сб
  const weekly = master.weeklySchedule ? master.weeklySchedule[dayOfWeek] : null;

  if (weekly && weekly.isWorking) {
    return {
      isWorking: true,
      type: 'regular',
      workStart: weekly.workStart || '09:00',
      workEnd: weekly.workEnd || '20:00',
      regularBreaks: weekly.regularBreaks || []
    };
  }

  return {
    isWorking: false,
    type: 'day_off',
    reason: 'Вихідний день',
    workStart: null,
    workEnd: null,
    regularBreaks: []
  };
}

/**
 * Отримати всі зайняті часові інтервали майстра на день (перерви, записи + буфери, timeBlocks)
 * @param {Object} master
 * @param {string} dateStr
 * @param {Object} db
 * @returns {Array} [{ startMin, endMin, type, label, ref }]
 */
export function getMasterBusyIntervals(master, dateStr, db) {
  const intervals = [];
  const daySched = getMasterDaySchedule(master, dateStr);

  // 1. Регулярні перерви з графіку
  if (daySched.isWorking && Array.isArray(daySched.regularBreaks)) {
    daySched.regularBreaks.forEach(b => {
      intervals.push({
        startMin: timeToMin(b.start),
        endMin: timeToMin(b.end),
        type: 'break',
        label: b.name || 'Обід / Перерва'
      });
    });
  }

  // 2. Разові перерви та особистий час (timeBlocks)
  const timeBlocks = (db.timeBlocks || []).filter(tb => tb.masterId === master.id && tb.date === dateStr);
  timeBlocks.forEach(tb => {
    intervals.push({
      startMin: timeToMin(tb.startTime),
      endMin: timeToMin(tb.endTime),
      type: 'timeBlock',
      label: tb.reason || '☕ Особистий час',
      ref: tb
    });
  });

  // 3. Записи клієнтів (bookings) + технічний буфер
  const apps = (db.appointments || []).filter(a => a.masterId === master.id && a.date === dateStr && a.status !== 'cancelled');
  apps.forEach(a => {
    const startMin = timeToMin(a.time);
    const dur = Number(a.duration) || 60;
    // Буфер з послуги або глобальний буфер майстра
    let buf = a.bufferTime;
    if (buf === undefined) {
      const srv = (db.services || []).find(s => a.serviceIds && a.serviceIds.includes(s.id));
      buf = srv && srv.bufferTime !== undefined ? Number(srv.bufferTime) : Number(master.globalBuffer || 15);
    }
    buf = Number(buf) || 0;

    intervals.push({
      startMin,
      serviceEndMin: startMin + dur,
      endMin: startMin + dur + buf, // Повне зайняте вікно з буфером
      bufferMin: buf,
      type: 'booking',
      label: a.clientName || 'Запис',
      ref: a
    });
  });

  return intervals.sort((a, b) => a.startMin - b.startMin);
}

/**
 * Алгоритм розрахунку доступних слотів для клієнтського віджета
 * @param {Object} master
 * @param {Array} services Масив обраних об'єктів послуг
 * @param {string} dateStr
 * @param {Object} db
 * @returns {Object} { isWorking, slots, daySched, totalDuration, buffer, totalNeeded }
 */
export function calculateAvailableSlots(master, services, dateStr, db) {
  const daySched = getMasterDaySchedule(master, dateStr);
  if (!daySched.isWorking) {
    return {
      isWorking: false,
      slots: [],
      daySched,
      reason: daySched.reason
    };
  }

  const startWorkMin = timeToMin(daySched.workStart);
  const endWorkMin = timeToMin(daySched.workEnd);

  // Тривалість усіх обраних послуг
  const totalDuration = services.reduce((acc, s) => acc + Number(s.duration || 60), 0) || 60;

  // Технічний перерва (буфер) після послуг: беремо максимальний буфер з обраних послуг або глобальний буфер майстра
  const maxServiceBuffer = services.reduce((acc, s) => Math.max(acc, Number(s.bufferTime !== undefined ? s.bufferTime : 0)), 0);
  const buffer = maxServiceBuffer > 0 ? maxServiceBuffer : (Number(master.globalBuffer) || 15);

  const totalNeeded = totalDuration + buffer;
  const slotStep = Number(master.slotStep) || 30;
  const busyIntervals = getMasterBusyIntervals(master, dateStr, db);

  // Якщо дата сьогодні — фільтруємо слоти, що вже минули (+ 30 хвилин запас)
  let minAllowedStart = 0;
  if (dateStr === todayStr) {
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    minAllowedStart = currentMin + 30;
  }

  const slots = [];
  for (let m = startWorkMin; m + totalNeeded <= endWorkMin; m += slotStep) {
    if (dateStr === todayStr && m < minAllowedStart) continue;

    const slotStart = m;
    const slotEnd = m + totalNeeded;

    // Перевірка на перетин з будь-яким зайнятим інтервалом (перерва, інший запис + його буфер, timeBlock)
    const hasCollision = busyIntervals.some(busy => slotStart < busy.endMin && slotEnd > busy.startMin);

    if (!hasCollision) {
      slots.push(minToTime(m));
    }
  }

  return {
    isWorking: true,
    slots,
    daySched,
    totalDuration,
    buffer,
    totalNeeded
  };
}

/**
 * Знайти найближчі вільні дні для майстра, якщо в обраний день немає слотів
 * @param {Object} master
 * @param {Array} services
 * @param {string} fromDateStr
 * @param {Object} db
 * @param {number} maxDays
 * @returns {Array} [{ date, formatted, slotsCount }]
 */
export function findNextAvailableDays(master, services, fromDateStr, db, maxDays = 3) {
  const result = [];
  const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  for (let i = 1; i <= 21; i++) {
    const dateStr = addDays(fromDateStr, i);
    const checkDate = parseLocalDate(dateStr);

    const calc = calculateAvailableSlots(master, services, dateStr, db);
    if (calc.isWorking && calc.slots.length > 0) {
      const d = String(checkDate.getDate()).padStart(2, '0');
      const m = String(checkDate.getMonth() + 1).padStart(2, '0');
      const dow = dayNames[checkDate.getDay()];
      result.push({
        date: dateStr,
        formatted: `${d}.${m} (${dow})`,
        slotsCount: calc.slots.length
      });
      if (result.length >= maxDays) break;
    }
  }

  return result;
}

/**
 * Детектор конфліктів: перевірка накладання записів клієнтів при зміні графіка або додаванні timeBlock
 * @param {string} masterId
 * @param {string} dateStr
 * @param {Object} proposedChange { type: 'day_off' | 'custom_hours' | 'timeBlock', workStart, workEnd, startTime, endTime }
 * @param {Object} db
 * @returns {Array} Масив конфліктних записів клієнтів
 */
export function detectScheduleConflicts(masterId, dateStr, proposedChange, db) {
  const activeApps = (db.appointments || []).filter(a => a.masterId === masterId && a.date === dateStr && a.status !== 'cancelled');
  if (activeApps.length === 0) return [];

  const conflicts = [];

  if (proposedChange.type === 'day_off') {
    // Всі записи на цей день стають конфліктними
    return [...activeApps];
  }

  if (proposedChange.type === 'custom_hours') {
    const newStart = timeToMin(proposedChange.workStart);
    const newEnd = timeToMin(proposedChange.workEnd);

    activeApps.forEach(a => {
      const appStart = timeToMin(a.time);
      const appEnd = appStart + Number(a.duration || 60);
      if (appStart < newStart || appEnd > newEnd) {
        conflicts.push(a);
      }
    });
  }

  if (proposedChange.type === 'timeBlock') {
    const tbStart = timeToMin(proposedChange.startTime);
    const tbEnd = timeToMin(proposedChange.endTime);

    activeApps.forEach(a => {
      const appStart = timeToMin(a.time);
      const appEnd = appStart + Number(a.duration || 60);
      if (appStart < tbEnd && appEnd > tbStart) {
        conflicts.push(a);
      }
    });
  }

  return conflicts;
}

/**
 * Генерація тексту .ics для експорту в календар (Apple / Google / Outlook)
 */
export function generateIcsString(appointment, master, services, salon) {
  const srvNames = (services || []).map(s => s.title).join(', ');
  const startDt = appointment.date.replace(/-/g, '') + 'T' + appointment.time.replace(':', '') + '00';

  const [h, m] = appointment.time.split(':').map(Number);
  const endTotalMin = h * 60 + m + Number(appointment.duration || 60);
  const endH = String(Math.floor(endTotalMin / 60)).padStart(2, '0');
  const endM = String(endTotalMin % 60).padStart(2, '0');
  const endDt = appointment.date.replace(/-/g, '') + 'T' + endH + endM + '00';

  const uid = `${appointment.id || Date.now()}@beautystudio.local`;
  const summary = `Запис: ${srvNames || 'Послуга салону'} — ${master ? master.name : 'Майстер'}`;
  const description = `Клієнт: ${appointment.clientName}\\nТелефон: ${appointment.clientPhone}\\nМайстер: ${master ? master.name : ''}\\nСума: ${appointment.price} ₴\\n${appointment.notes ? 'Нотатка: ' + appointment.notes : ''}`;
  const location = salon ? (salon.name + ', ' + salon.address) : 'Beauty Studio';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Beauty Studio CRM//UA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
    `DTSTART:${startDt}`,
    `DTEND:${endDt}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

/**
 * Завантажити файл .ics у браузері
 */
export function downloadIcsFile(appointment, master, services, salon) {
  const icsData = generateIcsString(appointment, master, services, salon);
  const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `booking-${appointment.date}-${appointment.time}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Сформувати пряме посилання для додавання події в Google Calendar (web)
 */
export function generateGoogleCalendarUrl(appointment, master, services, salon) {
  const srvNames = (services || []).map(s => s.title).join(', ');
  const startDt = appointment.date.replace(/-/g, '') + 'T' + appointment.time.replace(':', '') + '00';

  const [h, m] = appointment.time.split(':').map(Number);
  const endTotalMin = h * 60 + m + Number(appointment.duration || 60);
  const endH = String(Math.floor(endTotalMin / 60)).padStart(2, '0');
  const endM = String(endTotalMin % 60).padStart(2, '0');
  const endDt = appointment.date.replace(/-/g, '') + 'T' + endH + endM + '00';

  const title = encodeURIComponent(`Запис: ${srvNames || 'Beauty Studio'} • ${master ? master.name : ''}`);
  const details = encodeURIComponent(`Майстер: ${master ? master.name : ''}\nПослуги: ${srvNames}\nВартість: ${appointment.price} ₴\nТелефон: ${appointment.clientPhone}\n${appointment.notes || ''}`);
  const location = encodeURIComponent(salon ? `${salon.name}, ${salon.address}` : 'Beauty Studio');

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDt}/${endDt}&details=${details}&location=${location}`;
}
