<?php
/**
 * api-v2.php — Головний API-контролер Beauty Studio CRM
 * Працює на базі повноцінної реляційної SQL бази даних (SQLite / PDO) через db.php
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Cache-Control, Pragma, X-Admin-Token');
header('Cache-Control: no-cache, no-store, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if (session_status() === PHP_SESSION_NONE) {
    @session_start();
}

require_once __DIR__ . '/db.php';

try {
    $db = CRM_DB::getInstance();
} catch (Exception $e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => false,
        'error' => 'Помилка ініціалізації бази даних: ' . $e->getMessage(),
        'fix_command' => 'sudo mkdir -p ' . __DIR__ . '/data && sudo chown -R www-data:www-data ' . __DIR__ . '/data && sudo chmod -R 775 ' . __DIR__ . '/data'
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

$dataDir = __DIR__ . '/data';

/**
 * Отримати токен адміністратора із заголовків, сесії або query-параметра
 */
function getClientAdminToken(): string {
    if (!empty($_SERVER['HTTP_X_ADMIN_TOKEN'])) {
        return trim($_SERVER['HTTP_X_ADMIN_TOKEN']);
    }
    if (!empty($_SESSION['salon_admin_token'])) {
        return trim($_SESSION['salon_admin_token']);
    }
    if (!empty($_GET['admin_token'])) {
        return trim($_GET['admin_token']);
    }
    return '';
}

/**
 * Перевірка прав адміністратора.
 * Якщо $exitOnFail === true, відправляє 401 Unauthorized та завершує виконання.
 */
function checkAdminAuth(CRM_DB $db, bool $exitOnFail = true): bool {
    $token = getClientAdminToken();
    $isValid = $db->verifyAdminToken($token);
    if (!$isValid && $exitOnFail) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'ok' => false,
            'error' => 'Доступ заборонено: потрібна авторизація адміністратора (PIN-код).'
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
    return $isValid;
}

// =================== АВТОРИЗАЦІЯ АДМІНІСТРАТОРА (PIN / TOKEN / SESSION) ===================

