// Telegram (MTProto) client running in the browser, signed in as the user.
// Loaded lazily from app.js so the ~700 KB library is fetched only when needed.
import { Buffer } from "buffer";
globalThis.Buffer = globalThis.Buffer || Buffer;
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import QRCode from "qrcode";
import { fillVars } from "./scenario.js";

export const qrSvg = (text) => QRCode.toString(text, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });

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

/* ---------- sign-in: QR code (like Telegram Desktop) or phone + code ---------- */
let pending = null; // { c, cfg, phone, hash }

export async function beginLogin({ apiId, apiHash }) {
  const cfg = { apiId: String(apiId).trim(), apiHash: String(apiHash).trim() };
  if (!/^\d+$/.test(cfg.apiId) || !/^[0-9a-f]{32}$/i.test(cfg.apiHash)) throw new Error("API_ID_INVALID");
  if (client) { try { await client.disconnect(); } catch {} client = null; }
  if (pending) { try { await pending.c.disconnect(); } catch {} }
  pending = { c: await makeClient(cfg), cfg };
}

export async function cancelLogin() {
  if (pending) { try { await pending.c.disconnect(); } catch {} pending = null; }
}

async function finish() {
  const { c, cfg } = pending;
  const me = await c.getMe();
  saveCfg({ ...cfg, session: c.session.save(), me: [me.firstName, me.lastName].filter(Boolean).join(" ") || me.username || "" });
  client = c; pending = null;
  return config();
}

const creds = () => ({ apiId: Number(pending.cfg.apiId), apiHash: pending.cfg.apiHash });

async function withPassword(askPassword) {
  let failure = null;
  await pending.c.signInWithPassword(creds(), {
    password: (hint) => askPassword(hint),
    onError: (e) => { failure = e; return true; },
  }).catch((e) => { failure = failure || e; });
  if (failure) throw failure;
}

// onQr(url) is called with a fresh tg://login link every ~30 s until the phone scans it.
export async function loginWithQr({ onQr, askPassword }) {
  let failure = null;
  await pending.c.signInUserWithQrCode(creds(), {
    qrCode: async ({ token }) => {
      const b64 = Buffer.from(token).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      onQr(`tg://login?token=${b64}`);
    },
    password: (hint) => askPassword(hint),
    onError: (e) => { failure = e; return true; },
  }).catch((e) => { failure = failure || e; });
  if (failure) throw failure;
  return finish();
}

// Where Telegram says it delivered the code, in words the user can act on.
const CODE_TYPES = {
  SentCodeTypeApp: "у застосунок Telegram на іншому вашому пристрої, у чат «Telegram» із синьою галочкою",
  SentCodeTypeSms: "SMS-повідомленням",
  SentCodeTypeSmsWord: "SMS-повідомленням (слово)",
  SentCodeTypeSmsPhrase: "SMS-повідомленням (фраза)",
  SentCodeTypeFirebaseSms: "SMS-повідомленням",
  SentCodeTypeCall: "голосовим дзвінком",
  SentCodeTypeFlashCall: "дзвінком: код — останні цифри номера, з якого дзвонять",
  SentCodeTypeMissedCall: "пропущеним дзвінком: код — останні цифри номера, з якого дзвонили",
  SentCodeTypeEmailCode: "на вашу пошту, прив'язану до Telegram",
  SentCodeTypeFragmentSms: "через Fragment (для анонімних номерів)",
};
const NEXT_TYPES = { CodeTypeSms: "SMS", CodeTypeCall: "дзвінком", CodeTypeFlashCall: "дзвінком", CodeTypeMissedCall: "дзвінком", CodeTypeFragmentSms: "через Fragment" };

function describeSent(r) {
  const t = r.type?.className;
  if (t === "SentCodeTypeSetUpEmailRequired") throw new Error("EMAIL_SETUP_REQUIRED");
  return {
    where: CODE_TYPES[t] || "невідомим способом",
    viaApp: t === "SentCodeTypeApp",
    next: NEXT_TYPES[r.nextType?.className] || null,
    timeout: r.timeout || 0,
  };
}

export async function sendPhoneCode(phone) {
  const r = await pending.c.invoke(new Api.auth.SendCode({
    phoneNumber: phone, apiId: Number(pending.cfg.apiId), apiHash: pending.cfg.apiHash, settings: new Api.CodeSettings({}),
  }));
  if (r.className === "auth.SentCodeSuccess") return { done: await finish() };
  pending.phone = phone; pending.hash = r.phoneCodeHash;
  return describeSent(r);
}

export async function resendPhoneCode() {
  const r = await pending.c.invoke(new Api.auth.ResendCode({ phoneNumber: pending.phone, phoneCodeHash: pending.hash }));
  pending.hash = r.phoneCodeHash;
  return describeSent(r);
}

export async function signInWithCode(code, askPassword) {
  try {
    await pending.c.invoke(new Api.auth.SignIn({ phoneNumber: pending.phone, phoneCodeHash: pending.hash, phoneCode: code }));
  } catch (e) {
    if (e.errorMessage !== "SESSION_PASSWORD_NEEDED") throw e;
    await withPassword(askPassword);
  }
  return finish();
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

export async function runScenario({ bot, steps, vars, onLog, onStep, signal }) {
  const c = await getClient();
  if (!c) throw new Error("Спершу увійдіть у Telegram");
  const resolve = (name) => c.getInputEntity(name.trim().replace(/^https?:\/\/t\.me\//, "").replace(/^@/, ""));
  let peer = await resolve(bot);
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
  // each step reports run → ok / err so the page can show progress
  const runStep = async (step) => {
    stopIfAborted();
    if (step.op === "pause") { await sleep(step.ms); return; }

    // one reading can go to several bots (e.g. hot water: Vodokanal and the heat supplier)
    if (step.op === "bot") {
      peer = await resolve(step.arg);
      snap = await snapshot(c, peer);
      recentReplies.length = 0;
      onLog({ who: "sys", text: `→ ${step.arg}` });
      return;
    }

    if (step.op === "failIf") {
      const bad = norm(fillVars(step.arg, vars));
      const hit = recentReplies.find((m) => norm(m.message).includes(bad));
      if (hit) throw new Error(`Бот відповів: «${hit.message}»`);
      return;
    }

    if (step.op === "send") {
      const text = fillVars(step.arg, vars);
      if (/\{[^}]+\}/.test(text)) throw new Error(`Рядок ${step.line}: невідома змінна в «${step.arg}»`);
      if (!text) throw new Error(`Рядок ${step.line}: порожнє значення (заповніть особовий рахунок у налаштуваннях)`);
      said(text);
      await c.sendMessage(peer, { message: text });
      recentReplies.push(...(await waitReply()));
      return;
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
      return;
    }

    if (step.op === "expect") {
      const want = norm(fillVars(step.arg, vars));
      const hit = () => recentReplies.some((m) => norm(m.message).includes(want));
      if (!hit()) recentReplies.push(...(await waitReply(10000)));
      if (!hit()) throw new Error(`Рядок ${step.line}: бот не відповів «${step.arg}». Перевірте відповідь вище.`);
    }
  };
  for (const [i, step] of steps.entries()) {
    onStep?.(i, "run");
    try { await runStep(step); } catch (e) { onStep?.(i, "err"); throw e; }
    onStep?.(i, "ok");
  }
  return { ok: true };
}
