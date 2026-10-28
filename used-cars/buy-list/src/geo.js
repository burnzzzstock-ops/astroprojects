import zipcodes from "zipcodes";

// Straight-line miles between two US ZIPs (free offline table), or null if unknown.
export function zipDistance(a, b) {
  const za = String(a ?? "").slice(0, 5), zb = String(b ?? "").slice(0, 5);
  if (!/^\d{5}$/.test(za) || !/^\d{5}$/.test(zb)) return null;
  const d = zipcodes.distance(za, zb);
  return Number.isFinite(d) ? d : null;
}

// A ZIP for "City, ST" when a dealer row has none (for distance only).
export function zipForCity(city, state) {
  if (!city || !state) return null;
  const c = String(city).trim();
  for (const name of [c, c.replace(/[^a-z ]/gi, ""), c.replace(/\bSt\.?\s/i, "Saint "), c.replace(/([a-z])([A-Z])/g, "$1 $2")]) {
    const hit = zipcodes.lookupByName(name, String(state).trim().toUpperCase())[0];
    if (hit) return hit.zip;
  }
  return null;
}