// Вхід за PIN-кодом: POST api-v2.php?action=login
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_GET['action']) && $_GET['action'] === 'login') {
    header('Content-Type: application/json; charset=utf-8');
    
    $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? ($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1');
    $ip = trim(explode(',', $ip)[0]);

    if ($db->isRateLimited($ip)) {
        http_response_code(429);
        echo json_encode([
            'ok' => false,
            'error' => 'Забагато невдалих спроб введення PIN-коду. Доступ тимчасово заблоковано на 5 хвилин для захисту від підбору.'
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true) ?: [];
    $pin = trim($body['pin'] ?? '');

    if (empty($pin) || !$db->verifyAdminPin($pin)) {
        $db->recordFailedLogin($ip);
        http_response_code(401);
        echo json_encode([
            'ok' => false,
            'error' => 'Невірний PIN-код! Перевірте правильність коду.'
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $db->clearFailedLogins($ip);
    $token = $db->createAdminSession();
    $_SESSION['salon_admin_token'] = $token;

    echo json_encode([
        'ok' => true,
        'token' => $token,
        'message' => 'Авторизація успішна'
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Вихід: POST api-v2.php?action=logout
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_GET['action']) && $_GET['action'] === 'logout') {
    header('Content-Type: application/json; charset=utf-8');
    $token = getClientAdminToken();
    if (!empty($token)) {
        $db->deleteAdminSession($token);
    }
    unset($_SESSION['salon_admin_token']);
    echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
    exit;
}

// Перевірка стану авторизації: GET api-v2.php?action=check_auth
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'check_auth') {
    header('Content-Type: application/json; charset=utf-8');
    $isAuth = checkAdminAuth($db, false);
    echo json_encode(['ok' => true, 'is_admin' => $isAuth], JSON_UNESCAPED_UNICODE);
    exit;
}

// =================== 0. ДІАГНОСТИКА СЕРВЕРА ТА БАЗИ ДАНИХ ===================
// Доступ: api-v2.php?action=diagnostic (вимагає прав адміна)
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'diagnostic') {
    checkAdminAuth($db, true);
    header('Content-Type: application/json; charset=utf-8');
    $phpUser = function_exists('posix_getpwuid') && function_exists('posix_geteuid') 
        ? posix_getpwuid(posix_geteuid())['name'] 
        : 'www-data';

    $dirWritable = is_dir($dataDir) && is_writable($dataDir);
    $parentWritable = is_writable(__DIR__);
    $dbDiag = $db->getDiagnostic();

    // Діагностика Google Calendar
    $gcalDiag = null;
    if (file_exists(__DIR__ . '/google-calendar.php')) {
        require_once __DIR__ . '/google-calendar.php';
        $gCal = GoogleCalendarService::getInstance();
        $gcalDiag = [
            'configured' => $gCal->isConfigured(),
            'key_path' => $gCal->getKeyPath(),
            'key_exists' => file_exists($gCal->getKeyPath()),
            'key_readable' => is_readable($gCal->getKeyPath()),
            'service_account_email' => $gCal->getServiceAccountEmail()
        ];
    }

    echo json_encode([
        "status" => $dirWritable ? "ok" : "permission_error",
        "database" => $dbDiag,
        "google_calendar" => $gcalDiag,
        "php_user" => $phpUser,
        "base_dir" => __DIR__,
        "base_dir_writable" => $parentWritable,
        "data_dir_exists" => is_dir($dataDir),
        "data_dir_writable" => $dirWritable,
        "fix_command" => "sudo mkdir -p " . __DIR__ . "/data && sudo chown -R {$phpUser}:{$phpUser} " . __DIR__ . "/data && sudo chmod -R 777 " . __DIR__ . "/data"
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

// Тест Google Calendar: api-v2.php?action=test_google_calendar (вимагає прав адміна)
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'test_google_calendar') {
    checkAdminAuth($db, true);
    header('Content-Type: application/json; charset=utf-8');
    require_once __DIR__ . '/google-calendar.php';
    $customKey = $_GET['key_path'] ?? null;
    $testCal = $_GET['calendar_id'] ?? null;
    $gCal = GoogleCalendarService::getInstance($customKey);
    echo json_encode($gCal->testConnection($testCal), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

/**
 * Універсальна функція відправки email (SMTP або локальний mail())
 */
function sendStudioEmail(string $to, string $subject, string $htmlBody, array $smtpConfig = []): array {
    $host = trim($smtpConfig['host'] ?? ($smtpConfig['smtpHost'] ?? ''));
    $port = (int)($smtpConfig['port'] ?? ($smtpConfig['smtpPort'] ?? 465));
    $user = trim($smtpConfig['user'] ?? ($smtpConfig['smtpUser'] ?? ''));
    $pass = trim($smtpConfig['pass'] ?? ($smtpConfig['smtpPass'] ?? ''));
    $fromEmail = !empty($smtpConfig['from']) ? trim($smtpConfig['from']) : ($user ?: 'noreply@' . ($_SERVER['SERVER_NAME'] ?? 'beauty.studio'));
    $fromName = !empty($smtpConfig['from_name']) ? trim($smtpConfig['from_name']) : 'Beauty Studio';

    // 1. Якщо налаштовано SMTP — пряма відправка через сокет
    if (!empty($host) && !empty($user) && !empty($pass)) {
        try {
            $prefix = ($port == 465) ? 'ssl://' : '';
            $socket = @fsockopen($prefix . $host, $port, $errno, $errstr, 10);
            if (!$socket) {
                return ['ok' => false, 'method' => 'SMTP', 'error' => "Не вдалося з'єднатися з SMTP $host:$port ($errstr)"];
            }

            $read = function() use ($socket) {
                $res = '';
                while ($str = fgets($socket, 515)) {
                    $res .= $str;
                    if (substr($str, 3, 1) === ' ') break;
                }
                return $res;
            };
            $write = function($cmd) use ($socket) {
                fputs($socket, $cmd . "\r\n");
            };

            $read();
            $write("EHLO " . ($_SERVER['SERVER_NAME'] ?? 'localhost'));
            $read();

            if ($port == 587) {
                $write("STARTTLS");
                $read();
                stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
                $write("EHLO " . ($_SERVER['SERVER_NAME'] ?? 'localhost'));
                $read();
            }

            $write("AUTH LOGIN");
            $read();
            $write(base64_encode($user));
            $read();
            $write(base64_encode($pass));
            $authRes = $read();
            if (substr($authRes, 0, 3) !== '235') {
                fclose($socket);
                return ['ok' => false, 'method' => 'SMTP', 'error' => "Помилка авторизації SMTP: " . trim($authRes)];
            }

            $write("MAIL FROM: <$fromEmail>");
            $read();
            $write("RCPT TO: <$to>");
            $read();
            $write("DATA");
            $read();

            $headers = "MIME-Version: 1.0\r\n";
            $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
            $headers .= "From: =?UTF-8?B?" . base64_encode($fromName) . "?= <$fromEmail>\r\n";
            $headers .= "To: <$to>\r\n";
            $headers .= "Subject: =?UTF-8?B?" . base64_encode($subject) . "?=\r\n";
            $headers .= "Date: " . date('r') . "\r\n";

            $write($headers . "\r\n" . $htmlBody . "\r\n.");
            $dataRes = $read();
            $write("QUIT");
            fclose($socket);

            $ok = substr($dataRes, 0, 3) === '250';
            return ['ok' => $ok, 'method' => 'SMTP', 'response' => trim($dataRes)];
        } catch (Exception $e) {
            return ['ok' => false, 'method' => 'SMTP', 'error' => $e->getMessage()];
        }
    }

    // 2. Локальний агент сервера mail()
    $encodedSubject = "=?UTF-8?B?" . base64_encode($subject) . "?=";
    $headers = "MIME-Version: 1.0\r\n";
    $headers .= "Content-type: text/html; charset=utf-8\r\n";
    $headers .= "From: =?UTF-8?B?" . base64_encode($fromName) . "?= <$fromEmail>\r\n";

    $sent = @mail($to, $encodedSubject, $htmlBody, $headers);
    return [
        'ok' => (bool)$sent,
        'method' => 'mail()',
        'error' => $sent ? null : 'Функція mail() повернула false. Перевірте, чи встановлено поштовий агент (postfix).'
    ];
}

// Тест відправки пошти: api-v2.php?action=test_email&email=vash@email.com (вимагає прав адміна)
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'test_email') {
    checkAdminAuth($db, true);
    header('Content-Type: application/json; charset=utf-8');
    $to = trim($_GET['email'] ?? '');
    if (empty($to)) {
        echo json_encode([
            'ok' => false, 
            'error' => "Будь ласка, вкажіть email для тесту, наприклад: api-v2.php?action=test_email&email=your@gmail.com"
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    $subject = "Тестове повідомлення від Beauty Studio CRM";
    $body = "<div style='font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 12px;'>
        <h2 style='color: #4f46e5;'>Beauty Studio CRM</h2>
        <p>Це тестовий лист для перевірки поштового сервера вашої CRM.</p>
        <p><b>Час відправки:</b> " . date('Y-m-d H:i:s') . "</p>
        <p style='color: #16a34a; font-weight: bold;'>✅ Пошта працює коректно!</p>
    </div>";

    $fullState = $db->getState();
    $salonSettings = $fullState['salon'] ?? [];
    $res = sendStudioEmail($to, $subject, $body, $salonSettings);

    echo json_encode([
        'ok' => $res['ok'],
        'method' => $res['method'] ?? 'mail()',
        'target_email' => $to,
        'php_sendmail_path' => ini_get('sendmail_path'),
        'details' => $res,
        'recommendation' => $res['ok'] 
            ? 'Лист успішно відправлено! Перевірте Вхідні та папку Спам.' 
            : 'Помилка відправки. На сервері виконайте: sudo apt update && sudo apt install -y postfix mailutils'
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

// Верифікація запису клієнта через Email: api-v2.php?action=verify_booking&token=...
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'verify_booking') {
    $token = trim($_GET['token'] ?? '');
    if (empty($token)) {
        die("Помилка: недійсне або відсутнє посилання для підтвердження.");
    }

    $pdo = $db->getPdo();
    $stmt = $pdo->prepare("SELECT * FROM appointments WHERE verification_token = :token");
    $stmt->execute([':token' => $token]);
    $app = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$app) {
        die("Помилка: запис за цим посиланням не знайдено або термін його дії закінчився.");
    }

    // Оновлюємо статус запису на підтверджений
    $stmtUpdate = $pdo->prepare("UPDATE appointments SET is_verified = 1, status = 'confirmed' WHERE id = :id");
    $stmtUpdate->execute([':id' => $app['id']]);

    // Синхронізуємо з Google Calendar
    if (file_exists(__DIR__ . '/google-calendar.php')) {
        try {
            require_once __DIR__ . '/google-calendar.php';
            $gCal = GoogleCalendarService::getInstance();
            if ($gCal->isConfigured()) {
                $fullState = $db->getState();
                $updatedApp = null;
                foreach ($fullState['appointments'] as $fa) {
                    if ($fa['id'] === $app['id']) { $updatedApp = $fa; break; }
                }
                if ($updatedApp) {
                    $resGid = $gCal->syncAppointment($updatedApp, $fullState);
                    if ($resGid) {
                        $pdo->prepare("UPDATE appointments SET google_event_id = :gid WHERE id = :id")->execute([':gid' => $resGid, ':id' => $app['id']]);
                    }
                }
            }
        } catch (Exception $e) {}
    }

    // Сповіщення в Telegram майстру та салону
    $fullState = $db->getState();
    $tokenBot = $fullState['salon']['tgBotToken'] ?? '';
    if (!empty($tokenBot)) {
        $mName = 'Майстер';
        $chatId = $fullState['salon']['tgChatId'] ?? '';
        foreach ($fullState['masters'] as $m) {
            if ($m['id'] === $app['master_id']) {
                $mName = $m['name'];
                if (!empty($m['tg_chat_id'])) $chatId = $m['tg_chat_id'];
                break;
            }
        }
        $cName = htmlspecialchars($app['client_name']);
        $cPhone = htmlspecialchars($app['client_phone']);
        $cEmail = htmlspecialchars($app['client_email']);
        $date = $app['date'];
        $time = $app['time'];
        $msg = "✅ <b>Клієнт підтвердив запис через Email!</b>\nКлієнт: <b>{$cName}</b> ({$cPhone})\nEmail: {$cEmail}\nМайстер: <b>{$mName}</b>\nДата: <b>{$date} о {$time}</b>";
        CRM_DB::sendTelegram($tokenBot, (string)$chatId, $msg);
    }

    // Показуємо красиву сторінку підтвердження
    header('Content-Type: text/html; charset=utf-8');
    echo "<!DOCTYPE html>
    <html lang='uk'>
    <head>
        <meta charset='UTF-8'>
        <meta name='viewport' content='width=device-width, initial-scale=1.0'>
        <title>Запис підтверджено | Beauty Studio</title>
        <script src='https://cdn.tailwindcss.com'></script>
    </head>
    <body class='bg-slate-50 min-h-screen flex items-center justify-center p-4 font-sans text-slate-800'>
        <div class='bg-white max-w-md w-full rounded-3xl p-8 shadow-xl border border-slate-100 text-center space-y-4'>
            <div class='w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-4xl mx-auto'>✓</div>
            <h1 class='text-2xl font-bold text-slate-900'>Ваш запис підтверджено!</h1>
            <p class='text-sm text-slate-600'>Дякуємо, <b>" . htmlspecialchars($app['client_name']) . "</b>! Ваша пошта успішно верифікована, а візит заброньовано.</p>
            <div class='bg-slate-50 rounded-2xl p-4 text-xs space-y-1.5 text-left border border-slate-100'>
                <div>📅 <b>Дата:</b> {$app['date']} о {$app['time']}</div>
                <div>⏱️ <b>Тривалість:</b> {$app['duration']} хв</div>
                <div>💰 <b>Вартість:</b> {$app['price']} ₴</div>
            </div>
            <div class='pt-2'>
                <a href='./' class='inline-block w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition shadow-sm'>На головну</a>
            </div>
        </div>
    </body>
    </html>";
    exit;
}

// Примусова синхронізація всіх записів: api-v2.php?action=sync_all_google_calendar (вимагає прав адміна)
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'sync_all_google_calendar') {
    checkAdminAuth($db, true);
    header('Content-Type: application/json; charset=utf-8');
    require_once __DIR__ . '/google-calendar.php';
    $gCal = GoogleCalendarService::getInstance();
    echo json_encode($gCal->syncAllAppointments(), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

// =================== 1. iCal СИНХРОНІЗАЦІЯ (.ics СТРІМ) ===================
// Доступ: api-v2.php?action=ical&master=m1&key=key_m1_svitlana
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'ical') {
    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: inline; filename="schedule.ics"');
    header('Cache-Control: no-cache, no-store, must-revalidate');

    $masterId = $_GET['master'] ?? '';
    $key = $_GET['key'] ?? '';

    $fullState = $db->getState(true);
    $salonName = $fullState['salon']['name'] ?? 'Beauty Studio';
    $salonAddress = $fullState['salon']['address'] ?? '';

    $master = null;
    foreach ($fullState['masters'] as $m) {
        if ($m['id'] === $masterId) {
            $master = $m;
            break;
        }
    }

    // Перевірка секретного ical ключа майстра
    $expectedKey = $master ? ($master['icalKey'] ?? '') : '';
    if (empty($master) || empty($expectedKey) || !hash_equals((string)$expectedKey, (string)$key)) {
        http_response_code(403);
        echo "Access Denied: Invalid iCal key";
        exit;
    }

    $masterName = $master ? $master['name'] : 'Майстер';

    $lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Beauty Studio//Schedule Feed//UA',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:' . $salonName . ' - ' . $masterName,
        'X-WR-TIMEZONE:Europe/Kyiv'
    ];

    $servicesMap = [];
    foreach ($fullState['services'] as $s) {
        $servicesMap[$s['id']] = $s['title'];
    }

    foreach ($fullState['appointments'] as $app) {
        if ($app['masterId'] !== $masterId || ($app['status'] ?? '') === 'cancelled') {
            continue;
        }

        $date = str_replace('-', '', $app['date']);
        $timeParts = explode(':', $app['time']);
        $startH = str_pad($timeParts[0] ?? '10', 2, '0', STR_PAD_LEFT);
        $startM = str_pad($timeParts[1] ?? '00', 2, '0', STR_PAD_LEFT);
        $dtStart = $date . 'T' . $startH . $startM . '00';

        $totalMin = ((int)$startH * 60) + (int)$startM + ((int)($app['duration'] ?? 60));
        $endH = str_pad((string)floor($totalMin / 60), 2, '0', STR_PAD_LEFT);
        $endM = str_pad((string)($totalMin % 60), 2, '0', STR_PAD_LEFT);
        $dtEnd = $date . 'T' . $endH . $endM . '00';

        $srvTitles = [];
        if (!empty($app['serviceIds'])) {
            foreach ($app['serviceIds'] as $sid) {
                if (isset($servicesMap[$sid])) $srvTitles[] = $servicesMap[$sid];
            }
        }
        $srvText = !empty($srvTitles) ? implode(', ', $srvTitles) : 'Послуга';

        $summary = "Запис: " . ($app['clientName'] ?? 'Клієнт') . " (" . $srvText . ")";
        $desc = "Клієнт: " . ($app['clientName'] ?? '') . "\\n" .
                "Телефон: " . ($app['clientPhone'] ?? '') . "\\n" .
                "Послуги: " . $srvText . "\\n" .
                "Сума: " . ($app['price'] ?? 0) . " ₴\\n" .
                (!empty($app['notes']) ? "Нотатка: " . $app['notes'] : "");

        $uid = ($app['id'] ?? uniqid()) . '@beautystudio.local';

        $lines[] = 'BEGIN:VEVENT';
        $lines[] = 'UID:' . $uid;
        $lines[] = 'DTSTAMP:' . gmdate('Ymd\THis\Z');
        $lines[] = 'DTSTART:' . $dtStart;
        $lines[] = 'DTEND:' . $dtEnd;
        $lines[] = 'SUMMARY:' . $summary;
        $lines[] = 'DESCRIPTION:' . $desc;
        $lines[] = 'LOCATION:' . $salonAddress;
        $lines[] = 'STATUS:CONFIRMED';
        $lines[] = 'END:VEVENT';
    }

    $lines[] = 'END:VCALENDAR';
    echo implode("\r\n", $lines);
    exit;
}

// =================== 2. ЧИТАННЯ ДАНИХ (JSON) ===================
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    header('Content-Type: application/json; charset=utf-8');
    
    // Можливість отримати записи конкретного дня (вимагає авторизації адміна)
    if (isset($_GET['action']) && $_GET['action'] === 'appointments_by_date') {
        checkAdminAuth($db, true);
        $date = $_GET['date'] ?? date('Y-m-d');
        $masterId = $_GET['master'] ?? null;
        echo json_encode([
            'ok' => true,
            'date' => $date,
            'appointments' => $db->getAppointmentsForDate($date, $masterId)
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // Перевіряємо, чи запит від авторизованого адміністратора
    $isAdmin = checkAdminAuth($db, false);
    // Якщо не адмін — повертаються безпечні публічні дані без контактів клієнтів, паролів і токенів
    $state = $db->getState($isAdmin);
    echo json_encode($state, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

// =================== 3. ЗАХИЩЕНЕ ЗБЕРЕЖЕННЯ ДАНИХ ===================
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    $raw = file_get_contents('php://input');
    $reqData = json_decode($raw, true);

    if (!$reqData) {
        http_response_code(400);
        echo json_encode(["ok" => false, "error" => "Невірний формат JSON"]);
        exit;
    }

    // -------------------------------------------------------------
    // А. Публічний клієнтський онлайн-запис (action=client_booking)
    // -------------------------------------------------------------
    if (isset($_GET['action']) && $_GET['action'] === 'client_booking') {
        // Захист від спам-ботів (Honeypot)
        if (!empty($reqData['website'])) {
            echo json_encode(['ok' => true, 'bot_blocked' => true], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $b = $reqData['booking'] ?? [];
        $name = trim($b['clientName'] ?? '');
        $phone = trim($b['clientPhone'] ?? '');
        $email = trim($b['clientEmail'] ?? '');
        $masterId = trim($b['masterId'] ?? '');
        $date = trim($b['date'] ?? '');
        $time = trim($b['time'] ?? '');
        $duration = (int)($b['duration'] ?? 60);
        $buffer = (int)($b['bufferTime'] ?? 15);
        $price = (float)($b['price'] ?? 0);
        $serviceIds = is_array($b['serviceIds'] ?? null) ? $b['serviceIds'] : [];
        $notes = trim($b['notes'] ?? '');

        if (empty($name) || empty($phone) || empty($email) || empty($masterId) || empty($date) || empty($time)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => "Будь ласка, заповніть усі обов'язкові поля"], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Серверна валідація українського номера телефону
        $digits = preg_replace('/[^\d]/', '', $phone);
        if (str_starts_with($digits, '0') && strlen($digits) === 10) {
            $digits = '380' . substr($digits, 1);
        }
        if (!str_starts_with($digits, '380') || strlen($digits) !== 12) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Дозволені лише українські мобільні номери (+380...)'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $opCode = substr($digits, 3, 2);
        $validCodes = ['50', '63', '66', '67', '68', '73', '77', '91', '92', '93', '94', '95', '96', '97', '98', '99'];
        if (!in_array($opCode, $validCodes)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => "Код оператора ($opCode) не є дійсним мобільним кодом України."], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Серверна валідація Email
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Будь ласка, вкажіть коректну адресу електронної пошти'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        // Серверна перевірка накладання часу в SQLite
        $pdo = $db->getPdo();
        $newStartParts = explode(':', $time);
        $newStartMin = ((int)$newStartParts[0]) * 60 + ((int)($newStartParts[1] ?? 0));
        $newEndMin = $newStartMin + $duration;

        $stmtCheck = $pdo->prepare("SELECT id, time, duration FROM appointments WHERE master_id = :mid AND date = :dt AND status != 'cancelled'");
        $stmtCheck->execute([':mid' => $masterId, ':dt' => $date]);
        $existingApps = $stmtCheck->fetchAll(PDO::FETCH_ASSOC);

        foreach ($existingApps as $ea) {
            $eaParts = explode(':', $ea['time']);
            $eaStart = ((int)$eaParts[0]) * 60 + ((int)($eaParts[1] ?? 0));
            $eaEnd = $eaStart + (int)$ea['duration'];
            if (max($newStartMin, $eaStart) < min($newEndMin, $eaEnd)) {
                http_response_code(409);
                echo json_encode(['ok' => false, 'error' => 'Обраний час вже зайнятий або перетинається з іншим записом.'], JSON_UNESCAPED_UNICODE);
                exit;
            }
        }

        $appId = 'a' . round(microtime(true) * 1000);
        $vToken = bin2hex(random_bytes(16));
        $clientId = 'c_' . $digits;

        // Збереження клієнта
        $stmtClient = $pdo->prepare("
            INSERT OR REPLACE INTO clients (id, name, phone, email, notes, created_at, updated_at)
            VALUES (:id, :name, :phone, :email, :notes, 
                COALESCE((SELECT created_at FROM clients WHERE id = :id OR phone = :phone LIMIT 1), CURRENT_TIMESTAMP), 
                CURRENT_TIMESTAMP)
        ");
        $stmtClient->execute([
            ':id' => $clientId,
            ':name' => $name,
            ':phone' => $phone,
            ':email' => $email,
            ':notes' => ''
        ]);

        // Вставка запису
        $stmtApp = $pdo->prepare("
            INSERT INTO appointments 
            (id, master_id, client_id, client_name, client_phone, client_email, date, time, duration, buffer_time, price, status, service_ids, verification_token, is_verified, replaces_lunch, notes, created_at, updated_at)
            VALUES (:id, :master_id, :client_id, :client_name, :client_phone, :client_email, :date, :time, :duration, :buffer_time, :price, 'pending', :service_ids, :verification_token, 0, 0, :notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ");
        $stmtApp->execute([
            ':id' => $appId,
            ':master_id' => $masterId,
            ':client_id' => $clientId,
            ':client_name' => $name,
            ':client_phone' => $phone,
            ':client_email' => $email,
            ':date' => $date,
            ':time' => $time,
            ':duration' => $duration,
            ':buffer_time' => $buffer,
            ':price' => $price,
            ':service_ids' => json_encode($serviceIds, JSON_UNESCAPED_UNICODE),
            ':verification_token' => $vToken,
            ':notes' => $notes
        ]);

        // Відправка листа верифікації
        $fullState = $db->getState(true);
        $salonSettings = $fullState['salon'] ?? [];
        $master = null;
        foreach ($fullState['masters'] as $m) {
            if ($m['id'] === $masterId) { $master = $m; break; }
        }
        $masterName = $master ? $master['name'] : 'Майстер';

        $servicesNames = [];
        foreach ($fullState['services'] as $s) {
            if (in_array($s['id'], $serviceIds)) $servicesNames[] = $s['title'];
        }
        $servicesStr = implode(', ', $servicesNames) ?: 'Послуга салону';

        $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' || ($_SERVER['SERVER_PORT'] ?? 80) == 443) ? "https://" : "http://";
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $scriptPath = $_SERVER['SCRIPT_NAME'] ?? '/api-v2.php';
        $verifyUrl = "{$protocol}{$host}{$scriptPath}?action=verify_booking&token={$vToken}";

        $subject = "Підтвердження запису в Beauty Studio";
        $htmlBody = "
        <div style='font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;'>
            <h2 style='color: #4f46e5; margin-top: 0;'>Beauty Studio</h2>
            <p style='font-size: 15px;'>Вітаємо, <b>" . htmlspecialchars($name) . "</b>!</p>
            <p style='font-size: 14px;'>Ви створили онлайн-запис на візит:</p>
            <div style='background-color: #f8fafc; padding: 14px; border-radius: 12px; margin: 16px 0; font-size: 14px; border: 1px solid #f1f5f9;'>
                <p style='margin: 4px 0;'>👤 <b>Майстер:</b> " . htmlspecialchars($masterName) . "</p>
                <p style='margin: 4px 0;'>✨ <b>Послуга:</b> " . htmlspecialchars($servicesStr) . "</p>
                <p style='margin: 4px 0;'>📅 <b>Дата та час:</b> " . htmlspecialchars($date) . " о " . htmlspecialchars($time) . " (" . $duration . " хв)</p>
                <p style='margin: 4px 0;'>💰 <b>Сума:</b> " . htmlspecialchars((string)$price) . " ₴</p>
            </div>
            <p style='font-size: 14px;'>Для завершення та підтвердження запису, будь ласка, натисніть кнопку:</p>
            <div style='text-align: center; margin: 24px 0;'>
                <a href='{$verifyUrl}' style='background-color: #4f46e5; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 15px; display: inline-block;'>Підтвердити мій запис</a>
            </div>
            <p style='font-size: 12px; color: #64748b;'>Або скопіюйте посилання у браузер:<br><a href='{$verifyUrl}' style='color: #4f46e5;'>{$verifyUrl}</a></p>
        </div>";

        $mailRes = sendStudioEmail($email, $subject, $htmlBody, $salonSettings);

        // Telegram-сповіщення майстру та салону
        $botToken = $salonSettings['tgBotToken'] ?? '';
        if (!empty($botToken)) {
            $chatId = $master['tgChatId'] ?? ($salonSettings['tgChatId'] ?? '');
            $adminChatId = $salonSettings['tgChatId'] ?? '';
            $tgMessage = "🔔 <b>Новий онлайн-запис!</b>\nМайстер: <b>{$masterName}</b>\nПослуги: {$servicesStr}\nДата: <b>{$date} о {$time}</b> ({$duration} хв)\nКлієнт: {$name} ({$phone})\nEmail: {$email}\nСума: {$price} ₴\n⚠️ <i>Очікує підтвердження Email</i>";
            $targets = array_unique(array_filter([$chatId, $adminChatId]));
            foreach ($targets as $tid) {
                CRM_DB::sendTelegram($botToken, (string)$tid, $tgMessage);
            }
        }

        echo json_encode([
            'ok' => true,
            'appointment_id' => $appId,
            'verification' => [
                'token' => $vToken,
                'verify_url' => $verifyUrl,
                'email_sent' => (bool)$mailRes['ok']
            ]
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // -------------------------------------------------------------
    // Б. Загальне збереження стану адмінки (СТРОГО ВИМАГАЄ АВТОРИЗАЦІЇ)
    // -------------------------------------------------------------
    checkAdminAuth($db, true);
    $data = $reqData;

    if (!$data) {
        http_response_code(400);
        echo json_encode(["ok" => false, "error" => "Невірний формат JSON"]);
        exit;
    }

    try {
        // Обробка сповіщення у Telegram (якщо передано)
        if (isset($data['_notify_telegram'])) {
            $token = $data['salon']['tgBotToken'] ?? '';
            $chatId = $data['_notify_telegram']['chatId'] ?? ($data['salon']['tgChatId'] ?? '');
            $message = $data['_notify_telegram']['message'] ?? '';
            $appId = $data['_notify_telegram']['appointmentId'] ?? null;

            if (!empty($token) && !empty($message)) {
                // Відправляємо сповіщення майстру та адміністратору салону (без дублювання)
                $adminChatId = $data['salon']['tgChatId'] ?? '';
                $targets = array_unique(array_filter([$chatId, $adminChatId]));
                foreach ($targets as $targetChatId) {
                    CRM_DB::sendTelegram($token, (string)$targetChatId, $message);
                    $db->enqueueTelegram('new_booking', $appId, (string)$targetChatId, $message);
                }
            }
            unset($data['_notify_telegram']);
        }

        // 0. Відправка листа верифікації для клієнтського запису (якщо передано _send_verification_email)
        $verificationData = null;
        if (!empty($data['_send_verification_email'])) {
            $vEmail = trim($data['_send_verification_email']['email'] ?? '');
            $vAppId = trim($data['_send_verification_email']['appointmentId'] ?? '');
            $vClientName = trim($data['_send_verification_email']['clientName'] ?? 'Клієнт');
            $vMasterName = trim($data['_send_verification_email']['masterName'] ?? 'Майстер');
            $vServices = trim($data['_send_verification_email']['services'] ?? 'Послуга салону');
            $vDate = trim($data['_send_verification_email']['date'] ?? '');
            $vTime = trim($data['_send_verification_email']['time'] ?? '');

            if (!empty($vEmail) && !empty($vAppId)) {
                $vToken = bin2hex(random_bytes(16));
                
                // Встановлюємо токен для створеного запису
                if (!empty($data['appointments'])) {
                    foreach ($data['appointments'] as &$ap) {
                        if (($ap['id'] ?? '') === $vAppId) {
                            $ap['verificationToken'] = $vToken;
                            $ap['isVerified'] = 0;
                            break;
                        }
                    }
                    unset($ap);
                }

                $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' || ($_SERVER['SERVER_PORT'] ?? 80) == 443) ? "https://" : "http://";
                $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
                $scriptPath = $_SERVER['SCRIPT_NAME'] ?? '/api-v2.php';
                $verifyUrl = "{$protocol}{$host}{$scriptPath}?action=verify_booking&token={$vToken}";

                $subject = "Підтвердження запису в Beauty Studio";
                $htmlBody = "
                <div style='font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;'>
                    <h2 style='color: #4f46e5; margin-top: 0;'>Beauty Studio</h2>
                    <p style='font-size: 15px;'>Вітаємо, <b>" . htmlspecialchars($vClientName) . "</b>!</p>
                    <p style='font-size: 14px;'>Ви створили онлайн-запис на візит:</p>
                    <div style='background-color: #f8fafc; padding: 14px; border-radius: 12px; margin: 16px 0; font-size: 14px; border: 1px solid #f1f5f9;'>
                        <p style='margin: 4px 0;'>👤 <b>Майстер:</b> " . htmlspecialchars($vMasterName) . "</p>
                        <p style='margin: 4px 0;'>✨ <b>Послуга:</b> " . htmlspecialchars($vServices) . "</p>
                        <p style='margin: 4px 0;'>📅 <b>Дата та час:</b> " . htmlspecialchars($vDate) . " о " . htmlspecialchars($vTime) . "</p>
                    </div>
                    <p style='font-size: 14px;'>Для завершення та підтвердження запису, будь ласка, натисніть кнопку:</p>
                    <div style='text-align: center; margin: 24px 0;'>
                        <a href='{$verifyUrl}' style='background-color: #4f46e5; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 15px; display: inline-block;'>Підтвердити мій запис</a>
                    </div>
                    <p style='font-size: 12px; color: #64748b;'>Або скопіюйте посилання у браузер:<br><a href='{$verifyUrl}' style='color: #4f46e5;'>{$verifyUrl}</a></p>
                </div>";

                $salonSettings = $data['salon'] ?? [];
                $sendRes = sendStudioEmail($vEmail, $subject, $htmlBody, $salonSettings);
                $verificationData = [
                    'token' => $vToken,
                    'verify_url' => $verifyUrl,
                    'email_sent' => (bool)$sendRes['ok'],
                    'method' => $sendRes['method'] ?? 'mail()',
                    'error' => $sendRes['error'] ?? null
                ];
            }
            unset($data['_send_verification_email']);
        }

        // 1. Google Calendar: видаляємо з календаря записи, які видалені, скасовані або змінили майстра
        if (file_exists(__DIR__ . '/google-calendar.php')) {
            try {
                require_once __DIR__ . '/google-calendar.php';
                $gCal = GoogleCalendarService::getInstance();
                if ($gCal->isConfigured()) {
                    $fullState = $db->getState();
                    $existingApps = $fullState['appointments'] ?? [];

                    $incomingIds = [];
                    $incomingCancelled = [];
                    if (!empty($data['appointments'])) {
                        foreach ($data['appointments'] as $inApp) {
                            if (!empty($inApp['id'])) {
                                $incomingIds[] = $inApp['id'];
                                if (($inApp['status'] ?? '') === 'cancelled') {
                                    $incomingCancelled[] = $inApp['id'];
                                }
                            }
                        }
                    }

                    foreach ($existingApps as $oldApp) {
                        $eventId = $oldApp['googleEventId'] ?? null;
                        if (empty($eventId)) continue;

                        $isDeleted = !in_array($oldApp['id'], $incomingIds);
                        $isCancelled = in_array($oldApp['id'], $incomingCancelled);

                        // Перевіряємо, чи не змінився майстер у записі
                        $masterChanged = false;
                        if (!empty($data['appointments'])) {
                            foreach ($data['appointments'] as $inApp) {
                                if (($inApp['id'] ?? '') === $oldApp['id'] && !empty($inApp['masterId']) && $inApp['masterId'] !== $oldApp['masterId']) {
                                    $masterChanged = true;
                                    break;
                                }
                            }
                        }

                        if ($isDeleted || $isCancelled || $masterChanged) {
                            $mId = $oldApp['masterId'];
                            $calId = null;
                            foreach ($fullState['masters'] as $m) {
                                if ($m['id'] === $mId && !empty($m['googleCalendarId'])) {
                                    $calId = trim($m['googleCalendarId']);
                                    break;
                                }
                            }
                            if (empty($calId)) {
                                $calId = trim($fullState['salon']['googleCalendarId'] ?? '');
                            }
                            if (!empty($calId)) {
                                $gCal->deleteEvent($calId, $eventId);
                            }

                            // Якщо майстер змінився, скидаємо google_event_id у вхідних даних та базі,
                            // щоб подія коректно створилася в календарі нового майстра
                            if ($masterChanged) {
                                foreach ($data['appointments'] as &$inApp) {
                                    if (($inApp['id'] ?? '') === $oldApp['id']) {
                                        $inApp['googleEventId'] = null;
                                        $inApp['google_event_id'] = null;
                                    }
                                }
                                unset($inApp);
                                try {
                                    $db->getPdo()->prepare("UPDATE appointments SET google_event_id = NULL WHERE id = :id")->execute([':id' => $oldApp['id']]);
                                } catch (Exception $e) {}
                            }
                        }
                    }
                }
            } catch (Exception $ge) {
                error_log("Помилка видалення з Google Calendar: " . $ge->getMessage());
            }
        }

        // Зберігаємо стан в SQL базу даних (в рамках атомарної транзакції)
        $db->saveState($data);

        // 2. Google Calendar: створення нових та оновлення перенесених подій
        $googleEventIdsMap = [];
        if (file_exists(__DIR__ . '/google-calendar.php')) {
            try {
                require_once __DIR__ . '/google-calendar.php';
                $gCal = GoogleCalendarService::getInstance();
                if ($gCal->isConfigured()) {
                    // Беремо актуальний стан із SQLite, де google_event_id збережено та валідовано
                    $fullState = $db->getState();
                    if (!empty($fullState['appointments'])) {
                        foreach ($fullState['appointments'] as $app) {
                            if (($app['status'] ?? '') === 'cancelled') continue;

                            $resEventId = $gCal->syncAppointment($app, $fullState);
                            if ($resEventId) {
                                $googleEventIdsMap[$app['id']] = $resEventId;
                                if (empty($app['googleEventId']) || $app['googleEventId'] !== $resEventId) {
                                    $pdo = $db->getPdo();
                                    $stmtG = $pdo->prepare("UPDATE appointments SET google_event_id = :gid WHERE id = :id");
                                    $stmtG->execute([':gid' => $resEventId, ':id' => $app['id']]);
                                }
                            }
                        }
                    }
                }
            } catch (Exception $ge) {
                error_log("Помилка оновлення Google Calendar: " . $ge->getMessage());
            }
        }

        echo json_encode([
            "ok" => true,
            "engine" => "SQLite (PDO)",
            "google_event_ids" => $googleEventIdsMap,
            "verification" => $verificationData
        ], JSON_UNESCAPED_UNICODE);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode([
            "ok" => false,
            "error" => "Помилка збереження в базу даних SQLite: " . $e->getMessage()
        ], JSON_UNESCAPED_UNICODE);
    }
    exit;
}
