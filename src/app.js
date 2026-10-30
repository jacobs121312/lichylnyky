import { DEFAULT_SCENARIO, parseScenario, scenarioVars, fillVars } from "./scenario.js";

const tg = () => import("./tg.js");

const TYPES = {
  elec:  {label:"Електроенергія", unit:"кВт·год", decimals:0, from:1, to:3, tariff:4.32,
          icon:'<path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor"/>'},
  gas:   {label:"Газ", unit:"м³", decimals:3, from:1, to:5, tariff:7.96,
          icon:'<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z" fill="currentColor"/>'},
  water: {label:"Вода", unit:"м³", decimals:3, from:20, to:25, tariff:0,
          icon:'<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" fill="currentColor"/>'},
  heat:  {label:"Опалення", unit:"Гкал", decimals:3, from:25, to:28, tariff:0,
          icon:'<path d="M5 20V9a3 3 0 0 1 6 0v11M13 20V5a3 3 0 0 1 6 0v15M3 20h18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'},
  other: {label:"Інше", unit:"од.", decimals:0, from:1, to:5, tariff:0,
          icon:'<circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 12l3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}
};
const TEMPLATES = [
  {type:"elec", name:"Електроенергія", provider:"Обленерго / постачальник"},
  {type:"gas", name:"Газ", provider:"Газопостачальна компанія"},
  {type:"water", name:"Холодна вода", provider:"Водоканал"},
  {type:"water", name:"Гаряча вода", provider:"Теплопостачальник"},
];
const DAY = 864e5;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
const fmtDate = d => d.toLocaleDateString("uk-UA",{day:"numeric",month:"long"});
const fmtShort = iso => { const [y,m,d] = iso.split("-"); return `${d}.${m}.${y}`; };
const toISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const parseISO = iso => { const [y,m,d] = iso.split("-").map(Number); return new Date(y,m-1,d); };
const today0 = () => { const t = new Date(); return new Date(t.getFullYear(),t.getMonth(),t.getDate()); };
const num = (v, dec=2) => Number(v).toLocaleString("uk-UA",{minimumFractionDigits:0,maximumFractionDigits:dec});
const money = v => Number(v).toLocaleString("uk-UA",{minimumFractionDigits:2,maximumFractionDigits:2}) + " грн";
const plural = (n, one, few, many) => { const a=Math.abs(n)%100, b=a%10; return a>10&&a<20?many:b===1?one:b>=2&&b<=4?few:many; };
const days = n => `${n} ${plural(n,"день","дні","днів")}`;
const botName = b => String(b||"").trim().replace(/^https?:\/\/t\.me\//,"").replace(/^@/,"");

/* ---------- storage ---------- */
const LS_KEY = "lichylnyky.v1";
let docs = {};
function loadLocal(){ try { docs = JSON.parse(localStorage.getItem(LS_KEY) || "{}").docs || {}; } catch { docs = {}; } }
function saveLocal(){ try { localStorage.setItem(LS_KEY, JSON.stringify({docs})); } catch { toast("Браузер не дає зберегти дані"); } }
function put(id, data){ docs[id] = data; saveLocal(); render(); }
function remove(id){ delete docs[id]; saveLocal(); render(); }

/* ---------- model ---------- */
const meters = () => Object.entries(docs).filter(([,d]) => d.kind === "meter").map(([id,d]) => ({id,...d})).sort((a,b)=>(a.created||0)-(b.created||0));
const readingsOf = mid => Object.entries(docs).filter(([,d]) => d.kind === "reading" && d.meterId === mid).map(([id,d]) => ({id,...d})).sort((a,b)=> a.date<b.date?-1:a.date>b.date?1:(a.created||0)-(b.created||0));
const canAutoSend = m => !!(botName(m.bot) && m.scenario && !parseScenario(m.scenario).errors.length);

function clampDay(y,m,d){ return Math.min(d, new Date(y,m+1,0).getDate()); }
function windowAt(mt, y, m){
  const s = new Date(y, m, clampDay(y,m,mt.from));
  const e = mt.to >= mt.from ? new Date(y, m, clampDay(y,m,mt.to)) : new Date(y, m+1, clampDay(y,m+1,mt.to));
  return {s, e};
}
function status(mt){
  const t = today0();
  let y = t.getFullYear(), m = t.getMonth();
  let w = windowAt(mt, y, m);
  if (w.s > t) { m -= 1; w = windowAt(mt, y, m); }
  const next = windowAt(mt, y, m+1);
  const rs = readingsOf(mt.id);
  const last = rs[rs.length-1];
  // a reading made up to 5 days before the window still counts for it
  const done = last && parseISO(last.date) >= new Date(w.s - 5*DAY);
  const unsent = done && botName(mt.bot) && !last.sentAt;
  const toNext = Math.round((next.s - t)/DAY);
  if (unsent) return {code:"unsent", cls:"warn", label:"Внесено, не надіслано", w, next, last};
  if (done) return toNext <= 3
    ? {code:"soon", cls:"warn", label: toNext===0 ? "Подача з сьогодні" : `Подача через ${days(toNext)}`, w, next, last}
    : {code:"done", cls:"ok", label: last.sentAt ? "Надіслано" : "Подано", w, next, last};
  if (t <= w.e) { const left = Math.round((w.e - t)/DAY); return {code:"open", cls:"warn", label: left===0 ? "Останній день" : `Подати, лишилось ${days(left)}`, w, next, last, left}; }
  return {code:"late", cls:"bad", label:`Прострочено на ${days(Math.round((t - w.e)/DAY))}`, w, next, last};
}
function consumption(rs){
  const out = [];
  for (let i=1;i<rs.length;i++) out.push({date:rs[i].date, value:rs[i].value, delta: rs[i].value - rs[i-1].value});
  return out;
}

/* ---------- render ---------- */
function odo(value, decimals, cls=""){
  const v = value == null ? null : Number(value);
  const int = v == null ? "" : Math.floor(v).toString();
  const width = Math.max(5, int.length);
  let html = "";
  for (let i=0;i<width;i++){ const ch = int.padStart(width," ")[i]; html += ch===" " ? `<span class="blank">0</span>` : `<span>${ch}</span>`; }
  if (decimals > 0){
    const frac = v == null ? "".padEnd(decimals,"0") : (v - Math.floor(v)).toFixed(decimals).slice(2);
    for (const ch of frac) html += `<span class="red">${ch}</span>`;
  }
  return `<div class="odo ${cls}" role="img" aria-label="${v==null?"немає показника":num(v,decimals)}">${html}</div>`;
}
const badge = (t, sm) => `<span class="res r-${TYPES[t]?t:"other"}${sm?" sm":""}"><svg viewBox="0 0 24 24" aria-hidden="true">${(TYPES[t]||TYPES.other).icon}</svg></span>`;
const ICON = {
  chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  send:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 11.1 19.6 4.3c.9-.4 1.8.4 1.5 1.3l-3.5 13.6c-.2.9-1.3 1.2-2 .6l-4.2-3.4-2.2 2.1c-.4.4-1 .1-1-.4v-3.4l7.7-7.1-9.6 5.8-3.1-1c-.9-.3-.9-1.5 0-1.8z"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8 3v4M16 3v4"/></svg>',
  bot:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/></svg>',
};

function spark(m, deltas){
  if (deltas.length < 2) return `<span class="spark" aria-hidden="true"></span>`;
  const W = 110, H = 36, p = 3, max = Math.max(...deltas, 1e-9), min = Math.min(...deltas, 0);
  const x = i => p + (W - 2*p) * i / (deltas.length - 1);
  const y = v => H - p - (H - 2*p) * (v - min) / (max - min || 1);
  const pts = deltas.map((v,i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const c = `var(--${TYPES[m.type]?m.type:"other"})`;
  const last = deltas.length - 1;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-label="Споживання за останні ${deltas.length} періодів">
    <polygon points="${x(0)},${H} ${pts} ${x(last)},${H}" fill="${c}" opacity=".14"/>
    <polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last)}" cy="${y(deltas[last])}" r="3" fill="${c}" stroke="var(--paper)" stroke-width="1.5"/></svg>`;
}

// what the primary action for a meter is right now
function action(m, s, size="sm", short=false, label=""){
  if (s.code === "unsent") return canAutoSend(m)
    ? `<button class="btn ${size} tg" data-send="${m.id}">${ICON.send}${label ? `Надіслати: ${label}` : "Надіслати"}</button>`
    : `<button class="btn ${size}" data-send="${m.id}">${label ? `Передати: ${label}` : "Передати"}</button>`;
  return `<button class="btn ${size} ink" data-read="${m.id}">${label ? `Внести: ${label}` : short ? "Внести" : "Внести показник"}</button>`;
}

function emptyState(){
  $("#hero").innerHTML = `<div class="empty">
    <div style="display:flex;flex-direction:column;gap:16px">
      <span class="eyebrow">Почніть тут</span>
      <h2>Усі показники в одному місці</h2>
      <p>Додайте лічильники й дні, коли постачальник приймає показники. Застосунок нагадає про подачу, порахує спожите й суму, а якщо в постачальника є Telegram-бот, сам передасть йому показник.</p>
      <div class="tpls">${TEMPLATES.map((t,i)=>`<button class="tpl" data-tpl="${i}">${badge(t.type,1)}${esc(t.name)}</button>`).join("")}
        <button class="btn ghost" data-act="new">Свій лічильник…</button></div>
    </div>
    <ol class="steps3">
      <li><div><b>Додайте лічильник</b><div class="muted">Особовий рахунок, дні подачі й тариф із квитанції.</div></div></li>
      <li><div><b>Підключіть Telegram</b><div class="muted">Один раз через QR-код, як Telegram Desktop.</div></div></li>
      <li><div><b>Вносьте показник раз на місяць</b><div class="muted">Сайт сам пройде меню бота постачальника.</div></div></li>
    </ol></div>`;
  $("#schedule").innerHTML = ""; $("#board").innerHTML = ""; $("#dock").hidden = true;
}

const urgentOf = st => st.filter(x => ["open","late","unsent"].includes(x.s.code))
  .sort((a,b) => (a.s.code==="late"?0:1)-(b.s.code==="late"?0:1) || a.s.w.e-b.s.w.e);

function heroHtml(st){
  const t = today0();
  const urgent = urgentOf(st);
  const sendable = urgent.filter(x => x.s.code === "unsent" && canAutoSend(x.m));
  let now;
  if (urgent.length){
    const n = urgent.length, onlyUnsent = urgent.every(x => x.s.code === "unsent");
    const head = onlyUnsent ? `Надішліть ${n} ${plural(n,"показник","показники","показників")}` : `Подайте ${n} ${plural(n,"показник","показники","показників")}`;
    const first = urgent[0].s, left = Math.round((first.w.e - t)/DAY);
    const sub = first.code === "late" ? `Вікно подачі для «${esc(urgent[0].m.name)}» закрилося ${fmtDate(first.w.e)}. Постачальник порахує за середнім, тож краще подати якнайшвидше.`
      : onlyUnsent ? "Показники внесено, лишилося передати їх постачальникам."
      : `Найближчий останній день — ${fmtDate(first.w.e)}${left===0?", це сьогодні":`, лишилось ${days(left)}`}.`;
    now = `<span class="eyebrow">Зараз</span><h2>${head}</h2><p class="sub">${sub}</p>
      <ul class="todo">${urgent.map(({m,s}) => `<li>${badge(m.type,1)}<div class="t-main"><b>${esc(m.name)}</b><span>${s.label}<span class="wide"> · вікно ${fmtDate(s.w.s)} – ${fmtDate(s.w.e)}</span></span></div>${action(m,s,"sm",true)}</li>`).join("")}</ul>
      ${sendable.length > 1 ? `<div><button class="btn tg" data-sendall>${ICON.send}Надіслати всі (${sendable.length})</button></div>` : ""}`;
  } else {
    const nx = st.slice().sort((a,b)=>a.s.next.s-b.s.next.s)[0];
    const inDays = Math.round((nx.s.next.s - t)/DAY);
    now = `<span class="eyebrow">Зараз</span><h2>Усе подано. <em>Наступна подача ${fmtDate(nx.s.next.s)}.</em></h2>
      <p class="sub">${esc(nx.m.name)}: вікно відкриється ${inDays<=1?(inDays===0?"сьогодні":"завтра"):`через ${days(inDays)}`}. Щоб телефон нагадав, додайте вікна подачі в календар.</p>
      <div><button class="btn" id="hero-ics">${ICON.pin}Додати в календар</button></div>`;
  }
  // estimated bill from the latest period of every meter that has a tariff
  const parts = st.map(({m}) => { const c = consumption(readingsOf(m.id)); const l = c[c.length-1]; return l && m.tariff ? {m, sum: Math.max(0,l.delta)*m.tariff} : null; }).filter(Boolean);
  const total = parts.reduce((a,p)=>a+p.sum,0);
  const [whole, cents] = total.toFixed(2).split(".");
  const bill = parts.length
    ? `<span class="eyebrow">Орієнтовно за останній період</span>
      <div class="big num">${Number(whole).toLocaleString("uk-UA")}<small>,${cents} грн</small></div>
      <div class="stack" aria-hidden="true">${parts.map(p=>`<i style="width:${(p.sum/total*100).toFixed(2)}%;background:var(--${TYPES[p.m.type]?p.m.type:"other"})"></i>`).join("")}</div>
      <ul class="legend">${parts.map(p=>`<li><i class="sw" style="background:var(--${TYPES[p.m.type]?p.m.type:"other"})"></i><span>${esc(p.m.name)}</span><b class="num">${money(p.sum)}</b></li>`).join("")}</ul>
      <p class="hint">Спожите × тариф з налаштувань. Без абонплати, пільг і боргів, тому сума в квитанції може відрізнятися.</p>`
    : `<span class="eyebrow">Орієнтовна сума</span><p class="muted">Вкажіть тариф у налаштуваннях лічильника і внесіть два показники поспіль, щоб бачити, скільки орієнтовно платити.</p>`;
  return `<div class="hero"><div class="now">${now}</div><aside class="bill">${bill}</aside></div>`;
}

function scheduleHtml(ms){
  const t = today0(), y = t.getFullYear(), mo = t.getMonth();
  const N = new Date(y, mo+1, 0).getDate();
  const pos = d => ((d-1)/N*100).toFixed(3);
  const rows = ms.map(m => {
    const rs = readingsOf(m.id);
    let bars = "";
    for (const k of [-1,0,1]){
      const w = windowAt(m, y, mo+k);
      const s = w.s < new Date(y,mo,1) ? 1 : (w.s.getMonth()===mo ? w.s.getDate() : null);
      const e = w.e > new Date(y,mo,N) ? N : (w.e.getMonth()===mo ? w.e.getDate() : null);
      if (s == null || e == null || w.e < new Date(y,mo,1) || w.s > new Date(y,mo,N)) continue;
      const done = rs.some(r => { const d = parseISO(r.date); return d >= new Date(w.s - 5*DAY) && d <= w.e; });
      bars += `<i class="win${done?" done":""}" style="left:${pos(s)}%;width:${((e-s+1)/N*100).toFixed(3)}%" title="${fmtDate(w.s)} – ${fmtDate(w.e)}${done?", подано":""}"></i>`;
    }
    const marks = rs.filter(r => { const d = parseISO(r.date); return d.getFullYear()===y && d.getMonth()===mo; })
      .map(r => `<i class="mark" style="left:${((parseISO(r.date).getDate()-.5)/N*100).toFixed(3)}%" title="Показник ${num(r.value,m.decimals)} · ${fmtShort(r.date)}"></i>`).join("");
    return `<div class="lbl">${badge(m.type,1)}<span>${esc(m.name)}</span></div>
      <div class="track r-${TYPES[m.type]?m.type:"other"}" style="--days:${N}">${bars}${marks}<i class="today-line" style="left:${((t.getDate()-.5)/N*100).toFixed(3)}%"></i></div>`;
  }).join("");
  const ticks = [...new Set([1,5,10,15,20,25,N,t.getDate()])].sort((a,b)=>a-b)
    .filter(d => d===t.getDate() || Math.abs(d-t.getDate())>1)
    .map(d => `<span class="${d===t.getDate()?"today":""}" style="left:${((d-.5)/N*100).toFixed(3)}%">${d}</span>`).join("");
  const monthName = t.toLocaleDateString("uk-UA",{month:"long"});
  return `<div class="panel">
    <div class="panel-head"><h2>Графік подачі · ${monthName[0].toUpperCase()+monthName.slice(1)}</h2>
      <div class="sched-key"><span><i style="background:color-mix(in srgb,var(--ink) 18%,transparent);border:1.5px solid var(--ink-2)"></i>вікно подачі</span><span><i style="background:var(--ink-2)"></i>подано</span><span><i style="width:10px;border-radius:50%;background:var(--ink)"></i>показник</span></div></div>
    <div class="sched">
      <div></div><div class="days" style="position:relative">${ticks}</div>
      ${rows}
    </div></div>`;
}

function cardHtml(m, s){
  const rs = readingsOf(m.id), c = consumption(rs), lastC = c[c.length-1];
  const bot = botName(m.bot);
  return `<article class="card">
    <div class="row"><div class="name">${badge(m.type)}<div><h3>${esc(m.name)}</h3><div class="prov">${esc(m.provider||TYPES[m.type]?.label||"")}</div></div></div>
      <span class="pill ${s.cls}">${s.label}</span></div>
    <div class="reading"><div>${odo(s.last?.value, m.decimals)}<span class="unit">${esc(m.unit)}</span></div>${spark(m, c.slice(-7).map(x=>Math.max(0,x.delta)))}</div>
    <dl class="facts">
      <div><dt>Останній</dt><dd>${s.last ? fmtShort(s.last.date).slice(0,5) : "—"}</dd></div>
      <div><dt>Спожито</dt><dd>${lastC ? `${num(lastC.delta, m.decimals)}<small> ${esc(m.unit)}</small>` : "—"}</dd></div>
      <div><dt>Сума, грн</dt><dd>${lastC && m.tariff ? num(Math.max(0,lastC.delta)*m.tariff, 2) : "—"}</dd></div>
    </dl>
    <div class="meta">
      <span>${ICON.pin}${m.from}–${m.to} числа</span>
      ${m.account ? `<span>о/р ${esc(m.account)}</span>` : ""}
      ${bot ? `<span>${ICON.bot}@${esc(bot)}${canAutoSend(m) ? "" : " · без сценарію"}</span>` : ""}
    </div>
    <div class="foot">${action(m, s)}<span class="grow"></span>
      <button class="btn sm icon ghost" data-hist="${m.id}" title="Історія" aria-label="Історія: ${esc(m.name)}">${ICON.chart}</button>
      <button class="btn sm icon ghost" data-edit="${m.id}" title="Налаштування" aria-label="Налаштування: ${esc(m.name)}">${ICON.gear}</button></div>
  </article>`;
}

function render(){
  const tl = today0().toLocaleDateString("uk-UA",{weekday:"long",day:"numeric",month:"long"});
  $("#today").textContent = tl;
  const ms = meters();
  if (!ms.length) return emptyState();
  const st = ms.map(m => ({m, s: status(m)}));
  $("#hero").innerHTML = heroHtml(st);
  $("#hero-ics")?.addEventListener("click", () => $("#ics-btn").click());
  $("#schedule").innerHTML = scheduleHtml(ms);
  $("#board").innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
    <div class="section-head"><h2>Лічильники</h2><span class="muted num">${ms.length}</span></div>
    <div class="grid">${st.map(({m,s}) => cardHtml(m,s)).join("")}</div></div>`;
  // phone: one obvious thing to do, always within thumb reach
  const urgent = urgentOf(st);
  const sendable = urgent.filter(x => x.s.code === "unsent" && canAutoSend(x.m));
  const dock = $("#dock"); dock.hidden = false;
  dock.innerHTML = sendable.length > 1 ? `<button class="btn tg" data-sendall>${ICON.send}Надіслати всі (${sendable.length})</button>`
    : urgent.length ? action(urgent[0].m, urgent[0].s, "", false, esc(urgent[0].m.name))
    : `<button class="btn ink" data-pick>${ICON.plus}Внести показник</button>`;
}

function pickMeter(){
  const ms = meters();
  if (ms.length === 1) return readingForm(ms[0]);
  openSheet(`<div class="bar"><div><span class="eyebrow">Новий показник</span><h2>Який лічильник?</h2></div><button class="x" data-close aria-label="Закрити">×</button></div>
    <ul class="todo">${ms.map(m => `<li>${badge(m.type,1)}<div class="t-main"><b>${esc(m.name)}</b><span>${esc(m.provider||"")}</span></div><button class="btn sm ink" data-read="${m.id}">Внести</button></li>`).join("")}</ul>`);
}

/* ---------- sheets ---------- */
let sheetLocked = false; // while a bot run is in progress
function openSheet(html, onMount){
  $("#sheet").innerHTML = html; $("#overlay").hidden = false;
  onMount?.($("#sheet"));
  ($("#sheet").querySelector("[autofocus]") || $("#sheet").querySelector("button,input"))?.focus();
}
function closeSheet(){ if (sheetLocked) return; $("#overlay").hidden = true; $("#sheet").innerHTML = ""; }
$("#overlay").addEventListener("click", e => { if (e.target.id === "overlay" || e.target.closest("[data-close]")) closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#overlay").hidden) closeSheet(); });

function meterForm(m){
  const isNew = !m.id;
  const t = TYPES[m.type] || TYPES.other;
  openSheet(`<div class="bar"><div><span class="eyebrow">${isNew?"Новий лічильник":"Налаштування"}</span><h2>${esc(m.name||"Лічильник")}</h2></div><button class="x" data-close aria-label="Закрити">×</button></div>
  <form class="f" id="mf">
    <div class="two">
      <div class="fld"><label for="m-name">Назва</label><input id="m-name" required value="${esc(m.name||"")}" placeholder="Напр. Електроенергія (день)"></div>
      <div class="fld"><label for="m-type">Тип</label><select id="m-type">${Object.entries(TYPES).map(([k,v])=>`<option value="${k}" ${k===m.type?"selected":""}>${v.label}</option>`).join("")}</select></div>
    </div>
    <div class="two">
      <div class="fld"><label for="m-prov">Постачальник</label><input id="m-prov" value="${esc(m.provider||"")}" placeholder="Назва компанії"></div>
      <div class="fld"><label for="m-acc">Особовий рахунок</label><input id="m-acc" value="${esc(m.account||"")}" placeholder="Номер з квитанції"></div>
    </div>
    <div class="two">
      <div class="fld"><label for="m-from">Приймають з (число)</label><input id="m-from" type="number" min="1" max="31" required value="${m.from ?? t.from}"></div>
      <div class="fld"><label for="m-to">по (число)</label><input id="m-to" type="number" min="1" max="31" required value="${m.to ?? t.to}"><span class="hint">Якщо «по» менше за «з», вікно переходить на наступний місяць</span></div>
    </div>
    <div class="two">
      <div class="fld"><label for="m-unit">Одиниця</label><input id="m-unit" required value="${esc(m.unit ?? t.unit)}"></div>
      <div class="fld"><label for="m-dec">Знаків після коми (червоні барабани)</label><input id="m-dec" type="number" min="0" max="3" value="${m.decimals ?? t.decimals}"></div>
    </div>
    <div class="fld"><label for="m-tar">Тариф, грн за одиницю</label><input id="m-tar" type="number" step="0.0001" min="0" value="${m.tariff ?? t.tariff}"><span class="hint">Залиште 0, якщо не потрібно рахувати суму. Перевірте актуальний тариф у своїй квитанції.</span></div>
    <fieldset>
      <legend>Подача через Telegram-бота</legend>
      <div class="fld"><label for="m-bot">Бот постачальника</label><input id="m-bot" value="${esc(m.bot ? "@"+botName(m.bot) : "")}" placeholder="@назва_бота" autocapitalize="off" spellcheck="false"></div>
      <div class="fld"><label for="m-scn">Сценарій</label><textarea id="m-scn" spellcheck="false">${esc(m.scenario || DEFAULT_SCENARIO)}</textarea>
        <span class="hint">Запишіть кроки, які ви робите в боті вручну, по одному на рядок:
          <code>надіслати текст</code> · <code>натиснути Текст кнопки</code> · <code>очікувати слово з відповіді</code> · <code>зупинити_якщо слово з помилки</code> · <code>бот @інший_бот</code> · <code>пауза 2</code>.
          Підстановки: <code>{показник}</code> (ціле число), <code>{показник_точно}</code>, <code>{рахунок}</code>, <code>{дата}</code>.
          Останній рядок <code>очікувати …</code> перевіряє, що бот прийняв показник.</span>
        <span class="note-warn" id="m-scn-err" hidden></span></div>
      <div class="fld"><span class="eyebrow">Як це виконається</span><ol class="steps" id="m-scn-prev"></ol></div>
    </fieldset>
    <div class="fld"><label for="m-link">Інший спосіб подачі (для нагадувань)</label><input id="m-link" value="${esc(m.link||"")}" placeholder="Сайт, застосунок або телефон"></div>
    <div class="form-actions">
      ${isNew ? "<span></span>" : `<button type="button" class="btn danger" id="m-del">Видалити лічильник</button>`}
      <div class="actions"><button type="button" class="btn ghost" data-close>Скасувати</button><button class="btn ink">${isNew?"Додати":"Зберегти"}</button></div>
    </div>
  </form>`, s => {
    s.querySelector("#m-type").addEventListener("change", e => {
      const nt = TYPES[e.target.value];
      if (isNew){ s.querySelector("#m-unit").value = nt.unit; s.querySelector("#m-dec").value = nt.decimals; s.querySelector("#m-from").value = nt.from; s.querySelector("#m-to").value = nt.to; s.querySelector("#m-tar").value = nt.tariff; }
    });
    const scn = s.querySelector("#m-scn"), prevList = s.querySelector("#m-scn-prev"), scnErr = s.querySelector("#m-scn-err");
    const preview = () => { const { steps, errors } = parseScenario(scn.value); prevList.innerHTML = stepsHtml(steps); scnErr.hidden = !errors.length; scnErr.textContent = errors.join(" "); };
    scn.addEventListener("input", preview); preview();
    s.querySelector("#mf").addEventListener("submit", e => {
      e.preventDefault();
      const g = id => s.querySelector(id).value.trim();
      const bot = botName(g("#m-bot"));
      const scenario = s.querySelector("#m-scn").value;
      if (bot){
        const { errors } = parseScenario(scenario);
        const box = s.querySelector("#m-scn-err");
        box.hidden = !errors.length; box.textContent = errors.join(" ");
        if (errors.length) return s.querySelector("#m-scn").focus();
      }
      const day = v => Math.min(31, Math.max(1, parseInt(v,10)||1));
      const id = m.id || uid();
      put(id, {kind:"meter", name:g("#m-name"), type:g("#m-type"), provider:g("#m-prov"), account:g("#m-acc"),
        from:day(g("#m-from")), to:day(g("#m-to")), unit:g("#m-unit")||"од.", decimals:Math.min(3,Math.max(0,parseInt(g("#m-dec"),10)||0)),
        tariff:parseFloat(g("#m-tar").replace(",", "."))||0, link:g("#m-link"), bot, scenario: bot ? scenario : (m.scenario||""),
        created:m.created||Date.now()});
      closeSheet(); toast(isNew ? "Лічильник додано" : "Збережено");
    });
    const del = s.querySelector("#m-del");
    del && armed(del, "Точно видалити разом з історією?", () => {
      readingsOf(m.id).forEach(r => delete docs[r.id]); remove(m.id); closeSheet(); toast("Лічильник видалено");
    });
  });
}

function readingForm(m){
  const rs = readingsOf(m.id), prev = rs[rs.length-1];
  const auto = canAutoSend(m);
  // typical monthly use from the last three periods, to sanity-check the new number
  const recent = consumption(rs).slice(-3).map(x => x.delta).filter(d => d > 0);
  const avg = recent.length ? recent.reduce((a,b)=>a+b,0)/recent.length : null;
  openSheet(`<div class="bar"><div class="name">${badge(m.type)}<div><span class="eyebrow">Новий показник</span><h2>${esc(m.name)}</h2></div></div><button class="x" data-close aria-label="Закрити">×</button></div>
  <form class="f" id="rf">
    <div class="entry">
      <div id="r-odo">${odo(prev?.value ?? null, m.decimals, "lg")}</div>
      <label for="r-val" class="hint">Перепишіть усі чорні цифри${m.decimals ? " і червоні після коми" : ""}, ${esc(m.unit)}</label>
      <input id="r-val" inputmode="decimal" autocomplete="off" required autofocus placeholder="${prev ? num(prev.value, m.decimals).replace(/\s/g,"") : "0"}">
      <div class="expect">${prev && avg ? `Зазвичай близько <b class="num">${num(prev.value + avg, m.decimals)}</b> (≈ +${num(avg, m.decimals)} ${esc(m.unit)} за місяць)` : prev ? `Не менше <b class="num">${num(prev.value, m.decimals)}</b>, як минулого разу` : "Перший показник: з ним порівнюватимемо наступні"}</div>
    </div>
    <dl class="calc" id="r-calc"></dl>
    <div class="note-warn" id="r-warn" hidden></div>
    <div class="fld"><label for="r-date">Дата зняття</label><input id="r-date" type="date" value="${toISO(today0())}" required></div>
    <div class="form-actions"><button type="button" class="btn ghost" data-close>Скасувати</button><div class="actions">
      ${auto ? `<button type="submit" class="btn" value="save">Лише зберегти</button><button type="submit" class="btn tg" value="send">${ICON.send}Зберегти й надіслати</button>` : `<button class="btn ink" value="save">Зберегти показник</button>`}</div></div>
  </form>`, s => {
    const val = s.querySelector("#r-val"), calc = s.querySelector("#r-calc"), warn = s.querySelector("#r-warn"), od = s.querySelector("#r-odo");
    const parse = () => parseFloat(val.value.replace(/\s/g,"").replace(",", "."));
    const upd = () => {
      const v = parse(), ok = !isNaN(v);
      od.innerHTML = odo(ok ? v : prev?.value ?? null, m.decimals, "lg");
      const d = prev && ok ? v - prev.value : null;
      calc.innerHTML = `<div><dt>Попередній</dt><dd>${prev ? num(prev.value,m.decimals) : "—"}</dd></div>
        <div><dt>Спожито</dt><dd>${d==null ? "—" : `${num(d,m.decimals)} ${esc(m.unit)}`}</dd></div>
        <div><dt>Сума</dt><dd>${d!=null && m.tariff ? money(Math.max(0,d)*m.tariff) : "—"}</dd></div>`;
      if (d != null && d < 0) { warn.hidden = false; warn.textContent = "Показник менший за попередній. Перевірте цифри, особливо червоні барабани після коми."; }
      else if (d != null && avg && d > avg * 3) { warn.hidden = false; warn.textContent = `Утричі більше, ніж зазвичай (${num(avg,m.decimals)} ${m.unit}). Можливо, зайва цифра або червоні цифри потрапили до чорних.`; }
      else warn.hidden = true;
    };
    val.addEventListener("input", upd); upd();
    s.querySelector("#rf").addEventListener("submit", e => {
      e.preventDefault();
      const v = parse();
      if (isNaN(v)) { val.focus(); toast("Введіть число, наприклад 4521 або 312,457"); return; }
      const date = s.querySelector("#r-date").value;
      const id = uid();
      put(id, {kind:"reading", meterId:m.id, value:v, date, created:Date.now()});
      if (e.submitter?.value === "send") sendFlow([{meter:m, readingId:id}]);
      else submitHelp(m, v, date);
    });
  });
}

function submitText(m, v, date){
  return [m.account && `Особовий рахунок: ${m.account}`, `Показник: ${num(v,m.decimals).replace(/\s/g,"")} ${m.unit}`, `Дата: ${fmtShort(date)}`].filter(Boolean).join(". ");
}
function submitHelp(m, v, date){
  const txt = submitText(m, v, date);
  const bot = botName(m.bot);
  const link = bot ? `<a class="btn tg" href="https://t.me/${encodeURIComponent(bot)}" target="_blank" rel="noopener">Відкрити @${esc(bot)}</a>`
    : m.link && /^https?:\/\//i.test(m.link) ? `<a class="btn" href="${esc(m.link)}" target="_blank" rel="noopener">Відкрити сайт постачальника</a>` : "";
  openSheet(`<div class="bar"><div><span class="eyebrow">Збережено</span><h2>Передайте показник постачальнику</h2></div><button class="x" data-close aria-label="Закрити">×</button></div>
    <p class="muted">Скопіюйте текст і вставте його там, де ви подаєте показники${m.link && !link ? `: <b>${esc(m.link)}</b>` : ""}.${bot && !canAutoSend(m) ? " Щоб застосунок надсилав сам, налаштуйте сценарій бота в налаштуваннях лічильника." : ""}</p>
    <div class="copybox"><code id="cp-text">${esc(txt)}</code><button class="btn ink" id="cp-btn">Скопіювати</button></div>
    <div class="actions">${link}<button class="btn ghost" data-close>Готово</button></div>`, s => {
      s.querySelector("#cp-btn").addEventListener("click", () => copy(txt, s.querySelector("#cp-text")));
    });
}

/* ---------- Telegram ---------- */
async function tgStatus(){
  const { config } = await tg();
  return config();
}
async function refreshTgDot(){
  try { const c = JSON.parse(localStorage.getItem("lichylnyky.tg") || "{}"); $("#tg-dot").classList.toggle("on", !!c.session); } catch {}
}

async function telegramSheet(){
  let cfg;
  try { cfg = await tgStatus(); } catch (e) { return toast("Не вдалося завантажити модуль Telegram: " + e.message); }
  if (cfg.hasSession){
    return openSheet(`<div class="bar"><div><span class="eyebrow">Telegram</span><h2>Підключено${cfg.me ? `: ${esc(cfg.me)}` : ""}</h2></div><button class="x" data-close aria-label="Закрити">×</button></div>
      <p class="muted">Застосунок надсилає показники ботам від вашого імені, лише коли ви натискаєте «Надіслати». Вхід зберігається тільки в цьому браузері.</p>
      <div class="actions"><button class="btn danger" id="tg-out">Вийти з Telegram</button><button class="btn ghost" data-close>Закрити</button></div>`, s => {
        armed(s.querySelector("#tg-out"), "Точно вийти?", async () => {
          const { logout } = await tg(); await logout(); refreshTgDot(); closeSheet(); toast("Ви вийшли з Telegram");
        });
      });
  }
  openSheet(`<div class="bar"><div><span class="eyebrow">Telegram · крок 1 з 2</span><h2>Ключі доступу</h2></div><button class="x" data-close aria-label="Закрити">×</button></div>
    <p class="muted">Сайт підключається до Telegram як ще один ваш пристрій, так само як Telegram Desktop. Для цього потрібні два ключі, які Telegram видає безкоштовно:</p>
    <ol class="muted" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px">
      <li>Відкрийте <a href="https://my.telegram.org/apps" target="_blank" rel="noopener">my.telegram.org/apps</a> і увійдіть своїм номером.</li>
      <li>Створіть застосунок: будь-яка назва, платформа Web.</li>
      <li>Скопіюйте сюди <b>App api_id</b> і <b>App api_hash</b>.</li>
    </ol>
    <form class="f" id="tf">
      <div class="two">
        <div class="fld"><label for="t-id">api_id</label><input id="t-id" inputmode="numeric" required value="${esc(cfg.apiId)}" autocomplete="off"></div>
        <div class="fld"><label for="t-hash">api_hash</label><input id="t-hash" ${cfg.hasHash ? "" : "required"} autocomplete="off" spellcheck="false" placeholder="${cfg.hasHash ? "збережено, можна не вводити" : ""}"></div>
      </div>
      <div class="note-warn" id="t-err" hidden></div>
      <div class="form-actions"><span class="hint">Ключі й вхід зберігаються лише в цьому браузері й нікуди, крім серверів Telegram, не передаються.</span>
        <div class="actions"><button type="button" class="btn ghost" data-close>Скасувати</button><button class="btn tg" id="t-go">Далі</button></div></div>
    </form>`, s => {
      const go = s.querySelector("#t-go"), err = s.querySelector("#t-err");
      s.querySelector("#tf").addEventListener("submit", async e => {
        e.preventDefault(); err.hidden = true;
        go.disabled = true; go.textContent = "Підключаюсь…";
        const apiId = s.querySelector("#t-id").value.trim();
        let apiHash = s.querySelector("#t-hash").value.trim();
        if (!apiHash && cfg.hasHash) { try { apiHash = JSON.parse(localStorage.getItem("lichylnyky.tg")).apiHash; } catch {} }
        try { await (await tg()).beginLogin({ apiId, apiHash }); signInSheet(); }
        catch (ex) { go.disabled = false; go.textContent = "Далі"; err.hidden = false; err.textContent = tgError(ex); }
      });
    });
}

// Step 2: QR code (recommended, no code needed) or phone number + code.
function signInSheet(){
  openSheet(`<div class="bar"><div><span class="eyebrow">Telegram · крок 2 з 2</span><h2>Вхід в акаунт</h2></div><button class="x" data-close data-cancel-login aria-label="Закрити">×</button></div>
    <div class="actions" role="tablist">
      <button class="btn sm primary" id="mode-qr" role="tab" aria-selected="true">QR-код</button>
      <button class="btn sm" id="mode-phone" role="tab" aria-selected="false">За номером телефону</button>
    </div>
    <div id="v-qr" style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">
        <div id="qr" style="width:200px;height:200px;background:#fff;border-radius:12px;padding:8px;display:grid;place-items:center;color:#5A6774;flex:none">Готую код…</div>
        <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;flex:1 1 220px;min-width:0">
          <li>Відкрийте Telegram на телефоні.</li>
          <li><b>Налаштування → Пристрої → Підключити пристрій</b> (Link Desktop Device).</li>
          <li>Наведіть камеру на цей код.</li>
        </ol>
      </div>
      <span class="hint">Код оновлюється кожні 30 секунд, просто тримайте сторінку відкритою.</span>
    </div>
    <form class="f" id="v-phone" hidden>
      <div class="fld"><label for="p-num">Номер телефону</label><input id="p-num" type="tel" inputmode="tel" autocomplete="tel" placeholder="+380501234567"></div>
      <div id="p-sent" class="calc" style="grid-template-columns:1fr" hidden></div>
      <div class="fld" id="p-code-box" hidden><label for="p-code">Код підтвердження</label><input id="p-code" inputmode="numeric" autocomplete="one-time-code"></div>
      <div class="actions"><button class="btn tg" id="p-go">Надіслати код</button><button type="button" class="btn" id="p-resend" hidden></button></div>
    </form>
    <form class="f" id="v-pass" hidden>
      <div class="fld"><label for="pw">Пароль двоетапної перевірки</label><input id="pw" type="password" autocomplete="current-password"><span class="hint" id="pw-hint"></span></div>
      <div class="actions"><button class="btn tg" id="pw-go">Увійти</button></div>
    </form>
    <div class="note-warn" id="l-err" hidden></div>
    <div class="actions"><button class="btn ghost" data-close data-cancel-login>Скасувати</button></div>`, async s => {
      const T = await tg();
      const err = s.querySelector("#l-err"), vQr = s.querySelector("#v-qr"), vPhone = s.querySelector("#v-phone"), vPass = s.querySelector("#v-pass");
      let done = false;
      const fail = ex => { if (done) return; err.hidden = false; err.textContent = tgError(ex); };
      const success = res => { if (done) return; done = true; refreshTgDot(); closeSheet(); toast(`Підключено${res.me ? ": " + res.me : ""}`); };
      s.querySelectorAll("[data-cancel-login]").forEach(b => b.addEventListener("click", () => { done = true; T.cancelLogin(); }));

      let passResolve = null;
      const askPassword = hint => new Promise(res => {
        vQr.hidden = true; vPhone.hidden = true; vPass.hidden = false; s.querySelector("#mode-qr").parentElement.hidden = true;
        s.querySelector("#pw-hint").textContent = hint ? `Підказка: ${hint}` : "Хмарний пароль, який ви встановили в налаштуваннях Telegram";
        s.querySelector("#pw").focus(); passResolve = res;
      });
      vPass.addEventListener("submit", e => { e.preventDefault(); err.hidden = true; if (passResolve) { const r = passResolve; passResolve = null; s.querySelector("#pw-go").disabled = true; r(s.querySelector("#pw").value); } });

      const setMode = m => {
        vQr.hidden = m !== "qr"; vPhone.hidden = m !== "phone"; err.hidden = true;
        s.querySelector("#mode-qr").classList.toggle("primary", m === "qr"); s.querySelector("#mode-qr").setAttribute("aria-selected", m === "qr");
        s.querySelector("#mode-phone").classList.toggle("primary", m === "phone"); s.querySelector("#mode-phone").setAttribute("aria-selected", m === "phone");
        if (m === "phone") s.querySelector("#p-num").focus();
      };
      s.querySelector("#mode-qr").addEventListener("click", () => setMode("qr"));
      s.querySelector("#mode-phone").addEventListener("click", () => setMode("phone"));

      T.loginWithQr({ onQr: async url => { if (!done) s.querySelector("#qr").innerHTML = await T.qrSvg(url); }, askPassword })
        .then(success, fail);

      const go = s.querySelector("#p-go"), resend = s.querySelector("#p-resend"), sent = s.querySelector("#p-sent");
      const showSent = info => {
        sent.hidden = false;
        sent.innerHTML = `<span>Telegram надіслав код <b>${esc(info.where)}</b>.</span>` +
          (info.viaApp ? `<span class="muted">Шукайте повідомлення від «Telegram» у списку чатів, воно може бути в архіві. SMS у цьому разі не приходить.</span>` : "");
        resend.hidden = !info.next; resend.textContent = info.next ? `Надіслати ${info.next}` : "";
        s.querySelector("#p-code-box").hidden = false; s.querySelector("#p-code").focus();
        go.disabled = false; go.textContent = "Увійти";
      };
      vPhone.addEventListener("submit", async e => {
        e.preventDefault(); err.hidden = true;
        const codeBox = s.querySelector("#p-code-box");
        go.disabled = true;
        try {
          if (codeBox.hidden) {
            const phone = s.querySelector("#p-num").value.replace(/[\s()-]/g, "");
            go.textContent = "Надсилаю…";
            const info = await T.sendPhoneCode(phone);
            return info.done ? success(info.done) : showSent(info);
          }
          go.textContent = "Перевіряю…";
          success(await T.signInWithCode(s.querySelector("#p-code").value.replace(/\D/g, ""), askPassword));
        } catch (ex) { go.disabled = false; go.textContent = codeBox.hidden ? "Надіслати код" : "Увійти"; fail(ex); }
      });
      resend.addEventListener("click", async () => {
        err.hidden = true; resend.disabled = true;
        try { showSent(await T.resendPhoneCode()); } catch (ex) { fail(ex); }
        resend.disabled = false;
      });
    });
}
function tgError(e){
  const m = e?.errorMessage || e?.message || String(e);
  if (/API_ID_INVALID|api_id/i.test(m)) return "Telegram не прийняв api_id або api_hash. Перевірте їх на my.telegram.org/apps.";
  if (/PHONE_NUMBER_INVALID/.test(m)) return "Неправильний номер телефону. Введіть його у форматі +380…";
  if (/PHONE_CODE_INVALID/.test(m)) return "Код неправильний. Перевірте цифри й спробуйте ще раз.";
  if (/PHONE_CODE_EXPIRED/.test(m)) return "Код застарів. Натисніть «Скасувати» й почніть вхід знову.";
  if (/PASSWORD_HASH_INVALID/.test(m)) return "Неправильний пароль двоетапної перевірки.";
  if (/FLOOD_WAIT/.test(m)) { const sec = +(m.match(/\d+/)?.[0] || 0); return `Забагато спроб. Telegram дозволить знову ${sec > 90 ? `приблизно через ${Math.ceil(sec/60)} хв` : "за хвилину"}. Поки що спробуйте QR-код.`; }
  if (/EMAIL_SETUP_REQUIRED/.test(m)) return "Telegram вимагає прив'язати пошту для входу з нового застосунку. Увійдіть через QR-код: там пошта не потрібна.";
  if (/AUTH_TOKEN_EXPIRED/.test(m)) return "QR-код застарів. Закрийте вікно й почніть вхід знову.";
  if (/PHONE_NUMBER_BANNED/.test(m)) return "Telegram заблокував цей номер.";
  if (/USERNAME_NOT_OCCUPIED|USERNAME_INVALID|No user has/i.test(m)) return "Не знайшов такого бота. Перевірте @назву в налаштуваннях лічильника.";
  return m;
}

// items: [{meter, readingId}]
async function sendFlow(items){
  let cfg;
  try { cfg = await tgStatus(); } catch (e) { return toast("Не вдалося завантажити модуль Telegram: " + e.message); }
  if (!cfg.hasSession) { toast("Спершу увійдіть у Telegram"); return telegramSheet(); }
  const ctl = new AbortController();
  openSheet(`<div class="bar"><div><span class="eyebrow">Надсилання через Telegram</span><h2 id="sf-title">${items.length === 1 ? esc(items[0].meter.name) : `${items.length} показники`}</h2></div></div>
    <ol class="steps" id="sf-steps"></ol>
    <div class="log" id="sf-log" aria-live="polite"></div>
    <div class="actions" id="sf-act"><button class="btn danger" id="sf-stop">Зупинити</button></div>`);
  sheetLocked = true;
  const log = $("#sf-log");
  const add = (cls, text, extra="") => { const d = document.createElement("div"); d.className = "m " + cls; d.textContent = text; if (extra) d.insertAdjacentHTML("beforeend", extra); log.append(d); log.scrollTop = log.scrollHeight; };
  $("#sf-stop").addEventListener("click", () => ctl.abort());
  const { runScenario } = await tg();
  let failed = null;
  for (const { meter, readingId } of items){
    const r = docs[readingId]; if (!r) continue;
    const bot = botName(meter.bot);
    add("sys", `${meter.name}: ${num(r.value, meter.decimals)} ${meter.unit} → @${bot}`);
    const steps = parseScenario(meter.scenario).steps, vars = scenarioVars(meter, r);
    const list = $("#sf-steps");
    list.innerHTML = stepsHtml(steps, vars);
    try {
      await runScenario({ bot, steps, vars, signal: ctl.signal,
        onStep: (i, state) => { const li = list.children[i]; if (li) li.className = (li.className.replace(/\b(run|ok|err)\b/g,"").trim() + " " + state).trim(); },
        onLog: ({who, text, buttons}) => add(who === "me" ? "me" : who === "sys" ? "sys" : "bot", text, buttons?.length ? `<div class="hint" style="margin-top:4px">${buttons.map(esc).join(" · ")}</div>` : "") });
      docs[readingId] = { ...docs[readingId], sentAt: new Date().toISOString() }; saveLocal(); render();
      add("sys ok", "Показник прийнято ✓");
    } catch (e) {
      failed = { meter, readingId };
      add("sys bad", tgError(e));
      break;
    }
  }
  sheetLocked = false;
  const bot = failed && botName(failed.meter.bot);
  $("#sf-act").innerHTML = failed
    ? `<a class="btn tg" href="https://t.me/${encodeURIComponent(bot)}" target="_blank" rel="noopener">Дописати вручну в @${esc(bot)}</a>
       <button class="btn" data-markr="${esc(failed.readingId)}">Я надіслав вручну</button>
       <button class="btn" data-edit="${failed.meter.id}">Змінити сценарій</button><button class="btn ghost" data-close>Закрити</button>`
    : `<button class="btn ink" data-close>Готово</button>`;
}

const OP_LABEL = { send:"надіслати", click:"натиснути", expect:"чекати", failIf:"зупинити, якщо", pause:"пауза", bot:"бот" };
function stepsHtml(steps, vars){
  return steps.map(st => st.op === "bot"
    ? `<li class="bot"><span class="op">→ ${esc(st.arg)}</span></li>`
    : `<li><span class="op">${OP_LABEL[st.op]}</span><span class="arg">${st.op==="pause" ? `${st.ms/1000} с` : esc(vars ? fillVars(st.arg, vars) : st.arg)}</span></li>`).join("");
}

/* ---------- history ---------- */
function history(m){
  const rs = readingsOf(m.id), c = consumption(rs);
  const last12 = c.slice(-12);
  let chart = `<p class="muted">Графік з'явиться після двох показників.</p>`;
  if (last12.length){
    const W = 560, H = 190, padL = 8, padB = 26, padT = 22;
    const max = Math.max(...last12.map(x=>Math.max(0,x.delta)), 1e-9);
    const bw = (W - padL*2) / last12.length;
    const avg = last12.reduce((a,x)=>a+x.delta,0)/last12.length;
    const y = v => padT + (H - padT - padB) * (1 - Math.max(0,v)/max);
    const color = ({elec:"elec",gas:"gas",water:"water",heat:"heat"})[m.type] || "muted";
    chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Споживання за останні ${last12.length} періодів">
      <line x1="${padL}" x2="${W-padL}" y1="${H-padB}" y2="${H-padB}" stroke="var(--line)"/>
      <line x1="${padL}" x2="${W-padL}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--muted)" stroke-dasharray="4 4"/>
      <text x="${W-padL}" y="${y(avg)-5}" text-anchor="end">середнє ${num(avg,m.decimals)}</text>
      ${last12.map((x,i)=>{ const h=(H-padB)-y(x.delta); const cx=padL+bw*i+bw/2; const isLast=i===last12.length-1;
        return `<rect x="${padL+bw*i+bw*0.18}" y="${y(x.delta)}" width="${bw*0.64}" height="${Math.max(h,1)}" rx="3" fill="var(--${color})" opacity="${isLast?1:.55}"/>
        ${isLast?`<text x="${cx}" y="${y(x.delta)-5}" text-anchor="middle" style="fill:var(--ink);font-weight:600">${num(x.delta,m.decimals)}</text>`:""}
        <text x="${cx}" y="${H-8}" text-anchor="middle">${parseISO(x.date).toLocaleDateString("uk-UA",{month:"short"}).replace(".","")}</text>`; }).join("")}
    </svg>`;
  }
  const rows = rs.slice().reverse().map((r,i,arr) => {
    const prev = arr[i+1]; const d = prev ? r.value - prev.value : null;
    return `<tr><td>${fmtShort(r.date)}</td><td class="num">${num(r.value,m.decimals)}</td><td class="num">${d==null?"—":num(d,m.decimals)}</td>
      ${m.tariff?`<td class="num">${d==null?"—":money(Math.max(0,d)*m.tariff)}</td>`:""}
      <td>${r.sentAt ? "✓ боту" : ""}</td>
      <td><button class="btn sm ghost" data-copyr="${r.id}">Текст</button> <button class="btn sm danger" data-delr="${r.id}">Видалити</button></td></tr>`;
  }).join("");
  openSheet(`<div class="bar"><div class="name">${badge(m.type)}<div><span class="eyebrow">Історія · ${esc(m.unit)}</span><h2>${esc(m.name)}</h2></div></div><button class="x" data-close aria-label="Закрити">×</button></div>
    ${chart}
    ${rs.length ? `<div class="tablewrap"><table><thead><tr><th>Дата</th><th class="num">Показник</th><th class="num">Спожито</th>${m.tariff?`<th class="num">Сума</th>`:""}<th>Надіслано</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">Показників ще немає.</p>`}
    <div class="actions"><button class="btn ink" id="h-add">Внести показник</button></div>`, s => {
      s.querySelector("#h-add").addEventListener("click", () => readingForm(m));
      s.querySelectorAll("[data-delr]").forEach(b => armed(b, "Точно?", () => { remove(b.dataset.delr); history(m); }));
      s.querySelectorAll("[data-copyr]").forEach(b => b.addEventListener("click", () => { const r = docs[b.dataset.copyr]; submitHelp(m, r.value, r.date); }));
    });
}

/* ---------- reminders as calendar (.ics) ---------- */
function ics(){
  const stamp = new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d+/,"");
  const dt = d => toISO(d).replace(/-/g,"");
  const escI = s => String(s).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n");
  const ev = [];
  for (const m of meters()){
    const s = status(m);
    const first = ["open","late"].includes(s.code) ? s.w : s.next;
    const info = [m.account && `Особовий рахунок: ${m.account}`, m.provider, botName(m.bot) && `Бот: @${botName(m.bot)}`, m.link && `Де подати: ${m.link}`, location.href].filter(Boolean).join("\n");
    const mk = (kind, start, byday, title, alarm) => ev.push([
      "BEGIN:VEVENT", `UID:${m.id}-${kind}@lichylnyky`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dt(start)}`, `DTEND;VALUE=DATE:${dt(new Date(start.getTime()+DAY))}`,
      `RRULE:FREQ=MONTHLY;BYMONTHDAY=${byday}`, `SUMMARY:${escI(title)}`, `DESCRIPTION:${escI(info)}`, `URL:${location.href}`, "TRANSP:TRANSPARENT",
      "BEGIN:VALARM","ACTION:DISPLAY",`DESCRIPTION:${escI(title)}`,`TRIGGER:${alarm}`,"END:VALARM","END:VEVENT"].join("\r\n"));
    mk("start", first.s, m.from, `Подати показник: ${m.name}`, "PT10H");
    mk("end", first.e, m.to, `Останній день подачі: ${m.name}`, "PT9H");
  }
  return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Lichylnyky//UK","CALSCALE:GREGORIAN","X-WR-CALNAME:Лічильники",...ev,"END:VCALENDAR"].join("\r\n");
}
function download(filename, data, type){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], {type})); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$("#ics-btn").addEventListener("click", () => {
  if (!meters().length) return toast("Спершу додайте лічильник");
  download("lichylnyky-nagaduvannya.ics", ics(), "text/calendar");
  toast("Відкрийте файл, щоб додати нагадування в календар");
});
$("#backup").addEventListener("click", () => download(`lichylnyky-${toISO(today0())}.json`, JSON.stringify({docs}, null, 1), "application/json"));
$("#restore").addEventListener("click", () => $("#restore-file").click());
$("#restore-file").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()).docs; if (!d || typeof d !== "object") throw 0; docs = d; saveLocal(); render(); toast("Дані відновлено"); }
  catch { toast("Це не схоже на резервну копію лічильників"); }
  e.target.value = "";
});

