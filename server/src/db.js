import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'haven.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'receptionist' CHECK (role IN ('admin', 'manager', 'receptionist')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL DEFAULT '', id_details TEXT NOT NULL DEFAULT '', preferences TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS hotels (
    id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL DEFAULT 'The Haven House',
    address TEXT NOT NULL DEFAULT 'San Francisco, CA', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    tax_rate REAL NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO hotels (id) VALUES (1);
  CREATE TABLE IF NOT EXISTS admin_bootstrap (id INTEGER PRIMARY KEY CHECK(id=1), completed_at TEXT);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('users', 'role_key', "TEXT NOT NULL DEFAULT 'receptionist'");
ensureColumn('users', 'account_status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('users', 'phone', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'employee_id', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'department', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'last_login', 'TEXT');
ensureColumn('guests', 'account_id', 'INTEGER REFERENCES users(id)');
db.exec(`UPDATE users SET role_key=role WHERE role_key='receptionist' AND role IN ('admin','manager','receptionist');`);
db.exec(`UPDATE users SET role_key=CASE WHEN role IN ('admin','manager') THEN role ELSE role_key END;`);
db.exec(`INSERT OR IGNORE INTO admin_bootstrap (id,completed_at)
  SELECT 1,CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM users WHERE role_key='admin' OR role='admin');`);

const userSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
if (userSql && !userSql.includes('manager')) {
  db.exec(`ALTER TABLE users RENAME TO users_legacy;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'receptionist'
        CHECK (role IN ('admin','manager','receptionist')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users (id,name,email,password_hash,role,created_at)
      SELECT id,name,email,password_hash,CASE role WHEN 'admin' THEN 'admin' ELSE 'receptionist' END,created_at
      FROM users_legacy;
    DROP TABLE users_legacy;`);
}
ensureColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id ON password_reset_tokens(user_id);`);

const roomSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rooms'").get()?.sql || '';
if (roomSql && !roomSql.includes('Maintenance')) {
  db.exec(`ALTER TABLE rooms RENAME TO rooms_legacy;
    CREATE TABLE rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Available','Occupied','Cleaning','Maintenance')),
      rate INTEGER NOT NULL CHECK (rate >= 0), capacity INTEGER NOT NULL DEFAULT 2, floor INTEGER NOT NULL DEFAULT 1);
    INSERT INTO rooms (id,number,type,status,rate,capacity,floor)
      SELECT id,number,type,status,rate,2,CAST(substr(number,1,1) AS INTEGER) FROM rooms_legacy;
    DROP TABLE rooms_legacy;`);
} else {
  db.exec(`CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Available','Occupied','Cleaning','Maintenance')),
    rate INTEGER NOT NULL CHECK (rate >= 0), capacity INTEGER NOT NULL DEFAULT 2, floor INTEGER NOT NULL DEFAULT 1
  );`);
}

const reservationSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reservations'").get()?.sql || '';
if (reservationSql && !reservationSql.includes('Pending')) {
  db.exec(`ALTER TABLE reservations RENAME TO reservations_legacy;
    INSERT OR IGNORE INTO guests (name,email)
      SELECT DISTINCT guest,email FROM reservations_legacy;
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guest_id INTEGER NOT NULL REFERENCES guests(id),
      room_id INTEGER NOT NULL REFERENCES rooms(id), check_in TEXT NOT NULL, check_out TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Pending','Confirmed','Checked-in','Checked-out','Cancelled')),
      nightly_rate INTEGER NOT NULL, additional_charges INTEGER NOT NULL DEFAULT 0,
      taxes INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0, total_amount INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO reservations (id,guest_id,room_id,check_in,check_out,status,nightly_rate,total_amount)
      SELECT old.id,guest.id,room.id,old.check_in,old.check_out,
        CASE old.status WHEN 'Checked in' THEN 'Checked-in' WHEN 'Checked out' THEN 'Checked-out'
          WHEN 'Arriving' THEN 'Confirmed' ELSE 'Confirmed' END,
        room.rate,old.amount
      FROM reservations_legacy old
      JOIN guests guest ON guest.email=old.email COLLATE NOCASE
      JOIN rooms room ON room.number=old.room_number;
    DROP TABLE reservations_legacy;`);
} else {
  db.exec(`CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guest_id INTEGER NOT NULL REFERENCES guests(id),
    room_id INTEGER NOT NULL REFERENCES rooms(id), check_in TEXT NOT NULL, check_out TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Pending','Confirmed','Checked-in','Checked-out','Cancelled')),
    nightly_rate INTEGER NOT NULL, additional_charges INTEGER NOT NULL DEFAULT 0,
    taxes INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0, total_amount INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
}
ensureColumn('reservations','cancellation_requested_at','TEXT');

