import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';

const COOKIE_NAME = 'helpline_session';
const SESSION_SECONDS = 8 * 60 * 60;
const loginFailures = new Map();
const activeSessions = new Map();
let cachedConfig;

function config() {
  const { AUTH_USERNAME: username, AUTH_PASSWORD: password, AUTH_SECRET: secret } = process.env;
  const cacheKey = `${username}\0${password}\0${secret}`;
  if (cachedConfig?.cacheKey === cacheKey) return cachedConfig.value;
  const value = !username || !password || password.length < 12 || !secret || Buffer.byteLength(secret) < 32
    ? null
    : { username, passwordHash: scryptSync(password, secret, 64), secret };
  cachedConfig = { cacheKey, value };
  return value;
}

function equal(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieOptions() {
  const options = ['HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSION_SECONDS}`];
  if (process.env.NODE_ENV === 'production') options.push('Secure');
  return options.join('; ');
}

function signature(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function sessionToken(username, secret) {
  const sessionId = randomBytes(32).toString('base64url');
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  for (const [id, session] of activeSessions) {
    if (session.expiresAt <= Date.now() / 1000) activeSessions.delete(id);
  }
  activeSessions.set(sessionId, { username, expiresAt });
  const payload = Buffer.from(JSON.stringify({
    username,
    sessionId,
    expiresAt
  })).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}

function readSession(req, authConfig) {
  const cookie = req.headers.cookie?.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;
  const token = cookie.slice(COOKIE_NAME.length + 1);
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature || !equal(suppliedSignature, signature(payload, authConfig.secret))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (session.username !== authConfig.username || session.expiresAt <= Date.now() / 1000) return null;
    const activeSession = activeSessions.get(session.sessionId);
    if (!activeSession || activeSession.expiresAt !== session.expiresAt) return null;
    return session;
  } catch {
    return null;
  }
}

export function validateOrigin(req, res, next) {
  const allowedOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  if (req.headers.origin && req.headers.origin !== allowedOrigin) {
    return res.status(403).json({ error: 'Origen no permitido' });
  }
  next();
}

export function authenticate(req, res, next) {
  const authConfig = config();
  if (!authConfig) {
    return res.status(503).json({ error: 'Configura AUTH_USERNAME, AUTH_PASSWORD y AUTH_SECRET en backend/.env' });
  }
  const session = readSession(req, authConfig);
  if (!session) return res.status(401).json({ error: 'Inicia sesión para continuar' });
  req.auth = { username: session.username, sessionId: session.sessionId };
  next();
}

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const authConfig = config();
  if (!authConfig) {
    return res.status(503).json({ error: 'Configura AUTH_USERNAME, AUTH_PASSWORD y AUTH_SECRET en backend/.env' });
  }

  const now = Date.now();
  const ip = req.ip;
  for (const [address, attempt] of loginFailures) {
    if (attempt.updatedAt < now - 15 * 60 * 1000 && attempt.lockedUntil <= now) loginFailures.delete(address);
  }
  const failures = loginFailures.get(ip);
  if (failures?.lockedUntil > now) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.' });
  }

  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const passwordHash = scryptSync(password, authConfig.secret, 64);
  if (!equal(username, authConfig.username) || !timingSafeEqual(passwordHash, authConfig.passwordHash)) {
    const attempts = (failures?.attempts || 0) + 1;
    if (!loginFailures.has(ip) && loginFailures.size >= 10000) {
      loginFailures.delete(loginFailures.keys().next().value);
    }
    loginFailures.set(ip, {
      attempts,
      lockedUntil: attempts >= 5 ? now + 15 * 60 * 1000 : 0,
      updatedAt: now
    });
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  loginFailures.delete(ip);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${sessionToken(authConfig.username, authConfig.secret)}; ${cookieOptions()}`);
  res.json({ username: authConfig.username });
});

authRouter.get('/session', authenticate, (req, res) => res.json({ username: req.auth.username }));

authRouter.post('/logout', authenticate, (req, res) => {
  activeSessions.delete(req.auth.sessionId);
  const options = ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') options.push('Secure');
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${options.join('; ')}`);
  res.status(204).end();
});
