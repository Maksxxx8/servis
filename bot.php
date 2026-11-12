<?php
/**
 * bot.php — Telegram Бот для Beauty Studio CRM
 *
 * Можливості:
 * 1. Webhook для Telegram: миттєва відповідь на команди адміністратора та майстрів.
 * 2. Команди:
 *    - /start: привітання, відображення Chat ID користувача, меню кнопок.
 *    - /today (або кнопка "📅 Записи на сьогодні"): список усіх записів на сьогодні з цінами та статусами.
 *    - /tomorrow (або кнопка "🗓 Записи на завтра"): розклад на завтра.
 *    - /stats (або кнопка "📊 Статистика"): виручка та кількість записів за поточний місяць.
 *    - /find <телефон>: пошук історії клієнта за номером.
 * 3. Налаштування вебхука в 1 клік: bot.php?action=set_webhook
 * 4. Тест відправки: bot.php?action=test_send&chat_id=123456
 */

require_once __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');

$db = CRM_DB::getInstance();
$state = $db->getState();
$botToken = $state['salon']['tgBotToken'] ?? '';

// =================== 1. АДМІНІСТРАТИВНІ GET-ДІЇ (Тест та Налаштування) ===================

// Встановлення Webhook у Telegram: bot.php?action=set_webhook
if (isset($_GET['action']) && $_GET['action'] === 'set_webhook') {
    if (empty($botToken)) {
        echo json_encode(['ok' => false, 'error' => 'Токен бота не вказано в налаштуваннях CRM (Налаштування -> Telegram Bot Token)']);
        exit;
    }

    $protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? "https://" : "http://";
    $host = $_SERVER['HTTP_HOST'];
    $uri = dirname($_SERVER['SCRIPT_NAME']);
    $webhookUrl = rtrim($protocol . $host . $uri, '/') . '/bot.php';

    $res = @file_get_contents("https://api.telegram.org/bot{$botToken}/setWebhook?url=" . urlencode($webhookUrl));
    echo $res ?: json_encode(['ok' => false, 'error' => 'Не вдалося підключитися до api.telegram.org']);
    exit;
}

// Тестова відправка: bot.php?action=test_send&chat_id=...
if (isset($_GET['action']) && $_GET['action'] === 'test_send') {
    $chatId = $_GET['chat_id'] ?? ($state['salon']['tgChatId'] ?? '');
    if (empty($botToken) || empty($chatId)) {
        echo json_encode(['ok' => false, 'error' => 'Не вказано botToken або chat_id']);
        exit;
    }
    $success = CRM_DB::sendTelegram(
        $botToken,
        $chatId,
        "✅ <b>Тестове сповіщення від Beauty Studio CRM!</b>\n\nБот успішно налаштований та готовий надсилати сповіщення про записи!"
    );
    echo json_encode(['ok' => $success]);
    exit;
}

// Записи на сьогодні через HTTP GET: bot.php?action=today
if (isset($_GET['action']) && $_GET['action'] === 'today') {
    $date = $_GET['date'] ?? date('Y-m-d');
    $masterId = $_GET['master'] ?? null;
    $summary = $db->getScheduleSummaryForDate($date, $masterId);
    echo json_encode(['ok' => true, 'date' => $date, 'summary' => $summary], JSON_UNESCAPED_UNICODE);
    exit;
}

// =================== 2. TELEGRAM WEBHOOK (ОБРОБКА ВХІДНИХ ПОВІДОМЛЕНЬ) ===================

$rawInput = file_get_contents('php://input');
$update = json_decode($rawInput, true);

if (!$update || !isset($update['message'])) {
    echo json_encode([
        'status' => 'bot_ready',
        'info' => 'Telegram Bot Webhook endpoint. Надсилайте запити від Telegram Bot API або використовуйте ?action=today'
    ]);
    exit;
}

$message = $update['message'];
$chatId = (string)($message['chat']['id'] ?? '');
$text = trim($message['text'] ?? '');
$userName = $message['from']['first_name'] ?? 'Користувач';

// Клавіатура швидких кнопок
$mainKeyboard = [
    'keyboard' => [
        [['text' => '📅 Записи на сьогодні'], ['text' => '🗓 Записи на завтра']],
        [['text' => '📊 Статистика за місяць'], ['text' => 'ℹ️ Мій Chat ID']]
    ],
    'resize_keyboard' => true,
    'persistent' => true
];

// 1. Команда /start або /help
if ($text === '/start' || $text === '/help') {
    $welcome = "👋 Вітаємо, <b>{$userName}</b>!\n\n" .
        "Це бот системи керування записами <b>{$state['salon']['name']}</b>.\n\n" .
        "🔑 <b>Ваш Telegram Chat ID:</b> <code>{$chatId}</code>\n" .
        "<i>(Скопіюйте цей ID та вставте його у профіль майстра в CRM, щоб отримувати сповіщення про нові записи)</i>\n\n" .
        "Оберіть дію на клавіатурі нижче або введіть команду:\n" .
        "• /today — Записи на сьогодні\n" .
        "• /tomorrow — Записи на завтра\n" .
        "• /stats — Виручка та статистика за місяць\n" .
        "• /find 0671112233 — Пошук записів клієнта за номером";

    CRM_DB::sendTelegram($botToken, $chatId, $welcome, $mainKeyboard);
    echo json_encode(['ok' => true]);
    exit;
}

