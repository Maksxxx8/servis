<?php
/**
 * google-calendar.php — Сервіс прямої двосторонньої синхронізації з Google Calendar API
 * Працює через Сервісний аккаунт Google (Service Account) без потреби у зовнішніх бібліотеках.
 *
 * Переваги:
 * 1. Миттєве (real-time) оновлення подій без очікування оновлення iCal (яке триває до 24 годин).
 * 2. Робота у фоновому режимі (server-to-server) без запиту авторизації у майстрів через браузер.
 * 3. Автоматичне створення, редагування часу та видалення при скасуванні запису.
 * 4. Чистий PHP 8 (використовує вбудовані OpenSSL та cURL).
 */

require_once __DIR__ . '/db.php';

class GoogleCalendarService {
    private static ?GoogleCalendarService $instance = null;
    private string $keyPath;
    private ?array $keyData = null;
    private ?string $accessToken = null;
    private int $tokenExpiresAt = 0;

    public static function getInstance(?string $customKeyPath = null): GoogleCalendarService {
        if (self::$instance === null) {
            self::$instance = new self($customKeyPath);
        }
        return self::$instance;
    }

    private function __construct(?string $customKeyPath = null) {
        // Стандартний шлях до ключа або шлях із налаштувань
        $this->keyPath = $customKeyPath 
            ?: (CRM_DB::getInstance()->getState()['salon']['googleKeyPath'] ?? '/opt/Keys/servis-calendar-sync-514520-60482c5cddc7.json');

        if (file_exists($this->keyPath) && is_readable($this->keyPath)) {
            $raw = @file_get_contents($this->keyPath);
            $parsed = json_decode($raw, true);
            if ($parsed && isset($parsed['client_email'], $parsed['private_key'])) {
                $this->keyData = $parsed;
            }
        }
    }

    public function isConfigured(): bool {
        return $this->keyData !== null;
    }

    public function getKeyPath(): string {
        return $this->keyPath;
    }

    public function getServiceAccountEmail(): ?string {
        return $this->keyData['client_email'] ?? null;
    }