/* ---------- helpers ---------- */
function armed(btn, question, fn){
  const orig = btn.textContent; let t;
  btn.addEventListener("click", () => {
    if (btn.classList.contains("armed")) { clearTimeout(t); fn(); return; }
    btn.classList.add("armed"); btn.textContent = question;
    t = setTimeout(() => { btn.classList.remove("armed"); btn.textContent = orig; }, 3500);
  });
}
async function copy(text, el){
  try { await navigator.clipboard.writeText(text); toast("Скопійовано"); }
  catch { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast("Текст виділено: натисніть Копіювати"); }
}
let toastT;
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(()=>t.hidden=true, 3200); }

function lastUnsent(m){ const s = status(m); return s.code === "unsent" ? s.last : null; }
document.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const find = id => meters().find(m => m.id === id);
  if (b.id === "add-meter" || b.dataset.act === "new") return meterForm({type:"elec"});
  if (b.id === "tg-btn") return telegramSheet();
  if (b.dataset.tpl != null) return meterForm({...TEMPLATES[b.dataset.tpl]});
  if (b.dataset.read) return readingForm(find(b.dataset.read));
  if (b.dataset.pick != null) return pickMeter();
  if (b.dataset.hist) return history(find(b.dataset.hist));
  if (b.dataset.edit) { sheetLocked = false; return meterForm(find(b.dataset.edit)); }
  if (b.dataset.markr) { const id = b.dataset.markr; if (docs[id]) { docs[id] = {...docs[id], sentAt:new Date().toISOString(), sentManually:true}; saveLocal(); render(); } closeSheet(); return toast("Позначено як надіслане"); }
  if (b.dataset.send) {
    const m = find(b.dataset.send), r = lastUnsent(m);
    if (!r) return;
    return canAutoSend(m) ? sendFlow([{meter:m, readingId:r.id}]) : submitHelp(m, r.value, r.date);
  }
  if (b.dataset.sendall != null) return sendFlow(meters().filter(canAutoSend).map(m => ({meter:m, r:lastUnsent(m)})).filter(x => x.r).map(x => ({meter:x.meter, readingId:x.r.id})));
});

loadLocal(); render(); refreshTgDot();
// re-evaluate statuses when the date rolls over while the page stays open
setInterval(render, 60*60*1000);
