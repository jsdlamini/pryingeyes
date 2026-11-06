/**
 * A small in-memory stand-in for the Redis commands PryingEyes uses, so the app runs with no
 * Redis server (REDIS_URL empty). It lives inside the one website process: rate limits, call
 * signalling and passkey challenges reset when the website restarts, and it can't be shared by
 * several copies of the app (set REDIS_URL for that).
 */
type Val = string | string[];
type Entry = { v: Val; exp: number | null };
type Res = [Error | null, unknown];
/** A MULTI chain: every command returns the chain; exec() runs them. */
export type MemoryMulti = { exec(): Promise<Res[]> } & { [command: string]: (...args: (string | number)[]) => MemoryMulti };

export class MemoryRedis {
  private m = new Map<string, Entry>();
  private sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => { const now = Date.now(); for (const [k, e] of this.m) if (e.exp !== null && e.exp <= now) this.m.delete(k); }, 30_000);
    this.sweeper.unref?.();
  }

  private live(k: string): Entry | undefined {
    const e = this.m.get(k);
    if (e && e.exp !== null && e.exp <= Date.now()) { this.m.delete(k); return undefined; }
    return e;
  }
  private str(k: string): string | null {
    const e = this.live(k); if (!e) return null;
    if (Array.isArray(e.v)) throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
    return e.v;
  }
  private list(k: string, create = false): string[] | null {
    const e = this.live(k);
    if (!e) { if (!create) return null; const v: string[] = []; this.m.set(k, { v, exp: null }); return v; }
    if (!Array.isArray(e.v)) throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
    return e.v;
  }
  private add(k: string, by: number): number {
    const e = this.live(k); const n = Number(e ? this.str(k) : 0);
    if (!Number.isInteger(n)) throw new Error("ERR value is not an integer or out of range");
    const next = n + by; this.m.set(k, { v: String(next), exp: e?.exp ?? null }); return next;
  }

  // ---- string commands ------------------------------------------------------
  async get(k: string) { return this.str(k); }
  /** SET key value [EX seconds | PX ms] [NX | XX] */
  async set(k: string, v: string | number, ...opts: (string | number)[]) {
    let exp: number | null = null; let nx = false; let xx = false;
    for (let i = 0; i < opts.length; i++) {
      const o = String(opts[i]).toUpperCase();
      if (o === "EX") exp = Date.now() + Number(opts[++i]) * 1000;
      else if (o === "PX") exp = Date.now() + Number(opts[++i]);
      else if (o === "NX") nx = true;
      else if (o === "XX") xx = true;
    }
    const has = !!this.live(k);
    if ((nx && has) || (xx && !has)) return null;
    this.m.set(k, { v: String(v), exp });
    return "OK";
  }
  async getdel(k: string) { const v = this.str(k); this.m.delete(k); return v; }
  async incr(k: string) { return this.add(k, 1); }
  async decr(k: string) { return this.add(k, -1); }

  // ---- keys -----------------------------------------------------------------
  async exists(...ks: string[]) { return ks.flat().filter((k) => this.live(k)).length; }
  async del(...ks: string[]) { let n = 0; for (const k of ks.flat()) if (this.live(k) && this.m.delete(k)) n++; return n; }
  async expire(k: string, sec: number) { const e = this.live(k); if (!e) return 0; e.exp = Date.now() + Number(sec) * 1000; return 1; }
  async ttl(k: string) { const e = this.live(k); if (!e) return -2; return e.exp === null ? -1 : Math.ceil((e.exp - Date.now()) / 1000); }
  async pttl(k: string) { const e = this.live(k); if (!e) return -2; return e.exp === null ? -1 : Math.max(0, e.exp - Date.now()); }
  async keys(pattern: string) {
    const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
    return [...this.m.keys()].filter((k) => this.live(k) && re.test(k));
  }

  // ---- lists ----------------------------------------------------------------
  async rpush(k: string, ...vs: string[]) { const l = this.list(k, true)!; l.push(...vs.map(String)); return l.length; }
  async lrange(k: string, start: number, stop: number) {
    const l = this.list(k) ?? []; const n = l.length;
    const s = start < 0 ? Math.max(n + start, 0) : start; const e = stop < 0 ? n + stop : Math.min(stop, n - 1);
    return s > e ? [] : l.slice(s, e + 1);
  }
  async ltrim(k: string, start: number, stop: number) {
    const e = this.live(k); if (!e) return "OK";
    const kept = await this.lrange(k, start, stop);
    if (kept.length) e.v = kept; else this.m.delete(k);
    return "OK";
  }

  // ---- scripting --------------------------------------------------------------
  /** Only the scripts PryingEyes uses: the atomic "INCR, set TTL on first hit, return [count, ttl]" counter. */
  async eval(script: string, numKeys: number, ...args: (string | number)[]) {
    const key = String(args[0]);
    if (numKeys === 1 && /INCR/.test(script) && /EXPIRE/.test(script) && /TTL/.test(script)) {
      const c = this.add(key, 1);
      if (c === 1) await this.expire(key, Number(args[1]));
      return [c, await this.ttl(key)];
    }
    throw new Error("MemoryRedis: unsupported script");
  }

  // ---- transactions -----------------------------------------------------------
  /** MULTI … EXEC: queued commands run back to back (nothing can interleave in one process). */
  multi(): MemoryMulti {
    const q: (() => Promise<unknown>)[] = [];
    const self = this;
    const chain: MemoryMulti = new Proxy({} as MemoryMulti, {
      get(_t, name: string) {
        if (name === "exec") return async (): Promise<Res[]> => {
          const out: Res[] = [];
          for (const f of q) { try { out.push([null, await f()]); } catch (e) { out.push([e as Error, null]); } }
          return out;
        };
        const fn = (self as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
        if (typeof fn !== "function") throw new Error(`MemoryRedis: ${name} isn't supported in multi()`);
        return (...a: unknown[]) => { q.push(() => fn.apply(self, a)); return chain; };
      },
    });
    return chain;
  }

  // ---- connection -------------------------------------------------------------
  on() { return this; }
  async ping() { return "PONG"; }
  async flushdb() { this.m.clear(); return "OK"; }
  async quit() { clearInterval(this.sweeper); return "OK"; }
}
