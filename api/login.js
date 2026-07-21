const crypto = require('crypto');
const { createSession, sessionCookie } = require('./_auth');

function safeEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left)).digest();
  const rightHash = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const configuredUsername = process.env.ADMIN_USERNAME || 'admin';
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredPassword) {
    return res.status(503).json({ error: 'Defina ADMIN_PASSWORD nas variáveis de ambiente da Vercel.' });
  }

  const { username = '', password = '' } = req.body || {};
  if (!safeEqual(username.trim(), configuredUsername) || !safeEqual(password, configuredPassword)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }

  const token = createSession(configuredUsername);
  res.setHeader('Set-Cookie', sessionCookie(token));
  return res.status(200).json({ ok: true, username: configuredUsername });
};
