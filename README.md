# Beauty Studio — Система онлайн-запису та CRM майстрів

Сучасна модульна система онлайн-запису клієнтів (у стилі Altegio) та CRM для салону краси / майстрів краси з інтерактивною шахівницею розкладу, базою клієнтів, аналітикою виручки та сповіщеннями в Telegram.

## 📁 Структура репозиторію

- `frontend/` — модульний клієнтський фронтенд та адмін-панель (ES Modules, Tailwind CSS, архітектурний підхід EasyAppointments)
  - `frontend/index.html` — основна сторінка віджета та адмінки
  - `frontend/js/app.js` — точка входу додатку
  - `frontend/js/pages/` — сторінки (віджет запису `booking.js`, шахівниця `calendar.js`, налаштування `settings.js`, база клієнтів `clients.js`)
  - `frontend/js/components/` — модальні вікна та навігація (`admin-bar.js`, `pin-modal.js`, `booking-modal.js`, `service-modal.js`)
  - `frontend/js/http/` — API-клієнт з автоматичним перемиканням сервер/офлайн
  - `frontend/js/state.js` — реактивний стан
- `api-v2.php` — легкий бекенд на PHP (збереження даних у JSON, відправка сповіщень у Telegram Bot API)
- `index-v2.html` — оригінальний монолітний прототип (збережено для довідки)
- `easyappointments-main/` — референсна база коду EasyAppointments (архітектура бекенду та календарів)

---

## 🚀 Розгортання та запуск на VPS сервері

### 1. Вимоги до сервера
- Будь-який Linux VPS (Ubuntu 22.04 / 24.04 або Debian 11 / 12)
- Вебсервер **Nginx** або **Apache**
- **PHP 8.0+** з розширенням `curl` (для Telegram-сповіщень) та `json`

---

### 2. Встановлення оточення на чистому VPS (Ubuntu/Debian)

```bash
# Оновлення пакетів
sudo apt update && sudo apt upgrade -y

# Встановлення Nginx, PHP та curl
sudo apt install -y nginx php-fpm php-curl php-json git
```

---

### 3. Клонування репозиторію

```bash
cd /var/www
sudo git clone https://github.com/Maksxxx8/servis.git
sudo chown -R www-data:www-data /var/www/servis
sudo chmod -R 755 /var/www/servis

# Важливо надати права на запис для каталогу даних бекенду:
sudo chmod -R 775 /var/www/servis
```

---

### 4. Налаштування Nginx

Створіть конфігураційний файл сайту:
```bash
sudo nano /etc/nginx/sites-available/servis
```

Вставте наступну конфігурацію (замініть `your-domain.com` або вкажіть IP вашого VPS):

```nginx
server {
    listen 80;
    server_name your-domain.com; # або ваш IP-адрес

    # Кореневий каталог сайту
    root /var/www/servis;
    index frontend/index.html;

    location / {
        try_files $uri $uri/ /frontend/index.html;
    }

    # Обробка PHP скриптів (api-v2.php)
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php-fpm.sock; # перевірте версію, наприклад php8.2-fpm.sock або php8.3-fpm.sock
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }

    # Захист каталогу даних з JSON файлом бази
    location ^~ /data/ {
        deny all;
        return 403;
    }

    # Кешування статичних файлів
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
```

Активуйте сайт і перезавантажте Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/servis /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

### 5. Підключення безкоштовного SSL (HTTPS) через Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

### 6. Доступ та використання

- **Клієнтський віджет онлайн-запису**: `https://your-domain.com/frontend/`
- **Вхід для майстрів / адмінка**: 
  - Натисніть посилання «🔒 Вхід для майстрів» внизу віджета або відкрийте `https://your-domain.com/frontend/?admin=1`
  - Стандартний PIN-код: **`1234`** (змінюється у розділі *«⚙️ Налаштування та Послуги»*)
- **Telegram-сповіщення**: 
  - В розділі *«⚙️ Налаштування та Послуги»* вкажіть токен вашого Telegram-бота (`set-tg-token`), щоб майстри миттєво отримували сповіщення про нові онлайн-записи клієнтів.
