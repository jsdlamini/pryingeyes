/**
 * Server-side budgets and lockouts in Redis (rule 7). Client signals are never trusted.
 */
import { redis } from "./redis";
import { env } from "./env";

// Atomic counter: INCR, set TTL only on first hit. Returns [count, ttl].
const HIT_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {c, ttl}`;

export interface HitResult { allowed: boolean; count: number; retryAfter: number }

export async function hit(key: string, limit: number, windowSec: number): Promise<HitResult> {
  const [count, ttl] = (await redis().eval(HIT_LUA, 1, `rl:${key}`, windowSec)) as [number, number];
  return { allowed: count <= limit, count, retryAfter: Math.max(ttl, 1) };
}

export async function peek(key: string): Promise<number> {
  return Number((await redis().get(`rl:${key}`)) ?? 0);
}

export async function resetKey(key: string) { await redis().del(`rl:${key}`); }

const secondsUntilUtcMidnight = () => {
  const now = new Date();
  const mid = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((mid - now.getTime()) / 1000));
};
const day = () => new Date().toISOString().slice(0, 10);

// ---- decode-gate budgets ---------------------------------------------------
export const gateBudgets = {
  ip: (ip: string) => hit(`gate:ip:${ip}`, env().RL_IP_PER_HOUR, 3600),
  caller: (callerId: string) => hit(`gate:caller:${callerId}:${day()}`, env().RL_CALLER_PER_DAY, secondsUntilUtcMidnight()),
  callerToken: (callerId: string, tokenId: string) =>
    hit(`gate:ct:${callerId}:${tokenId}:${day()}`, env().RL_CALLER_TOKEN_PER_DAY, secondsUntilUtcMidnight()),
  token: (tokenId: string) => hit(`gate:token:${tokenId}:${day()}`, env().RL_TOKEN_PER_DAY, secondsUntilUtcMidnight()),
  tier2Daily: (callerId: string) => hit(`gate:t2:${callerId}:${day()}`, env().TIER2_DAILY_CAP, secondsUntilUtcMidnight()),
};

// ---- concurrency -----------------------------------------------------------
/**
 * At most `max` gate requests in flight per caller. Without this, a burst of parallel requests can
 * all pass the lockout check before the failures that should lock the account are recorded.
 */
export async function acquireInflight(callerId: string, max = 2): Promise<(() => Promise<void>) | null> {
  const key = `inflight:caller:${callerId}`;
  const n = await redis().incr(key);
  await redis().expire(key, 15);
  if (n > max) { await redis().decr(key); return null; }
  return async () => { await redis().decr(key); };
}

// ---- lockouts --------------------------------------------------------------
/** Seconds remaining on a caller lockout, or 0. */
export async function lockRemaining(callerId: string): Promise<number> {
  const ttl = await redis().pttl(`lock:caller:${callerId}`);
  return ttl > 0 ? Math.ceil(ttl / 1000) : 0;
}

/**
 * Records a failed check. Five failures in 15 minutes lock the caller for 1 h, doubling on
 * each subsequent lockout (tracked for 7 days) up to 24 h. Returns lockout seconds (0 = none).
 */
export async function recordCallerFailure(callerId: string): Promise<number> {
  const e = env();
  const r = await hit(`fail:caller:${callerId}`, e.RL_FAILS_BEFORE_LOCK - 1, e.RL_FAIL_WINDOW_SEC);
  if (r.allowed) return 0;
  const n = await redis().incr(`lockcount:caller:${callerId}`);
  await redis().expire(`lockcount:caller:${callerId}`, 7 * 86400);
  const secs = Math.min(e.RL_LOCK_BASE_SEC * 2 ** (n - 1), e.RL_LOCK_MAX_SEC);
  await redis().set(`lock:caller:${callerId}`, "1", "EX", secs);
  await resetKey(`fail:caller:${callerId}`);
  return secs;
}

/** Records a failed attempt against a token. Returns true exactly when the freeze threshold is crossed. */
export async function recordTokenFailure(tokenId: string): Promise<boolean> {
  const e = env();
  const r = await hit(`fail:token:${tokenId}`, e.RL_TOKEN_FAILS_BEFORE_FREEZE - 1, e.RL_TOKEN_FAIL_WINDOW_SEC);
  return r.count === e.RL_TOKEN_FAILS_BEFORE_FREEZE;
}

// ---- generic auth limits ---------------------------------------------------
export const authBudgets = {
  loginIp: (ip: string) => hit(`auth:login:ip:${ip}`, 20, 900),
  loginId: (id: string) => hit(`auth:login:id:${id}`, 10, 900),
  otpSend: (subject: string) => hit(`auth:otpsend:${subject}`, 5, 3600),
  otpSendIp: (ip: string) => hit(`auth:otpsend:ip:${ip}`, 20, 3600),
  // Many people can share one address (campus, office or mobile-carrier networks), so this is a setting.
  signupIp: (ip: string) => hit(`auth:signup:ip:${ip}`, env().RL_SIGNUP_PER_IP_HOUR, 3600),
  mfa: (userId: string) => hit(`auth:mfa:${userId}`, 10, 900),
};
