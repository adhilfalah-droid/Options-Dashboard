// Shared helpers for talking to Bybit's public v5 API from our serverless functions.
// Server-to-server, so no browser CORS/sandbox concerns here at all.

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

// Real examples: BTC-27MAR26-70000-P-USDT (USDT-settled), ETH-28FEB25-2800-C (USDC-settled, no suffix)
function parseSymbol(sym) {
  const m = sym.match(/^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-([CP])(?:-(?:USDT|USDC|USD))?$/);
  if (!m) return null;
  const [, base, day, monStr, yy, strikeStr, cp] = m;
  const month = MONTHS[monStr];
  if (month === undefined) return null;
  const year = 2000 + parseInt(yy, 10);
  const date = new Date(Date.UTC(year, month, parseInt(day, 10), 8, 0, 0)); // Bybit options settle 08:00 UTC
  return { base, date, expiryKey: `${day}${monStr}${yy}`, strike: parseFloat(strikeStr), type: cp };
}

async function fetchOptionTickers(coin) {
  const url = `https://api.bybit.com/v5/market/tickers?category=option&baseCoin=${coin}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit tickers HTTP ${res.status}`);
  const json = await res.json();
  if (json.retCode !== 0) throw new Error(json.retMsg || 'Bybit API error');
  return json.result.list || [];
}

async function fetchSpotKlines(coin, limit = 32) {
  const symbol = `${coin}USDT`;
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=D&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit kline HTTP ${res.status}`);
  const json = await res.json();
  if (json.retCode !== 0) throw new Error(json.retMsg || 'Bybit API error');
  // list is [[startTime, open, high, low, close, volume, turnover], ...] descending by time
  return json.result.list.map((r) => parseFloat(r[4])).reverse();
}

function computeRV(closes, window) {
  if (closes.length < window + 1) return null;
  const slice = closes.slice(closes.length - 1 - window, closes.length);
  const rets = [];
  for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365) * 100; // annualised %
}

module.exports = { parseSymbol, fetchOptionTickers, fetchSpotKlines, computeRV, MONTHS };