db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservation_id INTEGER NOT NULL REFERENCES reservations(id),
    amount INTEGER NOT NULL CHECK (amount > 0), method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Completed'
      CHECK (status IN ('Completed','Failed','Refunded')), transaction_ref TEXT NOT NULL DEFAULT '',
    paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by INTEGER REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, read_at TEXT
  );
  CREATE TABLE IF NOT EXISTS guest_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guest_id INTEGER NOT NULL REFERENCES guests(id),
    category TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Open'
      CHECK (status IN ('Open','In Progress','Resolved','Closed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
    entity TEXT NOT NULL, entity_id INTEGER, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER NOT NULL REFERENCES payments(id),
    amount INTEGER NOT NULL CHECK (amount > 0), status TEXT NOT NULL DEFAULT 'Completed'
      CHECK (status IN ('Pending','Completed','Failed','Cancelled')),
    reason TEXT NOT NULL DEFAULT '', transaction_ref TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, description TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0), status TEXT NOT NULL DEFAULT 'Approved'
      CHECK (status IN ('Pending','Approved','Rejected')), expense_date TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '', created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservation_id INTEGER NOT NULL UNIQUE REFERENCES reservations(id),
    confirmation_number TEXT NOT NULL UNIQUE, subtotal INTEGER NOT NULL, taxes INTEGER NOT NULL,
    discount INTEGER NOT NULL, total INTEGER NOT NULL, snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS housekeeping_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL REFERENCES rooms(id),
    assigned_to INTEGER REFERENCES users(id), status TEXT NOT NULL DEFAULT 'Pending'
      CHECK (status IN ('Pending','In Progress','Clean','Inspected')),
    priority TEXT NOT NULL DEFAULT 'Normal', instructions TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '', due_date TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS maintenance_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL REFERENCES rooms(id),
    assigned_to INTEGER REFERENCES users(id), issue TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'Normal',
    status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Assigned','In Progress','Resolved','Closed')),
    instructions TEXT NOT NULL DEFAULT '', work_notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS kitchen_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservation_id INTEGER REFERENCES reservations(id),
    room_id INTEGER REFERENCES rooms(id), items TEXT NOT NULL, dietary_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Received' CHECK (status IN ('Received','Preparing','Ready','Delivered','Cancelled')),
    requested_for TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS reservations_room_dates ON reservations(room_id,check_in,check_out,status);
  CREATE INDEX IF NOT EXISTS payments_paid_at ON payments(paid_at,status);
`);

for (const table of ['payments', 'audit_logs']) {
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '';
  if (!definition.includes('users_legacy')) continue;
  const columns = table === 'payments'
    ? 'id,reservation_id,amount,method,status,transaction_ref,paid_at,created_by'
    : 'id,user_id,action,entity,entity_id,details,created_at';
  db.exec(`CREATE TABLE ${table}_repair AS SELECT ${columns} FROM ${table}; DROP TABLE ${table};`);
  if (table === 'payments') {
    db.exec(`CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservation_id INTEGER NOT NULL REFERENCES reservations(id),
      amount INTEGER NOT NULL CHECK (amount > 0), method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Completed' CHECK (status IN ('Completed','Failed','Refunded')),
      transaction_ref TEXT NOT NULL DEFAULT '', paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER REFERENCES users(id));`);
  } else {
    db.exec(`CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
      entity TEXT NOT NULL, entity_id INTEGER, details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  }
  db.exec(`INSERT INTO ${table} (${columns}) SELECT ${columns} FROM ${table}_repair; DROP TABLE ${table}_repair;`);
}
db.exec('CREATE INDEX IF NOT EXISTS payments_paid_at ON payments(paid_at,status);');
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS payments_transaction_ref_unique ON payments(transaction_ref) WHERE transaction_ref<>'';");

if (db.prepare('SELECT COUNT(*) AS count FROM rooms').get().count === 0) {
  const addRoom = db.prepare('INSERT INTO rooms (number,type,status,rate,capacity,floor) VALUES (?,?,?,?,?,?)');
  for (const room of [
    ['101','Deluxe King','Available',289,2,1], ['102','Garden Suite','Available',420,3,1],
    ['103','Deluxe Twin','Available',245,2,1], ['104','Ocean Suite','Available',520,3,1],
    ['201','Deluxe King','Available',289,2,2], ['202','Garden Suite','Available',420,3,2],
    ['203','Deluxe Twin','Available',245,2,2], ['204','Ocean Suite','Available',520,3,2],
    ['301','Penthouse','Available',760,4,3], ['302','Deluxe King','Available',289,2,3],
    ['303','Garden Suite','Available',420,3,3], ['304','Deluxe Twin','Available',245,2,3],
  ]) addRoom.run(...room);
}

db.exec(`UPDATE rooms SET status='Available' WHERE status='Occupied'
    AND id NOT IN (SELECT room_id FROM reservations WHERE status='Checked-in');
  UPDATE rooms SET status='Occupied' WHERE status NOT IN ('Maintenance','Cleaning')
    AND id IN (SELECT room_id FROM reservations WHERE status='Checked-in');`);
