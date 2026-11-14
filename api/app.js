// Бэкенд сайта (Vercel). Секреты берутся только из Environment Variables.
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
const emptyBracket = () => ({ x: {}, n: Array.from({ length: 16 }, () => ({ t: "", a: 0, u: "" })), w: [Array(8).fill(null), Array(4).fill(null), Array(2).fill(null), [null]] });

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
  const out = (c, o) => res.status(c).json(o);
  try {
    if (req.method === "GET") {
      if (act === "ping") return out(200, { ok: true, steamKey: !!E.STEAM_API_KEY, adminPassword: !!E.ADMIN_PASSWORD, database: !!(RU() && RT()) });
      if (act === "news") { try { return out(200, { news: jp(await rd("GET", "news"), []) }); } catch (e) { return out(200, { news: [] }); } }
      if (act === "bracket") { try { return out(200, { data: jp(await rd("GET", "bracket"), null) }); } catch (e) { return out(200, { data: null }); } }
      return out(400, { error: "Неизвестное действие" });
    }
    if (req.method !== "POST") return out(405, { error: "Метод не поддерживается" });

    /* любой посетитель: добавить свою платину в первый свободный слот */
    if (act === "bracket_add") {
      const t = clean(b.game, 60), u = clean(b.name, 30);
      if (!t || !u) return out(400, { error: "Впиши название игры и своё имя" });
      const d = jp(await rd("GET", "bracket"), null) || emptyBracket();
      if (!Array.isArray(d.n) || d.n.length !== 16) return out(500, { error: "Сетка повреждена, напиши админу" });
      const i = d.n.findIndex((x) => !x || !String(x.t || "").trim());
      if (i < 0) return out(409, { error: "Все 16 мест уже заняты" });
      const ip = String(req.headers["x-forwarded-for"] || "?").split(",")[0].trim();
      if (!(await rd("SET", "rl:" + ip, "1", "EX", 600, "NX"))) return out(429, { error: "Подожди 10 минут перед следующей заявкой" });
      d.n[i] = { t, a: 0, u };
      await rd("SET", "bracket", JSON.stringify(d));
      return out(200, { ok: true, slot: i + 1 });
    }

    /* админ (пароль) */
    if (!E.ADMIN_PASSWORD) return out(500, { error: "В настройках хостинга не задан ADMIN_PASSWORD" });
    if (!b.password || b.password !== E.ADMIN_PASSWORD) return out(401, { error: "Неверный пароль" });
    if (act === "login") return out(200, { ok: true });
    if (act === "news_add") {
      const title = clean(b.title, 120), text = String(b.text || "").trim().slice(0, 5000);
      if (!title) return out(400, { error: "Нужен заголовок" });
      const n = jp(await rd("GET", "news"), []);
      n.unshift({ id: Date.now().toString(36), title, text, date: new Date().toISOString() });
      await rd("SET", "news", JSON.stringify(n.slice(0, 100)));
      return out(200, { ok: true });
    }
    if (act === "news_del") {
      await rd("SET", "news", JSON.stringify(jp(await rd("GET", "news"), []).filter((x) => x.id !== b.id)));
      return out(200, { ok: true });
    }
    if (act === "bracket_set") {
      const d = b.data, s = JSON.stringify(d || {});
      if (!d || !Array.isArray(d.n) || d.n.length !== 16 || !Array.isArray(d.w) || d.w.length !== 4 || s.length > 30000) return out(400, { error: "Плохие данные сетки" });
      await rd("SET", "bracket", s);
      return out(200, { ok: true });
    }
    if (!E.STEAM_API_KEY) return out(500, { error: "В настройках хостинга не задан STEAM_API_KEY" });
    if (act === "games") {
      const t = String(b.profile || "").trim().replace(/\/+$/, "");
      const m = t.match(/profiles\/(\d{17})/);
      let id = m ? m[1] : (/^\d{17}$/.test(t) ? t : null);
      if (!id) {
        const v = (t.match(/\/id\/([^/?#]+)/) || [null, t])[1];
        const r = await get(`${S}ISteamUser/ResolveVanityURL/v1/?key=${E.STEAM_API_KEY}&vanityurl=${encodeURIComponent(v)}`);
        if (r.response.success !== 1) return out(404, { error: "Профиль не найден" });
        id = r.response.steamid;
      }
      const list = await owned(id);
      if (!list.length) return out(403, { error: PRIV });
      return out(200, { steamid: id, games: list });
    }
    if (act === "achv") {
      if (!/^\d{17}$/.test(String(b.steamid))) return out(400, { error: "Плохой steamid" });
      return out(200, { results: await achv(b.steamid, ids8(b.appids)) });
    }
    return out(400, { error: "Неизвестное действие" });
  } catch (e) {
    return out(502, { error: e.message });
  }
};
