const crypto = require('crypto');

const COOKIE_NAME = 'hengst_admin_session';
const SESSION_DURATION_SECONDS = 60 * 60 * 12;

function getSecret() {
  return process.env.SESSION_SECRET || process.env.SUPABASE_SECRET_KEY;
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function createSession(username) {
  if (!getSecret()) throw new Error('SESSION_SECRET ou SUPABASE_SECRET_KEY não configurada.');
  const payload = encode(JSON.stringify({ username, expiresAt: Date.now() + SESSION_DURATION_SECONDS * 1000 }));
  return `${payload}.${sign(payload)}`;
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(item => {
    const separator = item.indexOf('=');
    return separator < 0 ? ['', ''] : [item.slice(0, separator).trim(), decodeURIComponent(item.slice(separator + 1))];
  }).filter(([key]) => key));
}

function isAuthenticated(req) {
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token || !getSecret()) return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expected = sign(payload);
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION_SECONDS}`;
}

module.exports = { createSession, isAuthenticated, sessionCookie };
