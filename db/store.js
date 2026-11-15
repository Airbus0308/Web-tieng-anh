import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const COLLECTIONS = ['placement_results', 'writing_results', 'speaking_results', 'study_progress', 'study_srs', 'study_checkpoints'];
const safe = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(value)) throw new Error('Invalid storage key');
  return value;
};
export function getStorageMode() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return 'upstash';
  return process.env.VERCEL ? 'ephemeral' : 'json-dir';
}

export function createStore(resultsDir) {
  const mode = getStorageMode();
  const localLocks = new Map();
  const authDir = path.join(resultsDir, 'auth');
  const userDir = id => path.join(resultsDir, 'users', safe(id));
  const authPath = name => path.join(authDir, `${safe(name)}.json`);
  const read = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return fallback; throw err; }
  };
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
  };
  async function redis(...command) {
    const response = await fetch(process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, ''), {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command), signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Upstash HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(`Upstash: ${data.error}`);
    return data.result;
  }
  async function get(key, file, fallback) {
    if (mode !== 'upstash') return read(file, fallback);
    const value = await redis('GET', key);
    return value == null ? fallback : JSON.parse(value);
  }
  async function set(key, file, value) {
    if (mode !== 'upstash') return write(file, value);
    await redis('SET', key, JSON.stringify(value));
  }
  async function acquire(key) {
    safe(key);
    if (mode === 'upstash') {
      const token = crypto.randomBytes(24).toString('hex'), lockKey = `im:lock:${key}`;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (await redis('SET', lockKey, token, 'NX', 'PX', '180000') === 'OK') {
          return async () => { await redis('EVAL', "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", '1', lockKey, token); };
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Storage lock timeout');
    }
    const previous = localLocks.get(key) || Promise.resolve();
    let release;
    const next = new Promise(resolve => { release = resolve; });
    localLocks.set(key, next);
    await previous;
    return async () => { if (localLocks.get(key) === next) localLocks.delete(key); release(); };
  }
  const api = {
    mode, acquire,
    async withLock(key, fn) { const release = await acquire(key); try { return await fn(); } finally { await release(); } },
    async list(id, collection) { safe(id); safe(collection); const data = await get(`im:rec:${id}:${collection}`, path.join(userDir(id), `${collection}.json`), []); return Array.isArray(data) ? data : []; },
    async replace(id, collection, records) { safe(id); safe(collection); return set(`im:rec:${id}:${collection}`, path.join(userDir(id), `${collection}.json`), records); },
    async append(id, collection, record) { const records = await api.list(id, collection); records.push(record); await api.replace(id, collection, records); return record; },
    async upsert(id, collection, key, record) { const records = await api.list(id, collection); const index = records.findIndex(x => x[key] === record[key]); if (index < 0) records.push(record); else records[index] = record; await api.replace(id, collection, records); return record; },
    async getProfile(id) { return get(`im:user:${safe(id)}`, path.join(userDir(id), 'profile.json'), null); },
    async putProfile(id, profile) { return set(`im:user:${safe(id)}`, path.join(userDir(id), 'profile.json'), profile); },
    async auth(name) { return get(`im:auth:${safe(name)}`, authPath(name), []); },
    async putAuth(name, value) { return set(`im:auth:${safe(name)}`, authPath(name), value); },
    async migrateFirstUser(id) {
      if (mode !== 'json-dir') return;
      for (const collection of COLLECTIONS) {
        const legacy = path.join(resultsDir, `${collection}.json`), target = path.join(userDir(id), `${collection}.json`);
        if (fs.existsSync(legacy) && !fs.existsSync(target)) { fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.copyFileSync(legacy, target, fs.constants.COPYFILE_EXCL); }
      }
    },
    async failedAttempts(ip, add = false) {
      const digest = crypto.createHash('sha256').update(ip).digest('hex');
      if (mode === 'upstash') {
        const key = `im:rate:redeem:${digest}`;
        if (add) return Number(await redis('EVAL', "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n", '1', key));
        return Number(await redis('GET', key) || 0);
      }
      return api.withLock('rate', async () => {
        const rates = await api.auth('rate_limits'), now = Date.now();
        const alive = rates.filter(x => x.time > now - 900000);
        if (add) alive.push({ ip: digest, time: now });
        await api.putAuth('rate_limits', alive);
        return alive.filter(x => x.ip === digest).length;
      });
    }
  };
  return api;
}
