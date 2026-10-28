// How long a car has been listed, and whether it's still for sale. Pure, so the
// browser (web version) computes the same numbers the scan does.
import { daysSince } from "./util.js";

export const ACTIVE_DAYS = 3; // still for sale if any source saw it this recently

/**
 * Days listed = the longest of: what each source reported (aged forward from the
 * day it said so) and how long this tool has been seeing the car itself.
 */
export function daysListed(l, now = Date.now()) {
  let best = daysSince(l.firstSeenAt, now) ?? 0;
  for (const r of Object.values(l.reported || {})) {
    if (r && r.days != null) best = Math.max(best, r.days + (daysSince(r.at, now) ?? 0));
  }
  return Math.round(best);
}

export function isActive(l, now = Date.now()) {
  return (daysSince(l.lastSeenAt, now) ?? Infinity) <= ACTIVE_DAYS;
}
