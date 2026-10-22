const { fetchOptionTickers, parseSymbol } = require('./_lib/bybit');
const { getRedis } = require('./_lib/redis');

const COINS = ['BTC', 'ETH', 'SOL', 'XAUT'];
const RETENTION_DAYS = 45; // enough for 24h/48h OI-change; raise once IV Rank needs ~1yr

module.exports = async (req, res) => {
  // Allow Vercel's own cron (carries this header) OR a manually-configured external
  // scheduler using a shared secret, since Vercel's free-tier cron only runs daily.
  const isVercelCron = req.headers['x-vercel-cron-schedule'] !== undefined;
  if (!isVercelCron) {
    const expected = process.env.CRON_SECRET;
    const auth = req.headers['authorization'] || '';
    const tokenParam = req.query ? req.query.token : undefined;
    if (!expected || (auth !== `Bearer ${expected}` && tokenParam !== expected)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  }

  const now = Date.now();
  const results = {};
  let redis;
  try {
    redis = getRedis();
  } catch (err) {
    res.status(500).json({ error: 'Redis not configured — add the Upstash integration first (see README)' });
    return;
  }

  for (const coin of COINS) {
    try {
      const list = await fetchOptionTickers(coin);
      const byExpiry = {};
      for (const t of list) {
        const p = parseSymbol(t.symbol);
        if (!p) continue;
        const oi = parseFloat(t.openInterest || 0);
        if (!byExpiry[p.expiryKey]) byExpiry[p.expiryKey] = {};
        if (!byExpiry[p.expiryKey][p.strike]) byExpiry[p.expiryKey][p.strike] = [0, 0];
        byExpiry[p.expiryKey][p.strike][p.type === 'C' ? 0 : 1] = oi;
      }
      const snapshot = JSON.stringify({ t: now, byExpiry });
      await redis.zadd(`snap:${coin}`, { score: now, member: snapshot });
      await redis.zremrangebyscore(`snap:${coin}`, 0, now - RETENTION_DAYS * 86400000);
      results[coin] = { ok: true, expiries: Object.keys(byExpiry).length };
    } catch (err) {
      results[coin] = { ok: false, error: String((err && err.message) || err) };
    }
  }

  res.status(200).json({ at: new Date(now).toISOString(), results });
};
