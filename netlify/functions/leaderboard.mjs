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
const list = board => ({
  players: Object.entries(board.players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => b.best - a.best)
    .slice(0, 500)
});

const handler = async (req, eventual) => {
  const store = (eventual ? getStore("leaderboard") : openStore("leaderboard"));
  const board = (await store.get("board", { type: "json" })) || { players: {} };

  if (req.method === "GET") return json(list(board));
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let b;
  try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const id = String(b.id || "");
  if (!/^[a-z0-9]{6,40}$/i.test(id)) return json({ error: "Bad player id" }, 400);
  const name = clean(b.name);
  if (!name) return json({ error: "Name required" }, 400);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day) ? b.day : "";

  const old = board.players[id] || {};
  const p = {
    name,
    best: Math.max(num(old.best), num(b.best)),
    top: Math.max(num(old.top), Math.min(11, num(b.top))),
    games: Math.max(num(old.games), num(b.games, 1e6)),
    day: day || old.day || "",
    dayBest: 0,
    ts: Date.now()
  };
  p.dayBest = day
    ? (old.day === day ? Math.max(num(old.dayBest), num(b.dayBest)) : num(b.dayBest))
    : num(old.dayBest);
  board.players[id] = p;

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
