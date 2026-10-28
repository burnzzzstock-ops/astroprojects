// Forgiving search for "Search all cars" and the filter panel's search box. Every word
// has to match, as before, but a word that matches nothing on the list ("tacomaa",
// "silvarado", "chevy") is swapped for the closest words that ARE on the list, so a
// typo never hides a car. The page says what it did ("No exact match for …").
// Pure (no Node-only imports): the web version runs this in the browser.

// Nicknames people type for makes.
const ALIASES = { chevy: "chevrolet", vw: "volkswagen", caddy: "cadillac", bimmer: "bmw", beemer: "bmw", benz: "mercedes", merc: "mercedes" };

// Letters and digits only: "F-150", "f150" and "F 150" all come out the same.
const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const fields = (u) => [u.year, u.make, u.model, u.trim, u.title, u.dealer?.name, u.dealer?.city, u.vin, u.stock];
const hayOf = (u) => fields(u).map(squash).join(" ");

// The search's words. A 1-2 letter piece joins the next word when that one starts with a
// digit or is short too, so "f 150", "cr v" and "4 wd" read as F-150, CR-V and 4WD.
function words(q) {
  const parts = String(q ?? "").trim().split(/\s+/).filter((w) => squash(w));
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const next = parts[i + 1];
    if (next && squash(parts[i]).length <= 2 && (/^\d/.test(squash(next)) || squash(next).length <= 2)) {
      out.push(`${parts[i]} ${next}`);
      i++;
    } else out.push(parts[i]);
  }
  return out;
}

// Typos allowed per word: short words 1, medium 2, long 3.
const allowedTypos = (len) => (len <= 4 ? 1 : len <= 7 ? 2 : 3);

/** Typos between a and b (a swapped pair of letters counts as one); anything over max is max + 1. */
export function typos(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (before && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2] + 1);
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    before = prev;
    prev = cur;
  }
  return Math.min(prev[b.length], max + 1);
}

// Every word on the cars (squashed), how many cars have it, and how it's usually written.
function vocabulary(pool) {
  const found = new Map();
  for (const u of pool) {
    const seen = new Set();
    for (const f of fields(u).slice(0, 7)) { // not VINs or stock numbers
      for (const raw of String(f ?? "").split(/\s+/)) {
        const w = squash(raw);
        if (w.length < 2 || /^\d+$/.test(w) || seen.has(w)) continue;
        seen.add(w);
        const e = found.get(w) || { n: 0, spell: new Map() };
        e.n++;
        const shown = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
        e.spell.set(shown, (e.spell.get(shown) || 0) + 1);
        found.set(w, e);
      }
    }
  }
  return found;
}
const spelling = (e) => [...e.spell.entries()].sort((a, b) => b[1] - a[1])[0][0];

/**
 * Works out a search against the cars it runs over. Returns null for an empty search, else
 * { terms: [{ t, alts }], fixes: [{ from, to: [...] }] }: `alts` null = match the word as
 * typed; otherwise the closest words on the list stand in for it ([] = nothing is close).
 */
export function resolveQuery(q, pool) {
  const typed = words(q);
  if (!typed.length) return null;
  const hays = pool.map(hayOf);
  let vocab = null;
  const terms = [], fixes = [];
  for (const raw of typed) {
    const t = squash(raw);
    // Numbers (years, stock numbers) and very short words are never guessed at.
    if (/^\d+$/.test(t) || t.length < 3 || hays.some((h) => h.includes(t))) { terms.push({ t, alts: null }); continue; }
    vocab ||= vocabulary(pool);
    let alts = ALIASES[t] && vocab.has(ALIASES[t]) ? [ALIASES[t]] : [];
    if (!alts.length) {
      const max = allowedTypos(t.length);
      let best = max + 1;
      for (const w of vocab.keys()) {
        const cap = Math.min(best, max);
        // also against the start of a longer word, so a half-typed "silvr" finds Silverado
        const d = Math.min(typos(t, w, cap), t.length >= 4 && w.length > t.length ? typos(t, w.slice(0, t.length), cap) : cap + 1);
        if (d < best) { best = d; alts = [w]; } else if (d === best && d <= max) alts.push(w);
      }
      alts = alts.sort((a, b) => vocab.get(b).n - vocab.get(a).n).slice(0, 5);
    }
    terms.push({ t, alts });
    fixes.push({ from: raw, to: alts.map((w) => spelling(vocab.get(w))) });
  }
  return { terms, fixes };
}

/** Does this car match? `q` is a resolveQuery result, or a plain string (matched as typed). */
export function queryMatches(u, q) {
  if (!q) return true;
  const rq = typeof q === "string" ? { terms: words(q).map((w) => ({ t: squash(w), alts: null })) } : q;
  const h = hayOf(u);
  return rq.terms.every(({ t, alts }) => (alts ? alts.some((w) => h.includes(w)) : h.includes(t)));
}
