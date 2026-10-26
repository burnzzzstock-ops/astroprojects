// Text classifiers for the legally load-bearing paths: opt-out (carrier keywords
// AND the FCC's "any reasonable manner"), HELP, re-subscribe, and the short
// "C"/"yes" that confirms an interview reminder. Pure functions, unit tested.

export const OPT_OUT_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit"];
export const OPT_IN_WORDS = ["start", "unstop", "yes"];
export const HELP_WORDS = ["help", "info", "ayuda"];

// Plain-English AND Spanish opt-out requests, without snagging ordinary sentences
// ("can I stop by tomorrow?" is not an opt-out). Returns 'en' | 'es' | null.
export function optOutLang(text) {
  const s = (text || "").toLowerCase();
  if (/\b(stop|quit|no more|don'?t|do not|please stop|never|cease)\b[^.!?]{0,20}\b(text|texting|messag|messaging|contact|contacting)\b/.test(s)
    || /\b(unsubscribe|opt[\s-]?out|leave me alone)\b/.test(s)
    || /\b(take|remove)\s+me\s+(off|from)\b/.test(s)
    || /\b(lose|delete|forget)\s+my\s+(number|info|details)\b/.test(s)) return "en";
  if (/\bno\s+me\s+(manden|mande|env[íi]en|env[íi]e|escriban|escriba|mensaje)/.test(s)
    || /\b(deja|dejen|dejar)\s+de\s+(enviar|mandar|escribir|textear|molestar|mensaje)/.test(s)
    || /\bno\s+m[áa]s\s+(mensajes|textos)/.test(s)
    || /\b(dar(me)?|darse)\s+de\s+baja/.test(s)
    || /\b(borra|borrar|elimina|eliminar|quita|quitar)\s+mi\s+n[úu]mero/.test(s)
    || /\bcancela(r|me)?\s+(suscripci[óo]n|los mensajes|mensajes)/.test(s)
    || /\bd[ée]jen?me\s+en\s+paz/.test(s)) return "es";
  return null;
}

// Language tag for the templated reminders (the assistant mirrors language on its
// own). Spanish is sticky once seen.
export function detectLang(text) {
  const s = (text || "").toLowerCase();
  if (/[ñ¿¡]/.test(s) || /[áéíóú]/.test(s)) return "es";
  if (/\b(hola|gracias|buenos|buenas|d[íi]as|tardes|noches|quiero|quisiera|necesito|busco|trabajo|empleo|empleos|solicitud|contratando|puesto|entrevista|favor|usted|nombre|me\s+llamo|s[íi])\b/.test(s)) return "es";
  return "en";
}

const CONFIRM_WORDS = new Set(["c", "confirm", "confirmed", "yes", "y", "yep", "yeah", "yup", "ya", "ok", "okay", "k", "sure", "👍", "👍🏻", "👍🏼", "👍🏽", "👍🏾", "👍🏿", "si", "sí"]);
export function isConfirmation(word) {
  const w = (word || "").toLowerCase().replace(/[.!,\s]+$/g, "").trim();
  return CONFIRM_WORDS.has(w) || w === "sounds good" || w === "see you then" || w === "ill be there" || w === "i'll be there";
}

// US mobile number → E.164, or invalid.
export function normalizePhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  let ten = digits;
  if (ten.length === 11 && ten[0] === "1") ten = ten.slice(1);
  const valid = ten.length === 10 && ten[0] >= "2" && ten[0] <= "9" && ten[3] >= "2" && ten[3] <= "9";
  return { valid, e164: valid ? `+1${ten}` : null };
}
