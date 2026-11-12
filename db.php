<?php
/**
 * db.php — Менеджер бази даних CRM салону з підтримкою SQLite (PDO) та автоматичним JSON-фолбеком
 *
 * Режими роботи:
 * 1. Режим SQLite (Основний): використовує PDO SQLite, транзакції (ACID), індекси, WAL-режим.
 * 2. Режим JSON Fallback (Резервний): якщо в Ubuntu не встановлено php-sqlite3, система
 *    автоматично перемикається на надійне файлове сховище database.json, щоб сайт ЗАВЖДИ
 *    залишався онлайн та працював стабільно!
 */

class CRM_DB {
    private static ?CRM_DB $instance = null;
    private ?PDO $pdo = null;
    private string $dataDir;
    private string $sqlitePath;
    private string $jsonPath;
    private bool $useSqlite = false;
    private string $engineStatus = '';

    public static function getInstance(): CRM_DB {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        $this->dataDir = __DIR__ . '/data';
        if (!is_dir($this->dataDir)) {
            @mkdir($this->dataDir, 0777, true);
        }

        $this->sqlitePath = $this->dataDir . '/salon.sqlite';
        $this->jsonPath = $this->dataDir . '/database.json';

        // Перевіряємо, чи доступний модуль pdo_sqlite в PHP на сервері
        if (extension_loaded('pdo') && extension_loaded('pdo_sqlite')) {
            try {
                $isNew = !file_exists($this->sqlitePath);
                $this->pdo = new PDO("sqlite:" . $this->sqlitePath);
                $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
                $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

                $this->pdo->exec("PRAGMA journal_mode = WAL;");
                $this->pdo->exec("PRAGMA synchronous = NORMAL;");
                $this->pdo->exec("PRAGMA foreign_keys = ON;");

                $this->initSqliteSchema();

                // Автоматична міграція існуючих даних з JSON при створенні SQLite
                if ($isNew || $this->isTablesEmpty()) {
                    $this->migrateFromJson();
                }

                $this->useSqlite = true;
                $this->engineStatus = 'SQLite (PDO) — Активна SQL база';
            } catch (Exception $e) {
                error_log("SQLite init failed, falling back to JSON: " . $e->getMessage());
                $this->useSqlite = false;
                $this->engineStatus = 'JSON Fallback (Помилка SQLite: ' . $e->getMessage() . ')';
            }
        } else {
            $this->useSqlite = false;
            $this->engineStatus = 'JSON Fallback (розширення php-sqlite3 не встановлено на сервері)';
        }
    }

    public function isSqlite(): bool {
        return $this->useSqlite;
    }

    public function getPdo(): ?PDO {
        return $this->pdo;
    }

