// Бэкенд сайта «Платина года» (Vercel). Секреты только из Environment Variables:
// ADMIN_PASSWORD, STEAM_API_KEY (нужен лишь админу), Upstash Redis (UPSTASH_REDIS_REST_URL/TOKEN или KV_REST_API_URL/TOKEN)
const crypto = require("crypto");
const E = process.env;
const RU = () => E.UPSTASH_REDIS_REST_URL || E.KV_REST_API_URL;
const RT = () => E.UPSTASH_REDIS_REST_TOKEN || E.KV_REST_API_TOKEN;
const S = "https://api.steampowered.com/";

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
const today = () => new Date().toISOString().slice(0, 10);
const year = () => new Date().getUTCFullYear();
const STREAK = [{ c: 10, x: 5 }, { c: 15, x: 5 }, { c: 20, x: 10 }, { c: 25, x: 10 }, { c: 30, x: 15 }, { c: 40, x: 20 }, { c: 100, x: 50 }];
const lvl = (xp) => 1 + Math.floor(Math.sqrt((xp || 0) / 40));
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const sign = (v) => crypto.createHmac("sha256", E.SESSION_SECRET || E.ADMIN_PASSWORD || "x").update(v).digest("hex").slice(0, 32);
const hash = (p, salt) => crypto.scryptSync(p, salt, 32).toString("hex");
function uidOf(req) {
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)sid=([a-f0-9]{12})\.([a-f0-9]{32})/);
  if (!m) return null;
  const a = Buffer.from(m[2]), b = Buffer.from(sign(m[1]));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1] : null;
}
const ITEMS = [
  { id: "f1", t: "frame", n: "Золотая рамка", p: 150, v: "linear-gradient(135deg,#ffe08a,#f2a33c)" },
  { id: "f2", t: "frame", n: "Ледяная рамка", p: 100, v: "linear-gradient(135deg,#bdeaff,#4aa8ff)" },
  { id: "f3", t: "frame", n: "Неоновая рамка", p: 200, v: "linear-gradient(135deg,#ff4ecd,#7a5cff)" },
  { id: "f4", t: "frame", n: "Радужная рамка", p: 400, v: "conic-gradient(#ff5e5e,#ffd24a,#5eff8a,#4ac8ff,#b45eff,#ff5e5e)" },
  { id: "b1", t: "banner", n: "Закат", p: 120, v: "linear-gradient(120deg,#ff7e5f,#6a3093)" },
  { id: "b2", t: "banner", n: "Океан", p: 120, v: "linear-gradient(120deg,#0f4c81,#2dd4bf)" },
  { id: "b3", t: "banner", n: "Ночь", p: 100, v: "linear-gradient(120deg,#0b1020,#3b2a7a)" },
  { id: "b4", t: "banner", n: "Огонь", p: 250, v: "linear-gradient(120deg,#ff3d00,#ffb300)" },
  { id: "c1", t: "color", n: "Золотой ник", p: 80, v: "#f2c14e" },
  { id: "c2", t: "color", n: "Голубой ник", p: 80, v: "#7fd4ff" },
  { id: "c3", t: "color", n: "Розовый ник", p: 80, v: "#ff7ad9" },
  { id: "c4", t: "color", n: "Лаймовый ник", p: 80, v: "#b6ff5e" },
  { id: "g1", t: "badge", n: "Геймер", p: 80, v: "🎮" },
  { id: "g2", t: "badge", n: "Звезда", p: 100, v: "⭐" },
  { id: "g3", t: "badge", n: "Огонь", p: 120, v: "🔥" },
  { id: "g4", t: "badge", n: "Алмаз", p: 250, v: "💎" },
  { id: "g5", t: "badge", n: "Корона", p: 300, v: "👑" },
];
const val = (u, t) => { const it = ITEMS.find((i) => i.id === (u.eq || {})[t]); return it ? it.v : null; };
const pub = (u) => ({ id: u.id, name: u.name, bio: u.bio || "", xp: u.xp || 0, av: u.av || 0, created: u.created, eq: { frame: val(u, "frame"), banner: val(u, "banner"), color: val(u, "color"), badge: val(u, "badge") } });
const priv = (u) => ({ ...pub(u), coins: u.coins || 0, own: u.own || [], eqIds: u.eq || {}, streak: u.streak || 0, last: u.last || "" });
const getU = async (id) => jp(await rd("GET", "u:" + id), null);
const put = async (u) => { await rd("SET", "u:" + u.id, JSON.stringify(u)); await rd("ZADD", "lbx", u.xp || 0, u.id); };
const getBr = async () => jp(await rd("GET", "bracket:" + year()), null) || (year() === 2026 ? jp(await rd("GET", "bracket"), null) : null);
const setBr = (d) => rd("SET", "bracket:" + year(), typeof d === "string" ? d : JSON.stringify(d));
const ids8 = (a) => (a || []).map(Number).filter(Number.isInteger).slice(0, 8);

