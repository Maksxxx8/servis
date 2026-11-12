<?php
/**
 * api-v2.php — Головний API-контролер Beauty Studio CRM
 * Працює на базі повноцінної реляційної SQL бази даних (SQLite / PDO) через db.php
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Cache-Control, Pragma');
header('Cache-Control: no-cache, no-store, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
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

// =================== 0. ДІАГНОСТИКА СЕРВЕРА ТА БАЗИ ДАНИХ ===================
// Доступ: api-v2.php?action=diagnostic
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'diagnostic') {
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

// Тест Google Calendar: api-v2.php?action=test_google_calendar
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'test_google_calendar') {
    header('Content-Type: application/json; charset=utf-8');
    require_once __DIR__ . '/google-calendar.php';
    $customKey = $_GET['key_path'] ?? null;
    $testCal = $_GET['calendar_id'] ?? null;
    $gCal = GoogleCalendarService::getInstance($customKey);
    echo json_encode($gCal->testConnection($testCal), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
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

    $fullState = $db->getState();
    $salonName = $fullState['salon']['name'] ?? 'Beauty Studio';
    $salonAddress = $fullState['salon']['address'] ?? '';

    $master = null;
    foreach ($fullState['masters'] as $m) {
        if ($m['id'] === $masterId) {
            $master = $m;
            break;
        }
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
    
    // Можливість отримати записи конкретного дня
    if (isset($_GET['action']) && $_GET['action'] === 'appointments_by_date') {
        $date = $_GET['date'] ?? date('Y-m-d');
        $masterId = $_GET['master'] ?? null;
        echo json_encode([
            'ok' => true,
            'date' => $date,
            'appointments' => $db->getAppointmentsForDate($date, $masterId)
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $state = $db->getState();
    echo json_encode($state, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

// =================== 3. ЗБЕРЕЖЕННЯ ДАНИХ ТА TELEGRAM-СПОСТІВЕЩЕННЯ ===================
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);

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

        // Зберігаємо стан в SQL базу даних (в рамках атомарної транзакції)
        $db->saveState($data);

        // Пряма фонова синхронізація з Google Calendar через Service Account (без затримок)
        if (file_exists(__DIR__ . '/google-calendar.php')) {
            try {
                require_once __DIR__ . '/google-calendar.php';
                $gCal = GoogleCalendarService::getInstance();
                if ($gCal->isConfigured() && !empty($data['appointments'])) {
                    $fullState = $db->getState();
                    foreach ($data['appointments'] as $app) {
                        $resEventId = $gCal->syncAppointment($app, $fullState);
                        if ($resEventId && empty($app['googleEventId'])) {
                            $pdo = $db->getPdo();
                            $stmtG = $pdo->prepare("UPDATE appointments SET google_event_id = :gid WHERE id = :id");
                            $stmtG->execute([':gid' => $resEventId, ':id' => $app['id']]);
                        }
                    }
                }
            } catch (Exception $ge) {
                error_log("Помилка Google Calendar sync: " . $ge->getMessage());
            }
        }

        echo json_encode(["ok" => true, "engine" => "SQLite (PDO)"]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode([
            "ok" => false,
            "error" => "Помилка збереження в базу даних SQLite: " . $e->getMessage()
        ], JSON_UNESCAPED_UNICODE);
    }
    exit;
}
