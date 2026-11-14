// Регистрация и сообщество через Steam (Vercel). Лежит в папке api рядом с app.js.
// Нужны переменные: STEAM_API_KEY, ADMIN_PASSWORD (или SESSION_SECRET) и база Upstash Redis.
const crypto = require("crypto");
const E = process.env;
const RU = () => E.UPSTASH_REDIS_REST_URL || E.KV_REST_API_URL;
const RT = () => E.UPSTASH_REDIS_REST_TOKEN || E.KV_REST_API_TOKEN;
const S = "https://api.steampowered.com/";
const PRIV = "Игр не видно: открой в Steam настройки приватности (профиль и «Сведения об играх» — публичные)";

async function rd(...c) {
  if (!RU() || !RT()) throw new Error("База данных не подключена (Upstash Redis)");
  const r = await fetch(RU(), { method: "POST", headers: { Authorization: "Bearer " + RT() }, body: JSON.stringify(c.map(String)) });
  const j = await r.json();
  if (j.error) throw new Error("БД: " + j.error);
  return j.result;
}
const jp = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
const ids8 = (a) => (a || []).map(Number).filter(Number.isInteger).slice(0, 8);
const sign = (v) => crypto.createHmac("sha256", E.SESSION_SECRET || E.ADMIN_PASSWORD || "x").update(v).digest("hex").slice(0, 32);
function sid(req) {
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)sid=(\d{17})\.([a-f0-9]{32})/);
  if (!m) return null;
  const a = Buffer.from(m[2]), b = Buffer.from(sign(m[1]));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1] : null;
}
async function owned(id) {
  const g = await get(`${S}IPlayerService/GetOwnedGames/v1/?key=${E.STEAM_API_KEY}&steamid=${id}&include_appinfo=1&include_played_free_games=1`);
  return ((g.response && g.response.games) || []).map((x) => ({ appid: x.appid, name: x.name, playtime: x.playtime_forever }));
}
async function achv(id, ids) {
  const out = {};
  await Promise.all(ids.map(async (a) => {
    try {
      const r = await get(`${S}ISteamUserStats/GetPlayerAchievements/v1/?key=${E.STEAM_API_KEY}&steamid=${id}&appid=${a}`);
      const l = (r.playerstats && r.playerstats.achievements) || [];
      out[a] = { total: l.length, got: l.filter((x) => x.achieved === 1).length };
    } catch (e) { out[a] = { total: 0, got: 0 }; }
  }));
  return out;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  let b = req.body;
  if (typeof b === "string") b = jp(b, {});
  b = b || {};
  const act = req.method === "POST" ? b.action : q.action;
  const origin = "https://" + (req.headers["x-forwarded-host"] || req.headers.host);
  const back = origin + "/api/auth?action=cb";
  const out = (c, o) => res.status(c).json(o);
  const go = (u) => { res.statusCode = 302; res.setHeader("Location", u); res.end(); };
  try {
    if (req.method === "GET") {
      if (act === "ping") return out(200, { ok: true, steamKey: !!E.STEAM_API_KEY, adminPassword: !!(E.ADMIN_PASSWORD || E.SESSION_SECRET), database: !!(RU() && RT()) });

      if (act === "members") {
        try {
          const z = await rd("ZREVRANGE", "lb", 0, 99, "WITHSCORES"), ids = [], sc = [];
          for (let i = 0; i < z.length; i += 2) { ids.push(z[i]); sc.push(+z[i + 1]); }
          const us = ids.length ? await rd("MGET", ...ids.map((i) => "u:" + i)) : [];
          return out(200, { members: ids.map((id, i) => { const u = jp(us[i], {}); return { id, name: u.name || "Игрок", avatar: u.avatar || "", count: sc[i] }; }) });
        } catch (e) { return out(200, { members: [] }); }
      }
      if (act === "me") {
        const id = sid(req);
        if (!id) return out(200, { me: null });
        try { const u = jp(await rd("GET", "u:" + id), null); return out(200, { me: u && { id, name: u.name, avatar: u.avatar, count: u.count || 0 } }); }
        catch (e) { return out(200, { me: null }); }
      }
      if (act === "logout") {
        res.setHeader("Set-Cookie", "sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
        return go("/#community");
      }
      if (act === "login") {
        const p = new URLSearchParams({
          "openid.ns": "http://specs.openid.net/auth/2.0", "openid.mode": "checkid_setup",
          "openid.return_to": back, "openid.realm": origin,
          "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
          "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select" });
        return go("https://steamcommunity.com/openid/login?" + p);
      }
      if (act === "cb") {
        const v = new URLSearchParams();
        for (const k in q) if (k.startsWith("openid.")) v.set(k, String(q[k]));
        v.set("openid.mode", "check_authentication");
        const m = String(q["openid.claimed_id"] || "").match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
        if (!m || q["openid.return_to"] !== back) return go("/?err=steam#community");
        const t = await (await fetch("https://steamcommunity.com/openid/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: v })).text();
        if (!/is_valid\s*:\s*true/.test(t)) return go("/?err=steam#community");
        const id = m[1];
        const sm = await get(`${S}ISteamUser/GetPlayerSummaries/v2/?key=${E.STEAM_API_KEY}&steamids=${id}`);
        const p = (sm.response.players || [])[0] || {};
        const old = jp(await rd("GET", "u:" + id), {});
        const u = { name: clean(p.personaname || "Игрок", 40), avatar: p.avatarfull || "", count: old.count || 0 };
        await rd("SET", "u:" + id, JSON.stringify(u));
        await rd("ZADD", "lb", "NX", u.count, id);
        res.setHeader("Set-Cookie", `sid=${id}.${sign(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
        return go("/#community");
      }
      return out(400, { error: "Неизвестное действие" });
    }
    if (req.method !== "POST") return out(405, { error: "Метод не поддерживается" });

    /* проверка платин вошедшего участника (по cookie) */
    const id = sid(req);
    if (!id) return out(401, { error: "Сначала войди через Steam" });
    if (act === "my_games") {
      if (await rd("GET", "cd:" + id)) return out(429, { error: "Подожди пару минут перед повторной проверкой" });
      const list = await owned(id);
      if (!list.length) return out(403, { error: PRIV });
      await rd("SET", "cd:" + id, "1", "EX", 300);
      await rd("DEL", "p:" + id);
      return out(200, { games: list });
    }
    if (act === "my_achv") {
      const ids = ids8(b.appids), r = await achv(id, ids);
      const pl = ids.filter((a) => r[a].total > 0 && r[a].got === r[a].total);
      if (pl.length) await rd("SADD", "p:" + id, ...pl);
      return out(200, { found: pl.length });
    }
    if (act === "my_done") {
      const count = +(await rd("SCARD", "p:" + id)) || 0;
      const u = jp(await rd("GET", "u:" + id), {});
      u.count = count;
      await rd("SET", "u:" + id, JSON.stringify(u));
      await rd("ZADD", "lb", count, id);
      return out(200, { count });
    }
    return out(400, { error: "Неизвестное действие" });
  } catch (e) {
    return out(502, { error: e.message });
  }
};
