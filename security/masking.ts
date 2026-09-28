import type { IdentifierType } from "../shared/domain";

/** Produce a display hint that never reveals the full sensitive value. */
export function maskIdentifier(type: IdentifierType, value: string): string {
  switch (type) {
    case "EMAIL": {
      const [local = "", domain = ""] = value.split("@");
      const head = local.slice(0, 1);
      return `${head}${"•".repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
    }
    case "PHONE": {
      const digits = value.replace(/\D/g, "");
      return `••••••••${digits.slice(-2)}`;
    }
    case "ADDRESS":
      return `${value.split(/\s+/)[0]?.replace(/\d/g, "•") ?? ""} •••••••`;
    case "DATE_OF_BIRTH":
      return "••/••/••••";
    case "ALIAS":
      return "[Hidden]";
    default:
      return value;
  }
}
