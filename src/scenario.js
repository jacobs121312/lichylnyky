// Bot scenario: one step per line, e.g.
//   натиснути Передати показники
//   надіслати {рахунок}
//   надіслати {показник}
//   очікувати прийнято
const OPS = {
  "надіслати": "send", "send": "send",
  "натиснути": "click", "click": "click",
  "очікувати": "expect", "expect": "expect",
  "пауза": "pause", "pause": "pause",
  "бот": "bot", "bot": "bot",
  "зупинити_якщо": "failIf", "fail_if": "failIf",
};

export const DEFAULT_SCENARIO = [
  "# Кроки, які ви робите в боті вручну, по одному на рядок",
  "надіслати /start",
  "натиснути Передати показник",
  "надіслати {рахунок}",
  "надіслати {показник}",
  "очікувати прийнято",
].join("\n");

export function parseScenario(text) {
  const steps = [], errors = [];
  String(text || "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const sp = line.indexOf(" ");
    const word = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
    const arg = sp < 0 ? "" : line.slice(sp + 1).trim();
    const op = OPS[word];
    if (!op) return errors.push(`Рядок ${i + 1}: невідома дія «${word}». Можна: надіслати, натиснути, очікувати, зупинити_якщо, бот, пауза.`);
    if (op === "pause") {
      const sec = parseFloat(arg.replace(",", "."));
      if (!(sec > 0 && sec <= 60)) return errors.push(`Рядок ${i + 1}: пауза в секундах, від 1 до 60.`);
      return steps.push({ op, ms: sec * 1000, line: i + 1 });
    }
    if (!arg) return errors.push(`Рядок ${i + 1}: після «${word}» потрібен текст.`);
    steps.push({ op, arg, line: i + 1 });
  });
  if (!errors.length && !steps.length) errors.push("Сценарій порожній.");
  return { steps, errors };
}

export function fillVars(text, vars) {
  return text.replace(/\{([^}]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function scenarioVars(meter, reading) {
  const v = Number(reading.value);
  const [y, mo, d] = reading.date.split("-");
  return {
    "показник": String(Math.floor(v)),
    "показник_точно": String(Number(v.toFixed(meter.decimals || 0))).replace(".", ","),
    "рахунок": meter.account || "",
    "дата": `${d}.${mo}.${y}`,
  };
}