    /**
     * Створення таблиць SQLite
     */
    private function initSqliteSchema(): void {
        if (!$this->pdo) return;
        $this->pdo->exec("
            CREATE TABLE IF NOT EXISTS salon_settings (
                key VARCHAR(64) PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS masters (
                id VARCHAR(32) PRIMARY KEY,
                name VARCHAR(128) NOT NULL,
                role VARCHAR(128) DEFAULT '',
                bio TEXT DEFAULT '',
                avatar VARCHAR(32) DEFAULT '✨',
                tg_chat_id VARCHAR(64) DEFAULT '',
                slot_step INT DEFAULT 30,
                global_buffer INT DEFAULT 15,
                ical_key VARCHAR(64) DEFAULT '',
                weekly_schedule TEXT,
                date_overrides TEXT,
                is_active INT DEFAULT 1,
                sort_order INT DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS services (
                id VARCHAR(32) PRIMARY KEY,
                master_id VARCHAR(32) NOT NULL,
                title VARCHAR(255) NOT NULL,
                duration INT NOT NULL,
                buffer_time INT DEFAULT 15,
                price REAL NOT NULL,
                is_active INT DEFAULT 1,
                sort_order INT DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_services_master ON services(master_id);

            CREATE TABLE IF NOT EXISTS clients (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(128) NOT NULL,
                phone VARCHAR(32) NOT NULL UNIQUE,
                notes TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);

            CREATE TABLE IF NOT EXISTS appointments (
                id VARCHAR(64) PRIMARY KEY,
                master_id VARCHAR(32) NOT NULL,
                client_id VARCHAR(64),
                client_name VARCHAR(128) NOT NULL,
                client_phone VARCHAR(32) NOT NULL,
                date VARCHAR(10) NOT NULL,
                time VARCHAR(5) NOT NULL,
                duration INT NOT NULL,
                buffer_time INT DEFAULT 15,
                price REAL NOT NULL,
                status VARCHAR(20) DEFAULT 'confirmed',
                service_ids TEXT,
                notes TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
            CREATE INDEX IF NOT EXISTS idx_appointments_master_date ON appointments(master_id, date);
            CREATE INDEX IF NOT EXISTS idx_appointments_phone ON appointments(client_phone);
            CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

            CREATE TABLE IF NOT EXISTS time_blocks (
                id VARCHAR(64) PRIMARY KEY,
                master_id VARCHAR(32) NOT NULL,
                date VARCHAR(10) NOT NULL,
                start_time VARCHAR(5) NOT NULL,
                end_time VARCHAR(5) NOT NULL,
                reason TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_timeblocks_master_date ON time_blocks(master_id, date);

            CREATE TABLE IF NOT EXISTS telegram_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type VARCHAR(32) NOT NULL,
                appointment_id VARCHAR(64),
                chat_id VARCHAR(64) NOT NULL,
                message TEXT NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                sent_at DATETIME
            );
            CREATE INDEX IF NOT EXISTS idx_tq_status ON telegram_queue(status);
        ");
    }

    private function isTablesEmpty(): bool {
        if (!$this->pdo) return true;
        $count = (int)$this->pdo->query("SELECT count(*) FROM masters")->fetchColumn();
        return $count === 0;
    }

    public function migrateFromJson(): bool {
        if (!file_exists($this->jsonPath)) return false;
        $raw = @file_get_contents($this->jsonPath);
        $data = json_decode($raw, true);
        if (!$data || !isset($data['salon'])) return false;
        return $this->saveState($data, true);
    }

    /**
     * Отримати стан CRM
     */
    public function getState(): array {
        if ($this->useSqlite && $this->pdo) {
            return $this->getSqliteState();
        }
        return $this->getJsonState();
    }

    private function getJsonState(): array {
        if (file_exists($this->jsonPath)) {
            $raw = @file_get_contents($this->jsonPath);
            $parsed = json_decode($raw, true);
            if ($parsed && isset($parsed['salon'])) {
                return $parsed;
            }
        }
        return $this->getDefaultState();
    }

    private function getSqliteState(): array {
        // 1. Салон
        $salonRows = $this->pdo->query("SELECT key, value FROM salon_settings")->fetchAll();
        $salon = $this->getDefaultState()['salon'];
        foreach ($salonRows as $r) {
            $k = $r['key'];
            $v = $r['value'];
            if (in_array($k, ['workStart', 'workEnd'])) {
                $salon[$k] = (int)$v;
            } else {
                $salon[$k] = $v;
            }
        }

        // 2. Майстри
        $masterRows = $this->pdo->query("SELECT * FROM masters WHERE is_active = 1 ORDER BY sort_order ASC, id ASC")->fetchAll();
        $masters = [];
        foreach ($masterRows as $m) {
            $masters[] = [
                'id' => $m['id'],
                'name' => $m['name'],
                'role' => $m['role'] ?? '',
                'bio' => $m['bio'] ?? '',
                'avatar' => $m['avatar'] ?? '✨',
                'tgChatId' => $m['tg_chat_id'] ?? '',
                'slotStep' => (int)($m['slot_step'] ?? 30),
                'globalBuffer' => (int)($m['global_buffer'] ?? 15),
                'icalKey' => $m['ical_key'] ?? ('key_' . $m['id']),
                'weeklySchedule' => !empty($m['weekly_schedule']) ? json_decode($m['weekly_schedule'], true) : new stdClass(),
                'dateOverrides' => !empty($m['date_overrides']) ? json_decode($m['date_overrides'], true) : new stdClass()
            ];
        }

        // 3. Послуги
        $serviceRows = $this->pdo->query("SELECT * FROM services WHERE is_active = 1 ORDER BY sort_order ASC, id ASC")->fetchAll();
        $services = [];
        foreach ($serviceRows as $s) {
            $services[] = [
                'id' => $s['id'],
                'masterId' => $s['master_id'],
                'title' => $s['title'],
                'duration' => (int)$s['duration'],
                'bufferTime' => (int)$s['buffer_time'],
                'price' => (float)$s['price']
            ];
        }

        // 4. Записи (Appointments)
        $appRows = $this->pdo->query("SELECT * FROM appointments ORDER BY date ASC, time ASC")->fetchAll();
        $appointments = [];
        foreach ($appRows as $a) {
            $appointments[] = [
                'id' => $a['id'],
                'masterId' => $a['master_id'],
                'serviceIds' => !empty($a['service_ids']) ? json_decode($a['service_ids'], true) : [],
                'date' => $a['date'],
                'time' => $a['time'],
                'duration' => (int)$a['duration'],
                'bufferTime' => (int)$a['buffer_time'],
                'price' => (float)$a['price'],
                'clientName' => $a['client_name'],
                'clientPhone' => $a['client_phone'],
                'status' => $a['status'] ?? 'confirmed',
                'notes' => $a['notes'] ?? ''
            ];
        }

        // 5. Технічні перерви
        $tbRows = $this->pdo->query("SELECT * FROM time_blocks ORDER BY date ASC, start_time ASC")->fetchAll();
        $timeBlocks = [];
        foreach ($tbRows as $tb) {
            $timeBlocks[] = [
                'id' => $tb['id'],
                'masterId' => $tb['master_id'],
                'date' => $tb['date'],
                'startTime' => $tb['start_time'],
                'endTime' => $tb['end_time'],
                'reason' => $tb['reason'] ?? ''
            ];
        }

        return [
            'salon' => $salon,
            'masters' => $masters,
            'services' => $services,
            'appointments' => $appointments,
            'timeBlocks' => $timeBlocks
        ];
    }

    /**
     * Зберегти стан CRM (в SQLite та дублювати в JSON для надійності)
     */
    public function saveState(array $data, bool $isMigration = false): bool {
        // Завжди зберігаємо резервну копію в JSON
        $writtenJson = @file_put_contents($this->jsonPath, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

        if (!$this->useSqlite || !$this->pdo) {
            if ($writtenJson === false) {
                throw new Exception("Не вдалося зберегти дані в {$this->jsonPath}. Перевірте права www-data.");
            }
            return true;
        }

        $this->pdo->beginTransaction();
        try {
            // 1. Салонні налаштування
            if (isset($data['salon']) && is_array($data['salon'])) {
                $stmt = $this->pdo->prepare("INSERT OR REPLACE INTO salon_settings (key, value) VALUES (:key, :value)");
                foreach ($data['salon'] as $k => $v) {
                    $stmt->execute([':key' => (string)$k, ':value' => (string)$v]);
                }
            }

            // 2. Майстри
            if (isset($data['masters']) && is_array($data['masters'])) {
                $stmt = $this->pdo->prepare("
                    INSERT OR REPLACE INTO masters 
                    (id, name, role, bio, avatar, tg_chat_id, slot_step, global_buffer, ical_key, weekly_schedule, date_overrides, is_active, sort_order)
                    VALUES (:id, :name, :role, :bio, :avatar, :tg_chat_id, :slot_step, :global_buffer, :ical_key, :weekly_schedule, :date_overrides, 1, :sort_order)
                ");

                $sort = 0;
                $activeMasterIds = [];
                foreach ($data['masters'] as $m) {
                    if (empty($m['id'])) continue;
                    $activeMasterIds[] = $m['id'];
                    $stmt->execute([
                        ':id' => $m['id'],
                        ':name' => $m['name'] ?? 'Майстер',
                        ':role' => $m['role'] ?? '',
                        ':bio' => $m['bio'] ?? '',
                        ':avatar' => $m['avatar'] ?? '✨',
                        ':tg_chat_id' => $m['tgChatId'] ?? '',
                        ':slot_step' => (int)($m['slotStep'] ?? 30),
                        ':global_buffer' => (int)($m['globalBuffer'] ?? 15),
                        ':ical_key' => $m['icalKey'] ?? ('key_' . $m['id']),
                        ':weekly_schedule' => json_encode($m['weeklySchedule'] ?? new stdClass(), JSON_UNESCAPED_UNICODE),
                        ':date_overrides' => json_encode($m['dateOverrides'] ?? new stdClass(), JSON_UNESCAPED_UNICODE),
                        ':sort_order' => $sort++
                    ]);
                }

                if (!$isMigration && !empty($activeMasterIds)) {
                    $placeholders = implode(',', array_fill(0, count($activeMasterIds), '?'));
                    $delStmt = $this->pdo->prepare("DELETE FROM masters WHERE id NOT IN ($placeholders)");
                    $delStmt->execute($activeMasterIds);
                }
            }

            // 3. Послуги
            if (isset($data['services']) && is_array($data['services'])) {
                $this->pdo->exec("DELETE FROM services");
                $stmt = $this->pdo->prepare("
                    INSERT INTO services (id, master_id, title, duration, buffer_time, price, is_active, sort_order)
                    VALUES (:id, :master_id, :title, :duration, :buffer_time, :price, 1, :sort_order)
                ");
                $sort = 0;
                foreach ($data['services'] as $s) {
                    if (empty($s['id']) || empty($s['masterId'])) continue;
                    $stmt->execute([
                        ':id' => $s['id'],
                        ':master_id' => $s['masterId'],
                        ':title' => $s['title'] ?? 'Послуга',
                        ':duration' => (int)($s['duration'] ?? 60),
                        ':buffer_time' => (int)($s['bufferTime'] ?? 15),
                        ':price' => (float)($s['price'] ?? 0),
                        ':sort_order' => $sort++
                    ]);
                }
            }

            // 4. Записи (Appointments) & Клієнти
            if (isset($data['appointments']) && is_array($data['appointments'])) {
                $stmtApp = $this->pdo->prepare("
                    INSERT OR REPLACE INTO appointments 
                    (id, master_id, client_id, client_name, client_phone, date, time, duration, buffer_time, price, status, service_ids, notes, updated_at)
                    VALUES (:id, :master_id, :client_id, :client_name, :client_phone, :date, :time, :duration, :buffer_time, :price, :status, :service_ids, :notes, CURRENT_TIMESTAMP)
                ");

                $stmtClient = $this->pdo->prepare("
                    INSERT INTO clients (id, name, phone, notes, created_at, updated_at)
                    VALUES (:id, :name, :phone, :notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT(phone) DO UPDATE SET 
                        name = excluded.name,
                        updated_at = CURRENT_TIMESTAMP
                ");

                $allAppIds = [];
                foreach ($data['appointments'] as $a) {
                    if (empty($a['id'])) continue;
                    $allAppIds[] = $a['id'];

                    $clientId = 'c_' . preg_replace('/[^\d]/', '', $a['clientPhone'] ?? '');
                    if (!empty($a['clientPhone'])) {
                        $stmtClient->execute([
                            ':id' => $clientId,
                            ':name' => $a['clientName'] ?? 'Клієнт',
                            ':phone' => $a['clientPhone'],
                            ':notes' => $a['notes'] ?? ''
                        ]);
                    }

                    $stmtApp->execute([
                        ':id' => $a['id'],
                        ':master_id' => $a['masterId'] ?? '',
                        ':client_id' => $clientId,
                        ':client_name' => $a['clientName'] ?? 'Клієнт',
                        ':client_phone' => $a['clientPhone'] ?? '',
                        ':date' => $a['date'] ?? date('Y-m-d'),
                        ':time' => $a['time'] ?? '10:00',
                        ':duration' => (int)($a['duration'] ?? 60),
                        ':buffer_time' => (int)($a['bufferTime'] ?? 15),
                        ':price' => (float)($a['price'] ?? 0),
                        ':status' => $a['status'] ?? 'confirmed',
                        ':service_ids' => json_encode($a['serviceIds'] ?? [], JSON_UNESCAPED_UNICODE),
                        ':notes' => $a['notes'] ?? ''
                    ]);
                }

                if (!$isMigration) {
                    if (empty($allAppIds)) {
                        $this->pdo->exec("DELETE FROM appointments");
                    } else {
                        $placeholders = implode(',', array_fill(0, count($allAppIds), '?'));
                        $delStmt = $this->pdo->prepare("DELETE FROM appointments WHERE id NOT IN ($placeholders)");
                        $delStmt->execute($allAppIds);
                    }
                }
            }

            // 5. Технічні перерви
            if (isset($data['timeBlocks']) && is_array($data['timeBlocks'])) {
                $this->pdo->exec("DELETE FROM time_blocks");
                $stmtTb = $this->pdo->prepare("
                    INSERT INTO time_blocks (id, master_id, date, start_time, end_time, reason)
                    VALUES (:id, :master_id, :date, :start_time, :end_time, :reason)
                ");
                foreach ($data['timeBlocks'] as $tb) {
                    if (empty($tb['id']) || empty($tb['masterId'])) continue;
                    $stmtTb->execute([
                        ':id' => $tb['id'],
                        ':master_id' => $tb['masterId'],
                        ':date' => $tb['date'] ?? date('Y-m-d'),
                        ':start_time' => $tb['startTime'] ?? '12:00',
                        ':end_time' => $tb['endTime'] ?? '13:00',
                        ':reason' => $tb['reason'] ?? ''
                    ]);
                }
            }

            $this->pdo->commit();
            return true;
        } catch (Exception $e) {
            $this->pdo->rollBack();
            error_log("Помилка збереження в SQLite: " . $e->getMessage());
            throw $e;
        }
    }

    /**
     * Отримати розклад на день
     */
    public function getAppointmentsForDate(string $date, ?string $masterId = null): array {
        if ($this->useSqlite && $this->pdo) {
            $sql = "
                SELECT a.*, m.name as master_name, m.role as master_role
                FROM appointments a
                LEFT JOIN masters m ON a.master_id = m.id
                WHERE a.date = :date AND a.status != 'cancelled'
            ";
            $params = [':date' => $date];
            if ($masterId !== null) {
                $sql .= " AND a.master_id = :master_id";
                $params[':master_id'] = $masterId;
            }
            $sql .= " ORDER BY a.time ASC";
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            return $stmt->fetchAll();
        }

        // JSON Fallback
        $state = $this->getState();
        $mastersMap = [];
        foreach ($state['masters'] as $m) $mastersMap[$m['id']] = $m;

        $res = [];
        foreach ($state['appointments'] as $app) {
            if ($app['date'] !== $date || ($app['status'] ?? '') === 'cancelled') continue;
            if ($masterId !== null && $app['masterId'] !== $masterId) continue;
            $app['master_name'] = $mastersMap[$app['masterId']]['name'] ?? 'Майстер';
            $app['master_role'] = $mastersMap[$app['masterId']]['role'] ?? '';
            $app['client_name'] = $app['clientName'] ?? '';
            $app['client_phone'] = $app['clientPhone'] ?? '';
            $app['buffer_time'] = $app['bufferTime'] ?? 15;
            $app['service_ids'] = json_encode($app['serviceIds'] ?? []);
            $res[] = $app;
        }
        usort($res, fn($x, $y) => strcmp($x['time'], $y['time']));
        return $res;
    }

    /**
     * Текстове зведення для Telegram
     */
    public function getScheduleSummaryForDate(string $date, ?string $targetMasterId = null): string {
        $records = $this->getAppointmentsForDate($date, $targetMasterId);
        $humanDate = date('d.m.Y', strtotime($date));

        if (empty($records)) {
            return "🗓 <b>Розклад на {$humanDate}:</b>\n\nЗаписів на цей день немає. Вільний день! ☕";
        }

        $byMaster = [];
        $totalSum = 0;
        foreach ($records as $r) {
            $mName = $r['master_name'] ?? 'Майстер';
            if (!isset($byMaster[$mName])) $byMaster[$mName] = [];
            $byMaster[$mName][] = $r;
            $totalSum += (float)($r['price'] ?? 0);
        }

        $state = $this->getState();
        $servicesMap = [];
        foreach ($state['services'] as $s) $servicesMap[$s['id']] = $s['title'];

        $msg = "📋 <b>Записи на {$humanDate}:</b>\n";
        foreach ($byMaster as $mName => $list) {
            $msg .= "\n✨ <b>{$mName}:</b>\n";
            foreach ($list as $app) {
                $statusIcon = ($app['status'] ?? '') === 'confirmed' ? '✅' : '⏳';
                $srvIds = is_array($app['service_ids'] ?? null) 
                    ? $app['service_ids'] 
                    : (!empty($app['service_ids']) ? json_decode($app['service_ids'], true) : ($app['serviceIds'] ?? []));
                
                $srvTitles = [];
                if (!empty($srvIds)) {
                    foreach ($srvIds as $sid) {
                        if (isset($servicesMap[$sid])) $srvTitles[] = $servicesMap[$sid];
                    }
                }
                $srvText = !empty($srvTitles) ? implode(', ', $srvTitles) : 'Послуга';

                $cName = $app['client_name'] ?? ($app['clientName'] ?? 'Клієнт');
                $cPhone = $app['client_phone'] ?? ($app['clientPhone'] ?? '');
                $msg .= "• <b>{$app['time']}</b> — {$cName} ({$cPhone})\n";
                $msg .= "  <i>{$srvText}</i> • {$app['price']} ₴ {$statusIcon}\n";
                if (!empty($app['notes'])) {
                    $msg .= "  💬 <i>{$app['notes']}</i>\n";
                }
            }
        }

        $msg .= "\n💰 <b>Загальна виручка за день:</b> " . number_format($totalSum, 0, '.', ' ') . " ₴";
        return $msg;
    }

    /**
     * Черга Telegram
     */
    public function enqueueTelegram(string $type, ?string $appId, string $chatId, string $message): int {
        if ($this->useSqlite && $this->pdo) {
            $stmt = $this->pdo->prepare("
                INSERT INTO telegram_queue (type, appointment_id, chat_id, message, status)
                VALUES (:type, :app_id, :chat_id, :message, 'pending')
            ");
            $stmt->execute([
                ':type' => $type,
                ':app_id' => $appId,
                ':chat_id' => $chatId,
                ':message' => $message
            ]);
            return (int)$this->pdo->lastInsertId();
        }
        return 0;
    }

    /**
     * Відправка повідомлення в Telegram Bot API
     */
    public static function sendTelegram(string $token, string $chatId, string $text, ?array $replyMarkup = null): bool {
        if (empty($token) || empty($chatId) || empty($text)) {
            return false;
        }

        $tgUrl = "https://api.telegram.org/bot{$token}/sendMessage";
        $data = [
            'chat_id' => $chatId,
            'text' => $text,
            'parse_mode' => 'HTML',
            'disable_web_page_preview' => true
        ];

        if ($replyMarkup !== null) {
            $data['reply_markup'] = json_encode($replyMarkup);
        }

        $ch = curl_init($tgUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        $res = @curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        @curl_close($ch);

        return $httpCode === 200;
    }

    /**
     * Діагностична інформація
     */
    public function getDiagnostic(): array {
        $phpSqliteInstalled = extension_loaded('pdo_sqlite');
        
        $diag = [
            'status' => 'ok',
            'active_engine' => $this->useSqlite ? 'SQLite (PDO)' : 'JSON File Storage',
            'engine_status' => $this->engineStatus,
            'php_sqlite_installed' => $phpSqliteInstalled,
            'sqlite_file_exists' => file_exists($this->sqlitePath),
            'json_file_exists' => file_exists($this->jsonPath),
            'install_sqlite_command' => 'sudo apt update && sudo apt install -y php-sqlite3 && sudo systemctl restart apache2'
        ];

        if ($this->useSqlite && $this->pdo) {
            $diag['sqlite_version'] = $this->pdo->query("SELECT sqlite_version()")->fetchColumn();
            $diag['db_size_bytes'] = file_exists($this->sqlitePath) ? filesize($this->sqlitePath) : 0;
            $counts = [];
            foreach (['salon_settings', 'masters', 'services', 'clients', 'appointments', 'time_blocks', 'telegram_queue'] as $t) {
                try {
                    $counts[$t] = (int)$this->pdo->query("SELECT count(*) FROM $t")->fetchColumn();
                } catch (Exception $e) {
                    $counts[$t] = -1;
                }
            }
            $diag['counts'] = $counts;
        }

        return $diag;
    }

    private function getDefaultState(): array {
        return [
            'salon' => [
                'name' => 'Beauty Studio',
                'address' => 'м. Дніпро • Щодня 09:00–20:00',
                'workStart' => 9,
                'workEnd' => 20,
                'adminPin' => '1234',
                'tgBotToken' => '',
                'tgChatId' => ''
            ],
            'masters' => [],
            'services' => [],
            'appointments' => [],
            'timeBlocks' => []
        ];
    }
}
