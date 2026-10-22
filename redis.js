// Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN, which Vercel's Upstash
// Marketplace integration injects automatically once you add the Redis integration
// to this project (see README). "Vercel KV" is the old, now-discontinued name for this.
const { Redis } = require('@upstash/redis');

let client = null;
function getRedis() {
  if (!client) client = Redis.fromEnv();
  return client;
}

module.exports = { getRedis };
