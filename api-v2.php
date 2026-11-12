<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Cache-Control, Pragma');
header('Cache-Control: no-cache, no-store, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) {
    mkdir($dataDir, 0777, true);
}

$dbFile = $dataDir . '/database.json';

// =================== 0. ДІАГНОСТИКА СЕРВЕРА ===================
// Доступ: api-v2.php?action=diagnostic
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'diagnostic') {
    header('Content-Type: application/json; charset=utf-8');
    $phpUser = function_exists('posix_getpwuid') && function_exists('posix_geteuid') 
        ? posix_getpwuid(posix_geteuid())['name'] 
        : 'www-data';

    $dirWritable = is_dir($dataDir) && is_writable($dataDir);
    $parentWritable = is_writable(__DIR__);
    $fileWritable = file_exists($dbFile) ? is_writable($dbFile) : $dirWritable;

    echo json_encode([
        "status" => ($dirWritable && $fileWritable) ? "ok" : "permission_error",
        "php_user" => $phpUser,
        "base_dir" => __DIR__,
        "base_dir_writable" => $parentWritable,
        "data_dir_exists" => is_dir($dataDir),
        "data_dir_writable" => $dirWritable,
        "db_file_exists" => file_exists($dbFile),
        "db_file_writable" => $fileWritable,
        "fix_command" => "sudo mkdir -p " . __DIR__ . "/data && sudo chown -R {$phpUser}:{$phpUser} " . __DIR__ . "/data && sudo chmod -R 777 " . __DIR__ . "/data"
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
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

    $db = file_exists($dbFile) ? json_decode(file_get_contents($dbFile), true) : null;
    $salonName = $db['salon']['name'] ?? 'Beauty Studio';
    $salonAddress = $db['salon']['address'] ?? '';

    $master = null;
    if ($db && !empty($db['masters'])) {
        foreach ($db['masters'] as $m) {
            if ($m['id'] === $masterId) {
                $master = $m;
                break;
            }
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

    if ($db && !empty($db['appointments'])) {
        $servicesMap = [];
        if (!empty($db['services'])) {
            foreach ($db['services'] as $s) {
                $servicesMap[$s['id']] = $s['title'];
            }
        }

        foreach ($db['appointments'] as $app) {
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
    }

    $lines[] = 'END:VCALENDAR';
    echo implode("\r\n", $lines);
    exit;
}

// =================== 2. ЧИТАННЯ ДАНИХ (JSON) ===================
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-cache, no-store, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
    if (file_exists($dbFile)) {
        echo file_get_contents($dbFile);
    } else {
        echo json_encode(["status" => "empty"]);
    }
    exit;
}

// =================== 3. ЗБЕРЕЖЕННЯ ДАНИХ ТА TELEGRAM ===================
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    
    if ($data) {
        // Перевірка на новий запис для сповіщення у Telegram
        if (isset($data['_notify_telegram']) && !empty($data['salon']['tgBotToken'])) {
            $token = $data['salon']['tgBotToken'];
            $chatId = $data['_notify_telegram']['chatId'] ?? ($data['salon']['tgChatId'] ?? '');
            $message = $data['_notify_telegram']['message'] ?? '';
            
            if (!empty($token) && !empty($chatId) && !empty($message)) {
                $tgUrl = "https://api.telegram.org/bot{$token}/sendMessage";
                $postFields = [
                    'chat_id' => $chatId,
                    'text' => $message,
                    'parse_mode' => 'HTML'
                ];
                $ch = curl_init($tgUrl);
                curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
                curl_setopt($ch, CURLOPT_POST, true);
                curl_setopt($ch, CURLOPT_POSTFIELDS, $postFields);
                curl_setopt($ch, CURLOPT_TIMEOUT, 5);
                @curl_exec($ch);
                @curl_close($ch);
            }
            unset($data['_notify_telegram']);
        }

        $written = @file_put_contents($dbFile, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        if ($written === false) {
            http_response_code(500);
            $err = error_get_last();
            echo json_encode([
                "ok" => false,
                "error" => "Не вдалося зберегти database.json на сервері. Перевірте права доступу до каталогу data/ (потрібно chown www-data:www-data data/ або chmod 777 data/)",
                "details" => $err ? $err['message'] : "file_put_contents failed"
            ]);
            exit;
        }
        echo json_encode(["ok" => true]);
    } else {
        http_response_code(400);
        echo json_encode(["ok" => false, "error" => "Невірний формат JSON"]);
    }
    exit;
}
