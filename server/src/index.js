import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from './db.js';
import { cookieOptions, issueToken, requireAuth } from './auth.js';

const app = express();
const port = Number(process.env.PORT) || 4000;
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
app.use(helmet());
app.use(cors({ origin: clientOrigin, credentials: true }));
app.use(express.json({ limit: '30kb' }));
app.use(cookieParser());
app.use((req,res,next)=>{
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.headers.origin&&req.headers.origin!==clientOrigin)
    return res.status(403).json({message:'Request origin is not allowed.'});
  return next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
const passwordResetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false });
const roles = ['admin','manager','receptionist','customer','finance','housekeeping','maintenance','kitchen'];
const permissionRoles = {
  hotel: ['admin','manager'], rooms: ['admin','manager','receptionist','housekeeping','maintenance'],
  reservations: ['admin','manager','receptionist'], guests: ['admin','manager','receptionist'],
  finance: ['admin','manager','finance'], payments: ['admin','manager','finance','receptionist'],
  staff: ['admin'], hotelSettings: ['admin'], housekeeping: ['admin','manager','housekeeping'],
  maintenance: ['admin','manager','maintenance'], kitchen: ['admin','manager','kitchen'],
};
const registerSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(254), phone: z.string().trim().max(40).optional().default(''), password: z.string().min(8).max(72), confirmPassword: z.string().optional(), requestedUserType: z.enum(['customer','receptionist','kitchen','maintenance']).optional().default('customer'), employeeId: z.string().trim().max(40).optional().default(''), department: z.string().trim().max(80).optional().default('') }).refine((value)=>!value.confirmPassword||value.password===value.confirmPassword,{message:'Passwords do not match.',path:['confirmPassword']});
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(72) });
const roomSchema = z.object({ number: z.string().trim().min(1).max(12), type: z.string().trim().min(2).max(60), rate: z.coerce.number().int().min(0), capacity: z.coerce.number().int().min(1).max(20), floor: z.coerce.number().int().min(0), status: z.enum(['Available', 'Occupied', 'Cleaning', 'Maintenance']).default('Available') });
const guestSchema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254), phone: z.string().trim().max(40).optional().default(''), idDetails: z.string().trim().max(120).optional().default(''), preferences: z.string().trim().max(500).optional().default('') });
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const formatINR = (amount) => `₹${Number(amount || 0).toLocaleString('en-IN')}`;
const requireRoles = (...allowedRoles) => (req, res, next) => allowedRoles.includes(req.user.role) ? next() : res.status(403).json({ message: 'Your account does not have permission for this action.' });
const requirePermission = (permission) => (req,res,next) => {
  if(!permissionRoles[permission])return res.status(403).json({message:'This operation is not enabled.'});
  return requireRoles(...permissionRoles[permission])(req,res,next);
};
const recordAudit = (userId, action, entity, entityId, details = '') => db.prepare('INSERT INTO audit_logs (user_id,action,entity,entity_id,details) VALUES (?,?,?,?,?)').run(userId, action, entity, entityId, details);
const reservationSelect = `SELECT r.id,r.guest_id AS guestId,g.name AS guest,g.email,g.phone,r.room_id AS roomId,room.number AS room,
  room.type AS roomType,r.check_in AS checkIn,r.check_out AS checkOut,r.status,r.nightly_rate AS nightlyRate,
  r.additional_charges AS additionalCharges,r.taxes,r.discount,r.total_amount AS amount,
  COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.reservation_id=r.id AND p.status='Completed'),0) AS paid
  ,r.cancellation_requested_at AS cancellationRequestedAt,i.confirmation_number AS confirmationNumber
  FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN rooms room ON room.id=r.room_id LEFT JOIN invoices i ON i.reservation_id=r.id`;
const getReservation = (id) => db.prepare(`${reservationSelect} WHERE r.id=?`).get(id);
const snapshotInvoice = (reservationId) => {
  const reservation=db.prepare(`SELECT r.*,g.name AS guest,room.number AS room FROM reservations r
    JOIN guests g ON g.id=r.guest_id JOIN rooms room ON room.id=r.room_id WHERE r.id=?`).get(reservationId);
  const confirmation=`HVN-${String(reservationId).padStart(6,'0')}`;
  const nights=Math.round((new Date(`${reservation.check_out}T00:00:00Z`)-new Date(`${reservation.check_in}T00:00:00Z`))/86400000);
  const subtotal=reservation.nightly_rate*nights+reservation.additional_charges;
  const snapshot=JSON.stringify({reservationId,guest:reservation.guest,room:reservation.room,checkIn:reservation.check_in,checkOut:reservation.check_out,nightlyRate:reservation.nightly_rate,additionalCharges:reservation.additional_charges,taxes:reservation.taxes,discount:reservation.discount,total:reservation.total_amount});
  db.prepare(`INSERT INTO invoices (reservation_id,confirmation_number,subtotal,taxes,discount,total,snapshot)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(reservation_id) DO UPDATE SET subtotal=excluded.subtotal,taxes=excluded.taxes,
      discount=excluded.discount,total=excluded.total,snapshot=excluded.snapshot`).run(reservationId,confirmation,subtotal,reservation.taxes,reservation.discount,reservation.total_amount,snapshot);
};
    for(const {id} of db.prepare('SELECT r.id FROM reservations r LEFT JOIN invoices i ON i.reservation_id=r.id WHERE i.id IS NULL').all())snapshotInvoice(id);
