// Generic "find the cars in this data" extractor, shared by the CarGurus and
// dealer-website sources. Sites change field names and URLs all the time, so
// instead of hard-coding one site's layout this walks ANY JSON (API responses,
// embedded page state, schema.org JSON-LD) and pulls out objects that look like
// a vehicle listing, reading each field from a list of common names.
import { toNumber, daysSince } from "./util.js";

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

const K = {
  vin: ["vin", "vehicleIdentificationNumber", "vinNumber", "vin_number", "vehicleVin", "vehicle_vin"],
  year: ["year", "modelYear", "carYear", "vehicleModelDate", "model_year", "yearNumber", "vehicleYear", "vehicle_year"],
  make: ["make", "makeName", "brand", "manufacturer", "make_name", "vehicleMake", "vehicle_make"],
  model: ["model", "modelName", "model_name", "vehicleModel", "vehicle_model"],
  trim: ["trim", "trimName", "trim_name", "vehicleConfiguration", "series", "vehicleTrim", "vehicle_trim"],
  title: ["listingTitle", "title", "heading", "vehicleTitle", "vehicleName", "vehicle_caption", "name"],
  price: ["price", "listPrice", "askingPrice", "internetPrice", "salePrice", "sellingPrice", "finalPrice",
    "displayPrice", "priceValue", "retailPrice", "currentPrice", "taggingPrice", "vehicle_sale_price", "vehicle_price"],
  // (not "expectedPrice": on CarGurus that's their market-value estimate, not the asking price)
  prevPrice: ["previousPrice", "originalPrice", "oldPrice", "ref_price", "wasPrice", "priceBeforeDrop", "lastPrice"],
  miles: ["mileage", "miles", "odometer", "mileageFromOdometer", "odometerReading", "mileageValue", "vehicleMileage", "vehicle_miles"],
  days: ["daysOnMarket", "daysOnLot", "daysInStock", "daysListed", "dom", "daysOnCarGurus", "ageInDays",
    "daysInInventory", "days_on_market"],
  since: ["inStockDate", "dateInStock", "stockDate", "listedDate", "firstListedDate", "datePosted", "listingDate",
    "postedDate", "dateListed", "first_seen_at_date", "dateFirstListed", "inventoryDate", "vehicleTaggingInventoryDate"],
  url: ["vdpUrl", "vdp_url", "listingUrl", "detailUrl", "detailsUrl", "vehicleUrl", "vehicleDetailUrl", "url", "link", "href"],
  photo: ["primaryPhotoUrl", "imageUrl", "mainPhotoUrl", "thumbnailUrl", "pictureUrl", "photoUrl", "image", "photo",
    "thumbnail", "images", "photos", "photo_links", "originalPictureData", "pictureData"],
  color: ["exteriorColor", "exterior_color", "extColor", "colorName", "color"],
  stock: ["stockNumber", "stockNo", "stock_no", "stockNum", "stock", "sku", "vehicleStockNumber", "vehicle_stocknum"],
  condition: ["condition", "itemCondition", "vehicleCondition", "newOrUsed", "stockType", "inventoryType"],
  isNew: ["isNew", "newCar", "isNewCar"],
  distance: ["distance", "dist", "distanceInMiles"],
  dealRating: ["dealRating", "dealBadge", "dealRatingKey"],
  id: ["listingId", "listing_id", "inventoryId", "vehicleId", "id"],
  sellerName: ["sellerName", "serviceProviderName", "dealerName", "dealershipName", "seller_name"],
  sellerPhone: ["phoneNumberString", "phoneNumber", "sellerPhone", "dealerPhone", "phone", "telephone", "seller_phone"],
  sellerStreet: ["streetAddress", "street", "address1", "sellerAddress"],
  sellerCity: ["sellerCity", "dealerCity", "city", "addressLocality"],
  sellerState: ["sellerRegion", "dealerState", "state", "addressRegion", "region"],
  sellerZip: ["sellerPostalCode", "dealerZip", "postalCode", "zipCode", "zip"],
  sellerType: ["sellerType", "seller_type", "dealerType", "dealer_type"],
  sellerWebsite: ["website", "dealerWebsite", "sellerWebsite", "inventory_url"],
};
const SELLER_KEYS = ["dealer", "seller", "dealership", "serviceProvider", "contact", "location", "address", "offers"];

