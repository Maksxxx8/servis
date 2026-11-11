# Beauty Studio — Онлайн-запис та CRM для салону краси

Модульна веб-система онлайн-запису клієнтів (стиль Altegio) та CRM для салону краси з трирівневою системою розкладу, гнучким керуванням графіком майстрів, інтерактивною шахівницею (День / Тиждень / Місяць), базою клієнтів, аналітикою виручки, iCal-синхронізацією та сповіщеннями в Telegram.

## 🌟 Ключові можливості

### 1. Трирівнева система розкладу (3-Level Schedule Engine)
Пріоритет розрахунку доступності: `DateOverrides` > `WeeklySchedule` > `Bookings / TimeBlocks`.
- **Рівень 1: Стандартний шаблон тижня (`weeklySchedule`)**:
  - Індивідуально для кожного майстра на 7 днів (Пн–Нд).
  - Налаштування тумблерів «Робочий / Вихідний», годин роботи (`workStart` – `workEnd`) та регулярних перерв (`regularBreaks`, наприклад, обід 13:00–14:00).
- **Рівень 2: Винятки на конкретні дати (`dateOverrides` & `timeBlocks`)**:
  - `dateOverrides`: повний вихідний (`day_off`) або скорочені/зміщені години (`custom_hours`). Повністю перекриває шаблон тижня.
  - `timeBlocks`: разові відлучки, особистий час або походи до лікаря (`date`, `startTime`, `endTime`, `reason`).
- **Рівень 3: Записи клієнтів та Буфери (`bookings`)**:
  - Розрахунок зайнятості: $\text{TotalNeeded} = \sum \text{Duration} + \text{Buffer}$.
  - Технічний буфер (`bufferTime`) після кожної послуги для провітрювання та дезінфекції.
  - Налаштування кроку часової сітки слотів майстра (`slotStep`: 15, 30 або 60 хв).

### 2. Шахівниця календаря (3 режими)
- **День**: почасова сітка для всіх майстрів (або фільтр по одному майстру), штриховка неробочих годин, візуальні блоки візитів з виділеним штрих-блоком технічного буфера знизу, карточки перерв (TimeBlocks), швидкий запис клієнта або перерва по кліку на слот.
- **Тиждень**: 7 колонок (Пн–Нд), спокійний сірий фон на вихідні дні майстра, зручний перегляд щотижневого навантаження.
- **Місяць**: сітка на 5–6 тижнів з індикаторами змін (наприклад, `Св: 09–20`, `Мр: Вих`), кількістю записів, виручкою та швидким переходом у день.

### 3. Детектор конфліктів
- При зміні графіка (наприклад, встановлення вихідного або додавання перерви) система перевіряє наявність активних записів клієнтів.
- Модальне вікно дозволяє в один клік: **Перенести запис**, **Скасувати зі сповіщенням у Telegram** або **Залишити як виняток**.

### 4. iCal та Google Calendar Синхронізація
- **Жива підписка для майстрів**: у кабінеті майстра доступне персональне посилання на стрім `api-v2.php?action=ical&master=ID&key=KEY` для додавання в Apple Calendar (iPhone/Mac), Google Calendar чи Outlook.
- **Для клієнтів**: на кроці успішного запису доступні кнопки прямого експорту в Google Calendar та завантаження `.ics` файлу.

---

## 📁 Структура проєкту

- `index.html` — головна сторінка сайту (віджет клієнта та кабінет майстра)
- `css/` — стилі (`styles.css`)
- `js/` — модульний JavaScript (ES Modules):
  - `app.js` — bootstrap додатку, ініціалізація
  - `state.js` — централізований реактивний стан
  - `config.js` — початкова конфігурація салону, послуги, графіки
  - `http/api-client.js` — робота з бекендом, Telegram та offline-fallback
  - `pages/` — сторінки: віджет запису (`booking.js`), шахівниця (`calendar.js`), кабінет графіка (`schedule.js`), налаштування (`settings.js`), клієнти (`clients.js`)
  - `components/` — модальні вікна (`admin-bar.js`, `pin-modal.js`, `booking-modal.js`, `service-modal.js`, `schedule-modal.js`)
  - `utils/` — утиліти (`schedule.js`, `dom.js`, `time.js`, `format.js`)
- `api-v2.php` — легкий PHP-бекенд (збереження даних у JSON, Telegram Bot API, iCal feed)
- `.gitignore` — виключення тимчасових файлів та бази `data/`

---

## 🚀 Розгортання та запуск на VPS сервері

### 1. Вимоги
- Linux VPS (Ubuntu 22.04 / 24.04 або Debian 11 / 12)
- Вебсервер **Nginx**
- **PHP 8.0+** з розширенням `curl` (для Telegram-сповіщень)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx php-fpm php-curl php-json git
```

### 2. Клонування репозиторію
```bash
cd /var/www
sudo git clone https://github.com/Maksxxx8/servis.git
sudo chown -R www-data:www-data /var/www/servis
sudo chmod -R 775 /var/www/servis
```

### 3. Конфігурація Nginx (`/etc/nginx/sites-available/servis`)
```nginx
server {
    listen 80;
    server_name your-domain.com; # або IP вашого VPS

    root /var/www/servis;
    index index.html;

    # Відкриття сайту прямо за адресою https://your-domain.com/
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Обробка бекенду api-v2.php та iCal стріму
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }

    # Захист каталогу даних з базою JSON від прямого перегляду у браузері
    location ^~ /data/ {
        deny all;
        return 403;
    }

    # Кешування статичних ресурсів
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/servis /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

### 🌐 Адреси доступу:
- **Клієнтський віджет онлайн-запису**: `https://your-domain.com/`
- **Кабінет майстра / адмінка**:
  - Кнопка **«🔒 Вхід для майстрів»** унизу віджета або пряме посилання `https://your-domain.com/?admin=1`
  - PIN-код за замовчуванням: **`1234`**
- **Підписка на iCal-календар**:
  - `https://your-domain.com/api-v2.php?action=ical&master=m1&key=key_m1_svitlana`
