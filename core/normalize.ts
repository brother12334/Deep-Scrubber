import type { IdentifierType } from "../shared/domain";

/**
 * Canonical forms used for blind indexes, de-duplication and matching.
 * Normalisation must be deterministic and stable across releases because
 * blind indexes are derived from it.
 */

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "md", "phd", "esq"]);

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !NAME_SUFFIXES.has(t.replace(/[.'-]/g, "")))
    .join(" ")
    .trim();
}

export function normalizeEmail(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  // Do not strip dots/plus tags: they can be meaningful at other providers.
  return `${local}@${domain}`;
}

/** E.164-ish digits; assumes NANP when 10 digits are supplied. */
export function normalizePhone(phone: string, defaultCountry = "1"): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function normalizeUsername(u: string): string {
  return u.trim().replace(/^@/, "").toLowerCase();
}

export function normalizeDomain(d: string): string {
  return d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

export interface Location {
  city?: string;
  region?: string;
}

export function normalizeLocation(loc: string): string {
  return loc.toLowerCase().replace(/[^a-z,\s]/g, "").replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim();
}

/** US state names → postal codes, so "Boca Raton, Florida" and "Boca Raton, FL" match. */
export const US_STATES: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co", connecticut: "ct",
  delaware: "de", "district of columbia": "dc", florida: "fl", georgia: "ga", hawaii: "hi", idaho: "id", illinois: "il",
  indiana: "in", iowa: "ia", kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md",
  massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo", montana: "mt", nebraska: "ne",
  nevada: "nv", "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny", "north carolina": "nc",
  "north dakota": "nd", ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri",
  "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt", virginia: "va",
  washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
};

export function regionCode(region: string | undefined): string | undefined {
  if (!region) return undefined;
  const r = region.trim().toLowerCase().replace(/\./g, "");
  return US_STATES[r] ?? r;
}

export function parseLocation(loc: string): Location {
  const [city, region] = normalizeLocation(loc).split(",");
  return { city: city?.trim() || undefined, region: regionCode(region) || undefined };
}

export function normalizeIdentifier(type: IdentifierType, value: string): string {
  switch (type) {
    case "FULL_NAME":
    case "ALIAS":
    case "BUSINESS_NAME":
      return normalizeName(value);
    case "EMAIL":
      return normalizeEmail(value);
    case "PHONE":
      return normalizePhone(value);
    case "USERNAME":
      return normalizeUsername(value);
    case "DOMAIN":
      return normalizeDomain(value);
    case "LOCATION":
      return normalizeLocation(value);
    case "ADDRESS":
      return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    case "DATE_OF_BIRTH":
      return value.trim();
  }
}

export function validateIdentifier(type: IdentifierType, value: string): string | null {
  const v = value.trim();
  if (!v) return "Value is required.";
  if (v.length > 320) return "Value is too long.";
  switch (type) {
    case "EMAIL":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Enter a valid email address.";
    case "PHONE": {
      const d = v.replace(/\D/g, "");
      return d.length >= 7 && d.length <= 15 ? null : "Enter a valid phone number.";
    }
    case "FULL_NAME":
    case "ALIAS":
      return normalizeName(v).split(" ").length >= 2 ? null : "Enter a first and last name.";
    case "USERNAME":
      return /^@?[\w.-]{2,64}$/.test(v) ? null : "Usernames may contain letters, numbers, dots, dashes and underscores.";
    case "DOMAIN":
      return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(normalizeDomain(v)) ? null : "Enter a valid domain.";
    case "DATE_OF_BIRTH":
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : "Use YYYY-MM-DD.";
    default:
      return null;
  }
}

export function domainOf(url: string): string {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return "";
  }
}

/** Canonical URL for de-duplication: drop fragments, tracking params, trailing slash. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|src$)/i.test(p)) u.searchParams.delete(p);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim();
  }
}
