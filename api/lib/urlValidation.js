import net from "node:net";

const PRIVATE_V4 = [
  [/^10\./, "private network"],
  [/^127\./, "loopback"],
  [/^169\.254\./, "link-local"],
  [/^192\.168\./, "private network"],
  [/^172\.(1[6-9]|2\d|3[0-1])\./, "private network"],
];

export function validateProductUrl(value) {
  if (value === undefined || value === null || value === "") return value;
  if (typeof value !== "string" || value.length > 4000) throw new Error("url must be a string up to 4000 characters");
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new Error("url must be a valid URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("url must use http or https");
  if (parsed.username || parsed.password) throw new Error("URLs with embedded credentials are not allowed");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1") {
    throw new Error("local/private URLs are not allowed");
  }
  if (net.isIP(host) === 4 && PRIVATE_V4.some(([re]) => re.test(host))) throw new Error("local/private URLs are not allowed");
  if (net.isIP(host) === 6 && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"))) {
    throw new Error("local/private URLs are not allowed");
  }
  return parsed.toString();
}

export function hostnameMatches(value, domains) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}
