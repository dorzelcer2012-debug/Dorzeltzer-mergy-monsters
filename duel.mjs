// Mergy Monsters — online duels. Two phones, one room, same board, live scores.
import { getStore } from "@netlify/blobs";

const json = (o, status = 200) => new Response(JSON.stringify({ ...o, now: Date.now() }), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" }
});
const clean = s => String(s ?? "").replace(/[<>&"\u0000-\u001f]/g, "").trim().slice(0, 14);
const num = (v, max) => { v = Math.floor(Number(v)); return Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0; };
const okId = id => /^[a-z0-9]{6}$/.test(id || "");
const DAY = 24 * 3600 * 1000;

async function state(st, id) {
  const meta = await st.get(id, { type: "json" });
  if (!meta || Date.now() - meta.created > DAY) return null;
  const [h, g] = await Promise.all([st.get(id + "-h", { type: "json" }), st.get(id + "-g", { type: "json" })]);
  return { meta, h: h && h.round === meta.round ? h : null, g: g && g.round === meta.round ? g : null };
}

export default async (req) => {
  const st = getStore({ name: "duels", consistency: "strong" });
  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id");
    if (!okId(id)) return json({ error: "Bad room" }, 400);
    const s = await state(st, id);
    return s ? json(s) : json({ error: "Room not found" }, 404);
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  if (b.a === "create") {
    const name = clean(b.name) || "Player 1";
    let id = ""; const abc = "abcdefghjkmnpqrstuvwxyz23456789";
    for (let i = 0; i < 6; i++) id += abc[Math.floor(Math.random() * abc.length)];
    const meta = { seed: Math.floor(Math.random() * 4294967295), time: Math.max(30, Math.min(600, num(b.time, 600) || 120)),
      h: name, g: null, start: 0, round: 1, created: Date.now() };
    await st.setJSON(id, meta);
    return json({ id, meta, h: null, g: null });
  }

  const id = String(b.id || "");
  if (!okId(id)) return json({ error: "Bad room" }, 400);
  const s = await state(st, id);
  if (!s) return json({ error: "Room not found" }, 404);
  const meta = s.meta;

  if (b.a === "join") {
    const name = clean(b.name) || "Player 2";
    if (meta.g && meta.g !== name) return json({ error: "This game already has 2 players" }, 409);
    meta.g = name; await st.setJSON(id, meta);
    return json({ ...s, meta });
  }
  if (b.a === "start") {
    if (!meta.g) return json({ error: "Wait for your friend to join" }, 409);
    meta.start = Date.now() + 4000; await st.setJSON(id, meta);
    return json({ ...s, meta });
  }
  if (b.a === "rematch") {
    meta.round += 1; meta.seed = Math.floor(Math.random() * 4294967295); meta.start = Date.now() + 5000;
    await st.setJSON(id, meta);
    return json({ meta, h: null, g: null });
  }
  if (b.a === "score") {
    const who = b.who === "g" ? "g" : "h";
    if (num(b.round, 1e6) === meta.round) {
      const row = { score: num(b.score, 5e7), done: !!b.done, round: meta.round, ts: Date.now() };
      await st.setJSON(id + "-" + who, row); s[who] = row;
    }
    return json(s);
  }
  return json({ error: "Unknown action" }, 400);
};

export const config = { path: "/api/duel" };