function lowerMap(obj) {
  const m = new Map();
  for (const k of Object.keys(obj)) m.set(k.toLowerCase(), obj[k]);
  return m;
}
function pick(m, names) {
  for (const n of names) {
    const v = m.get(n.toLowerCase());
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}
// Strings stay strings; { name } / { label } / { value } objects become their text.
function text(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return text(v.name ?? v.label ?? v.value ?? v.displayName ?? null);
  const s = String(v).trim();
  return s || null;
}
function urlOf(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return urlOf(v[0]);
  if (typeof v === "object") return urlOf(v.url ?? v.href ?? v.src ?? v.contentUrl ?? null);
  const s = String(v).trim();
  return /^(https?:)?\/\//i.test(s) || s.startsWith("/") ? s : null;
}
// DealerOn sites can leave TaggingPrice at 0 and keep the price only in a base64
// "VehiclePriceLibrary" ("MSRP:32895.0;Selling Price:32895.0;…").
function priceLibrary(v) {
  if (typeof v !== "string" || !v) return null;
  const s = Buffer.from(v, "base64").toString("utf8");
  return toNumber((s.match(/(?:^|;)Selling Price:([\d.]+)/i) || [])[1]);
}
// CarGurus sends sellerCity as "Gulfport, MS": keep just the city.
function cityOnly(v) {
  return v ? v.replace(/,\s*[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/i, "").trim() || null : null;
}
function yearOf(v) {
  const m = String(v ?? "").match(/\b(19[89]\d|20[0-4]\d)\b/);
  return m ? Number(m[1]) : null;
}

function isListingLike(m) {
  const vin = text(pick(m, K.vin));
  const hasVin = vin && VIN_RE.test(vin);
  const price = toNumber(pick(m, K.price)) ?? toNumber(m.get("offers")?.price);
  const year = yearOf(pick(m, K.year)) ?? yearOf(text(pick(m, K.title)));
  const named = pick(m, K.make) != null || pick(m, K.model) != null || pick(m, K.title) != null;
  if (hasVin) return price != null || year != null || named;
  return price != null && year != null && named && pick(m, K.miles) != null;
}

// Pull seller info from the listing itself and any nested dealer/seller/address objects.
function sellerOf(m) {
  // Breadth-first through nested dealer/seller/address objects, up to 3 levels
  // (JSON-LD puts the city at offers → seller → address).
  const maps = [m];
  let level = [m];
  for (let depth = 0; depth < 3; depth++) {
    const next = [];
    for (const mm of level) {
      for (const k of SELLER_KEYS) {
        const v = mm.get(k.toLowerCase());
        if (v && typeof v === "object" && !Array.isArray(v)) next.push(lowerMap(v));
      }
    }
    maps.push(...next);
    level = next;
  }
  const first = (names, nestedOnly = false) => {
    for (const mm of nestedOnly ? maps.slice(1) : maps) {
      const v = text(pick(mm, names));
      if (v) return v;
    }
    return null;
  };
  // A nested dealer object's plain "name" is the dealer name; the listing's own "name" is the car.
  const name = first(K.sellerName) || first(["name"], true);
  const typeRaw = (first(K.sellerType) || "").toLowerCase();
  return {
    name,
    phone: first(K.sellerPhone),
    street: first(K.sellerStreet, true),
    city: cityOnly(first(K.sellerCity)),
    state: first(K.sellerState),
    zip: first(K.sellerZip),
    website: first(K.sellerWebsite, true),
    type: /private|fsbo|owner|individual/.test(typeRaw) ? "private"
      : /franchise/.test(typeRaw) ? "franchise" : /independent/.test(typeRaw) ? "independent" : null,
  };
}

/** Normalize one listing-like object into the common observation shape. */
export function normalizeObject(obj) {
  const m = lowerMap(obj);
  const offers = m.get("offers") && typeof m.get("offers") === "object" ? m.get("offers") : null;
  const title = text(pick(m, K.title));
  let year = yearOf(pick(m, K.year)) ?? yearOf(title);
  let make = text(pick(m, K.make));
  let model = text(pick(m, K.model));
  const trim = text(pick(m, K.trim));
  if ((!make || !model) && title) {
    const words = title.replace(/^(used|certified|pre-owned)\s+/i, "").split(/\s+/);
    if (yearOf(words[0])) {
      make = make || words[1] || null;
      model = model || words[2] || null;
    }
  }
  const vinRaw = text(pick(m, K.vin));
  const condition = String(text(pick(m, K.condition)) ?? "").toLowerCase();
  const isNewFlag = pick(m, K.isNew);
  const days = toNumber(pick(m, K.days));
  const since = text(pick(m, K.since));
  const sinceDays = since ? daysSince(since) : null;
  const photo = urlOf(pick(m, K.photo));
  return {
    sourceId: text(pick(m, K.id)),
    vin: vinRaw && VIN_RE.test(vinRaw) ? vinRaw.toUpperCase() : null,
    year, make, model, trim,
    title: title || [year, make, model, trim].filter(Boolean).join(" ") || null,
    price: toNumber(pick(m, K.price)) ?? toNumber(offers?.price) ?? priceLibrary(m.get("vehiclepricelibrary")),
    prevPrice: toNumber(pick(m, K.prevPrice)),
    miles: toNumber(pick(m, K.miles)),
    daysListed: days ?? (sinceDays != null ? Math.round(sinceDays) : null),
    url: urlOf(pick(m, K.url)),
    photo,
    color: text(pick(m, K.color)),
    stock: text(pick(m, K.stock)),
    isNew: isNewFlag === true || /^new$|newcondition/.test(condition),
    distance: toNumber(pick(m, K.distance)),
    dealRating: text(pick(m, K.dealRating)),
    dealer: sellerOf(m),
  };
}

/**
 * Walk any JSON value and return every listing found (normalized). Stops
 * descending into an object once it's recognized as a listing.
 */
export function extractListings(root, { maxNodes = 300000 } = {}) {
  const out = [];
  const seen = new Set();
  const stack = [root];
  let n = 0;
  while (stack.length && n++ < maxNodes) {
    const v = stack.pop();
    if (!v || typeof v !== "object") continue;
    if (Array.isArray(v)) { for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]); continue; }
    const m = lowerMap(v);
    if (isListingLike(m)) {
      const l = normalizeObject(v);
      const key = l.vin || l.sourceId || `${l.title}|${l.price}|${l.miles}`;
      if (!seen.has(key)) { seen.add(key); out.push(l); }
      continue;
    }
    for (const child of Object.values(v)) if (child && typeof child === "object") stack.push(child);
  }
  return out;
}

/** Parse JSON safely; also unwraps JSON-LD blocks and "while(1);"-style guards. */
export function parseJsonLoose(textBody) {
  if (typeof textBody !== "string") return null;
  const s = textBody.trim().replace(/^\)\]\}',?\s*/, "").replace(/^while\(1\);\s*/, "");
  if (!s || (s[0] !== "{" && s[0] !== "[")) return null;
  try { return JSON.parse(s); } catch { return null; }
}
