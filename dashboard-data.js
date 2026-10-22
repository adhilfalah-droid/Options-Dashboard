const { fetchOptionTickers, fetchSpotKlines, computeRV, parseSymbol } = require('./_lib/bybit');
const { getRedis } = require('./_lib/redis');

const TARGET_HOURS_AGO = 24;
const TOLERANCE_HOURS = 3; // accept a snapshot anywhere from 21h-27h ago as "the 24h-ago reading"

module.exports = async (req, res) => {
  const coin = ((req.query && req.query.coin) || 'BTC').toUpperCase();

  try {
    const [list, closes] = await Promise.all([
      fetchOptionTickers(coin),
      fetchSpotKlines(coin, 32).catch(() => []),
    ]);

    let spot = null;
    const parsed = [];
    for (const t of list) {
      const p = parseSymbol(t.symbol);
      if (!p) continue;
      if (spot === null && t.underlyingPrice) spot = parseFloat(t.underlyingPrice);
      parsed.push({
        symbol: t.symbol,
        strike: p.strike,
        type: p.type,
        expiryKey: p.expiryKey,
        expiryDate: p.date.toISOString(),
        oi: parseFloat(t.openInterest || 0),
        vol24h: parseFloat(t.volume24h || 0),
        iv: parseFloat(t.markIv || 0) * 100,
        delta: parseFloat(t.delta || 0),
        gamma: parseFloat(t.gamma || 0),
        vega: parseFloat(t.vega || 0),
        theta: parseFloat(t.theta || 0),
      });
    }

    // Try to find a stored snapshot close to 24h ago, to compute a real OI change.
    // If the snapshot function hasn't been running long enough yet, this just stays
    // unavailable rather than guessing — same honesty rule as the rest of this build.
    const now = Date.now();
    let historyStatus = { available: false };
    try {
      const redis = getRedis();
      const lo = now - (TARGET_HOURS_AGO + TOLERANCE_HOURS) * 3600000;
      const hi = now - (TARGET_HOURS_AGO - TOLERANCE_HOURS) * 3600000;
      const entries = await redis.zrange(`snap:${coin}`, lo, hi, { byScore: true });
      if (entries && entries.length) {
        let best = null;
        let bestDiff = Infinity;
        for (const e of entries) {
          const obj = typeof e === 'string' ? JSON.parse(e) : e;
          const diff = Math.abs(now - obj.t - TARGET_HOURS_AGO * 3600000);
          if (diff < bestDiff) {
            bestDiff = diff;
            best = obj;
          }
        }
        if (best) {
          historyStatus = { available: true, snapshotAgeHours: Number(((now - best.t) / 3600000).toFixed(1)) };
          for (const row of parsed) {
            const past = best.byExpiry[row.expiryKey] && best.byExpiry[row.expiryKey][row.strike];
            if (past) row.oiChange24h = row.oi - past[row.type === 'C' ? 0 : 1];
          }
        }
      }
    } catch (err) {
      // Redis unreachable/not configured yet — dashboard still works, just without OI-change
      historyStatus = { available: false, error: 'history store unavailable' };
    }

    const rv = { r7: computeRV(closes, 7), r14: computeRV(closes, 14), r30: computeRV(closes, 30) };

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ coin, spot, tickers: parsed, rv, historyStatus, fetchedAt: new Date(now).toISOString() });
  } catch (err) {
    res.status(502).json({ error: String((err && err.message) || err) });
  }
};