// 2. Chat ID
if ($text === 'ℹ️ Мій Chat ID' || $text === '/id') {
    $reply = "🔑 <b>Ваш Chat ID:</b> <code>{$chatId}</code>\n" .
        "Вкажіть його у полі 'Telegram Chat ID' у налаштуваннях CRM для отримання сповіщень.";
    CRM_DB::sendTelegram($botToken, $chatId, $reply, $mainKeyboard);
    echo json_encode(['ok' => true]);
    exit;
}

// 3. Записи на сьогодні
if ($text === '📅 Записи на сьогодні' || $text === '/today') {
    $today = date('Y-m-d');
    $summary = $db->getScheduleSummaryForDate($today);
    CRM_DB::sendTelegram($botToken, $chatId, $summary, $mainKeyboard);
    echo json_encode(['ok' => true]);
    exit;
}

// 4. Записи на завтра
if ($text === '🗓 Записи на завтра' || $text === '/tomorrow') {
    $tomorrow = date('Y-m-d', strtotime('+1 day'));
    $summary = $db->getScheduleSummaryForDate($tomorrow);
    CRM_DB::sendTelegram($botToken, $chatId, $summary, $mainKeyboard);
    echo json_encode(['ok' => true]);
    exit;
}

// 5. Статистика за поточний місяць
if ($text === '📊 Статистика за місяць' || $text === '/stats') {
    $currentMonth = date('Y-m');
    $monthName = [
        '01' => 'Січень', '02' => 'Лютий', '03' => 'Березень', '04' => 'Квітень',
        '05' => 'Травень', '06' => 'Червень', '07' => 'Липень', '08' => 'Серпень',
        '09' => 'Вересень', '10' => 'Жовтень', '11' => 'Листопад', '12' => 'Грудень'
    ][date('m')] ?? 'Поточний місяць';

    $pdo = $db->getPdo();
    $stmt = $pdo->prepare("
        SELECT 
            COUNT(*) as total_apps,
            SUM(price) as total_revenue,
            COUNT(DISTINCT client_phone) as unique_clients
        FROM appointments
        WHERE date LIKE :monthPrefix AND status != 'cancelled'
    ");
    $stmt->execute([':monthPrefix' => $currentMonth . '%']);
    $stats = $stmt->fetch();

    $rev = number_format((float)($stats['total_revenue'] ?? 0), 0, '.', ' ');
    $appsCount = (int)($stats['total_apps'] ?? 0);
    $clientsCount = (int)($stats['unique_clients'] ?? 0);

    $msg = "📊 <b>Статистика салону за {$monthName} " . date('Y') . ":</b>\n\n" .
        "💰 Загальна виручка: <b>{$rev} ₴</b>\n" .
        "📋 Кількість записів: <b>{$appsCount}</b>\n" .
        "👥 Унікальних клієнтів: <b>{$clientsCount}</b>";

    CRM_DB::sendTelegram($botToken, $chatId, $msg, $mainKeyboard);
    echo json_encode(['ok' => true]);
    exit;
}

// 6. Пошук записів клієнта: /find <номер>
if (str_starts_with($text, '/find') || str_starts_with($text, '🔎')) {
    $parts = preg_split('/\s+/', $text);
    $query = $parts[1] ?? '';
    $cleanQuery = preg_replace('/[^\d]/', '', $query);

    if (empty($cleanQuery)) {
        CRM_DB::sendTelegram($botToken, $chatId, "⚠️ Вкажіть номер телефону для пошуку. Наприклад:\n<code>/find 0671112233</code>", $mainKeyboard);
        echo json_encode(['ok' => true]);
        exit;
    }

    $pdo = $db->getPdo();
    $stmt = $pdo->prepare("
        SELECT a.*, m.name as master_name
        FROM appointments a
        LEFT JOIN masters m ON a.master_id = m.id
        WHERE a.client_phone LIKE :phone
        ORDER BY a.date DESC, a.time DESC
        LIMIT 5
    ");
    $stmt->execute([':phone' => '%' . $cleanQuery . '%']);
    $found = $stmt->fetchAll();

    if (empty($found)) {
        CRM_DB::sendTelegram($botToken, $chatId, "🔍 Клієнта за номером <code>{$query}</code> не знайдено в базі.", $mainKeyboard);
    } else {
        $cName = $found[0]['client_name'];
        $cPhone = $found[0]['client_phone'];
        $reply = "🔍 <b>Історія візитів клієнта:</b> {$cName} ({$cPhone})\n\n";
        foreach ($found as $f) {
            $hDate = date('d.m.Y', strtotime($f['date']));
            $reply .= "• <b>{$hDate} о {$f['time']}</b> — {$f['master_name']} ({$f['price']} ₴) [{$f['status']}]\n";
            if (!empty($f['notes'])) {
                $reply .= "  <i>{$f['notes']}</i>\n";
            }
        }
        CRM_DB::sendTelegram($botToken, $chatId, $reply, $mainKeyboard);
    }
    echo json_encode(['ok' => true]);
    exit;
}

// Відповідь на будь-яке інше повідомлення
CRM_DB::sendTelegram(
    $botToken,
    $chatId,
    "Я зрозумів ваше повідомлення, але не знаю такої команди.\nСкористайтеся меню нижче або надішліть /today для перегляду розкладу на сьогодні.",
    $mainKeyboard
);

echo json_encode(['ok' => true]);
