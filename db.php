<?php
/**
 * db.php — Менеджер бази даних Beauty Studio CRM (Pure SQLite / PDO)
 *
 * Усі дані зберігаються виключно в реляційній базі даних SQLite (data/salon.sqlite).
 * Особливості:
 * - Повна підтримка транзакцій (ACID) та цілісності даних.
 * - Оптимізований режим журналу WAL (Write-Ahead Logging).
 * - Швидкі індекси для онлайн-запису, пошуку клієнтів та Telegram-бота.
 * - Автоматична ініціалізація структури таблиць та дефолтних даних при першому запуску.
 */

class CRM_DB {
    private static ?CRM_DB $instance = null;
    private PDO $pdo;
    private string $dbPath;

    public static function getInstance(): CRM_DB {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        if (!extension_loaded('pdo') || !extension_loaded('pdo_sqlite')) {
            throw new Exception("Модуль PHP 'pdo_sqlite' не знайдено на сервері. Для роботи встановіть його командою: sudo apt-get update && sudo apt-get install -y php-sqlite3 && sudo systemctl restart apache2");
        }

        $dataDir = __DIR__ . '/data';
        if (!is_dir($dataDir)) {
            @mkdir($dataDir, 0777, true);
        }

        $this->dbPath = $dataDir . '/salon.sqlite';
        $isNew = !file_exists($this->dbPath);

        $this->pdo = new PDO("sqlite:" . $this->dbPath);
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

        // Налаштування продуктивності SQLite
        $this->pdo->exec("PRAGMA journal_mode = WAL;");
        $this->pdo->exec("PRAGMA synchronous = NORMAL;");
        $this->pdo->exec("PRAGMA foreign_keys = ON;");

        $this->initSchema();

        if ($isNew || $this->isTablesEmpty()) {
            $this->seedDefaultData();
        }
    }

    public function getPdo(): PDO {
        return $this->pdo;
    }

    public function getDbPath(): string {
        return $this->dbPath;
    }

    /**
     * Створення таблиць та індексів бази даних
     */
    private function initSchema(): void {
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
                google_calendar_id VARCHAR(255) DEFAULT '',
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
                google_event_id VARCHAR(128) DEFAULT NULL,
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

        // Автоматична міграція існуючих таблиць (якщо вони вже створені на сервері)
        $this->ensureColumnExists('masters', 'google_calendar_id', 'VARCHAR(255) DEFAULT ""');
        $this->ensureColumnExists('appointments', 'google_event_id', 'VARCHAR(128) DEFAULT NULL');
    }

    private function ensureColumnExists(string $table, string $column, string $typeDef): void {
        try {
            $cols = $this->pdo->query("PRAGMA table_info($table)")->fetchAll();
            $names = array_column($cols, 'name');
            if (!in_array($column, $names)) {
                $this->pdo->exec("ALTER TABLE $table ADD COLUMN $column $typeDef");
            }
        } catch (Exception $e) {
            error_log("Помилка додавання колонки $column до $table: " . $e->getMessage());
        }
    }

    private function isTablesEmpty(): bool {
        $count = (int)$this->pdo->query("SELECT count(*) FROM masters")->fetchColumn();
        return $count === 0;
    }