module.exports = async (req, res) => {
  const q = req.query || {};
  let b = req.body;
  if (typeof b === "string") b = jp(b, {});
  b = b || {};
  const act = req.method === "POST" ? b.action : q.action;
  const out = (c, o) => res.status(c).json(o);
  const ip = String(req.headers["x-forwarded-for"] || "?").split(",")[0].trim();
  const cookie = (id) => res.setHeader("Set-Cookie", `sid=${id ? id + "." + sign(id) : ""}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${id ? 2592000 : 0}`);
  const uid = uidOf(req);
  try {
    /* ================= GET ================= */
    if (req.method === "GET") {
      if (act === "ping") return out(200, { ok: true, adminPassword: !!E.ADMIN_PASSWORD, steamKey: !!E.STEAM_API_KEY, database: !!(RU() && RT()) });
      if (act === "avatar" || act === "dimg") {
        const id = String(act === "avatar" ? q.id : q.d);
        if (!(act === "avatar" ? /^[a-f0-9]{12}$/ : /^\d{4}-\d{2}-\d{2}$/).test(id) || (act === "dimg" && id > today())) return out(404, { error: "нет" });
        const d = await rd("GET", (act === "avatar" ? "av:" : "dimg:") + id);
        if (!d) return out(404, { error: "нет" });
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=300");
        return res.status(200).send(Buffer.from(d.split(",")[1], "base64"));
      }
      if (act === "news") { try { return out(200, { news: jp(await rd("GET", "news"), []) }); } catch (e) { return out(200, { news: [] }); } }
      if (act === "bracket") { try { return out(200, { data: await getBr(), year: year() }); } catch (e) { return out(200, { data: null, year: year() }); } }
      if (act === "cfg") { let c = {}; try { c = jp(await rd("GET", "sitecfg"), {}); } catch (e) {} return out(200, { tg: c.tg || "", year: year(), streak: STREAK }); }
      if (act === "shop") return out(200, { items: ITEMS });
      if (act === "me") { if (!uid) return out(200, { me: null }); const u = await getU(uid); return out(200, { me: u ? priv(u) : null }); }
      if (act === "members") {
        try {
          const z = await rd("ZREVRANGE", "lbx", 0, 99), us = z.length ? await rd("MGET", ...z.map((i) => "u:" + i)) : [];
          return out(200, { members: us.map((x) => jp(x, null)).filter(Boolean).map(pub) });
        } catch (e) { return out(200, { members: [] }); }
      }
      if (act === "profile") {
        const u = /^[a-f0-9]{12}$/.test(String(q.id)) ? await getU(q.id) : null;
        if (!u) return out(404, { error: "Профиль не найден" });
        return out(200, { profile: { ...pub(u), given: +(await rd("ZSCORE", "ftop", u.id)) || 0 } });
      }
      if (act === "chat") {
        try { return out(200, { messages: (await rd("LRANGE", "chat", 0, 59)).map((x) => jp(x, null)).filter(Boolean).reverse() }); }
        catch (e) { return out(200, { messages: [] }); }
      }
      if (act === "fund") {
        try {
          const z = await rd("ZREVRANGE", "ftop", 0, 9, "WITHSCORES"), ids = [], sc = [];
          for (let i = 0; i < z.length; i += 2) { ids.push(z[i]); sc.push(+z[i + 1]); }
          const us = ids.length ? await rd("MGET", ...ids.map((i) => "u:" + i)) : [];
          return out(200, {
            total: +(await rd("GET", "fund")) || 0,
            cfg: jp(await rd("GET", "fundcfg"), { title: "Фонд сообщества", target: 10000 }),
            top: ids.map((id, i) => { const u = jp(us[i], {}); return { id, name: u.name || "Игрок", av: u.av || 0, amount: sc[i] }; }),
          });
        } catch (e) { return out(200, { total: 0, cfg: { title: "Фонд сообщества", target: 10000 }, top: [] }); }
      }
      return out(400, { error: "Неизвестное действие" });
    }
    if (req.method !== "POST") return out(405, { error: "Метод не поддерживается" });

    /* ================= публичное ================= */
    if (act === "register") {
      const name = clean(b.name, 20).replace(/\s+/g, " "), pw = String(b.password || "");
      if (!/^[\p{L}\p{N}_\- ]{3,20}$/u.test(name)) return out(400, { error: "Ник: 3–20 символов, буквы, цифры, _ - и пробел" });
      if (pw.length < 6 || pw.length > 64) return out(400, { error: "Пароль: от 6 до 64 символов" });
      if (!(await rd("SET", "rr:" + ip, "1", "EX", 60, "NX"))) return out(429, { error: "Подожди минуту перед новой регистрацией" });
      const id = crypto.randomBytes(6).toString("hex"), salt = crypto.randomBytes(8).toString("hex");
      if (!(await rd("SET", "un:" + name.toLowerCase(), id, "NX"))) return out(409, { error: "Такой ник уже занят" });
      await put({ id, name, salt, hash: hash(pw, salt), bio: "", xp: 0, coins: 50, own: [], eq: {}, av: 0, created: Date.now() });
      cookie(id);
      return out(200, { ok: true });
    }
    if (act === "login") {
      {
        const k = "la:" + ip, n = +(await rd("INCR", k));
        if (n === 1) await rd("EXPIRE", k, 600);
        if (n > 15) return out(429, { error: "Слишком много попыток, подожди 10 минут" });
        const id = await rd("GET", "un:" + clean(b.name, 20).toLowerCase()), u = id ? await getU(id) : null;
        const ok = u && (() => { const a = Buffer.from(hash(String(b.password || ""), u.salt)), c = Buffer.from(u.hash); return a.length === c.length && crypto.timingSafeEqual(a, c); })();
        if (!ok) return out(401, { error: "Неверный ник или пароль" });
        cookie(u.id);
        return out(200, { ok: true });
      }
    }
    if (act === "logout") { cookie(null); return out(200, { ok: true }); }
    if (act === "bracket_add") {
      const t = clean(b.game, 60), u = clean(b.name, 30);
      if (!t || !u) return out(400, { error: "Впиши название игры и своё имя" });
      const d = (await getBr()) || { x: {}, n: Array.from({ length: 16 }, () => ({ t: "", a: 0, u: "" })), w: [Array(8).fill(null), Array(4).fill(null), Array(2).fill(null), [null]] };
      const i = d.n.findIndex((x) => !x || !String(x.t || "").trim());
      if (i < 0) return out(409, { error: "Все 16 мест уже заняты" });
      if (!(await rd("SET", "rl:" + ip, "1", "EX", 600, "NX"))) return out(429, { error: "Подожди 10 минут перед следующей заявкой" });
      d.n[i] = { t, a: 0, u };
      await setBr(d);
      return out(200, { ok: true });
    }

    /* ================= игра дня: состояние (можно без входа) ================= */
    if (act === "daily_state") {
      const d = today(), rec = jp(await rd("GET", "daily:" + d), null);
      if (!rec) return out(200, { has: false });
      const p = uid ? jp(await rd("GET", `dp:${d}:${uid}`), { t: 0, s: 0 }) : { t: 0, s: 0 };
      return out(200, { has: true, date: d, tries: p.t, max: 5, state: p.s, login: !!uid, reward: rec.reward, total: rec.hints.length,
        hints: p.s ? rec.hints : rec.hints.slice(0, p.t), answer: p.s ? rec.show : undefined, img: !!rec.img });
    }

    if (act === "event_state") {
      const evs = jp(await rd("GET", "events"), []), n = today();
      const fl = uid && evs.length ? await rd("MGET", ...evs.map((e) => `ev:${e.id}:${uid}`)) : [];
      return out(200, { login: !!uid, events: evs.map((e, i) => ({ id: e.id, title: e.title, desc: e.desc, coins: e.coins, xp: e.xp, end: e.end, left: e.max ? Math.max(0, e.max - (e.taken || 0)) : null, over: !!(e.end && e.end < n), done: !!fl[i] })) });
    }

    /* ================= действия игрока ================= */
    const UA = ["me_update", "avatar_set", "daily_bonus", "daily_guess", "shop_buy", "shop_equip", "chat_send", "fund_give", "event_claim"];
    if (UA.includes(act)) {
      if (!uid) return out(401, { error: "Сначала войди или зарегистрируйся" });
      const u = await getU(uid);
      if (!u) return out(401, { error: "Профиль не найден" });
      if (act === "me_update") { u.bio = clean(b.bio, 200); await put(u); return out(200, { ok: true }); }
      if (act === "avatar_set") {
        const im = String(b.img || "");
        if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(im) || im.length > 90000) return out(400, { error: "Картинка слишком большая" });
        await rd("SET", "av:" + u.id, im); u.av = Date.now(); await put(u);
        return out(200, { ok: true });
      }
      if (act === "daily_bonus") {
        const d = today();
        if (u.last === d) return out(200, { got: 0 });
        const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
        u.streak = u.last === y ? (u.streak || 0) + 1 : 1;
        u.last = d;
        const r = STREAK[(u.streak - 1) % 7];
        u.coins = (u.coins || 0) + r.c; u.xp = (u.xp || 0) + r.x; await put(u);
        return out(200, { got: r.c, xp: r.x, streak: u.streak, day: (u.streak - 1) % 7 + 1 });
      }
      if (act === "daily_guess") {
        const d = today(), rec = jp(await rd("GET", "daily:" + d), null);
        if (!rec) return out(404, { error: "Сегодня игры нет" });
        const key = `dp:${d}:${u.id}`, p = jp(await rd("GET", key), { t: 0, s: 0 });
        if (p.s) return out(200, { state: p.s });
        const g = norm(b.guess);
        if (!g) return out(400, { error: "Впиши ответ" });
        let reward = 0;
        if (rec.ans.includes(g)) { p.s = 1; reward = Math.max(20, rec.reward - 20 * p.t); u.coins = (u.coins || 0) + reward; u.xp = (u.xp || 0) + 30; await put(u); }
        else { p.t++; if (p.t >= 5) p.s = 2; }
        await rd("SET", key, JSON.stringify(p), "EX", 172800);
        return out(200, { correct: p.s === 1, state: p.s, reward });
      }
      if (act === "shop_buy") {
        const it = ITEMS.find((i) => i.id === b.item);
        if (!it) return out(404, { error: "Нет такого товара" });
        u.own = u.own || [];
        if (u.own.includes(it.id)) return out(400, { error: "Уже куплено" });
        if ((u.coins || 0) < it.p) return out(400, { error: "Не хватает монет" });
        u.coins -= it.p; u.own.push(it.id); u.eq = u.eq || {}; if (!u.eq[it.t]) u.eq[it.t] = it.id;
        await put(u);
        return out(200, { ok: true });
      }
      if (act === "shop_equip") {
        u.eq = u.eq || {};
        if (b.off && ["frame", "banner", "color", "badge"].includes(b.off)) delete u.eq[b.off];
        else { const it = ITEMS.find((i) => i.id === b.item); if (!it || !(u.own || []).includes(it.id)) return out(400, { error: "Сначала купи" }); u.eq[it.t] = it.id; }
        await put(u);
        return out(200, { ok: true });
      }
      if (act === "chat_send") {
        const text = clean(b.text, 300);
        if (!text) return out(400, { error: "Пустое сообщение" });
        if (!(await rd("SET", "cr:" + u.id, "1", "PX", 1500, "NX"))) return out(429, { error: "Не так быстро" });
        await rd("LPUSH", "chat", JSON.stringify({ id: Date.now().toString(36) + crypto.randomBytes(2).toString("hex"), uid: u.id, name: u.name, av: u.av || 0, col: val(u, "color"), badge: val(u, "badge"), text, ts: Date.now() }));
        await rd("LTRIM", "chat", 0, 99);
        if (await rd("SET", "cx:" + u.id, "1", "EX", 60, "NX")) { u.xp = (u.xp || 0) + 2; await put(u); }
        return out(200, { ok: true });
      }
      if (act === "event_claim") {
        const c = +(await rd("INCR", "ea:" + u.id));
        if (c === 1) await rd("EXPIRE", "ea:" + u.id, 600);
        if (c > 10) return out(429, { error: "Слишком много попыток, подожди 10 минут" });
        const code = norm(b.code);
        if (!code) return out(400, { error: "Впиши ключ" });
        const evs = jp(await rd("GET", "events"), []), e = evs.find((x) => x.code === code);
        if (!e) return out(404, { error: "Такого ключа нет" });
        if (e.end && e.end < today()) return out(400, { error: "Этот ивент уже закончился" });
        if (e.max && (e.taken || 0) >= e.max) return out(400, { error: "Награды по этому ключу закончились" });
        if (!(await rd("SET", `ev:${e.id}:${u.id}`, "1", "NX"))) return out(409, { error: "Ты уже забрал награду за этот ключ" });
        e.taken = (e.taken || 0) + 1;
        await rd("SET", "events", JSON.stringify(evs));
        u.coins = (u.coins || 0) + e.coins; u.xp = (u.xp || 0) + e.xp; await put(u);
        return out(200, { ok: true, title: e.title, coins: e.coins, xp: e.xp });
      }
      if (act === "fund_give") {
        const n = Math.floor(+b.amount);
        if (!(n >= 1) || n > (u.coins || 0)) return out(400, { error: "Столько монет у тебя нет" });
        u.coins -= n; u.xp = (u.xp || 0) + Math.floor(n / 5); await put(u);
        await rd("INCRBY", "fund", n); await rd("ZINCRBY", "ftop", n, u.id);
        return out(200, { ok: true });
      }
    }

    /* ================= админ (пароль) ================= */
    if (!E.ADMIN_PASSWORD) return out(500, { error: "В настройках хостинга не задан ADMIN_PASSWORD" });
    if (!b.password || b.password !== E.ADMIN_PASSWORD) return out(401, { error: "Неверный пароль" });
    if (act === "admin_login") return out(200, { ok: true });
    if (act === "news_add") {
      const title = clean(b.title, 120), text = String(b.text || "").trim().slice(0, 5000);
      if (!title) return out(400, { error: "Нужен заголовок" });
      const n = jp(await rd("GET", "news"), []);
      n.unshift({ id: Date.now().toString(36), title, text, date: new Date().toISOString() });
      await rd("SET", "news", JSON.stringify(n.slice(0, 100)));
      return out(200, { ok: true });
    }
    if (act === "news_del") { await rd("SET", "news", JSON.stringify(jp(await rd("GET", "news"), []).filter((x) => x.id !== b.id))); return out(200, { ok: true }); }
    if (act === "bracket_set") {
      const d = b.data, s = JSON.stringify(d || {});
      if (!d || !Array.isArray(d.n) || d.n.length !== 16 || !Array.isArray(d.w) || d.w.length !== 4 || s.length > 30000) return out(400, { error: "Плохие данные сетки" });
      await setBr(s);
      return out(200, { ok: true });
    }
    if (act === "site_cfg") {
      const tg = String(b.tg || "").trim();
      if (tg && !/^https:\/\/(t|telegram)\.me\/[\w\-+\/.@]+$/i.test(tg)) return out(400, { error: "Нужна ссылка вида https://t.me/название" });
      await rd("SET", "sitecfg", JSON.stringify({ tg }));
      return out(200, { ok: true });
    }
    if (act === "event_list") return out(200, { events: jp(await rd("GET", "events"), []) });
    if (act === "event_add") {
      const title = clean(b.title, 80), desc = clean(b.desc, 300), show = clean(b.code, 40), code = norm(show);
      const coins = Math.min(5000, Math.max(0, Math.floor(+b.coins) || 0)), xp = Math.min(5000, Math.max(0, Math.floor(+b.xp) || 0));
      const end = /^\d{4}-\d{2}-\d{2}$/.test(String(b.end || "")) ? String(b.end) : "";
      const max = Math.min(100000, Math.max(0, Math.floor(+b.max) || 0));
      if (!title) return out(400, { error: "Нужно название ивента" });
      if (code.length < 3) return out(400, { error: "Ключ должен быть хотя бы из 3 символов" });
      if (!coins && !xp) return out(400, { error: "Укажи награду: монеты или XP" });
      const evs = jp(await rd("GET", "events"), []);
      if (evs.some((e) => e.code === code)) return out(409, { error: "Такой ключ уже есть" });
      evs.unshift({ id: Date.now().toString(36), title, desc, code, show, coins, xp, end, max, taken: 0 });
      await rd("SET", "events", JSON.stringify(evs.slice(0, 50)));
      return out(200, { ok: true });
    }
    if (act === "event_del") { await rd("SET", "events", JSON.stringify(jp(await rd("GET", "events"), []).filter((e) => e.id !== b.id))); return out(200, { ok: true }); }
    if (act === "daily_set") {
      const date = String(b.date || ""), ans = String(b.answers || "").split(/[|,]/).map((x) => x.trim()).filter(Boolean);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return out(400, { error: "Нужна дата" });
      if (!ans.length) return out(400, { error: "Впиши хотя бы один правильный ответ" });
      const hints = (b.hints || []).map((h) => clean(h, 200)).filter(Boolean).slice(0, 3);
      const rec = { ans: ans.map(norm).filter(Boolean), show: ans[0], hints, reward: Math.min(1000, Math.max(20, Math.floor(+b.reward) || 100)), img: false };
      const old = jp(await rd("GET", "daily:" + date), null);
      if (b.img) {
        const im = String(b.img);
        if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(im) || im.length > 500000) return out(400, { error: "Картинка слишком большая" });
        await rd("SET", "dimg:" + date, im); rec.img = true;
      } else if (old && old.img) rec.img = true;
      await rd("SET", "daily:" + date, JSON.stringify(rec));
      return out(200, { ok: true });
    }
    if (act === "user_del") {
      const u = /^[a-f0-9]{12}$/.test(String(b.id)) ? await getU(b.id) : null;
      if (u) { await rd("DEL", "u:" + u.id); await rd("DEL", "un:" + u.name.toLowerCase()); await rd("DEL", "av:" + u.id); await rd("ZREM", "lbx", u.id); await rd("ZREM", "ftop", u.id); }
      return out(200, { ok: true });
    }
    if (act === "user_grant") {
      const u = /^[a-f0-9]{12}$/.test(String(b.id)) ? await getU(b.id) : null;
      if (!u) return out(404, { error: "Профиль не найден" });
      u.coins = Math.max(0, (u.coins || 0) + Math.max(-1e6, Math.min(1e6, Math.floor(+b.coins) || 0)));
      await put(u);
      return out(200, { ok: true });
    }
    if (act === "fund_cfg") {
      await rd("SET", "fundcfg", JSON.stringify({ title: clean(b.title, 80) || "Фонд сообщества", target: Math.max(1, Math.floor(+b.target) || 10000) }));
      return out(200, { ok: true });
    }
    if (act === "chat_del") {
      const rest = (await rd("LRANGE", "chat", 0, 99)).filter((x) => (jp(x, {}) || {}).id !== b.id);
      await rd("DEL", "chat");
      if (rest.length) await rd("RPUSH", "chat", ...rest);
      return out(200, { ok: true });
    }
    if (!E.STEAM_API_KEY) return out(500, { error: "В настройках хостинга не задан STEAM_API_KEY" });
    if (act === "games") {
      const t = String(b.profile || "").trim().replace(/\/+$/, ""), m = t.match(/profiles\/(\d{17})/);
      let id = m ? m[1] : (/^\d{17}$/.test(t) ? t : null);
      if (!id) {
        const v = (t.match(/\/id\/([^/?#]+)/) || [null, t])[1];
        const r = await get(`${S}ISteamUser/ResolveVanityURL/v1/?key=${E.STEAM_API_KEY}&vanityurl=${encodeURIComponent(v)}`);
        if (r.response.success !== 1) return out(404, { error: "Профиль не найден" });
        id = r.response.steamid;
      }
      const g = await get(`${S}IPlayerService/GetOwnedGames/v1/?key=${E.STEAM_API_KEY}&steamid=${id}&include_appinfo=1&include_played_free_games=1`);
      const list = ((g.response && g.response.games) || []).map((x) => ({ appid: x.appid, name: x.name, playtime: x.playtime_forever }));
      if (!list.length) return out(403, { error: "Игр не видно: профиль и «Сведения об играх» в Steam должны быть публичными" });
      return out(200, { steamid: id, games: list });
    }
    if (act === "achv") {
      if (!/^\d{17}$/.test(String(b.steamid))) return out(400, { error: "Плохой steamid" });
      const res2 = {};
      await Promise.all(ids8(b.appids).map(async (a) => {
        try {
          const r = await get(`${S}ISteamUserStats/GetPlayerAchievements/v1/?key=${E.STEAM_API_KEY}&steamid=${b.steamid}&appid=${a}`);
          const l = (r.playerstats && r.playerstats.achievements) || [];
          res2[a] = { total: l.length, got: l.filter((x) => x.achieved === 1).length };
        } catch (e) { res2[a] = { total: 0, got: 0 }; }
      }));
      return out(200, { results: res2 });
    }
    return out(400, { error: "Неизвестное действие" });
  } catch (e) {
    return out(502, { error: e.message });
  }
};