    /**
     * Отримання OAuth2 Access Token за допомогою підписаного JWT (RFC 7523)
     */
    public function getAccessToken(): ?string {
        if (!$this->isConfigured()) {
            return null;
        }

        // Повертаємо кешований токен, якщо він ще дійсний
        if ($this->accessToken && time() < ($this->tokenExpiresAt - 60)) {
            return $this->accessToken;
        }

        $now = time();
        $header = ['alg' => 'RS256', 'typ' => 'JWT'];
        $claims = [
            'iss' => $this->keyData['client_email'],
            'scope' => 'https://www.googleapis.com/auth/calendar',
            'aud' => 'https://oauth2.googleapis.com/token',
            'exp' => $now + 3600,
            'iat' => $now
        ];

        $b64Header = $this->base64UrlEncode(json_encode($header));
        $b64Claims = $this->base64UrlEncode(json_encode($claims));
        $toSign = $b64Header . '.' . $b64Claims;

        $binarySignature = '';
        $privateKey = $this->keyData['private_key'];
        $success = openssl_sign($toSign, $binarySignature, $privateKey, OPENSSL_ALGO_SHA256);
        if (!$success) {
            error_log("Google Calendar: Помилка підпису JWT через openssl_sign");
            return null;
        }

        $jwt = $toSign . '.' . $this->base64UrlEncode($binarySignature);

        // Запит токена до Google OAuth2
        $ch = curl_init('https://oauth2.googleapis.com/token');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion' => $jwt
        ]));
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);

        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code === 200 && $res) {
            $data = json_decode($res, true);
            if (!empty($data['access_token'])) {
                $this->accessToken = $data['access_token'];
                $this->tokenExpiresAt = $now + (int)($data['expires_in'] ?? 3600);
                return $this->accessToken;
            }
        }

        error_log("Google Calendar: Не вдалося отримати access token. Код: $code, Відповідь: $res");
        return null;
    }

    /**
     * Створити подію в Google Calendar
     */
    public function createEvent(string $calendarId, array $app, string $masterName, string $servicesText): ?string {
        $token = $this->getAccessToken();
        if (!$token) return null;

        $body = $this->formatEventPayload($app, $masterName, $servicesText);

        $url = "https://www.googleapis.com/calendar/v3/calendars/" . urlencode($calendarId) . "/events";
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Authorization: Bearer {$token}",
            "Content-Type: application/json"
        ]);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);

        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code === 200 && $res) {
            $data = json_decode($res, true);
            return $data['id'] ?? null;
        }

        error_log("Google Calendar: Помилка створення події ($code): $res");
        return null;
    }

    /**
     * Оновити подію в Google Calendar (перенесення часу, зміна послуги)
     */
    public function updateEvent(string $calendarId, string $eventId, array $app, string $masterName, string $servicesText): bool {
        $token = $this->getAccessToken();
        if (!$token) return false;

        $body = $this->formatEventPayload($app, $masterName, $servicesText);

        $url = "https://www.googleapis.com/calendar/v3/calendars/" . urlencode($calendarId) . "/events/" . urlencode($eventId);
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Authorization: Bearer {$token}",
            "Content-Type: application/json"
        ]);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);

        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return $code === 200;
    }

    /**
     * Видалити подію з Google Calendar (при скасуванні запису)
     */
    public function deleteEvent(string $calendarId, string $eventId): bool {
        $token = $this->getAccessToken();
        if (!$token) return false;

        $url = "https://www.googleapis.com/calendar/v3/calendars/" . urlencode($calendarId) . "/events/" . urlencode($eventId);
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE');
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Authorization: Bearer {$token}"
        ]);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);

        $res = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return ($code === 204 || $code === 200 || $code === 404);
    }

    /**
     * Повна синхронізація запису (створення, оновлення або видалення)
     */
    public function syncAppointment(array $app, array $fullState): ?string {
        if (!$this->isConfigured()) return null;

        $masterId = $app['masterId'] ?? ($app['master_id'] ?? '');
        $master = null;
        foreach ($fullState['masters'] as $m) {
            if ($m['id'] === $masterId) {
                $master = $m;
                break;
            }
        }

        // Визначаємо ID календаря: або персональний для майстра, або загальний для салону
        $calendarId = !empty($master['googleCalendarId']) 
            ? trim($master['googleCalendarId']) 
            : trim($fullState['salon']['googleCalendarId'] ?? '');

        if (empty($calendarId)) {
            return null; // Календар не підключено для цього майстра/салону
        }

        $masterName = $master['name'] ?? 'Майстер';
        $servicesMap = [];
        foreach ($fullState['services'] as $s) {
            $servicesMap[$s['id']] = $s['title'];
        }

        $srvIds = $app['serviceIds'] ?? (is_string($app['service_ids'] ?? null) ? json_decode($app['service_ids'], true) : []);
        $srvTitles = [];
        if (!empty($srvIds)) {
            foreach ($srvIds as $sid) {
                if (isset($servicesMap[$sid])) $srvTitles[] = $servicesMap[$sid];
            }
        }
        $servicesText = !empty($srvTitles) ? implode(', ', $srvTitles) : 'Послуга салону';

        $eventId = $app['googleEventId'] ?? ($app['google_event_id'] ?? null);
        $status = $app['status'] ?? 'confirmed';

        // Якщо запис скасовано:
        if ($status === 'cancelled') {
            if ($eventId) {
                $this->deleteEvent($calendarId, $eventId);
            }
            return null;
        }

        // Якщо подія вже є в Google Календарі — оновлюємо
        if (!empty($eventId)) {
            $updated = $this->updateEvent($calendarId, $eventId, $app, $masterName, $servicesText);
            if ($updated) return $eventId;
        }

        // Якщо події ще немає — створюємо нову
        return $this->createEvent($calendarId, $app, $masterName, $servicesText);
    }

    /**
     * Тестування підключення до Google Calendar
     */
    public function testConnection(?string $testCalendarId = null): array {
        if (!file_exists($this->keyPath)) {
            return [
                'ok' => false,
                'error' => "Файл ключа сервісного аккаунту не знайдено за шляхом: {$this->keyPath}",
                'help' => "Перевірте наявність файлу та правильність шляху в налаштуваннях"
            ];
        }

        if (!is_readable($this->keyPath)) {
            return [
                'ok' => false,
                'error' => "Файл ключа знайдено, але веб-сервер (www-data) не має прав на його читання",
                'help' => "Виконайте команду: sudo chmod 644 {$this->keyPath}"
            ];
        }

        if (!$this->isConfigured()) {
            return [
                'ok' => false,
                'error' => "Некоректний формат JSON-файлу ключа (відсутні client_email або private_key)",
                'help' => "Перевірте вміст JSON-файлу сервісного аккаунту"
            ];
        }

        $token = $this->getAccessToken();
        if (!$token) {
            return [
                'ok' => false,
                'error' => "Не вдалося отримати токен доступу від Google OAuth2. Перевірте валідність ключа та системний час сервера.",
                'service_account' => $this->keyData['client_email']
            ];
        }

        // Якщо вказано конкретний календар, тестуємо доступ до нього
        $calendarCheck = null;
        if (!empty($testCalendarId)) {
            $url = "https://www.googleapis.com/calendar/v3/calendars/" . urlencode($testCalendarId);
            $ch = curl_init($url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Bearer {$token}"]);
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);
            $res = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($code === 200) {
                $calData = json_decode($res, true);
                $calendarCheck = [
                    'access' => 'granted',
                    'calendar_summary' => $calData['summary'] ?? $testCalendarId,
                    'timeZone' => $calData['timeZone'] ?? 'Europe/Kyiv'
                ];
            } else {
                $calendarCheck = [
                    'access' => 'denied',
                    'http_code' => $code,
                    'error' => "Календар '{$testCalendarId}' не знайдено або сервісному аккаунту не надано доступ.",
                    'fix_instruction' => "Відкрийте цей календар у Google Календарі -> Налаштування -> Доступ для окремих користувачів -> Додати '{$this->keyData['client_email']}' з правами 'Внесення змін до подій'."
                ];
            }
        }

        return [
            'ok' => true,
            'key_path' => $this->keyPath,
            'service_account_email' => $this->keyData['client_email'],
            'project_id' => $this->keyData['project_id'] ?? '',
            'token_received' => true,
            'calendar_test' => $calendarCheck
        ];
    }

    private function formatEventPayload(array $app, string $masterName, string $servicesText): array {
        $cName = $app['clientName'] ?? ($app['client_name'] ?? 'Клієнт');
        $cPhone = $app['clientPhone'] ?? ($app['client_phone'] ?? '');
        $date = $app['date'] ?? date('Y-m-d');
        $time = $app['time'] ?? '10:00';
        $duration = (int)($app['duration'] ?? 60);
        $price = $app['price'] ?? 0;
        $notes = $app['notes'] ?? '';

        $startParts = explode(':', $time);
        $startH = (int)($startParts[0] ?? 10);
        $startM = (int)($startParts[1] ?? 0);

        $endMinutes = ($startH * 60) + $startM + $duration;
        $endH = str_pad((string)floor($endMinutes / 60), 2, '0', STR_PAD_LEFT);
        $endM = str_pad((string)($endMinutes % 60), 2, '0', STR_PAD_LEFT);

        $startIso = sprintf("%sT%02d:%02d:00+02:00", $date, $startH, $startM);
        $endIso = sprintf("%sT%s:%s:00+02:00", $date, $endH, $endM);

        $desc = "Клієнт: {$cName}\n" .
                "Телефон: {$cPhone}\n" .
                "Майстер: {$masterName}\n" .
                "Послуги: {$servicesText}\n" .
                "Вартість: {$price} ₴\n" .
                (!empty($notes) ? "Нотатка: {$notes}\n" : "") .
                "\n(Створено автоматично Beauty Studio CRM)";

        return [
            'summary' => "{$cName} — {$servicesText} ({$masterName})",
            'description' => $desc,
            'start' => [
                'dateTime' => $startIso,
                'timeZone' => 'Europe/Kyiv'
            ],
            'end' => [
                'dateTime' => $endIso,
                'timeZone' => 'Europe/Kyiv'
            ],
            'colorId' => '11' // Червоний/Кораловий відтінок для зручної візуалізації
        ];
    }

    private function base64UrlEncode(string $data): string {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
