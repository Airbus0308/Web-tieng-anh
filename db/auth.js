import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { COLLECTIONS } from './store.js';

const scrypt = promisify(crypto.scrypt);
const MAX_DEVICES_PER_USER = 3;
const INACTIVITY_MS = 60 * 86400000;
const COOKIE_AGE = 400 * 86400;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const uid = prefix => `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
const token = () => crypto.randomBytes(32).toString('base64url');
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const publicSession = s => ({ id: s.id, label: s.label, lastSeenAt: s.lastSeenAt, createdAt: s.createdAt });
const active = s => Date.parse(s.lastSeenAt) > Date.now() - INACTIVITY_MS && Date.parse(s.expiresAt) > Date.now();
const cookieOptions = () => ({ httpOnly: true, path: '/', maxAge: COOKIE_AGE * 1000, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' });
const defaultProfile = id => ({ id, kind: 'guest', role: 'guest', displayName: 'Học viên IELTS', targetBand: null, examDate: null, commitment: null, streak: null, achievements: [], createdAt: new Date().toISOString() });
const requestLabel = req => String(req.get('user-agent') || 'Unknown device').slice(0, 200);
const parseCookie = req => {
  const value = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('im_uid='))?.slice(7);
  if (!value || !/^usr_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const [userId, sessionToken] = value.split('.'); return { userId, sessionHash: hash(sessionToken) };
};
const generateCode = () => { const bytes = crypto.randomBytes(8); const chars = [...bytes].map(n => alphabet[n & 31]).join(''); return `IELTS-${chars.slice(0,4)}-${chars.slice(4)}`; };
const codeHash = async (passcode, salt) => (await scrypt(passcode, salt, 64)).toString('hex');
const verifyCode = async (code, entry) => {
  if (!entry?.salt || !entry?.passcodeHash) return false;
  const actual = Buffer.from(await codeHash(code, entry.salt), 'hex'), expected = Buffer.from(entry.passcodeHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

export function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.profile?.role) ? next() : res.status(403).json({ error:'forbidden' });
}

export function installAuth(app, store) {
  async function createSession(userId, req, sessions) {
    const raw = token(), now = new Date();
    const session = { id: uid('ses'), userId, sessionHash: hash(raw), label: requestLabel(req), createdAt: now.toISOString(), lastSeenAt: now.toISOString(), expiresAt: new Date(now.getTime() + COOKIE_AGE * 1000).toISOString() };
    sessions.push(session);
    return { session, raw };
  }
  function setCookie(res, userId, raw) { res.cookie('im_uid', `${userId}.${raw}`, cookieOptions()); }

  // Requests without Origin remain usable by non-browser clients; a browser Origin must be same-origin.
  app.use('/api', (req, res, next) => {
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin = req.get('Origin');
      if (origin) {
        try { const url = new URL(origin); if (url.host !== req.get('host') || url.protocol !== `${req.protocol}:`) return res.status(403).json({ error: 'origin_mismatch' }); }
        catch { return res.status(403).json({ error: 'origin_mismatch' }); }
      } else if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: 'origin_mismatch' });
    }
    next();
  });
  // Establish the cookie on the document response before its scripts issue parallel API calls.
  app.use(['/api', /^\/(?:index|writing|speaking|study|analytics)\.html$/, /^\/$/], async (req, res, next) => {
    if (req.baseUrl === '/api' && req.path === '/health') return next();
    try {
      const auth = await store.withLock('auth', async () => {
        const sessions = (await store.auth('sessions')).filter(active);
        const parsed = parseCookie(req);
        let session = parsed && sessions.find(s => s.userId === parsed.userId && s.sessionHash === parsed.sessionHash);
        let profile = session && await store.getProfile(session.userId);
        if (!session || !profile) {
          const userId = uid('usr'); profile = defaultProfile(userId);
          const users = await store.auth('users');
          if (!users.length) await store.migrateFirstUser(userId);
          await store.putProfile(userId, profile); users.push({ id: userId, createdAt: profile.createdAt }); await store.putAuth('users', users);
          const created = await createSession(userId, req, sessions); session = created.session;
          setCookie(res, userId, created.raw);
        } else session.lastSeenAt = new Date().toISOString();
        await store.putAuth('sessions', sessions);
        return { session, profile };
      });
      req.userId = auth.profile.id; req.session = auth.session; req.profile = auth.profile;
      res.set('Cache-Control', 'no-store');
      const rateRelease = req.path === '/auth/redeem' ? await store.acquire(`redeem_${hash(req.ip || 'unknown')}`) : null;
      let release;
      try { release = await store.acquire(`user_${req.userId}`); } catch (err) { if (rateRelease) await rateRelease(); throw err; }
      let stillActive;
      try { stillActive = (await store.auth('sessions')).some(s => s.id === req.session.id && s.userId === req.userId && active(s)); }
      catch (err) { await release(); if (rateRelease) await rateRelease(); throw err; }
      if (!stillActive) { await release(); if (rateRelease) await rateRelease(); return res.status(401).json({ error:'session_revoked' }); }
      let released = false;
      const unlock = () => { if (!released) { released = true; release().then(() => rateRelease?.()).catch(err => console.error('[ERROR] release lock:', err.message)); } };
      res.once('finish', unlock); res.once('close', unlock);
      next();
    } catch (err) { console.error('[ERROR] identity:', err.message); return res.status(503).json({ error: 'identity_unavailable' }); }
  });
  app.get('/api/me', async (req, res) => {
    try {
      const profile = await store.getProfile(req.userId);
      const passcodes = await store.auth('passcodes');
      const devices = (await store.auth('sessions')).filter(s => s.userId === req.userId && active(s)).map(publicSession);
      const counts = Object.fromEntries(await Promise.all(COLLECTIONS.map(async c => [c, (await store.list(req.userId, c)).length])));
      const pass = passcodes.find(p => p.userId === req.userId);
      return res.json({ userId: req.userId, ...profile, hasPasscode: !!pass, passcodeHint: pass?.hint || null, storage: store.mode, currentSessionId: req.session.id, devices, counts });
    } catch { return res.status(500).json({ error: 'profile_unavailable' }); }
  });
  async function updateProfile(req, res) {
    try {
      const profile = await store.getProfile(req.userId), d = req.body || {};
      if (d.displayName !== undefined) { if (typeof d.displayName !== 'string' || !d.displayName.trim() || d.displayName.trim().length > 120) return res.status(400).json({ error: 'invalid_display_name' }); profile.displayName = d.displayName.trim(); }
      if (d.targetBand !== undefined) { if (d.targetBand !== null && (!Number.isFinite(Number(d.targetBand)) || Number(d.targetBand) < 0 || Number(d.targetBand) > 9)) return res.status(400).json({ error: 'invalid_target_band' }); profile.targetBand = d.targetBand === null ? null : Number(d.targetBand); }
      if (d.examDate !== undefined) { if (d.examDate !== null && (typeof d.examDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.examDate) || Number.isNaN(Date.parse(d.examDate)))) return res.status(400).json({ error: 'invalid_exam_date' }); profile.examDate = d.examDate; }
      profile.updatedAt = new Date().toISOString(); await store.putProfile(req.userId, profile); return res.json(profile);
    } catch { return res.status(500).json({ error: 'profile_update_failed' }); }
  }
  app.post('/api/me', updateProfile); app.patch('/api/me', updateProfile);
  app.post('/api/auth/passcode', async (req, res) => {
    try {
      const passcode = generateCode(), salt = crypto.randomBytes(16).toString('hex'), passcodeHash = await codeHash(passcode, salt);
      await store.withLock('auth', async () => {
        const codes = (await store.auth('passcodes')).filter(p => p.userId !== req.userId);
        codes.push({ userId: req.userId, salt, passcodeHash, hint: passcode.slice(-4) }); await store.putAuth('passcodes', codes);
        const profile = await store.getProfile(req.userId); profile.role = profile.role === 'guest' ? 'student' : profile.role; profile.kind = 'member'; await store.putProfile(req.userId, profile);
      });
      res.set('Cache-Control', 'no-store'); return res.json({ passcode });
    } catch { return res.status(500).json({ error: 'passcode_creation_failed' }); }
  });
  app.post('/api/auth/redeem', async (req, res) => {
    const ip = req.ip || 'unknown';
    try {
      if (await store.failedAttempts(ip) >= 5) return res.status(429).json({ error: 'too_many_attempts' });
      const code = typeof req.body?.passcode === 'string' ? req.body.passcode.trim().toUpperCase() : '';
      let target = null;
      if (/^IELTS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code)) {
        for (const entry of await store.auth('passcodes')) if (await verifyCode(code, entry)) { target = entry; break; }
      }
      if (!target) { await store.failedAttempts(ip, true); return res.status(401).json({ error: 'invalid_passcode' }); }
      const perform = async () => store.withLock('auth', async () => {
        // Rotation may have invalidated the passcode while the request waited for locks.
        const valid = (await store.auth('passcodes')).find(p => p.userId === target.userId && p.passcodeHash === target.passcodeHash);
        if (!valid) return res.status(401).json({ error: 'invalid_passcode' });
        const sessions = (await store.auth('sessions')).filter(active);
        if (!sessions.some(s => s.id === req.session.id && s.userId === req.userId)) return res.status(401).json({ error: 'session_revoked' });
        const existing = sessions.filter(s => s.userId === target.userId);
        if (req.userId !== target.userId && existing.length >= MAX_DEVICES_PER_USER) return res.status(409).json({ error: 'device_limit', maxDevices: MAX_DEVICES_PER_USER, devices: existing.map(publicSession) });
        if (req.userId === target.userId) return res.json({ userId: target.userId, currentSessionId: req.session.id });
        const sourceProfile = await store.getProfile(req.userId);
        if (sourceProfile?.role !== 'guest') return res.status(409).json({ error: 'account_not_guest' });
        const local = req.body?.localData && typeof req.body.localData === 'object' ? req.body.localData : {};
        const names = { placement_results:'ielts_placement_results', writing_results:'ielts_writing_history', speaking_results:'ielts_speaking_history', study_progress:'ielts_study_progress' };
        for (const collection of COLLECTIONS) {
          const existingRecords = await store.list(target.userId, collection), incoming = [...await store.list(req.userId, collection)];
          let fromLocal = local[names[collection]];
          if (typeof fromLocal === 'string') { try { fromLocal = JSON.parse(fromLocal); } catch { fromLocal = []; } }
          if (Array.isArray(fromLocal)) incoming.push(...fromLocal.slice(0, 1000));
          for (const item of incoming) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
            const identity = collection === 'study_progress' ? item.unitId : item.id || item.itemId || item.timestamp;
            if (!identity) continue;
            const index = existingRecords.findIndex(x => collection === 'study_progress' ? x.unitId === item.unitId : ((item.id && x.id === item.id) || (item.itemId && x.itemId === item.itemId) || (item.timestamp && x.timestamp === item.timestamp)));
            if (index < 0) existingRecords.push(item);
            else if (collection === 'study_progress') existingRecords[index] = { ...existingRecords[index], ...item, mastery: Math.max(Number(existingRecords[index].mastery) || 0, Number(item.mastery) || 0), steps:[...new Set([...(Array.isArray(existingRecords[index].steps) ? existingRecords[index].steps : []), ...(Array.isArray(item.steps) ? item.steps : [])])].sort() };
          }
          await store.replace(target.userId, collection, existingRecords);
        }
        const profile = await store.getProfile(target.userId);
        const parsedLocal = key => { let value = local[key]; if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } } return value && typeof value === 'object' && !Array.isArray(value) ? value : null; };
        const goal = parsedLocal('ielts_study_goal');
        if (goal) { if (profile.targetBand == null && goal.targetBand != null && goal.targetBand !== '' && Number.isFinite(Number(goal.targetBand))) profile.targetBand = Math.max(0, Math.min(9, Number(goal.targetBand))); if (!profile.examDate && typeof goal.examDate === 'string') profile.examDate = goal.examDate.slice(0,10); }
        if (profile.targetBand == null && sourceProfile.targetBand != null) profile.targetBand = sourceProfile.targetBand;
        if (!profile.examDate && sourceProfile.examDate) profile.examDate = sourceProfile.examDate;
        if (!profile.commitment) profile.commitment = parsedLocal('ielts_study_commitment') || sourceProfile.commitment;
        let localStreak = local.ielts_study_streak;
        if (typeof localStreak === 'string') { try { localStreak = JSON.parse(localStreak); } catch { localStreak = []; } }
        const dates = [...(Array.isArray(profile.streak) ? profile.streak : []), ...(Array.isArray(sourceProfile.streak) ? sourceProfile.streak : []), ...(Array.isArray(localStreak) ? localStreak : [])].filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
        if (dates.length) profile.streak = [...new Set(dates)].sort().slice(-120);
        await store.putProfile(target.userId, profile);
        const created = await createSession(target.userId, req, sessions);
        const kept = sessions.filter(s => s.id !== req.session.id); await store.putAuth('sessions', kept);
        setCookie(res, target.userId, created.raw);
        return res.json({ userId: target.userId, currentSessionId: created.session.id });
      });
      if (target.userId === req.userId) return await perform();
      if (req.profile.role !== 'guest') return res.status(409).json({ error:'account_not_guest' });
      return await store.withLock(`user_${target.userId}`, perform);
    } catch (err) { console.error('[ERROR] redeem:', err.message); return res.status(500).json({ error: 'redeem_failed' }); }
  });
  app.post('/api/auth/logout', async (req, res) => {
    try {
      const created = await store.withLock('auth', async () => {
        const sessions = (await store.auth('sessions')).filter(s => active(s) && s.id !== req.session.id);
        const userId = uid('usr'), profile = defaultProfile(userId), users = await store.auth('users');
        await store.putProfile(userId, profile); users.push({ id:userId, createdAt:profile.createdAt }); await store.putAuth('users', users);
        const created = await createSession(userId, req, sessions); await store.putAuth('sessions', sessions); return { userId, ...created };
      });
      setCookie(res, created.userId, created.raw); return res.json({ userId: created.userId });
    } catch { return res.status(500).json({ error: 'logout_failed' }); }
  });
  app.get('/api/auth/sessions', async (req, res) => {
    try { return res.json({ currentSessionId:req.session.id, devices:(await store.auth('sessions')).filter(s => s.userId === req.userId && active(s)).map(publicSession) }); }
    catch { return res.status(500).json({ error:'sessions_unavailable' }); }
  });
  app.delete('/api/auth/sessions/:sessionId', async (req, res) => {
    try {
      const removed = await store.withLock('auth', async () => {
        const sessions = await store.auth('sessions'); const found = sessions.some(s => s.userId === req.userId && s.id === req.params.sessionId && active(s));
        if (found) await store.putAuth('sessions', sessions.filter(s => !(s.userId === req.userId && s.id === req.params.sessionId)));
        return found;
      });
      if (!removed) return res.status(404).json({ error:'session_not_found' });
      if (req.params.sessionId === req.session.id) res.clearCookie('im_uid', { path:'/' });
      return res.json({ revoked:true });
    } catch { return res.status(500).json({ error:'session_revoke_failed' }); }
  });
}