    /**
     * Початкове наповнення бази даних за замовчуванням
     */
    public function seedDefaultData(): void {
        $today = date('Y-m-d');

        $defaultState = [
            'salon' => [
                'name' => 'Beauty Studio • Світлана & Марія',
                'address' => 'м. Дніпро • Щодня 09:00–20:00',
                'workStart' => 9,
                'workEnd' => 20,
                'adminPin' => '1234',
                'tgBotToken' => '',
                'tgChatId' => ''
            ],
            'masters' => [
                [
                    'id' => 'm1',
                    'name' => 'Світлана',
                    'role' => 'Майстер-бровіст',
                    'bio' => 'Архітектура, фарбування та ламінування брів',
                    'avatar' => '✨',
                    'tgChatId' => '',
                    'slotStep' => 30,
                    'globalBuffer' => 15,
                    'icalKey' => 'key_m1_svitlana',
                    'weeklySchedule' => [
                        '1' => ['isWorking' => true, 'workStart' => '09:00', 'workEnd' => '20:00', 'regularBreaks' => [['start' => '13:00', 'end' => '14:00', 'name' => 'Обід']]],
                        '2' => ['isWorking' => true, 'workStart' => '09:00', 'workEnd' => '20:00', 'regularBreaks' => [['start' => '13:00', 'end' => '14:00', 'name' => 'Обід']]],
                        '3' => ['isWorking' => true, 'workStart' => '09:00', 'workEnd' => '20:00', 'regularBreaks' => [['start' => '13:00', 'end' => '14:00', 'name' => 'Обід']]],
                        '4' => ['isWorking' => true, 'workStart' => '09:00', 'workEnd' => '20:00', 'regularBreaks' => [['start' => '13:00', 'end' => '14:00', 'name' => 'Обід']]],
                        '5' => ['isWorking' => true, 'workStart' => '09:00', 'workEnd' => '20:00', 'regularBreaks' => [['start' => '13:00', 'end' => '14:00', 'name' => 'Обід']]],
                        '6' => ['isWorking' => true, 'workStart' => '10:00', 'workEnd' => '18:00', 'regularBreaks' => []],
                        '0' => ['isWorking' => false, 'workStart' => '10:00', 'workEnd' => '18:00', 'regularBreaks' => []]
                    ],
                    'dateOverrides' => new stdClass()
                ],
                [
                    'id' => 'm2',
                    'name' => 'Марія',
                    'role' => 'Майстер манікюру',
                    'bio' => 'Апаратний манікюр, укріплення гелем, педикюр',
                    'avatar' => '💅',
                    'tgChatId' => '',
                    'slotStep' => 30,
                    'globalBuffer' => 15,
                    'icalKey' => 'key_m2_mariia',
                    'weeklySchedule' => [
                        '1' => ['isWorking' => true, 'workStart' => '09:00', 'workEnd' => '20:00', 'regularBreaks' => [['start' => '14:00', 'end' => '15:00', 'name' => 'Обід']]],
                        '2' => ['isWorking' => true, 'workStart' => '09:00', 'workEnd' => '20:00', 'regularBreaks' => [['start' => '14:00', 'end' => '15:00', 'name' => 'Обід']]],
                        '3' => ['isWorking' => true, 'workStart' => '09:00', 'workEnd' => '20:00', 'regularBreaks' => [['start' => '14:00', 'end' => '15:00', 'name' => 'Обід']]],
                        '4' => ['isWorking' => true, 'workStart' => '09:00', 'workEnd' => '20:00', 'regularBreaks' => [['start' => '14:00', 'end' => '15:00', 'name' => 'Обід']]],
                        '5' => ['isWorking' => true, 'workStart' => '09:00', 'workEnd' => '20:00', 'regularBreaks' => [['start' => '14:00', 'end' => '15:00', 'name' => 'Обід']]],
                        '6' => ['isWorking' => true, 'workStart' => '10:00', 'workEnd' => '17:00', 'regularBreaks' => []],
                        '0' => ['isWorking' => false, 'workStart' => '10:00', 'workEnd' => '17:00', 'regularBreaks' => []]
                    ],
                    'dateOverrides' => new stdClass()
                ]
            ],
            'services' => [
                ['id' => 's1', 'masterId' => 'm1', 'title' => 'Архітектура + корекція та фарбування брів', 'duration' => 60, 'bufferTime' => 15, 'price' => 500],
                ['id' => 's2', 'masterId' => 'm1', 'title' => 'Ламінування брів (повний комплекс)', 'duration' => 60, 'bufferTime' => 15, 'price' => 650],
                ['id' => 's3', 'masterId' => 'm1', 'title' => 'Корекція брів (віск / пінцет)', 'duration' => 30, 'bufferTime' => 10, 'price' => 300],
                ['id' => 's4', 'masterId' => 'm2', 'title' => 'Манікюр комплекс (зняття + гігієна + гель-лак)', 'duration' => 90, 'bufferTime' => 15, 'price' => 650],
                ['id' => 's5', 'masterId' => 'm2', 'title' => 'Манікюр з укріпленням гелем / полігелем', 'duration' => 120, 'bufferTime' => 15, 'price' => 800],
                ['id' => 's6', 'masterId' => 'm2', 'title' => 'Гігієнічний манікюр без покриття', 'duration' => 60, 'bufferTime' => 10, 'price' => 400]
            ],
            'appointments' => [
                [
                    'id' => 'a1',
                    'masterId' => 'm1',
                    'serviceIds' => ['s1'],
                    'date' => $today,
                    'time' => '09:00',
                    'duration' => 60,
                    'bufferTime' => 15,
                    'price' => 500,
                    'clientName' => 'Олена',
                    'clientPhone' => '+380671112233',
                    'status' => 'confirmed',
                    'notes' => 'Тон темно-русий, чутлива шкіра'
                ],
                [
                    'id' => 'a2',
                    'masterId' => 'm2',
                    'serviceIds' => ['s4'],
                    'date' => $today,
                    'time' => '09:00',
                    'duration' => 90,
                    'bufferTime' => 15,
                    'price' => 650,
                    'clientName' => 'Марина',
                    'clientPhone' => '+380509998877',
                    'status' => 'pending',
                    'notes' => 'Молочна база, мигдаль 2'
                ]
            ],
            'timeBlocks' => [
                [
                    'id' => 'tb1',
                    'masterId' => 'm1',
                    'date' => $today,
                    'startTime' => '16:00',
                    'endTime' => '16:45',
                    'reason' => '☕ Особистий час / Кава'
                ]
            ]
        ];

        $this->saveState($defaultState, true);
    }

