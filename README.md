# Beauty Studio — Онлайн-запис та CRM для салону краси

Модульна веб-система онлайн-запису клієнтів (стиль Altegio) та CRM для салону краси з інтерактивною шахівницею розкладу майстрів, базою клієнтів, підрахунком виручки та сповіщеннями в Telegram.

## 📁 Структура проєкту

- `index.html` — головна сторінка сайту (віджет клієнта та адмін-панель)
- `css/` — стилі (`styles.css`)
- `js/` — модульний JavaScript (ES Modules):
  - `app.js` — bootstrap додатку, ініціалізація
  - `state.js` — централізований реактивний стан
  - `config.js` — початкова конфігурація салону, послуги, майстри
  - `http/api-client.js` — робота з бекендом, Telegram та offline-fallback
  - `pages/` — сторінки: віджет запису (`booking.js`), шахівниця розкладу (`calendar.js`), налаштування (`settings.js`), клієнти (`clients.js`)
  - `components/` — модальні вікна та панель майстра (`admin-bar.js`, `pin-modal.js`, `booking-modal.js`, `service-modal.js`)
  - `utils/` — утиліти (`dom.js`, `time.js`, `format.js`)
- `api-v2.php` — легкий PHP-бекенд (збереження даних у JSON, відправка сповіщень у Telegram Bot API)
- `.gitignore` — виключення тимчасових файлів та динамічної бази `data/`

---

## 🚀 Розгортання та запуск на VPS сервері

### 1. Вимоги
- Linux VPS (Ubuntu 22.04 / 24.04 або Debian 11 / 12)
- Вебсервер **Nginx**
- **PHP 8.0+** з розширенням `curl` (для надсилання сповіщень у Telegram)

---

### 2. Встановлення оточення на сервері

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx php-fpm php-curl php-json git
```

---

### 3. Клонування репозиторію

```bash
cd /var/www
sudo git clone https://github.com/Maksxxx8/servis.git
sudo chown -R www-data:www-data /var/www/servis
sudo chmod -R 775 /var/www/servis
```

---

### 4. Конфігурація Nginx

Створіть файл конфігурації:
```bash
sudo nano /etc/nginx/sites-available/servis
```

Вставте конфігурацію (замініть `your-domain.com` на ваш домен або IP-адресу сервера, перевірте версію сокету php-fpm, наприклад `php8.2-fpm.sock` або `php8.3-fpm.sock`):

```nginx
server {
    listen 80;
    server_name your-domain.com; # або IP вашого VPS

    root /var/www/servis;
    index index.html;

    # Відкриття сайту прямо за кореневою адресою https://your-domain.com/
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Обробка бекенду api-v2.php
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

Активуйте конфігурацію та перезапустіть Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/servis /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

### 5. Підключення безкоштовного SSL (HTTPS)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

### 6. Адреси доступу

- **Головна сторінка (віджет онлайн-запису)**: `https://your-domain.com/`
- **Панель керування майстра**:
  - Натисніть **«🔒 Вхід для майстрів»** унизу віджета або перейдіть за прямою адресою: `https://your-domain.com/?admin=1`
  - PIN-код за замовчуванням: **`1234`**
- **Сповіщення у Telegram**:
  - У розділі *«⚙️ Налаштування та Послуги»* вкажіть **Telegram Bot Token** вашого бота
  - Майстри автоматично отримуватимуть картку клієнта одразу після оформлення онлайн-запису.
