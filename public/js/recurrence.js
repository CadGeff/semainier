// Semainier — dates et règles de récurrence : fonctions pures, sans DOM ni réseau,
// partagées par le navigateur et les tests Node.

const pad = (n) => String(n).padStart(2, "0");
/** Date locale -> "AAAA-MM-JJ" */
const ds = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** "AAAA-MM-JJ" -> Date locale à minuit */
const parse = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
/** Nombre de jours de `a` à `b` ("AAAA-MM-JJ"). Arrondi : un changement d'heure décale l'écart d'une heure. */
const daysBetween = (a, b) => Math.round((parse(b).getTime() - parse(a).getTime()) / 864e5);
/** Jour de la semaine, 0 = lundi … 6 = dimanche */
const dow = (d) => (d.getDay() + 6) % 7;
const mondayOf = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -dow(d));
/** Numéro de semaine ISO 8601 */
const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const n = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - n);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7);
};
const toMin = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

const DN = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DL = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/** Jours actifs d'une règle hebdo (par défaut : le jour de la date de départ). */
const weekDays = (it) => (it.days && it.days.length ? it.days : [dow(parse(it.start))]);

/**
 * L'élément a-t-il une occurrence le jour `day` ("AAAA-MM-JJ") ?
 * - none    : uniquement à la date de départ
 * - daily   : tous les jours à partir de la date de départ
 * - weekly  : les jours de semaine cochés
 * - monthly : même quantième chaque mois ; le 31 tombe le dernier jour des mois courts
 * Un jour présent dans `skipped` est retiré de la série ; une série s'arrête après `until`.
 */
function occurs(it, day) {
  if (!it.start || day < it.start) return false;
  if (it.until && it.recur && it.recur !== "none" && day > it.until) return false;
  if (it.skipped && it.skipped[day]) return false;
  const d = parse(day),
    s = parse(it.start);
  switch (it.recur) {
    case "daily":
      return true;
    case "weekly":
      return weekDays(it).includes(dow(d));
    case "monthly": {
      const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return d.getDate() === Math.min(s.getDate(), dim);
    }
    default:
      return day === it.start;
  }
}

/** Rythme d'une série, sans sa date de fin. */
function rhythm(it) {
  if (it.recur === "daily") return "Chaque jour";
  if (it.recur === "weekly") {
    const days = weekDays(it)
      .slice()
      .sort((a, b) => a - b);
    if (days.length === 7) return "Chaque jour";
    if (days.join() === "0,1,2,3,4") return "Chaque jour de semaine (lun → ven)";
    return `Chaque semaine : ${days.map((i) => DL[i]).join(", ")}`;
  }
  return `Chaque mois, le ${parse(it.start).getDate()}`;
}

/** Dernier jour d'une série, ou null si elle n'a pas de fin. */
const untilOf = (it) => (it.until && it.recur && it.recur !== "none" ? it.until : null);

function recurText(it) {
  if (!it.recur || it.recur === "none") return "Une seule fois";
  const until = untilOf(it);
  if (!until) return rhythm(it);
  const u = parse(until);
  // L'année n'est précisée que si la série ne finit pas l'année où elle commence.
  const year = u.getFullYear() !== parse(it.start).getFullYear() ? ` ${u.getFullYear()}` : "";
  return `${rhythm(it)}, jusqu'au ${u.getDate() === 1 ? "1er" : u.getDate()} ${MONTHS[u.getMonth()]}${year}`;
}

/**
 * L'élément a-t-il au moins une occurrence ? Une série sans fin en a toujours (les jours retirés
 * sont en nombre fini). Une série qui a une fin peut ne plus en avoir : tous ses jours retirés,
 * ou une fin placée avant son premier jour utile (hebdo du vendredi, finie le jeudi).
 */
function hasOccurrence(it) {
  const until = untilOf(it);
  if (!until) return true;
  for (let day = it.start; day <= until; day = ds(addDays(parse(day), 1))) if (occurs(it, day)) return true;
  return false;
}

/** La tâche est-elle cochée pour ce jour ? */
const isDone = (it, day) => !!(it.done && it.done[day]);

export {
  pad,
  ds,
  parse,
  addDays,
  daysBetween,
  dow,
  mondayOf,
  isoWeek,
  toMin,
  fromMin,
  DN,
  DL,
  occurs,
  hasOccurrence,
  recurText,
  untilOf,
  isDone,
};
