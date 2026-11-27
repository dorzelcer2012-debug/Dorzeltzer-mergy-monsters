// Shared leaderboard for Mergy Monsters.
// GET  /api/leaderboard  -> { players: [...] }  (top 500 by best score)
// POST /api/leaderboard  -> save/update one player, returns the same list
// Data lives in Netlify Blobs (built into every Netlify site, no setup needed).
import { getStore } from "@netlify/blobs";
// Open the store. Strong consistency needs extra platform support; fall back to the default if it is missing.
function openStore(name) {
  try { return getStore({ name, consistency: "strong" }); } catch { return getStore(name); }
}
const safe = (fn) => async (req) => {
  try { return await fn(req.clone(), false); }
  catch (e) {
    try { return await fn(req, true); }
    catch (e2) {
      return new Response(JSON.stringify({ error: "Server error: " + String(e2 && e2.message || e2).slice(0, 160), now: Date.now() }),
        { status: 500, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
  }
};


const MAX_PLAYERS = 2000;
const clean = s => String(s ?? "").replace(/[<>\u0000-\u001f\u007f]/g, "").trim().slice(0, 16);
const num = (v, max = 5e7) => { v = Math.floor(Number(v)); return Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0; };
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" }
});
// ISO week like "2026-W48" (UTC)
const weekKey = (t = Date.now()) => {
  const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const w1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return d.getUTCFullYear() + "-W" + String(1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7)).padStart(2, "0");
};
// When a new week starts, remember last week's champion before anyone's weekly score is replaced.
function rollWeek(board) {
  const cur = weekKey();
  if (!board.weekKey) { board.weekKey = cur; return true; }
  if (board.weekKey === cur) return false;
  let best = null;
  for (const [id, p] of Object.entries(board.players)) {
    if (id === "creatordor01" || p.week !== board.weekKey || !(p.weekBest > 0)) continue;
    if (!best || p.weekBest > best.score) best = { id, name: p.name, score: p.weekBest, week: board.weekKey };
  }
  if (best) board.lastWinner = best;
  board.weekKey = cur;
  return true;
}
const list = board => ({
  lastWinner: board.lastWinner || null,
  players: Object.entries(board.players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => b.best - a.best)
    .slice(0, 500)
});

const handler = async (req, eventual) => {
  const store = (eventual ? getStore("leaderboard") : openStore("leaderboard"));
  const board = (await store.get("board", { type: "json" })) || { players: {} };
  if (rollWeek(board) && req.method === "GET") await store.setJSON("board", board);

  if (req.method === "GET") {
    // Let Netlify's CDN reuse this answer for 30 s, so most visits don't run the function at all.
    const res = json(list(board));
    res.headers.set("cache-control", "public, max-age=0, must-revalidate");
    res.headers.set("netlify-cdn-cache-control", "public, durable, s-maxage=30, stale-while-revalidate=60");
    return res;
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let b;
  try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const id = String(b.id || "");
  if (!/^[a-z0-9]{6,40}$/i.test(id)) return json({ error: "Bad player id" }, 400);
  const name = clean(b.name);
  if (!name) return json({ error: "Name required" }, 400);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? b.day : "";
  const week = /^\d{4}-W\d{2}$/.test(b.week) ? b.week : "";

  const old = board.players[id] || {};
  const p = {
    name,
    best: Math.max(num(old.best), num(b.best)),
    top: Math.max(num(old.top), Math.min(11, num(b.top))),
    games: Math.max(num(old.games), num(b.games, 1e6)),
    day: day || old.day || "",
    dayBest: 0,
    week: week || old.week || "",
    weekBest: 0,
    refs: num(old.refs, 1e5),
    ts: Date.now()
  };
  p.weekBest = week
    ? (old.week === week ? Math.max(num(old.weekBest), num(b.weekBest)) : num(b.weekBest))
    : num(old.weekBest);
  p.dayBest = day
    ? (old.day === day ? Math.max(num(old.dayBest), num(b.dayBest)) : num(b.dayBest))
    : num(old.dayBest);
  board.players[id] = p;
  // A brand-new player who came from a friend's invite link: count it for that friend (once per new player).
  const ref = String(b.ref || "");
  if (b.newPlayer && /^[a-z0-9]{6,40}$/i.test(ref) && ref !== id && board.players[ref] && !old.name) {
    board.players[ref].refs = num(board.players[ref].refs, 1e5) + 1;
  }

  const ids = Object.keys(board.players);
  if (ids.length > MAX_PLAYERS) {
    ids.sort((a, c) => board.players[c].best - board.players[a].best);
    for (const x of ids.slice(MAX_PLAYERS)) delete board.players[x];
  }
  await store.setJSON("board", board);
  return json(list(board));
};

export default safe(handler);

export const config = { path: "/api/leaderboard" };
