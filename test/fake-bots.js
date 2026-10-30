// Fake Telegram client with two bots that behave like the real Lviv ones
// (menus and replies copied from the user's chat history), for testing scenarios offline.
let nextId = 1;
const kb = (className, ...texts) => ({ rows: texts.map((t) => ({ buttons: [{ className, text: t, data: Buffer.from(t) }] })) });

function vodokanal() {
  let waiting = null;
  return (text) => {
    if (text === "🛡️ Головне меню") return [["Оберіть потрібну дію у меню, що знаходиться нижче.", kb("KeyboardButton", "вул. Городоцька, 241, кв. 33", "🧭 Повірка лічильників", "🧭 Лічильники", "💳 Оплатити")]];
    if (text === "🧭 Лічильники") return [["Тариф для споживачів з ПДВ: 56.376 грн/м³", kb("KeyboardButton", "🔹 Внести показання 595128 ✔️", "Перейменувати 595128", "🔸 Внести показання 3007603", "Перейменувати 3007603", "🛡️ Головне меню")]];
    const m = text.match(/Внести показання (\d+)/);
    if (m) { waiting = m[1]; return [[`Внесіть показання лічильника № ${m[1]}, більший або рівний 732.000 м³.`, kb("KeyboardButton", "Лічильники")]]; }
    if (waiting && /^\d+$/.test(text)) {
      const n = Number(text), meter = waiting; waiting = null;
      if (meter === "595128" && n < 732) return [["Показання має бути більшим або рівним 732.000 м³", kb("KeyboardButton", "Лічильники")]];
      return [[`Збережене значення показання лічильника № ${meter}: ${n} м³`, kb("KeyboardButton", "Додати фото лічильника", "Лічильники")]];
    }
    return [["Оберіть потрібну дію у меню, що знаходиться нижче.", null]];
  };
}

function leotel() {
  let waiting = false;
  const h = (text) => {
    if (text === "🧭 Лічильники") return [
      ["Лічильники о/р: 3200009989 вулиця Городоцька, 241 кв.33:", kb("KeyboardButton", "🔝 До головного меню")],
      ["3007603 Гаряча вода Показники: 40.000", { rows: [{ buttons: [
        { className: "KeyboardButtonCallback", text: "Передати показники", data: Buffer.from("send") },
        { className: "KeyboardButtonCallback", text: "Історія показників", data: Buffer.from("hist") }] }] }],
    ];
    if (waiting && /^\d+$/.test(text)) {
      waiting = false;
      return Number(text) - 40 > 100
        ? [["😱 занадто велика різниця показників. Зверніться в абонвідділ", null]]
        : [["✅ Показники прийнято", null]];
    }
    return [["Головне меню:", kb("KeyboardButton", "🧭 Лічильники", "💳 Сальдо")]];
  };
  h.callback = (data) => (data === "send" ? ((waiting = true), [["🙂 Введіть поточні показники лічильника 3007603 Гаряча вода:", null]]) : []);
  return h;
}

export function fakeClient({ delay = 5 } = {}) {
  const chats = { vodokanal_lviv_bot: { msgs: [], bot: vodokanal() }, lte_leotel_bot: { msgs: [], bot: leotel() } };
  const sent = [];
  const push = (chat, out, message, replyMarkup = null) => chat.msgs.push({ id: nextId++, out, message, replyMarkup, editDate: 0 });
  const reply = (chat, list) => setTimeout(() => list.forEach(([t, markup]) => push(chat, false, t, markup)), delay);
  const chatOf = (peer) => { const c = chats[peer]; if (!c) throw Object.assign(new Error("USERNAME_NOT_OCCUPIED"), { errorMessage: "USERNAME_NOT_OCCUPIED" }); return c; };
  return {
    sent,
    async getInputEntity(name) { chatOf(name); return name; },
    async getMessages(peer, { limit }) { return chatOf(peer).msgs.slice(-limit).reverse().map((m) => ({ ...m })); },
    async sendMessage(peer, { message }) { const c = chatOf(peer); sent.push([peer, message]); push(c, true, message); reply(c, c.bot(message)); },
    async invoke(req) { const c = chatOf(req.peer); sent.push([req.peer, `[callback ${req.data}]`]); reply(c, c.bot.callback?.(String(req.data)) || []); return {}; },
  };
}
