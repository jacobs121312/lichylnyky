import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScenario, scenarioVars } from "../src/scenario.js";
import { runScenario } from "../src/tg.js";
import { fakeClient } from "./fake-bots.js";

// The scenarios configured for the user's meters (same text as on the site).
const COLD = `# Львівводоканал, холодна вода, лічильник 595128
надіслати 🛡️ Головне меню
натиснути 🧭 Лічильники
натиснути Внести показання 595128
надіслати {показник}
очікувати Збережене значення`;

const HOT = `# 1) Львівводоканал, лічильник 3007603
надіслати 🛡️ Головне меню
натиснути 🧭 Лічильники
натиснути Внести показання 3007603
надіслати {показник}
очікувати Збережене значення

# 2) Львівтеплоенерго, той самий лічильник
бот @lte_leotel_bot
надіслати 🧭 Лічильники
натиснути Передати показники
надіслати {показник}
пауза 2
зупинити_якщо занадто
зупинити_якщо помилк
зупинити_якщо невірн
зупинити_якщо зверніться`;

const fast = { pollMs: 10, quietMs: 40, replyTimeout: 600 };
const water = { decimals: 3, account: "" };

async function run(scenario, bot, value, client = fakeClient()) {
  const { steps, errors } = parseScenario(scenario.replace("пауза 2", "пауза 0.05"));
  assert.deepEqual(errors, []);
  const log = [], states = [];
  const vars = scenarioVars(water, { value, date: "2026-10-30" });
  try {
    await runScenario({ bot, steps, vars, client, onLog: (l) => log.push(l), onStep: (i, s) => states.push([i, s]), ...fast });
    return { ok: true, log, states, sent: client.sent };
  } catch (e) {
    return { ok: false, error: e.message, log, states, sent: client.sent };
  }
}

test("scenarios parse without errors", () => {
  assert.equal(parseScenario(COLD).steps.length, 5);
  assert.equal(parseScenario(HOT).steps.filter((s) => s.op === "bot").length, 1);
});

test("cold water: reading is saved by Vodokanal", async () => {
  const r = await run(COLD, "vodokanal_lviv_bot", 740.25);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.sent.map((x) => x[1]), ["🛡️ Головне меню", "🧭 Лічильники", "🔹 Внести показання 595128 ✔️", "740"]);
  assert.ok(r.log.some((l) => /Збережене значення.*740/.test(l.text)));
});

test("cold water: a reading below the last one is reported as a failure", async () => {
  const r = await run(COLD, "vodokanal_lviv_bot", 700);
  assert.equal(r.ok, false);
  assert.match(r.error, /не відповів «Збережене значення»/);
  assert.deepEqual(r.states.at(-1), [4, "err"]);
});

test("hot water: goes to Vodokanal and then to Lvivteploenergo", async () => {
  const r = await run(HOT, "vodokanal_lviv_bot", 52.4);
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.sent.map((x) => x.join(" ")), [
    "vodokanal_lviv_bot 🛡️ Головне меню", "vodokanal_lviv_bot 🧭 Лічильники", "vodokanal_lviv_bot 🔸 Внести показання 3007603", "vodokanal_lviv_bot 52",
    "lte_leotel_bot 🧭 Лічильники", "lte_leotel_bot [callback send]", "lte_leotel_bot 52",
  ]);
  assert.ok(r.log.some((l) => /Показники прийнято/.test(l.text)));
});

test("hot water: Lvivteploenergo rejecting the number stops with its message", async () => {
  const r = await run(HOT, "vodokanal_lviv_bot", 5852);
  assert.equal(r.ok, false);
  assert.match(r.error, /занадто велика різниця/);
});

test("a missing button names what the bot offers instead", async () => {
  const r = await run("надіслати 🛡️ Головне меню\nнатиснути Подати показник", "vodokanal_lviv_bot", 740);
  assert.equal(r.ok, false);
  assert.match(r.error, /не знайшов кнопку «Подати показник».*🧭 Лічильники/);
});

test("an unknown bot is reported", async () => {
  const r = await run("надіслати /start", "no_such_bot", 1);
  assert.equal(r.ok, false);
  assert.match(r.error, /USERNAME_NOT_OCCUPIED/);
});

test("readings are sent as whole numbers, {показник_точно} keeps the fraction", () => {
  const v = scenarioVars({ decimals: 3, account: "123" }, { value: 312.4567, date: "2026-10-30" });
  assert.equal(v["показник"], "312");
  assert.equal(v["показник_точно"], "312,457");
  assert.equal(v["дата"], "30.10.2026");
});

test("sync file round-trips through Saved Messages", async () => {
  const { syncPull, syncPush } = await import("../src/tg.js");
  const saved = [];
  const client = {
    async getMessages(peer, { search }) { return saved.filter((m) => m.text.includes(search)).slice().reverse(); },
    async downloadMedia(m) { return m.buf; },
    async sendFile(peer, { file, caption }) { const m = { id: saved.length + 1, text: caption, media: { document: {} }, buf: file.buffer }; saved.push(m); return m; },
    async editMessage(peer, { message, text, file }) { const m = saved.find((x) => x.id === message); m.text = text; m.buf = file.buffer; return m; },
  };
  assert.equal(await syncPull(client), null);
  const id = await syncPush({ docs: { a: { u: 1 } }, deleted: {} }, null, client);
  assert.deepEqual((await syncPull(client)).data.docs, { a: { u: 1 } });
  assert.equal(await syncPush({ docs: { a: { u: 2 } }, deleted: {} }, id, client), id);
  assert.equal(saved.length, 1, "the same message is updated, not a new one each time");
  assert.equal((await syncPull(client)).data.docs.a.u, 2);
});
