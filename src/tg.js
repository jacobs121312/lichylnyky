// Telegram (MTProto) client running in the browser, signed in as the user.
// Loaded lazily from app.js so the ~700 KB library is fetched only when needed.
import { Buffer } from "buffer";
globalThis.Buffer = globalThis.Buffer || Buffer;
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { fillVars } from "./scenario.js";

const LS = "lichylnyky.tg";
let client = null;

function loadCfg() { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } }
function saveCfg(c) { try { localStorage.setItem(LS, JSON.stringify(c)); } catch {} }

export function config() { const c = loadCfg(); return { apiId: c.apiId || "", hasHash: !!c.apiHash, hasSession: !!c.session, me: c.me || "" }; }

async function makeClient(cfg) {
  const c = new TelegramClient(new StringSession(cfg.session || ""), Number(cfg.apiId), cfg.apiHash, {
    connectionRetries: 5, useWSS: true,
  });
  c.setLogLevel("error");
  await c.connect();
  return c;
}

// Returns a signed-in client, or null when there is no saved session.
export async function getClient() {
  if (client) return client;
  const cfg = loadCfg();
  if (!cfg.session || !cfg.apiId || !cfg.apiHash) return null;
  const c = await makeClient(cfg);
  if (!(await c.checkAuthorization())) { await c.disconnect(); return null; }
  client = c;
  return client;
}

// ask(kind) resolves with what the user typed: "phone" | "code" | "password"
export async function login({ apiId, apiHash }, ask) {
  const cfg = { apiId: String(apiId).trim(), apiHash: String(apiHash).trim() };
  if (client) { try { await client.disconnect(); } catch {} client = null; }
  const c = await makeClient(cfg);
  let failure = null;
  try {
    await c.start({
      phoneNumber: () => ask("phone"),
      phoneCode: () => ask("code"),
      password: () => ask("password"),
      onError: (err) => { failure = err; return true; }, // stop at the first error instead of re-asking
    });
  } catch (e) { failure = failure || e; }
  if (failure) { try { await c.disconnect(); } catch {} throw failure; }
  const me = await c.getMe();
  saveCfg({ ...cfg, session: c.session.save(), me: [me.firstName, me.lastName].filter(Boolean).join(" ") || me.username || "" });
  client = c;
  return config();
}

export async function logout() {
  try { const c = await getClient(); if (c) { await c.invoke(new Api.auth.LogOut()); await c.disconnect(); } } catch {}
  client = null;
  const { apiId, apiHash } = loadCfg();
  saveCfg({ apiId, apiHash });
}

/* ---------- scenario runner ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

function buttonsOf(msg) {
  const rows = msg?.replyMarkup?.rows || [];
  return rows.flatMap((r) => r.buttons || []);
}

// Snapshot of the chat: incoming message id -> edit date, so we can spot new and edited replies.
async function snapshot(c, peer) {
  const msgs = await c.getMessages(peer, { limit: 12 });
  const map = new Map();
  for (const m of msgs) if (!m.out) map.set(m.id, m.editDate || 0);
  return { msgs, map };
}

export async function runScenario({ bot, steps, vars, onLog, signal }) {
  const c = await getClient();
  if (!c) throw new Error("Спершу увійдіть у Telegram");
  const peer = await c.getInputEntity(bot.replace(/^@/, "").replace(/^https?:\/\/t\.me\//, ""));
  let snap = await snapshot(c, peer);
  const said = (text) => onLog({ who: "me", text });
  const stopIfAborted = () => { if (signal?.aborted) throw new Error("Зупинено"); };

  // Wait until the bot answers (new or edited messages) and then goes quiet for a moment.
  async function waitReply(timeout = 20000) {
    const start = Date.now();
    let changedAt = 0, fresh = [];
    while (Date.now() - start < timeout) {
      stopIfAborted();
      await sleep(800);
      const next = await snapshot(c, peer);
      const changed = next.msgs.filter((m) => !m.out && snap.map.get(m.id) !== (m.editDate || 0));
      if (changed.length) {
        const ids = new Set(fresh.map((m) => m.id));
        for (const m of changed) if (!ids.has(m.id)) fresh.push(m); else fresh = fresh.map((x) => (x.id === m.id ? m : x));
        snap = next;
        changedAt = Date.now();
      } else if (changedAt && Date.now() - changedAt > 1500) break;
    }
    fresh.sort((a, b) => a.id - b.id).forEach((m) => onLog({ who: "bot", text: m.message || "(без тексту)", buttons: buttonsOf(m).map((b) => b.text) }));
    return fresh;
  }

  const recentReplies = [];
  for (const step of steps) {
    stopIfAborted();
    if (step.op === "pause") { await sleep(step.ms); continue; }

    if (step.op === "send") {
      const text = fillVars(step.arg, vars);
      if (/\{[^}]+\}/.test(text)) throw new Error(`Рядок ${step.line}: невідома змінна в «${step.arg}»`);
      if (!text) throw new Error(`Рядок ${step.line}: порожнє значення (заповніть особовий рахунок у налаштуваннях)`);
      said(text);
      await c.sendMessage(peer, { message: text });
      recentReplies.push(...(await waitReply()));
      continue;
    }

    if (step.op === "click") {
      const want = norm(fillVars(step.arg, vars));
      const withButtons = snap.msgs.filter((m) => !m.out && buttonsOf(m).length);
      let found = null;
      for (const m of withButtons) { // newest first
        const b = buttonsOf(m).find((x) => norm(x.text) === want) || buttonsOf(m).find((x) => norm(x.text).includes(want));
        if (b) { found = { m, b }; break; }
      }
      if (!found) {
        const offered = [...new Set(withButtons.flatMap((m) => buttonsOf(m).map((b) => b.text)))];
        throw new Error(`Рядок ${step.line}: не знайшов кнопку «${step.arg}».` + (offered.length ? ` Бот пропонує: ${offered.join(" · ")}` : " Бот не показує кнопок."));
      }
      said(`[${found.b.text}]`);
      if (found.b.className === "KeyboardButtonCallback") {
        try { await c.invoke(new Api.messages.GetBotCallbackAnswer({ peer, msgId: found.m.id, data: found.b.data })); }
        catch (e) { if (!/TIMEOUT/i.test(e.errorMessage || e.message)) throw e; }
      } else if (found.b.className === "KeyboardButton") {
        await c.sendMessage(peer, { message: found.b.text });
      } else {
        throw new Error(`Рядок ${step.line}: кнопку «${found.b.text}» не можна натиснути автоматично (це посилання або запит контакту)`);
      }
      recentReplies.push(...(await waitReply()));
      continue;
    }

    if (step.op === "expect") {
      const want = norm(fillVars(step.arg, vars));
      const hit = () => recentReplies.some((m) => norm(m.message).includes(want));
      if (!hit()) recentReplies.push(...(await waitReply(10000)));
      if (!hit()) throw new Error(`Рядок ${step.line}: бот не відповів «${step.arg}». Перевірте відповідь вище.`);
    }
  }
  return { ok: true };
}
