import jwt from 'jsonwebtoken';
import { db } from './db.js';

const secret = process.env.JWT_SECRET || 'local-development-secret-change-before-deploy-please';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 1000 * 60 * 60 * 24 * 7,
};

export function issueToken(user) {
  return jwt.sign({ sub: String(user.id), ver: user.tokenVersion ?? 0 }, secret, { expiresIn: '7d' });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.haven_session;
  if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });

  try {
    const payload = jwt.verify(token, secret);
    const user = db.prepare(`SELECT id,name,email,phone,role_key AS role,account_status AS accountStatus,token_version AS tokenVersion
      FROM users WHERE id=?`).get(Number(payload.sub));
    if (!user) return res.status(401).json({ message: 'Your session is no longer valid.' });
    if ((payload.ver ?? 0) !== user.tokenVersion) return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    if (user.accountStatus !== 'active') return res.status(403).json({ message: 'This account has been suspended. Contact the hotel administrator.' });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
  }
}
