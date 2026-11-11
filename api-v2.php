<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) {
    mkdir($dataDir, 0777, true);
}

$dbFile = $dataDir . '/database.json';

// Читання загальної бази салону
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (file_exists($dbFile)) {
        echo file_get_contents($dbFile);
    } else {
        echo json_encode(["status" => "empty"]);
    }
    exit;
}

// Збереження змін (послуги, налаштування, записи) + відправка сповіщень у Telegram
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
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

        file_put_contents($dbFile, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        echo json_encode(["ok" => true]);
    } else {
        http_response_code(400);
        echo json_encode(["ok" => false, "error" => "Невірний формат JSON"]);
    }
    exit;
}
