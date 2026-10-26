import { config } from "./config.js";

// Best-effort area-code -> IANA timezone for the recipient. We list the clearly
// non-Central zones; anything not listed (all Central codes, plus split/ambiguous
// ones) falls back to the dealership's own timezone, the safe default here.
const TZ_BY_AREA = {};
const addTz = (tz, codes) => codes.forEach((c) => { TZ_BY_AREA[c] = tz; });

addTz("America/New_York", [
  "212","646","332","917","718","347","929","516","631","914","845","585","716","315","518","838","680","607",
  "201","551","973","862","732","848","609","856","908","640",
  "215","267","445","610","484","412","724","570","272","717","223","814",
  "617","857","781","339","508","774","978","351","413",
  "203","475","860","959","401","603","802","207",
  "202","410","443","667","240","301","302",
  "703","571","540","804","757","434","276",
  "704","980","919","984","336","743","828","910","252",
  "803","839","843","854","864",
  "404","470","678","770","762","706","912","229","478",
  "305","786","954","754","561","407","321","689","813","727","941","239","904","386","352","863","772","656","728","324",
  "216","330","234","440","419","567","614","380","937","326","513","740","283",
  "313","248","734","586","810","947","517","989","231","679","616","269",
  "304","681",
]);
addTz("America/Denver", ["303","720","970","719","983","801","385","435","505","575","957","406","307","208","986"]);
addTz("America/Los_Angeles", [
  "213","310","323","424","818","747","626","661","562","714","949","909","951","760","442","619","858","805","820","279","916","510","925","650","408","669","415","628","707","530","831","209","559",
  "206","253","360","425","564","509","503","971","541","458","702","725","775",
]);
addTz("America/Phoenix", ["602","480","623","520","928"]);
addTz("America/Anchorage", ["907"]);
addTz("Pacific/Honolulu", ["808"]);

// Area code -> US state, focused on our actual markets (MS home + LA/AL/FL).
// Used to apply Florida's stricter 8 PM cap and to record the lead's state.
const STATE_BY_AREA = {};
const addState = (st, codes) => codes.forEach((c) => { STATE_BY_AREA[c] = st; });
addState("FL", ["305","786","954","754","561","407","321","689","813","727","941","239","904","386","352","863","772","850","448","656","728","324"]);
addState("LA", ["504","225","318","337","985","521"]);
addState("AL", ["205","251","256","334","938","659"]);
addState("MS", ["601","662","228","769"]);

function areaCode(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length === 11 && d[0] === "1" ? d.slice(1, 4) : d.length === 10 ? d.slice(0, 3) : null;
}

export function stateForPhone(phone) {
  const ac = areaCode(phone);
  return (ac && STATE_BY_AREA[ac]) || null;
}

// TCPA + state-law safe automation window. Automated outbound only fires inside
// 8 AM - 9 PM in the RECIPIENT's local time (inferred from area code, else the
// dealership's). Florida's FTSA is stricter, so FL numbers cap at 8 PM. A reply
// to a customer who texts us first is never gated - they started it.
export function isQuietHours(d = new Date(), phone = null) {
  const ac = phone ? areaCode(phone) : null;
  const tz = (ac && TZ_BY_AREA[ac]) || config.timezone;
  const state = ac ? STATE_BY_AREA[ac] : null;
  const endHour = state === "FL" ? 20 : 21; // Florida: 8 AM - 8 PM (FTSA)
  const h = new Date(d.toLocaleString("en-US", { timeZone: tz })).getHours();
  return h < 8 || h >= endHour;
}