    /**
     * Отримати повний стан CRM у форматі JSON для фронтенду
     */
    public function getState(): array {
        // 1. Салон
        $salonRows = $this->pdo->query("SELECT key, value FROM salon_settings")->fetchAll();
        $salon = [
            'name' => 'Beauty Studio • Світлана & Марія',
            'address' => 'м. Дніпро • Щодня 09:00–20:00',
            'workStart' => 9,
            'workEnd' => 20,
            'adminPin' => '1234',
            'tgBotToken' => '',
            'tgChatId' => '',
            'googleKeyPath' => '/opt/Keys/servis-calendar-sync-514520-60482c5cddc7.json',
            'googleCalendarId' => ''
        ];
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
                'googleCalendarId' => $m['google_calendar_id'] ?? '',
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
                'googleEventId' => $a['google_event_id'] ?? null,
                'notes' => $a['notes'] ?? ''
            ];
        }

        // 5. Технічні перерви (TimeBlocks)
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
     * Зберегти стан у базу даних з використанням транзакції
     */
    public function saveState(array $data, bool $isSeeding = false): bool {
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
                    (id, name, role, bio, avatar, tg_chat_id, google_calendar_id, slot_step, global_buffer, ical_key, weekly_schedule, date_overrides, is_active, sort_order)
                    VALUES (:id, :name, :role, :bio, :avatar, :tg_chat_id, :google_calendar_id, :slot_step, :global_buffer, :ical_key, :weekly_schedule, :date_overrides, 1, :sort_order)
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
                        ':google_calendar_id' => $m['googleCalendarId'] ?? '',
                        ':slot_step' => (int)($m['slotStep'] ?? 30),
                        ':global_buffer' => (int)($m['globalBuffer'] ?? 15),
                        ':ical_key' => $m['icalKey'] ?? ('key_' . $m['id']),
                        ':weekly_schedule' => json_encode($m['weeklySchedule'] ?? new stdClass(), JSON_UNESCAPED_UNICODE),
                        ':date_overrides' => json_encode($m['dateOverrides'] ?? new stdClass(), JSON_UNESCAPED_UNICODE),
                        ':sort_order' => $sort++
                    ]);
                }

                if (!$isSeeding && !empty($activeMasterIds)) {
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
                    (id, master_id, client_id, client_name, client_phone, date, time, duration, buffer_time, price, status, service_ids, google_event_id, notes, updated_at)
                    VALUES (:id, :master_id, :client_id, :client_name, :client_phone, :date, :time, :duration, :buffer_time, :price, :status, :service_ids, :google_event_id, :notes, CURRENT_TIMESTAMP)
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
                        ':google_event_id' => $a['googleEventId'] ?? ($a['google_event_id'] ?? null),
                        ':notes' => $a['notes'] ?? ''
                    ]);
                }

                if (!$isSeeding) {
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
     * Отримати розклад на конкретну дату
     */
    public function getAppointmentsForDate(string $date, ?string $masterId = null): array {
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

    /**
     * Текстове зведення розкладу для Telegram
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
                $srvIds = !empty($app['service_ids']) ? json_decode($app['service_ids'], true) : [];
                $srvTitles = [];
                if (!empty($srvIds)) {
                    foreach ($srvIds as $sid) {
                        if (isset($servicesMap[$sid])) $srvTitles[] = $servicesMap[$sid];
                    }
                }
                $srvText = !empty($srvTitles) ? implode(', ', $srvTitles) : 'Послуга';

                $cName = $app['client_name'] ?? 'Клієнт';
                $cPhone = $app['client_phone'] ?? '';
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
     * Додати сповіщення в чергу
     */
    public function enqueueTelegram(string $type, ?string $appId, string $chatId, string $message): int {
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
     * Діагностична інформація про базу даних
     */
    public function getDiagnostic(): array {
        $tables = ['salon_settings', 'masters', 'services', 'clients', 'appointments', 'time_blocks', 'telegram_queue'];
        $counts = [];
        foreach ($tables as $t) {
            try {
                $counts[$t] = (int)$this->pdo->query("SELECT count(*) FROM $t")->fetchColumn();
            } catch (Exception $e) {
                $counts[$t] = -1;
            }
        }

        return [
            'status' => 'ok',
            'engine' => 'SQLite (PDO)',
            'sqlite_version' => $this->pdo->query("SELECT sqlite_version()")->fetchColumn(),
            'db_file' => $this->dbPath,
            'db_file_exists' => file_exists($this->dbPath),
            'db_size_bytes' => file_exists($this->dbPath) ? filesize($this->dbPath) : 0,
            'db_writable' => is_writable($this->dbPath) || is_writable(dirname($this->dbPath)),
            'counts' => $counts
        ];
    }
}