const canBook = (roomId, checkIn, checkOut, exceptId = 0) => {
  const room = db.prepare('SELECT id,status FROM rooms WHERE id=?').get(roomId);
  if (!room) return { ok: false, message: 'Room not found.' };
  if (room.status === 'Maintenance' || room.status === 'Cleaning') return { ok: false, message: `Room is currently ${room.status.toLowerCase()}.` };
  const occupancyBelongsToReservation = exceptId && db.prepare("SELECT id FROM reservations WHERE id=? AND room_id=? AND status='Checked-in'").get(exceptId, roomId);
  if (room.status === 'Occupied' && checkIn <= today() && checkOut > today() && !occupancyBelongsToReservation) return { ok: false, message: 'This room is currently occupied.' };
  const conflict = db.prepare(`SELECT id FROM reservations WHERE room_id=? AND id<>? AND status IN ('Pending','Confirmed','Checked-in')
    AND check_in < ? AND check_out > ? LIMIT 1`).get(roomId, exceptId, checkOut, checkIn);
  return conflict ? { ok: false, message: 'This room already has an active reservation during those dates.' } : { ok: true };
};
const transaction = (callback) => {
  db.exec('BEGIN IMMEDIATE');
  try { const result = callback(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
};

export const __test__ = { canBook, transaction, snapshotInvoice, permissionRoles };

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/auth/bootstrap-status',(_req,res)=>res.json({available:!!process.env.HOTEL_ADMIN_SETUP_KEY&&!db.prepare('SELECT completed_at FROM admin_bootstrap WHERE id=1 AND completed_at IS NOT NULL').get()}));
app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
  const { name, email, password, phone, employeeId, department, requestedUserType } = parsed.data;
  const role = ['kitchen','maintenance'].includes(requestedUserType) ? requestedUserType : 'customer';
  try {
    const hash = await bcrypt.hash(password, 12);
    const user=transaction(()=>{
      const result = db.prepare(`INSERT INTO users (name,email,password_hash,role,role_key,phone,employee_id,department)
        VALUES (?,?,?,'receptionist',?,?,?,?)`).run(name,email.toLowerCase(),hash,role,phone,employeeId,department);
      const created={id:Number(result.lastInsertRowid),name,email:email.toLowerCase(),phone,role,accountStatus:'active'};
      if(role==='customer'){
        db.prepare('INSERT OR IGNORE INTO guests (name,email,phone) VALUES (?,?,?)').run(name,email.toLowerCase(),phone);
        db.prepare('UPDATE guests SET account_id=? WHERE email=? COLLATE NOCASE AND account_id IS NULL').run(created.id,email.toLowerCase());
      }
      return created;
    });
    res.cookie('haven_session', issueToken(user), cookieOptions);
    return res.status(201).json({ user });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'An account with this email already exists.' });
    return next(error);
  }
});
app.post('/api/auth/bootstrap-admin', authLimiter, async (req,res,next)=>{
  const parsed=z.object({name:z.string().trim().min(2).max(80),email:z.string().trim().email().max(254),password:z.string().min(12).max(72),setupKey:z.string().min(1)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  if(!process.env.HOTEL_ADMIN_SETUP_KEY||parsed.data.setupKey!==process.env.HOTEL_ADMIN_SETUP_KEY)return res.status(403).json({message:'Administrator bootstrap is not enabled or the setup key is invalid.'});
  try{
    const hash=await bcrypt.hash(parsed.data.password,12);
    const user=transaction(()=>{
      if(db.prepare('SELECT completed_at FROM admin_bootstrap WHERE id=1 AND completed_at IS NOT NULL').get())throw Object.assign(new Error('Administrator setup has already been completed.'),{status:409});
      const result=db.prepare(`INSERT INTO users (name,email,password_hash,role,role_key) VALUES (?,?,?,'admin','admin')`).run(parsed.data.name,parsed.data.email.toLowerCase(),hash);
      db.prepare('INSERT INTO admin_bootstrap (id,completed_at) VALUES (1,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET completed_at=CURRENT_TIMESTAMP').run();
      return {id:Number(result.lastInsertRowid),name:parsed.data.name,email:parsed.data.email.toLowerCase(),phone:'',role:'admin',accountStatus:'active'};
    });
    res.cookie('haven_session',issueToken(user),cookieOptions);return res.status(201).json({user});
  }catch(error){if(error.status)return res.status(error.status).json({message:error.message});if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({message:'An account with this email already exists.'});return next(error);}
});
app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
  try {
    const account = db.prepare('SELECT id,name,email,phone,role_key AS role,account_status AS accountStatus,password_hash,token_version AS tokenVersion FROM users WHERE email=? COLLATE NOCASE').get(parsed.data.email);
    if (!account || !(await bcrypt.compare(parsed.data.password, account.password_hash))) return res.status(401).json({ message: 'Email or password is incorrect.' });
    if(account.accountStatus!=='active')return res.status(403).json({message:'This account is suspended or awaiting approval.'});
    db.prepare('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?').run(account.id);
    const user = { id: account.id, name: account.name, email: account.email, phone:account.phone, role: account.role, accountStatus:account.accountStatus, tokenVersion:account.tokenVersion };
    res.cookie('haven_session', issueToken(user), cookieOptions);
    return res.json({ user });
  } catch (error) { return next(error); }
});
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
app.post('/api/auth/request-password-reset', passwordResetLimiter, async (req, res) => {
  const parsed=z.object({email:z.string().trim().email().max(254)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:'Enter a valid email address.'});

  const smtpHost=process.env.SMTP_HOST;
  const smtpPort=Number(process.env.SMTP_PORT)||587;
  const smtpUser=process.env.SMTP_USER;
  const smtpPass=process.env.SMTP_PASS;
  const emailFrom=process.env.EMAIL_FROM;
  if(!smtpHost||!smtpUser||!smtpPass||!emailFrom)
    return res.status(503).json({message:'Password reset email is not configured. Please contact the hotel administrator.'});
  db.prepare("DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR expires_at<=CURRENT_TIMESTAMP").run();

  const account=db.prepare('SELECT id,name,email FROM users WHERE email=? COLLATE NOCASE AND account_status=\'active\'').get(parsed.data.email);
  if(!account)return res.json({message:'If an active account exists for that email, a password reset link will be sent.'});

  const token=randomBytes(32).toString('base64url');
  const tokenHash=createHash('sha256').update(token).digest('hex');
  const expiresAt=new Date(Date.now()+30*60*1000).toISOString().slice(0,19).replace('T',' ');
  transaction(()=>{
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id=?').run(account.id);
    db.prepare('INSERT INTO password_reset_tokens (user_id,token_hash,expires_at) VALUES (?,?,?)').run(account.id,tokenHash,expiresAt);
  });

  const resetUrl=`${clientOrigin}/reset-password?token=${encodeURIComponent(token)}`;
  const safeName=account.name.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const transporter=nodemailer.createTransport({
    host:smtpHost,
    port:smtpPort,
    secure:process.env.SMTP_SECURE==='true'||smtpPort===465,
    auth:{user:smtpUser,pass:smtpPass},
  });
  try{
    await transporter.sendMail({
      from:emailFrom,
      to:account.email,
      subject:'Reset your Haven password',
      text:`Hello ${account.name},\n\nUse this one-time link to reset your Haven password. It expires in 30 minutes:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      html:`<p>Hello ${safeName},</p><p>Use this one-time link to reset your Haven password. It expires in 30 minutes.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    });
  }catch(error){
    db.prepare('DELETE FROM password_reset_tokens WHERE token_hash=?').run(tokenHash);
    console.error('Password reset email could not be sent:',error.message);
    return res.status(503).json({message:'The reset email could not be sent right now. Please try again later.'});
  }
  return res.json({message:'If an active account exists for that email, a password reset link will be sent.'});
});
app.post('/api/auth/reset-password', passwordResetLimiter, async (req,res,next)=>{
  const parsed=z.object({token:z.string().min(20).max(200),password:z.string().min(8).max(72),confirmPassword:z.string().min(8).max(72)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  if(parsed.data.password!==parsed.data.confirmPassword)return res.status(400).json({message:'Passwords do not match.'});
  const tokenHash=createHash('sha256').update(parsed.data.token).digest('hex');
  const hash=await bcrypt.hash(parsed.data.password,12);
  try{
    transaction(()=>{
      const reset=db.prepare(`SELECT id,user_id AS userId FROM password_reset_tokens
        WHERE token_hash=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP`).get(tokenHash);
      if(!reset)throw Object.assign(new Error('This password reset link is invalid or expired. Request a new link.'),{status:400});
      db.prepare('UPDATE users SET password_hash=?,token_version=token_version+1 WHERE id=?').run(hash,reset.userId);
      db.prepare('UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL').run(reset.id);
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id=? AND id<>?').run(reset.userId,reset.id);
      recordAudit(reset.userId,'reset_password','account',reset.userId);
    });
    return res.json({message:'Password updated. Sign in with your new password.'});
  }catch(error){
    if(error.status)return res.status(error.status).json({message:error.message});
    return next(error);
  }
});
app.patch('/api/auth/account', requireAuth, async (req, res, next) => {
  const parsed=z.object({name:z.string().trim().min(2).max(80),email:z.string().trim().email().max(254),currentPassword:z.string().optional(),newPassword:z.string().min(8).max(72).optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  try {
    const account=db.prepare('SELECT password_hash,phone FROM users WHERE id=?').get(req.user.id);
    if(parsed.data.newPassword&&(!parsed.data.currentPassword||!(await bcrypt.compare(parsed.data.currentPassword,account.password_hash))))return res.status(401).json({message:'Current password is incorrect.'});
    const hash=parsed.data.newPassword?await bcrypt.hash(parsed.data.newPassword,12):account.password_hash;
    db.prepare('UPDATE users SET name=?,email=?,password_hash=?,token_version=token_version+? WHERE id=?').run(parsed.data.name,parsed.data.email.toLowerCase(),hash,parsed.data.newPassword?1:0,req.user.id);
    const user=db.prepare('SELECT id,name,email,phone,role_key AS role,account_status AS accountStatus,token_version AS tokenVersion FROM users WHERE id=?').get(req.user.id);
    db.prepare('UPDATE guests SET name=?,email=?,phone=? WHERE account_id=?').run(user.name,user.email,user.phone,req.user.id);
    recordAudit(req.user.id,'updated','account',req.user.id,'profile/password');
    res.cookie('haven_session',issueToken(user),cookieOptions);
    res.json({user});
  } catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({message:'An account with this email already exists.'});return next(error);}
});
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('haven_session', { ...cookieOptions, maxAge: undefined }); res.json({ message: 'Signed out.' }); });

app.get('/api/dashboard', requireAuth, requireRoles('admin','manager','receptionist','finance','housekeeping','maintenance','kitchen'), (req, res) => {
  const currentDate = datePattern.test(req.query.date || '') ? req.query.date : today();
  const monthStart = `${currentDate.slice(0, 7)}-01`;
  const nextMonth = new Date(`${monthStart}T00:00:00Z`); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const monthEnd = nextMonth.toISOString().slice(0, 10);
  const rooms = db.prepare('SELECT id,number,type,status,rate,capacity,floor FROM rooms ORDER BY number').all();
  const rawRoomSummary = db.prepare('SELECT status,COUNT(*) AS count FROM rooms GROUP BY status').all();
  const reservations = req.user.role==='finance'
    ? db.prepare(`${reservationSelect} ORDER BY r.check_in,r.id`).all().map(({email,phone,...item})=>item)
    : db.prepare(`${reservationSelect} ORDER BY r.check_in,r.id`).all();
  const revenue = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE status='Completed' AND date(paid_at)>=date(?) AND date(paid_at)<date(?)").get(monthStart, monthEnd).total;
  const sellable = rooms.filter((room) => room.status !== 'Maintenance').length;
  const occupied = db.prepare("SELECT COUNT(DISTINCT room_id) AS count FROM reservations WHERE status='Checked-in' AND check_in<=? AND check_out>?").get(currentDate, currentDate).count;
  const available = rooms.filter((room) => ['Available','Occupied'].includes(room.status)
    && !(room.status === 'Occupied' && currentDate === today())
    && !db.prepare(`SELECT id FROM reservations WHERE room_id=? AND status IN ('Pending','Confirmed','Checked-in') AND check_in<=? AND check_out>? LIMIT 1`).get(room.id, currentDate, currentDate)).length;
  const reserved = db.prepare(`SELECT COUNT(DISTINCT room_id) AS count FROM reservations
    WHERE status IN ('Pending','Confirmed') AND check_in<=? AND check_out>?`).get(currentDate,currentDate).count;
  const cleaningCount = rawRoomSummary.find((item) => item.status === 'Cleaning')?.count || 0;
  const maintenanceCount = rawRoomSummary.find((item) => item.status === 'Maintenance')?.count || 0;
  const roomSummary = [
    { status: 'Occupied', count: Number(occupied) },
    { status: 'Reserved', count: Number(reserved) },
    { status: 'Available', count: Number(available) },
    { status: 'Cleaning', count: cleaningCount },
    { status: 'Maintenance', count: maintenanceCount },
  ].filter((item) => item.count > 0);
  const arrivals = reservations.filter((item) => item.checkIn === currentDate && item.status === 'Confirmed');
  const departures = reservations.filter((item) => item.checkOut === currentDate && item.status === 'Checked-in');
  const checkedIn = reservations.filter((item) => item.status === 'Checked-in').length;
  const overdue = reservations.filter((item) => item.checkOut < currentDate && item.status === 'Checked-in');
  const pending = reservations.filter((item) => item.status === 'Pending').length;
  const cancellationRequests=reservations.filter((item)=>item.cancellationRequestedAt);
  const limitedOperations=['housekeeping','maintenance','kitchen'].includes(req.user.role);
  const financeOnly=req.user.role==='finance';
  const visibleRooms=limitedOperations?rooms.map(({id,number,type,status})=>({id,number,type,status})):rooms;
  const visibleReservations=limitedOperations||financeOnly?[]:reservations;
  const visibleMetrics=financeOnly?[
    {label:'Successful payments this month',value:formatINR(revenue),raw:revenue,kind:'revenue'},
  ]:req.user.role==='receptionist'||limitedOperations?[
    {label:'Occupancy rate',value:`${sellable?Math.round(occupied/sellable*100):0}%`,raw:sellable?Number((occupied/sellable*100).toFixed(1)):0,kind:'occupancy'},
    {label:'Available for these dates',value:String(available).padStart(2,'0'),kind:'rooms'},
    {label:'Arrivals today',value:String(arrivals.length).padStart(2,'0'),kind:'checkins'},
  ]:undefined;
  res.json({ date: currentDate, period: { from: monthStart, to: monthEnd }, hotel: db.prepare('SELECT name,address,phone,email,tax_rate AS taxRate FROM hotels WHERE id=1').get(), metrics: [
    { label: 'Revenue this month', value: formatINR(revenue), raw: revenue, kind: 'revenue' },
    { label: 'Occupancy rate', value: `${sellable ? Math.round(occupied / sellable * 100) : 0}%`, raw: sellable ? Number((occupied / sellable * 100).toFixed(1)) : 0, kind: 'occupancy' },
    { label: 'Available for these dates', value: String(available).padStart(2,'0'), kind: 'rooms' },
    { label: 'Arrivals today', value: String(arrivals.length).padStart(2,'0'), kind: 'checkins' },
  ], stats: { arrivals: arrivals.length, departures: departures.length, checkedIn, overdue: overdue.length, pending, totalRooms: rooms.length, sellableRooms: sellable, occupied },
  roomSummary:limitedOperations||financeOnly?[]:roomSummary, rooms:limitedOperations?visibleRooms:financeOnly?[]:visibleRooms, reservations:visibleReservations, arrivals:limitedOperations||financeOnly?[]:arrivals, departures:limitedOperations||financeOnly?[]:departures, overdue:limitedOperations||financeOnly?[]:overdue,
  ...(req.user.role==='admin'||req.user.role==='manager'?{cancellationRequests}:{}),
  ...(visibleMetrics?{metrics:visibleMetrics}:{}), ...(limitedOperations?{stats:{totalRooms:rooms.length,sellableRooms:sellable,occupied}}:{}), ...(financeOnly?{stats:{}}:{}) });
});

app.get('/api/customer/rooms',requireAuth,requireRoles('customer'),(req,res)=>{
  const from=datePattern.test(req.query.checkIn||'')?req.query.checkIn:today();
  const to=datePattern.test(req.query.checkOut||'')?req.query.checkOut:new Date(Date.now()+86400000).toISOString().slice(0,10);
  if(from>=to)return res.status(400).json({message:'Check-out must be after check-in.'});
  const rooms=db.prepare(`SELECT id,number,type,rate,capacity FROM rooms WHERE status NOT IN ('Maintenance','Cleaning') AND NOT EXISTS (
    SELECT 1 FROM reservations r WHERE r.room_id=rooms.id AND r.status IN ('Pending','Confirmed','Checked-in')
    AND r.check_in<? AND r.check_out>?) ORDER BY rate`).all(to,from);
  res.json({rooms,from,to});
});
app.get('/api/customer/reservations',requireAuth,requireRoles('customer'),(req,res)=>{
  const guest=db.prepare('SELECT id FROM guests WHERE account_id=?').get(req.user.id);
  if(!guest)return res.json({reservations:[]});
  res.json({reservations:db.prepare(`${reservationSelect} WHERE g.id=? ORDER BY r.check_in DESC`).all(guest.id)});
});
app.post('/api/customer/reservations',requireAuth,requireRoles('customer'),(req,res)=>{
  const parsed=z.object({roomId:z.coerce.number().int().positive(),checkIn:z.string().regex(datePattern),checkOut:z.string().regex(datePattern)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  if(parsed.data.checkIn<today()||parsed.data.checkIn>=parsed.data.checkOut)return res.status(400).json({message:'Choose valid future check-in and check-out dates.'});
  try{
    const id=transaction(()=>{
      const guest=db.prepare('SELECT id FROM guests WHERE account_id=?').get(req.user.id);if(!guest)throw Object.assign(new Error('Guest profile is not available.'),{status:404});
      const room=db.prepare(`SELECT id,rate FROM rooms WHERE id=? AND status NOT IN ('Maintenance','Cleaning') AND NOT EXISTS (
        SELECT 1 FROM reservations r WHERE r.room_id=rooms.id AND r.status IN ('Pending','Confirmed','Checked-in')
        AND r.check_in<? AND r.check_out>?)`).get(parsed.data.roomId,parsed.data.checkOut,parsed.data.checkIn);
      if(!room)throw Object.assign(new Error('That room is not available for the selected dates.'),{status:409});
      const nights=Math.round((new Date(`${parsed.data.checkOut}T00:00:00Z`)-new Date(`${parsed.data.checkIn}T00:00:00Z`))/86400000);
      const taxRate=db.prepare('SELECT tax_rate FROM hotels WHERE id=1').get().tax_rate;
      const taxes=Math.round(nights*room.rate*taxRate/100);const total=nights*room.rate+taxes;
      const result=db.prepare(`INSERT INTO reservations (guest_id,room_id,check_in,check_out,status,nightly_rate,taxes,total_amount)
        VALUES (?,?,?,?,'Pending',?,?,?)`).run(guest.id,room.id,parsed.data.checkIn,parsed.data.checkOut,room.rate,taxes,total);
      snapshotInvoice(Number(result.lastInsertRowid));
      recordAudit(req.user.id,'created','customer_reservation',Number(result.lastInsertRowid));return Number(result.lastInsertRowid);
    });
    res.status(201).json({reservation:getReservation(id)});
  }catch(error){if(error.status)return res.status(error.status).json({message:error.message});throw error;}
});
app.post('/api/customer/reservations/:id/cancellation-request',requireAuth,requireRoles('customer'),(req,res)=>{
  const reservation=db.prepare('SELECT r.id,r.status,g.account_id FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.id=?').get(Number(req.params.id));
  if(!reservation||reservation.account_id!==req.user.id)return res.status(404).json({message:'Reservation not found.'});
  if(!['Pending','Confirmed'].includes(reservation.status))return res.status(409).json({message:'This reservation is no longer eligible for cancellation request.'});
  db.prepare('UPDATE reservations SET cancellation_requested_at=CURRENT_TIMESTAMP WHERE id=?').run(reservation.id);
  db.prepare('INSERT INTO notifications (kind,message) VALUES (?,?)').run('cancellation_request',`Customer cancellation requested for reservation #${reservation.id}.`);
  recordAudit(req.user.id,'requested_cancellation','reservation',reservation.id);res.status(202).json({message:'Cancellation request sent to the hotel.'});
});
app.get('/api/customer/payments',requireAuth,requireRoles('customer'),(req,res)=>res.json({payments:db.prepare(`SELECT p.id,p.amount,p.method,p.status,p.transaction_ref AS reference,p.paid_at AS paidAt
  FROM payments p JOIN reservations r ON r.id=p.reservation_id JOIN guests g ON g.id=r.guest_id WHERE g.account_id=? ORDER BY p.paid_at DESC`).all(req.user.id)}));
app.patch('/api/customer/profile',requireAuth,requireRoles('customer'),(req,res)=>{
  const parsed=z.object({name:z.string().trim().min(2).max(100),email:z.string().trim().email().max(254),phone:z.string().trim().max(40).optional().default('')}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  try{
    transaction(()=>{db.prepare('UPDATE users SET name=?,email=?,phone=? WHERE id=?').run(parsed.data.name,parsed.data.email.toLowerCase(),parsed.data.phone,req.user.id);
      db.prepare('UPDATE guests SET name=?,email=?,phone=? WHERE account_id=?').run(parsed.data.name,parsed.data.email.toLowerCase(),parsed.data.phone,req.user.id);});
    recordAudit(req.user.id,'updated','customer_profile',req.user.id);res.json({user:{...req.user,name:parsed.data.name,email:parsed.data.email.toLowerCase(),phone:parsed.data.phone}});
  }catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({message:'That email is already in use.'});throw error;}
});
app.post('/api/customer/requests',requireAuth,requireRoles('customer'),(req,res)=>{
  const parsed=z.object({category:z.enum(['service','feedback','dietary','accessibility','other']),message:z.string().trim().min(3).max(1000)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  const guest=db.prepare('SELECT id FROM guests WHERE account_id=?').get(req.user.id);if(!guest)return res.status(404).json({message:'Guest profile not found.'});
  const id=Number(db.prepare('INSERT INTO guest_requests (guest_id,category,message) VALUES (?,?,?)').run(guest.id,parsed.data.category,parsed.data.message).lastInsertRowid);
  db.prepare('INSERT INTO notifications (kind,message) VALUES (?,?)').run('guest_request',`New ${parsed.data.category} request from guest #${guest.id}.`);recordAudit(req.user.id,'created','guest_request',id);res.status(201).json({id,message:'Your request has been sent to the hotel.'});
});
app.get('/api/customer/invoices',requireAuth,requireRoles('customer'),(req,res)=>{
  const rows=db.prepare(`SELECT i.id,i.reservation_id AS reservationId,i.confirmation_number AS confirmationNumber,i.subtotal,i.taxes,i.discount,i.total,i.snapshot,i.created_at AS createdAt,
      r.check_in AS checkIn,r.check_out AS checkOut,r.nightly_rate AS nightlyRate,r.additional_charges AS additionalCharges,r.status AS reservationStatus,
      g.name AS guestName,g.email AS guestEmail,g.phone AS guestPhone,room.number AS roomNumber,room.type AS roomType
    FROM invoices i JOIN reservations r ON r.id=i.reservation_id JOIN guests g ON g.id=r.guest_id JOIN rooms room ON room.id=r.room_id
    WHERE g.account_id=? ORDER BY i.created_at DESC`).all(req.user.id);
  const hotel=db.prepare('SELECT name,address,phone,email,tax_rate AS taxRate FROM hotels WHERE id=1').get();
  const invoices=rows.map((row)=>{
    const payments=db.prepare(`SELECT amount,method,status,transaction_ref AS reference,paid_at AS paidAt FROM payments WHERE reservation_id=? ORDER BY paid_at`).all(row.reservationId);
    const paid=payments.reduce((sum,payment)=>sum+(payment.status==='Completed'?payment.amount:0),0);
    const {guestName,guestEmail,guestPhone,roomNumber,roomType,...invoice}=row;
    return {...invoice,snapshot:JSON.parse(invoice.snapshot),guest:{name:guestName,email:guestEmail,phone:guestPhone},room:{number:roomNumber,type:roomType},hotel,payments,paymentStatus:paid>=invoice.total&&paid>0?'Paid':paid>0?'Partial':'Pending'};
  });
  res.json({invoices});
});

app.get('/api/housekeeping/tasks',requireAuth,requirePermission('housekeeping'),(req,res)=>{
  const tasks=db.prepare(`SELECT t.id,t.room_id AS roomId,room.number AS room,room.type AS roomType,t.assigned_to AS assignedTo,
    t.status,t.priority,t.instructions,t.notes,t.due_date AS dueDate FROM housekeeping_tasks t JOIN rooms room ON room.id=t.room_id
    WHERE (? IN ('admin','manager') OR t.assigned_to IS NULL OR t.assigned_to=?) ORDER BY CASE t.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 ELSE 2 END,t.created_at`).all(req.user.role,req.user.id);
  res.json({tasks});
});
app.post('/api/housekeeping/tasks',requireAuth,requireRoles('admin','manager'),(req,res)=>{
  const parsed=z.object({roomId:z.coerce.number().int().positive(),assignedTo:z.coerce.number().int().positive().optional(),priority:z.enum(['Low','Normal','High','Urgent']).default('Normal'),instructions:z.string().trim().max(500).optional().default(''),dueDate:z.string().regex(datePattern).optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  const room=db.prepare('SELECT id FROM rooms WHERE id=?').get(parsed.data.roomId);if(!room)return res.status(404).json({message:'Room not found.'});
  if(parsed.data.assignedTo&&!db.prepare("SELECT id FROM users WHERE id=? AND role_key='housekeeping' AND account_status='active'").get(parsed.data.assignedTo))return res.status(400).json({message:'Choose an active housekeeping team member.'});
  const result=db.prepare('INSERT INTO housekeeping_tasks (room_id,assigned_to,priority,instructions,due_date) VALUES (?,?,?,?,?)').run(room.id,parsed.data.assignedTo||null,parsed.data.priority,parsed.data.instructions,parsed.data.dueDate||null);
  recordAudit(req.user.id,'created','housekeeping_task',Number(result.lastInsertRowid));res.status(201).json({id:Number(result.lastInsertRowid)});
});
app.patch('/api/housekeeping/tasks/:id',requireAuth,requirePermission('housekeeping'),(req,res)=>{
  const parsed=z.object({status:z.enum(['Pending','In Progress','Clean','Inspected']),notes:z.string().trim().max(500).optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  const task=db.prepare('SELECT * FROM housekeeping_tasks WHERE id=?').get(Number(req.params.id));if(!task)return res.status(404).json({message:'Task not found.'});
  if(!['admin','manager'].includes(req.user.role)&&task.assigned_to&&task.assigned_to!==req.user.id)return res.status(403).json({message:'This task is assigned to another team member.'});
  if(parsed.data.status==='Inspected'&&db.prepare("SELECT id FROM maintenance_requests WHERE room_id=? AND status NOT IN ('Resolved','Closed') LIMIT 1").get(task.room_id))return res.status(409).json({message:'Room remains unavailable while maintenance is open.'});
  if(parsed.data.status==='Inspected'&&db.prepare("SELECT id FROM reservations WHERE room_id=? AND status='Checked-in' AND check_out>? LIMIT 1").get(task.room_id,today()))return res.status(409).json({message:'A checked-in guest still occupies this room.'});
  db.prepare('UPDATE housekeeping_tasks SET status=?,notes=COALESCE(?,notes),updated_at=CURRENT_TIMESTAMP WHERE id=?').run(parsed.data.status,parsed.data.notes??null,task.id);
  if(parsed.data.status==='Inspected')db.prepare("UPDATE rooms SET status='Available' WHERE id=? AND status='Cleaning'").run(task.room_id);
  recordAudit(req.user.id,'updated','housekeeping_task',task.id,parsed.data.status);res.json({message:'Housekeeping task updated.'});
});
app.post('/api/housekeeping/tasks/:id/maintenance',requireAuth,requirePermission('housekeeping'),(req,res)=>{
  const parsed=z.object({issue:z.string().trim().min(3).max(240),priority:z.enum(['Low','Normal','High','Urgent']).default('Normal'),workInstructions:z.string().trim().max(500).optional().default('')}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  const task=db.prepare('SELECT id,room_id FROM housekeeping_tasks WHERE id=?').get(Number(req.params.id));if(!task)return res.status(404).json({message:'Task not found.'});
  const result=db.prepare("INSERT INTO maintenance_requests (room_id,issue,priority,instructions) VALUES (?,?,?,?)").run(task.room_id,parsed.data.issue,parsed.data.priority,parsed.data.workInstructions);
  if(!db.prepare("SELECT id FROM reservations WHERE room_id=? AND status='Checked-in' AND check_out>? LIMIT 1").get(task.room_id,today()))db.prepare("UPDATE rooms SET status='Maintenance' WHERE id=?").run(task.room_id);
  db.prepare('INSERT INTO notifications (kind,message) VALUES (?,?)').run('maintenance',`Room issue reported for room ${task.room_id}: ${parsed.data.issue}`);
  recordAudit(req.user.id,'reported','maintenance_request',Number(result.lastInsertRowid));res.status(201).json({id:Number(result.lastInsertRowid)});
});
app.get('/api/maintenance/requests',requireAuth,requirePermission('maintenance'),(req,res)=>res.json({requests:db.prepare(`SELECT m.id,m.room_id AS roomId,room.number AS room,m.assigned_to AS assignedTo,m.issue,m.priority,m.status,m.instructions,m.work_notes AS workNotes,m.created_at AS createdAt FROM maintenance_requests m JOIN rooms room ON room.id=m.room_id WHERE (? IN ('admin','manager') OR m.assigned_to IS NULL OR m.assigned_to=?) ORDER BY m.created_at DESC`).all(req.user.role,req.user.id)}));
app.post('/api/maintenance/requests',requireAuth,requireRoles('admin','manager','receptionist','housekeeping'),(req,res)=>{
  const parsed=z.object({roomId:z.coerce.number().int().positive(),assignedTo:z.coerce.number().int().positive().optional(),issue:z.string().trim().min(3).max(240),priority:z.enum(['Low','Normal','High','Urgent']).default('Normal'),instructions:z.string().trim().max(500).optional().default('')}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  if(!db.prepare('SELECT id FROM rooms WHERE id=?').get(parsed.data.roomId))return res.status(404).json({message:'Room not found.'});
  if(parsed.data.assignedTo&&!db.prepare("SELECT id FROM users WHERE id=? AND role_key='maintenance' AND account_status='active'").get(parsed.data.assignedTo))return res.status(400).json({message:'Choose an active maintenance team member.'});
  const id=Number(db.prepare('INSERT INTO maintenance_requests (room_id,assigned_to,issue,priority,instructions) VALUES (?,?,?,?,?)').run(parsed.data.roomId,parsed.data.assignedTo||null,parsed.data.issue,parsed.data.priority,parsed.data.instructions).lastInsertRowid);
  if(!db.prepare("SELECT id FROM reservations WHERE room_id=? AND status='Checked-in' AND check_out>? LIMIT 1").get(parsed.data.roomId,today()))db.prepare("UPDATE rooms SET status='Maintenance' WHERE id=?").run(parsed.data.roomId);
  recordAudit(req.user.id,'created','maintenance_request',id);res.status(201).json({id});
});
app.patch('/api/maintenance/requests/:id',requireAuth,requirePermission('maintenance'),(req,res)=>{
  const parsed=z.object({status:z.enum(['Open','Assigned','In Progress','Resolved','Closed']),workNotes:z.string().trim().max(800).optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  const request=db.prepare('SELECT * FROM maintenance_requests WHERE id=?').get(Number(req.params.id));if(!request)return res.status(404).json({message:'Maintenance request not found.'});
  if(!['admin','manager'].includes(req.user.role)&&request.assigned_to&&request.assigned_to!==req.user.id)return res.status(403).json({message:'This request is assigned to another team member.'});
  db.prepare('UPDATE maintenance_requests SET status=?,work_notes=COALESCE(?,work_notes),updated_at=CURRENT_TIMESTAMP WHERE id=?').run(parsed.data.status,parsed.data.workNotes??null,request.id);
  recordAudit(req.user.id,'updated','maintenance_request',request.id,parsed.data.status);
  if(['Resolved','Closed'].includes(parsed.data.status)&&!db.prepare("SELECT id FROM maintenance_requests WHERE room_id=? AND status NOT IN ('Resolved','Closed') LIMIT 1").get(request.room_id)){
    const occupant=db.prepare("SELECT id FROM reservations WHERE room_id=? AND status='Checked-in' AND check_out>? LIMIT 1").get(request.room_id,today());
    if(!occupant){db.prepare("UPDATE rooms SET status='Cleaning' WHERE id=? AND status='Maintenance'").run(request.room_id);
      if(!db.prepare("SELECT id FROM housekeeping_tasks WHERE room_id=? AND status NOT IN ('Clean','Inspected') LIMIT 1").get(request.room_id))db.prepare('INSERT INTO housekeeping_tasks (room_id,priority,instructions) VALUES (?,?,?)').run(request.room_id,'High','Post-maintenance inspection before room returns to service.');}
  }
  res.json({message:'Maintenance request updated. A manager must inspect the room before returning it to sellable inventory.'});
});
app.get('/api/kitchen/orders',requireAuth,requirePermission('kitchen'),(req,res)=>res.json({orders:db.prepare(`SELECT id,room_id AS roomId,(SELECT number FROM rooms WHERE id=room_id) AS room,items,dietary_notes AS dietaryNotes,status,requested_for AS requestedFor,notes FROM kitchen_orders ORDER BY requested_for`).all()}));
app.post('/api/kitchen/orders',requireAuth,requireRoles('admin','manager','receptionist'),(req,res)=>{
  const parsed=z.object({roomId:z.coerce.number().int().positive(),reservationId:z.coerce.number().int().positive().optional(),items:z.string().trim().min(2).max(800),dietaryNotes:z.string().trim().max(400).optional().default(''),requestedFor:z.string().min(1),notes:z.string().trim().max(400).optional().default('')}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  const id=Number(db.prepare('INSERT INTO kitchen_orders (room_id,reservation_id,items,dietary_notes,requested_for,notes) VALUES (?,?,?,?,?,?)').run(parsed.data.roomId,parsed.data.reservationId||null,parsed.data.items,parsed.data.dietaryNotes,parsed.data.requestedFor,parsed.data.notes).lastInsertRowid);
  recordAudit(req.user.id,'created','kitchen_order',id);res.status(201).json({id});
});
app.patch('/api/kitchen/orders/:id',requireAuth,requirePermission('kitchen'),(req,res)=>{
  const parsed=z.object({status:z.enum(['Received','Preparing','Ready','Delivered','Cancelled']),notes:z.string().trim().max(400).optional()}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  const result=db.prepare('UPDATE kitchen_orders SET status=?,notes=COALESCE(?,notes) WHERE id=?').run(parsed.data.status,parsed.data.notes??null,Number(req.params.id));
  if(!result.changes)return res.status(404).json({message:'Kitchen order not found.'});recordAudit(req.user.id,'updated','kitchen_order',Number(req.params.id),parsed.data.status);res.json({message:'Kitchen order updated.'});
});

app.get('/api/rooms', requireAuth, requirePermission('rooms'), (req, res) => {
  const rooms = db.prepare('SELECT id,number,type,status,rate,capacity,floor FROM rooms ORDER BY number').all();
  if(['housekeeping','maintenance'].includes(req.user.role)) return res.json({rooms:rooms.map(({id,number,type,status})=>({id,number,type,status}))});
  if (datePattern.test(req.query.checkIn || '') && datePattern.test(req.query.checkOut || '')) {
    const availableIds = new Set(rooms.filter((room) => ['Available','Occupied'].includes(room.status) && !db.prepare(`SELECT id FROM reservations WHERE room_id=? AND status IN ('Pending','Confirmed','Checked-in') AND check_in<? AND check_out>? LIMIT 1`).get(room.id, req.query.checkOut, req.query.checkIn)).map((room) => room.id));
    return res.json({ rooms: rooms.map((room) => ({ ...room, availableForDates: availableIds.has(room.id) })) });
  }
  res.json({ rooms });
});
app.post('/api/rooms', requireAuth, requireRoles('admin','manager'), (req, res) => {
  const parsed = roomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
  if (parsed.data.status === 'Occupied') return res.status(400).json({ message: 'A room becomes occupied when a confirmed guest is checked in.' });
  try {
    const result = db.prepare('INSERT INTO rooms (number,type,status,rate,capacity,floor) VALUES (?,?,?,?,?,?)').run(parsed.data.number, parsed.data.type, parsed.data.status, parsed.data.rate, parsed.data.capacity, parsed.data.floor);
    recordAudit(req.user.id,'created','room',Number(result.lastInsertRowid),parsed.data.number);
    return res.status(201).json({ room: db.prepare('SELECT * FROM rooms WHERE id=?').get(Number(result.lastInsertRowid)) });
  } catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'That room number already exists.' }); throw error; }
});
app.patch('/api/rooms/:id', requireAuth, requireRoles('admin','manager'), (req, res) => {
  const parsed = roomSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
  const current = db.prepare('SELECT * FROM rooms WHERE id=?').get(Number(req.params.id));
  if (!current) return res.status(404).json({ message: 'Room not found.' });
  const next = { ...current, ...parsed.data };
  if (next.status === 'Occupied' && current.status !== 'Occupied') return res.status(400).json({ message: 'A room becomes occupied when a confirmed guest is checked in.' });
  if(next.status==='Available'&&current.status==='Occupied'&&db.prepare("SELECT id FROM reservations WHERE room_id=? AND status='Checked-in' AND check_out>? LIMIT 1").get(current.id,today()))return res.status(409).json({message:'A checked-in guest still occupies this room.'});
  if(next.status==='Available'&&db.prepare("SELECT id FROM maintenance_requests WHERE room_id=? AND status NOT IN ('Resolved','Closed') LIMIT 1").get(current.id))return res.status(409).json({message:'Open maintenance work must be completed before the room returns to service.'});
  if(next.status==='Available'&&db.prepare("SELECT id FROM housekeeping_tasks WHERE room_id=? AND status NOT IN ('Clean','Inspected') LIMIT 1").get(current.id))return res.status(409).json({message:'Housekeeping must finish and inspect this room before it returns to service.'});
  if (['Cleaning','Maintenance'].includes(next.status) && next.status !== current.status && db.prepare("SELECT id FROM reservations WHERE room_id=? AND status IN ('Pending','Confirmed','Checked-in') AND check_out>? LIMIT 1").get(current.id,today())) return res.status(409).json({ message: 'This room has active bookings; resolve them before changing its operational status.' });
  if (next.status === 'Maintenance' && db.prepare("SELECT id FROM reservations WHERE room_id=? AND status IN ('Pending','Confirmed','Checked-in') AND check_out>? LIMIT 1").get(current.id, today())) return res.status(409).json({ message: 'This room has active bookings; resolve them before placing it in maintenance.' });
  db.prepare('UPDATE rooms SET number=?,type=?,status=?,rate=?,capacity=?,floor=? WHERE id=?').run(next.number,next.type,next.status,next.rate,next.capacity,next.floor,current.id);
  if(next.status==='Maintenance'&&current.status!=='Maintenance')db.prepare('INSERT INTO notifications (kind,message) VALUES (?,?)').run('maintenance',`Room ${next.number} was marked for maintenance.`);
  recordAudit(req.user.id,'updated','room',current.id,JSON.stringify({status:next.status,rate:next.rate}));
  recordAudit(req.user.id,'updated','room',current.id,next.status);
  res.json({ room: db.prepare('SELECT * FROM rooms WHERE id=?').get(current.id) });
});
app.delete('/api/rooms/:id', requireAuth, requireRoles('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (db.prepare('SELECT id FROM reservations WHERE room_id=? LIMIT 1').get(id)) return res.status(409).json({ message: 'Rooms with reservation history cannot be deleted. Set the room to maintenance instead.' });
  const result = db.prepare('DELETE FROM rooms WHERE id=?').run(id);
  if (!result.changes) return res.status(404).json({ message: 'Room not found.' });
  recordAudit(req.user.id,'deleted','room',id);
  recordAudit(req.user.id,'deleted','room',id);
  res.json({ message: 'Room deleted.' });
});

app.get('/api/guests', requireAuth, requirePermission('guests'), (req, res) => {
  const search = `%${String(req.query.search || '').slice(0,100)}%`;
  res.json({ guests: db.prepare(`SELECT g.id,g.name,g.email,g.phone,g.id_details AS idDetails,g.preferences,g.created_at AS createdAt,
    COUNT(r.id) AS reservationCount,MAX(r.check_out) AS lastStay FROM guests g LEFT JOIN reservations r ON r.guest_id=g.id
    WHERE g.name LIKE ? OR g.email LIKE ? OR g.phone LIKE ? GROUP BY g.id ORDER BY g.name`).all(search,search,search) });
});
app.post('/api/guests', requireAuth, requirePermission('guests'), guestWrite);
function guestWrite(req, res) {
  const parsed = guestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
  try {
    const result = db.prepare('INSERT INTO guests (name,email,phone,id_details,preferences) VALUES (?,?,?,?,?)').run(parsed.data.name,parsed.data.email.toLowerCase(),parsed.data.phone,parsed.data.idDetails,parsed.data.preferences);
    recordAudit(req.user.id,'created','guest',Number(result.lastInsertRowid));
    return res.status(201).json({ guest: db.prepare('SELECT * FROM guests WHERE id=?').get(Number(result.lastInsertRowid)) });
  } catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'A guest with that email already exists.' }); throw error; }
}
app.patch('/api/guests/:id', requireAuth, requirePermission('guests'), (req, res) => {
  const parsed = guestSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
  const old = db.prepare('SELECT * FROM guests WHERE id=?').get(Number(req.params.id));
  if (!old) return res.status(404).json({ message: 'Guest not found.' });
  const next = { ...old, ...parsed.data, email: (parsed.data.email || old.email).toLowerCase() };
  try { db.prepare('UPDATE guests SET name=?,email=?,phone=?,id_details=?,preferences=? WHERE id=?').run(next.name,next.email,next.phone,next.id_details,next.preferences,old.id); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'A guest with that email already exists.' }); throw error; }
  recordAudit(req.user.id,'updated','guest',old.id);
  res.json({ guest: db.prepare('SELECT * FROM guests WHERE id=?').get(old.id) });
});
app.get('/api/guests/:id/history', requireAuth, requirePermission('guests'), (req, res) => {
  const guest = db.prepare('SELECT * FROM guests WHERE id=?').get(Number(req.params.id));
  if (!guest) return res.status(404).json({ message: 'Guest not found.' });
  if(req.user.role==='customer'&&guest.account_id!==req.user.id)return res.status(404).json({message:'Guest not found.'});
  res.json({ guest, reservations: db.prepare(`${reservationSelect} WHERE g.id=? ORDER BY r.check_in DESC`).all(guest.id) });
});

app.get('/api/reservations', requireAuth, requirePermission('reservations'), (req, res) => res.json({ reservations: db.prepare(`${reservationSelect} ORDER BY r.check_in DESC,r.id DESC`).all() }));
app.post('/api/reservations', requireAuth, requirePermission('reservations'), (req, res) => {
  const schema = z.object({ guestName:z.string().trim().min(2).max(100),email:z.string().trim().email().max(254),phone:z.string().max(40).optional().default(''),roomId:z.coerce.number().int().positive(),checkIn:z.string().regex(datePattern),checkOut:z.string().regex(datePattern),status:z.enum(['Pending','Confirmed']).default('Pending'),additionalCharges:z.coerce.number().int().min(0).default(0),taxes:z.coerce.number().int().min(0).optional(),discount:z.coerce.number().int().min(0).default(0) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0].message });
  const input = parsed.data;
  if (input.checkIn >= input.checkOut) return res.status(400).json({ message: 'Check-out must be after check-in.' });
  if (input.checkIn < today()) return res.status(400).json({ message: 'Check-in cannot be in the past.' });
  try {
    const id = transaction(() => {
      const availability = canBook(input.roomId,input.checkIn,input.checkOut);
      if (!availability.ok) throw Object.assign(new Error(availability.message),{status:409});
      const room = db.prepare('SELECT * FROM rooms WHERE id=?').get(input.roomId);
      let guest = db.prepare('SELECT id FROM guests WHERE email=? COLLATE NOCASE').get(input.email);
      if (guest) db.prepare('UPDATE guests SET name=?,phone=? WHERE id=?').run(input.guestName,input.phone,guest.id);
      else { const result=db.prepare('INSERT INTO guests (name,email,phone) VALUES (?,?,?)').run(input.guestName,input.email.toLowerCase(),input.phone); guest={id:Number(result.lastInsertRowid)}; }
      const nights=Math.round((new Date(`${input.checkOut}T00:00:00Z`)-new Date(`${input.checkIn}T00:00:00Z`))/86400000);
      const taxes=input.taxes ?? Math.round((nights*room.rate+input.additionalCharges)*db.prepare('SELECT tax_rate FROM hotels WHERE id=1').get().tax_rate/100);
      const total=Math.max(0,nights*room.rate+input.additionalCharges+taxes-input.discount);
      const result=db.prepare(`INSERT INTO reservations (guest_id,room_id,check_in,check_out,status,nightly_rate,additional_charges,taxes,discount,total_amount)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(guest.id,room.id,input.checkIn,input.checkOut,input.status,room.rate,input.additionalCharges,taxes,input.discount,total);
      snapshotInvoice(Number(result.lastInsertRowid));
      recordAudit(req.user.id,'created','reservation',Number(result.lastInsertRowid));
      return Number(result.lastInsertRowid);
    });
    return res.status(201).json({ reservation:getReservation(id) });
  } catch (error) { if (error.status) return res.status(error.status).json({ message:error.message }); throw error; }
});
app.patch('/api/reservations/:id', requireAuth, requirePermission('reservations'), (req, res) => {
  const id=Number(req.params.id); const old=getReservation(id);
  if (!old) return res.status(404).json({ message:'Reservation not found.' });
  const schema=z.object({roomId:z.coerce.number().int().positive().optional(),checkIn:z.string().regex(datePattern).optional(),checkOut:z.string().regex(datePattern).optional(),status:z.enum(['Pending','Confirmed','Checked-in','Checked-out','Cancelled']).optional(),guestName:z.string().trim().min(2).max(100).optional(),email:z.string().trim().email().max(254).optional(),phone:z.string().max(40).optional()}).refine((value)=>Object.keys(value).length>0);
  const parsed=schema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({message:parsed.error.issues[0]?.message||'No valid changes provided.'});
  const input=parsed.data; const next={...old,...input};
  if(next.checkIn>=next.checkOut) return res.status(400).json({message:'Check-out must be after check-in.'});
  if(next.checkIn<today() && next.checkIn!==old.checkIn) return res.status(400).json({message:'Check-in cannot be changed to a past date.'});
  if(input.status==='Checked-in' && old.status!=='Confirmed') return res.status(409).json({message:'Only confirmed reservations can be checked in.'});
  if(input.status==='Checked-in' && next.checkIn>today()) return res.status(409).json({message:'A guest can only be checked in on or after the scheduled check-in date.'});
  if(old.status==='Checked-in' && input.roomId && input.roomId!==old.roomId) return res.status(409).json({message:'Checked-in guests cannot be reassigned to a different room.'});
  if(input.status==='Checked-out' && old.status!=='Checked-in') return res.status(409).json({message:'Only checked-in guests can be checked out.'});
  if(input.status==='Checked-out' && next.checkOut>today()) return res.status(409).json({message:'A guest cannot be checked out before the scheduled departure date.'});
  try {
    transaction(()=>{
      if(input.status==='Cancelled'&&old.cancellationRequestedAt){db.prepare('UPDATE reservations SET cancellation_requested_at=NULL WHERE id=?').run(id);}
      if(next.status==='Confirmed'||next.status==='Checked-in') { const availability=canBook(next.roomId,next.checkIn,next.checkOut,id); if(!availability.ok) throw Object.assign(new Error(availability.message),{status:409}); }
      let guestId=old.guestId;
      if(input.guestName||input.email||input.phone!==undefined){const guest=db.prepare('SELECT * FROM guests WHERE id=?').get(old.guestId);const name=input.guestName||guest.name;const email=(input.email||guest.email).toLowerCase();db.prepare('UPDATE guests SET name=?,email=?,phone=? WHERE id=?').run(name,email,input.phone??guest.phone,guest.id);}
      let room=db.prepare('SELECT rate FROM rooms WHERE id=?').get(next.roomId); if(!room) throw Object.assign(new Error('Room not found.'),{status:404});
      const agreedRate=next.roomId===old.roomId?old.nightlyRate:room.rate;
      const nights=Math.round((new Date(`${next.checkOut}T00:00:00Z`)-new Date(`${next.checkIn}T00:00:00Z`))/86400000);
      db.prepare(`UPDATE reservations SET room_id=?,check_in=?,check_out=?,status=?,nightly_rate=?,total_amount=MAX(0,?*?+additional_charges+taxes-discount),updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(next.roomId,next.checkIn,next.checkOut,next.status,agreedRate,nights,agreedRate,id);
      snapshotInvoice(id);
      if(input.status==='Checked-in') db.prepare("UPDATE rooms SET status='Occupied' WHERE id=?").run(next.roomId);
      if(input.status==='Checked-out') db.prepare("UPDATE rooms SET status='Cleaning' WHERE id=?").run(next.roomId);
      if(input.status==='Checked-out') db.prepare('INSERT INTO housekeeping_tasks (room_id,priority,instructions) VALUES (?,?,?)').run(next.roomId,'High','Turnover after guest checkout; inspect and mark ready.');
      if(input.status==='Cancelled' && old.status==='Checked-in') db.prepare("UPDATE rooms SET status='Cleaning' WHERE id=?").run(old.roomId);
      recordAudit(req.user.id,'updated','reservation',id,next.status);
    });
    if(input.status==='Cancelled') db.prepare('INSERT INTO notifications (kind,message) VALUES (?,?)').run('cancellation',`Reservation #${id} was cancelled.`);
    if(input.status==='Checked-in') db.prepare('INSERT INTO notifications (kind,message) VALUES (?,?)').run('arrival',`${old.guest} checked in to room ${next.room}.`);
    return res.json({reservation:getReservation(id)});
  } catch(error){if(error.status)return res.status(error.status).json({message:error.message});throw error;}
});

app.get('/api/calendar', requireAuth, requireRoles('admin','manager','receptionist'), (req,res)=>{
  const from=datePattern.test(req.query.from||'')?req.query.from:today();
  const to=datePattern.test(req.query.to||'')?req.query.to:new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  res.json({from,to,reservations:db.prepare(`${reservationSelect} WHERE r.check_in<? AND r.check_out>? AND r.status<>'Cancelled' ORDER BY r.check_in,room.number`).all(to,from)});
});
app.get('/api/payments', requireAuth, requirePermission('finance'), (req,res)=>{
  const personal=['admin','manager'].includes(req.user.role);
  const rows=db.prepare(`SELECT p.id,p.reservation_id AS reservationId,p.amount,p.method,p.status,p.transaction_ref AS reference,p.paid_at AS paidAt,g.name AS guest,room.number AS room
    FROM payments p JOIN reservations r ON r.id=p.reservation_id JOIN guests g ON g.id=r.guest_id JOIN rooms room ON room.id=r.room_id ORDER BY p.paid_at DESC`).all();
  res.json({payments:rows.map((p)=>({id:p.id,amount:p.amount,method:p.method,status:p.status==='Completed'?'Successful':p.status,reference:p.reference,paidAt:p.paidAt,...(personal?{guest:p.guest,room:p.room,reservationId:p.reservationId}:{})}))});
});
app.post('/api/reservations/:id/payments', requireAuth, requirePermission('payments'), (req,res)=>{
  const parsed=z.object({amount:z.coerce.number().int().positive(),method:z.enum(['Cash','Card terminal (offline)','Bank transfer','Other']),reference:z.string().max(100).optional().default('')}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  let result;
  try { result=transaction(()=>{const reservation=db.prepare('SELECT id,total_amount FROM reservations WHERE id=?').get(Number(req.params.id));if(!reservation)throw Object.assign(new Error('Reservation not found.'),{status:404});
      if(parsed.data.reference){const previous=db.prepare('SELECT id,reservation_id,amount,method FROM payments WHERE transaction_ref=?').get(parsed.data.reference);
        if(previous){if(previous.reservation_id!==reservation.id||previous.amount!==parsed.data.amount||previous.method!==parsed.data.method)throw Object.assign(new Error('This transaction reference was already used for a different payment.'),{status:409});return previous.id;}}
      const paid=db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE reservation_id=? AND status='Completed'").get(reservation.id).total;
    if(parsed.data.amount>reservation.total_amount-paid)throw Object.assign(new Error('Payment exceeds the outstanding balance.'),{status:400});
    return Number(db.prepare('INSERT INTO payments (reservation_id,amount,method,transaction_ref,created_by) VALUES (?,?,?,?,?)').run(reservation.id,parsed.data.amount,parsed.data.method,parsed.data.reference,req.user.id).lastInsertRowid);}); }
  catch(error) { if(error.status)return res.status(error.status).json({message:error.message}); throw error; }
  recordAudit(req.user.id,'recorded','payment',result);
  res.status(201).json({payment:db.prepare('SELECT * FROM payments WHERE id=?').get(result)});
});
app.get('/api/reports', requireAuth, requirePermission('finance'), (req,res)=>{
  const from=datePattern.test(req.query.from||'')?req.query.from:`${today().slice(0,7)}-01`;
  const to=datePattern.test(req.query.to||'')?req.query.to:new Date().toISOString().slice(0,10);
  if(from>to)return res.status(400).json({message:'Start date must be on or before end date.'});
  const totals=db.prepare("SELECT COALESCE(SUM(amount),0) AS received,COUNT(*) AS transactions FROM payments WHERE status='Completed' AND date(paid_at)>=date(?) AND date(paid_at)<date(?, '+1 day')").get(from,to);
  const bookings=db.prepare("SELECT status,COUNT(*) AS count,COALESCE(SUM(total_amount),0) AS value FROM reservations WHERE date(created_at)>=date(?) AND date(created_at)<date(?, '+1 day') GROUP BY status").all(from,to);
  const outstanding=db.prepare(`SELECT COALESCE(SUM(MAX(0,r.total_amount-COALESCE(p.paid,0)+COALESCE(f.refunded,0))),0) AS total
    FROM reservations r LEFT JOIN (SELECT reservation_id,SUM(amount) paid FROM payments WHERE status='Completed' GROUP BY reservation_id) p ON p.reservation_id=r.id
    LEFT JOIN (SELECT p.reservation_id,SUM(f.amount) refunded FROM refunds f JOIN payments p ON p.id=f.payment_id WHERE f.status='Completed' GROUP BY p.reservation_id) f ON f.reservation_id=r.id
    WHERE r.status<>'Cancelled'`).get().total;
  const grossCharges=db.prepare("SELECT COALESCE(SUM(total_amount),0) AS total FROM reservations WHERE status<>'Cancelled' AND date(check_in)>=date(?) AND date(check_in)<date(?, '+1 day')").get(from,to).total;
  const refunds=db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM refunds WHERE status='Completed' AND date(created_at)>=date(?) AND date(created_at)<date(?, '+1 day')").get(from,to).total;
  const recognizedRevenue=db.prepare("SELECT COALESCE(SUM(total_amount),0) AS total FROM reservations WHERE status='Checked-out' AND date(check_out)>=date(?) AND date(check_out)<date(?, '+1 day')").get(from,to).total;
  const expenses=db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE status='Approved' AND date(expense_date)>=date(?) AND date(expense_date)<=date(?)").get(from,to).total;
  const paymentBreakdown=db.prepare("SELECT method,COUNT(*) AS count,SUM(amount) AS total FROM payments WHERE status='Completed' AND date(paid_at)>=date(?) AND date(paid_at)<date(?, '+1 day') GROUP BY method").all(from,to);
  const paymentStatusCounts=db.prepare(`SELECT CASE WHEN COALESCE(p.paid,0)=0 THEN 'unpaid' WHEN p.paid<r.total_amount THEN 'partially_paid' ELSE 'paid' END AS status,COUNT(*) AS count
    FROM reservations r LEFT JOIN (SELECT reservation_id,SUM(amount) paid FROM payments WHERE status='Completed' GROUP BY reservation_id) p ON p.reservation_id=r.id
    WHERE r.status<>'Cancelled' AND date(r.check_in)>=date(?) AND date(r.check_in)<date(?, '+1 day') GROUP BY status`).all(from,to);
  const occupancy=db.prepare("SELECT date(check_in) AS date,COUNT(DISTINCT room_id) AS rooms FROM reservations WHERE status IN ('Confirmed','Checked-in') AND check_in>=? AND check_in<=? GROUP BY date(check_in) ORDER BY date").all(from,to);
  const paymentRows=db.prepare(`SELECT p.id,p.amount,p.method,p.status,p.paid_at AS paidAt,g.name AS guest,room.number AS room FROM payments p JOIN reservations r ON r.id=p.reservation_id JOIN guests g ON g.id=r.guest_id JOIN rooms room ON room.id=r.room_id WHERE date(p.paid_at)>=date(?) AND date(p.paid_at)<date(?, '+1 day') ORDER BY p.paid_at DESC`).all(from,to);
  const payments=paymentRows.map((p)=>({id:p.id,amount:p.amount,method:p.method,status:p.status,paidAt:p.paidAt,...(['admin','manager'].includes(req.user.role)?{guest:p.guest,room:p.room}:{})}));
  const netCash=Number(totals.received)-Number(refunds);
  const netRecognizedRevenue=Number(recognizedRevenue)-Number(refunds);
  res.json({from,to,grossCharges:Number(grossCharges),recognizedRevenue:netRecognizedRevenue,received:Number(totals.received),refunds:Number(refunds),netCash,expenses:Number(expenses),netOperatingResult:netRecognizedRevenue-Number(expenses),transactions:totals.transactions,outstanding:Number(outstanding),bookings,paymentBreakdown,paymentStatusCounts,occupancy,payments});
});
app.get('/api/expenses',requireAuth,requirePermission('finance'),(req,res)=>res.json({expenses:db.prepare(`SELECT id,category,description,amount,status,expense_date AS expenseDate,reference,created_at AS createdAt FROM expenses ORDER BY expense_date DESC`).all()}));
app.post('/api/expenses',requireAuth,requirePermission('finance'),(req,res)=>{
  const parsed=z.object({category:z.string().trim().min(2).max(60),description:z.string().trim().min(2).max(240),amount:z.coerce.number().int().positive(),expenseDate:z.string().regex(datePattern),reference:z.string().trim().max(100).optional().default('')}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  const status=req.user.role==='admin'?'Approved':'Pending';
  const id=Number(db.prepare('INSERT INTO expenses (category,description,amount,status,expense_date,reference,created_by) VALUES (?,?,?,?,?,?,?)').run(parsed.data.category,parsed.data.description,parsed.data.amount,status,parsed.data.expenseDate,parsed.data.reference,req.user.id).lastInsertRowid);
  recordAudit(req.user.id,'created','expense',id,`status=${status}`);res.status(201).json({expense:db.prepare('SELECT * FROM expenses WHERE id=?').get(id)});
});
app.patch('/api/expenses/:id/approve',requireAuth,requireRoles('admin'),(req,res)=>{
  const result=db.prepare("UPDATE expenses SET status='Approved' WHERE id=? AND status='Pending'").run(Number(req.params.id));
  if(!result.changes)return res.status(404).json({message:'Pending expense not found.'});recordAudit(req.user.id,'approved','expense',Number(req.params.id));res.json({message:'Expense approved.'});
});
app.post('/api/refunds',requireAuth,requireRoles('admin','manager','finance'),(req,res)=>{
  const parsed=z.object({paymentId:z.coerce.number().int().positive(),amount:z.coerce.number().int().positive(),reason:z.string().trim().min(2).max(240)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  try{
    const id=transaction(()=>{
      const payment=db.prepare('SELECT id,amount FROM payments WHERE id=? AND status=\'Completed\'').get(parsed.data.paymentId);
      if(!payment)throw Object.assign(new Error('Successful payment not found.'),{status:404});
      const refunded=db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM refunds WHERE payment_id=? AND status IN ('Pending','Completed')").get(payment.id).total;
      if(parsed.data.amount>payment.amount-refunded)throw Object.assign(new Error('Refund exceeds the unrefunded payment amount.'),{status:400});
      const status=req.user.role==='admin'?'Completed':'Pending';
      return Number(db.prepare('INSERT INTO refunds (payment_id,amount,status,reason,created_by) VALUES (?,?,?,?,?)').run(payment.id,parsed.data.amount,status,parsed.data.reason,req.user.id).lastInsertRowid);
    });
    recordAudit(req.user.id,'requested_refund','refund',id,`amount=${parsed.data.amount}`);res.status(201).json({refund:db.prepare('SELECT * FROM refunds WHERE id=?').get(id)});
  }catch(error){if(error.status)return res.status(error.status).json({message:error.message});throw error;}
});
app.get('/api/refunds',requireAuth,requirePermission('finance'),(req,res)=>res.json({refunds:db.prepare(`SELECT f.id,f.payment_id AS paymentId,f.amount,f.status,f.reason,f.transaction_ref AS reference,f.created_at AS createdAt,g.name AS guest,room.number AS room FROM refunds f JOIN payments p ON p.id=f.payment_id JOIN reservations r ON r.id=p.reservation_id JOIN guests g ON g.id=r.guest_id JOIN rooms room ON room.id=r.room_id ORDER BY f.created_at DESC`).all()}));
app.patch('/api/refunds/:id/approve',requireAuth,requireRoles('admin'),(req,res)=>{
  const result=db.prepare("UPDATE refunds SET status='Completed' WHERE id=? AND status='Pending'").run(Number(req.params.id));
  if(!result.changes)return res.status(404).json({message:'Pending refund not found.'});recordAudit(req.user.id,'approved','refund',Number(req.params.id));res.json({message:'Refund recorded as completed.'});
});
app.get('/api/reservations/:id/invoice',requireAuth,requireRoles('admin','manager','receptionist','finance','customer'),(req,res)=>{
  const invoice=db.prepare(`SELECT i.id,i.reservation_id AS reservationId,i.confirmation_number AS confirmationNumber,i.subtotal,i.taxes,i.discount,i.total,i.snapshot
    FROM invoices i JOIN reservations r ON r.id=i.reservation_id JOIN guests g ON g.id=r.guest_id WHERE i.reservation_id=? AND (?='customer' AND g.account_id=? OR ?<>'customer' AND ? IN ('admin','manager','receptionist','finance'))`).get(Number(req.params.id),req.user.role,req.user.id,req.user.role,req.user.role);
  if(!invoice)return res.status(404).json({message:'Invoice not found.'});res.json({invoice:{...invoice,snapshot:JSON.parse(invoice.snapshot)}});
});
app.get('/api/guests/:id/financial-summary',requireAuth,requirePermission('finance'),(req,res)=>{
  const guest=db.prepare('SELECT id,name,email FROM guests WHERE id=?').get(Number(req.params.id));if(!guest)return res.status(404).json({message:'Guest not found.'});
  const summary=db.prepare(`SELECT COUNT(DISTINCT CASE WHEN r.status='Checked-out' THEN r.id END) AS completedStays,
    COALESCE(SUM(CASE WHEN r.status<>'Cancelled' THEN r.total_amount ELSE 0 END),0) AS totalCharges FROM reservations r WHERE r.guest_id=?`).get(guest.id);
  const payments=db.prepare("SELECT COALESCE(SUM(p.amount),0) AS total FROM payments p JOIN reservations r ON r.id=p.reservation_id WHERE r.guest_id=? AND p.status='Completed'").get(guest.id).total;
  const refunds=db.prepare("SELECT COALESCE(SUM(f.amount),0) AS total FROM refunds f JOIN payments p ON p.id=f.payment_id JOIN reservations r ON r.id=p.reservation_id WHERE r.guest_id=? AND f.status='Completed'").get(guest.id).total;
  res.json({guest,completedStays:summary.completedStays,totalCharges:summary.totalCharges,totalPayments:payments,refunds,outstanding:Math.max(0,Number(summary.totalCharges)-Number(payments)+Number(refunds))});
});
app.get('/api/guest-financial-summaries',requireAuth,requirePermission('finance'),(req,res)=>{
  const summaries=db.prepare(`SELECT g.id,g.name,g.email,
    (SELECT COUNT(*) FROM reservations r WHERE r.guest_id=g.id AND r.status='Checked-out') AS completedStays,
    (SELECT COALESCE(SUM(r.total_amount),0) FROM reservations r WHERE r.guest_id=g.id AND r.status<>'Cancelled') AS totalCharges,
    (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN reservations r ON r.id=p.reservation_id WHERE r.guest_id=g.id AND p.status='Completed') AS totalPayments,
    (SELECT COALESCE(SUM(f.amount),0) FROM refunds f JOIN payments p ON p.id=f.payment_id JOIN reservations r ON r.id=p.reservation_id WHERE r.guest_id=g.id AND f.status='Completed') AS refunds
    FROM guests g ORDER BY g.name`).all();
  res.json({summaries:summaries.map((item)=>({...item,outstanding:Math.max(0,Number(item.totalCharges)-Number(item.totalPayments)+Number(item.refunds))}))});
});
app.get('/api/settings', requireAuth, requireRoles('admin','manager','receptionist','finance','housekeeping','maintenance','kitchen'), (req,res)=>{
  const hotel=db.prepare('SELECT name,address,phone,email,tax_rate AS taxRate FROM hotels WHERE id=1').get();
  if(!['admin','manager'].includes(req.user.role))delete hotel.taxRate;
  const users=req.user.role==='admin'?db.prepare('SELECT id,name,email,role_key AS role,account_status AS accountStatus,phone,employee_id AS employeeId,department,created_at AS createdAt,last_login AS lastLogin FROM users ORDER BY name').all():[];
  res.json({hotel,users});
});
app.patch('/api/settings', requireAuth, requireRoles('admin'), (req,res)=>{
  const parsed=z.object({name:z.string().trim().min(2).max(100),address:z.string().trim().max(200),phone:z.string().trim().max(40),email:z.string().trim().email().max(254),taxRate:z.coerce.number().min(0).max(100)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  db.prepare('UPDATE hotels SET name=?,address=?,phone=?,email=?,tax_rate=? WHERE id=1').run(parsed.data.name,parsed.data.address,parsed.data.phone,parsed.data.email,parsed.data.taxRate);
  recordAudit(req.user.id,'updated','hotel',1,parsed.data.name);
  res.json({hotel:db.prepare('SELECT name,address,phone,email,tax_rate AS taxRate FROM hotels WHERE id=1').get()});
});
app.get('/api/staff',requireAuth,requireRoles('admin'),(_req,res)=>res.json({staff:db.prepare(`SELECT id,name,email,role_key AS role,account_status AS accountStatus,phone,employee_id AS employeeId,department,created_at AS createdAt,last_login AS lastLogin FROM users ORDER BY name`).all()}));
app.get('/api/guest-requests',requireAuth,requireRoles('admin','manager','receptionist'),(_req,res)=>res.json({requests:db.prepare(`SELECT q.id,q.category,q.message,q.status,q.created_at AS createdAt,g.name AS guest FROM guest_requests q JOIN guests g ON g.id=q.guest_id ORDER BY q.created_at DESC`).all()}));
app.get('/api/operations/queues',requireAuth,requireRoles('admin','manager'),(_req,res)=>res.json({
  housekeeping:db.prepare(`SELECT t.id,room.number AS room,t.status,t.priority,t.instructions,t.created_at AS createdAt FROM housekeeping_tasks t JOIN rooms room ON room.id=t.room_id ORDER BY t.created_at DESC LIMIT 100`).all(),
  maintenance:db.prepare(`SELECT m.id,room.number AS room,m.issue,m.status,m.priority,m.work_notes AS workNotes,m.created_at AS createdAt FROM maintenance_requests m JOIN rooms room ON room.id=m.room_id ORDER BY m.created_at DESC LIMIT 100`).all(),
  kitchen:db.prepare(`SELECT k.id,room.number AS room,k.items,k.status,k.dietary_notes AS dietaryNotes,k.requested_for AS requestedFor FROM kitchen_orders k JOIN rooms room ON room.id=k.room_id ORDER BY k.requested_for LIMIT 100`).all(),
}));
app.post('/api/staff',requireAuth,requireRoles('admin'),async(req,res,next)=>{
  const parsed=z.object({name:z.string().trim().min(2).max(80),email:z.string().trim().email().max(254),phone:z.string().trim().max(40).optional().default(''),password:z.string().min(12).max(72),role:z.enum(roles.filter((role)=>role!=='customer')),employeeId:z.string().trim().max(40).optional().default(''),department:z.string().trim().max(80).optional().default('')}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0].message});
  try{
    const hash=await bcrypt.hash(parsed.data.password,12);
    const result=db.prepare(`INSERT INTO users (name,email,password_hash,role,role_key,phone,employee_id,department,account_status)
      VALUES (?,?,?,?,?,?,?,?,'active')`).run(parsed.data.name,parsed.data.email.toLowerCase(),hash,parsed.data.role==='manager'?'manager':parsed.data.role==='admin'?'admin':'receptionist',parsed.data.role,parsed.data.phone,parsed.data.employeeId,parsed.data.department);
    const id=Number(result.lastInsertRowid);recordAudit(req.user.id,'created','user',id,`role=${parsed.data.role}`);
    res.status(201).json({staff:db.prepare('SELECT id,name,email,role_key AS role,account_status AS accountStatus,phone,employee_id AS employeeId,department,created_at AS createdAt FROM users WHERE id=?').get(id)});
  }catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({message:'An account with this email already exists.'});return next(error);}
});
app.patch('/api/settings/users/:id', requireAuth, requireRoles('admin'), (req,res)=>{
  const parsed=z.object({role:z.enum(roles),accountStatus:z.enum(['active','suspended','pending']).optional()}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Select a valid role or account status.'});
  const id=Number(req.params.id);
  if(id===req.user.id&&(parsed.data.role!=='admin'||parsed.data.accountStatus==='suspended'))return res.status(400).json({message:'You cannot remove or suspend your own administrator account.'});
  const account=db.prepare('SELECT id,role_key FROM users WHERE id=?').get(id);if(!account)return res.status(404).json({message:'User not found.'});
  const role=parsed.data.role||account.role_key;const legacyRole=role==='admin'?'admin':role==='manager'?'manager':'receptionist';
  db.prepare('UPDATE users SET role=?,role_key=?,account_status=COALESCE(?,account_status) WHERE id=?').run(legacyRole,role,parsed.data.accountStatus||null,id);
  recordAudit(req.user.id,'updated','user',id,JSON.stringify({role,accountStatus:parsed.data.accountStatus}));res.json({message:'User role/status updated.'});
});
app.get('/api/audit-logs',requireAuth,requireRoles('admin'),(req,res)=>res.json({logs:db.prepare(`SELECT a.id,a.action,a.entity,a.entity_id AS entityId,a.details,a.created_at AS createdAt,u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200`).all()}));
app.get('/api/notifications', requireAuth, requireRoles('admin','manager','receptionist','finance','housekeeping','maintenance','kitchen'), (req,res)=>{
  const rows=db.prepare('SELECT id,kind,message,created_at AS createdAt,read_at AS readAt FROM notifications ORDER BY created_at DESC LIMIT 50').all();
  const allowed=['housekeeping','maintenance'].includes(req.user.role)?rows.filter((item)=>item.kind==='maintenance'):
    req.user.role==='finance'?rows.filter((item)=>['cancellation','cancellation_request'].includes(item.kind)).map((item)=>({...item,message:item.message.replace(/#[0-9]+/g,'a reservation')})):
    req.user.role==='kitchen'?[]:rows;
  res.json({notifications:allowed});
});
app.patch('/api/notifications/:id/read', requireAuth, requireRoles('admin','manager','receptionist','finance','housekeeping','maintenance','kitchen'), (req,res)=>{
  const notification=db.prepare('SELECT kind FROM notifications WHERE id=?').get(Number(req.params.id));if(!notification)return res.status(404).json({message:'Notification not found.'});
  if((['housekeeping','maintenance'].includes(req.user.role)&&notification.kind!=='maintenance')||req.user.role==='kitchen')return res.status(403).json({message:'You cannot modify this notification.'});
  db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=?').run(Number(req.params.id));res.json({message:'Notification marked as read.'});
});

app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({message:'Something went wrong. Please try again.'});});
app.listen(port,()=>console.log(`Haven API listening on http://localhost:${port}`));
