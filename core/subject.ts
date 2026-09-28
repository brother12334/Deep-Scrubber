import type { IdentifierType } from "../shared/domain";
import { normalizeEmail, normalizeName, normalizePhone, normalizeUsername, normalizeDomain, parseLocation, type Location } from "./normalize";

/**
 * The decrypted, in-memory view of a privacy profile used by discovery,
 * matching and removal. It exists only inside worker memory for the duration
 * of a job and must never be persisted or logged.
 */
export interface SubjectProfile {
  profileId: string;
  names: string[];
  previousNames: string[];
  emails: string[];
  phones: string[];
  usernames: string[];
  domains: string[];
  businessNames: string[];
  locations: Location[];
  addresses: string[];
  dateOfBirth?: string;
  /** Email the user wants brokers to use for confirmations. */
  contactEmail?: string;
  /** contactEmail is a service-managed relay alias whose inbox the platform can read. */
  contactIsRelay?: boolean;
}

export interface PlainIdentifier {
  type: IdentifierType;
  value: string;
  isPrevious: boolean;
}

export function buildSubject(
  profileId: string,
  ids: PlainIdentifier[],
  contact?: { email: string; isRelay: boolean },
): SubjectProfile {
  const s: SubjectProfile = {
    profileId,
    names: [],
    previousNames: [],
    emails: [],
    phones: [],
    usernames: [],
    domains: [],
    businessNames: [],
    locations: [],
    addresses: [],
    contactEmail: contact?.email,
    contactIsRelay: contact?.isRelay ?? false,
  };
  for (const id of ids) {
    switch (id.type) {
      case "FULL_NAME":
        (id.isPrevious ? s.previousNames : s.names).push(id.value.trim());
        break;
      case "ALIAS":
        s.previousNames.push(id.value.trim());
        break;
      case "EMAIL":
        s.emails.push(normalizeEmail(id.value));
        break;
      case "PHONE":
        s.phones.push(normalizePhone(id.value));
        break;
      case "USERNAME":
        s.usernames.push(normalizeUsername(id.value));
        break;
      case "DOMAIN":
        s.domains.push(normalizeDomain(id.value));
        break;
      case "BUSINESS_NAME":
        s.businessNames.push(id.value.trim());
        break;
      case "LOCATION":
        s.locations.push(parseLocation(id.value));
        break;
      case "ADDRESS":
        s.addresses.push(id.value.trim());
        break;
      case "DATE_OF_BIRTH":
        s.dateOfBirth = id.value.trim();
        break;
    }
  }
  s.contactEmail ??= s.emails[0];
  return s;
}

export function allNames(s: SubjectProfile): string[] {
  return [...s.names, ...s.previousNames].map(normalizeName).filter(Boolean);
}
