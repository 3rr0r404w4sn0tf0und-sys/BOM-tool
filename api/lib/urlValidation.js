import net from "node:net";

const PRIVATE_V4 = [
  [/^10\./, "private network"],
  [/^127\./, "loopback"],
  [/^169\.254\./, "link-local"],
  [/^192\.168\./, "private network"],
  [/^172\.(1[6-9]|2\d|3[0-1])\./, "private network"],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, "carrier-grade NAT"],
  [/^0\./, "\"this\" network"],
];

// Pulls the IPv4 address out of an IPv4-mapped/compatible IPv6 literal, e.g.
// "::ffff:127.0.0.1" or its fully-expanded/hex forms like "::ffff:7f00:1".
// Returns null if `host` isn't one of those forms.
function extractMappedV4(host) {
  const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (dotted) return dotted[1];
  const hex = host.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
    }
  }
  return null;
}

// Normalizes a URL's hostname for private/local-address checks:
//  - lowercases it
//  - strips the [] brackets Node's URL parser leaves on IPv6 hosts, which
//    otherwise make every string/net.isIP comparison below silently no-op
//    (new URL("http://[::1]/").hostname === "[::1]", not "::1")
function normalizeHost(rawHostname) {
  let host = rawHostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host;
}

export function validateProductUrl(value) {
  if (value === undefined || value === null || value === "") return value;
  if (typeof value !== "string" || value.length > 4000) throw new Error("url must be a string up to 4000 characters");
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new Error("url must be a valid URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("url must use http or https");
  if (parsed.username || parsed.password) throw new Error("URLs with embedded credentials are not allowed");

  const host = normalizeHost(parsed.hostname);
  const deny = () => { throw new Error("local/private URLs are not allowed"); };

  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1" || host === "::") {
    deny();
  }

  if (net.isIP(host) === 4 && PRIVATE_V4.some(([re]) => re.test(host))) deny();

  if (net.isIP(host) === 6) {
    if (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
      deny();
    }
    // IPv4-mapped/compatible addresses (e.g. ::ffff:127.0.0.1) carry a real
    // IPv4 address that needs the same private-range check re-run on it,
    // not just a loopback-string comparison.
    const mapped = extractMappedV4(host);
    if (mapped && PRIVATE_V4.some(([re]) => re.test(mapped))) deny();
    if (mapped === "0.0.0.0") deny();
  }

  return parsed.toString();
}

export function hostnameMatches(value, domains) {
  try {
    const host = normalizeHost(new URL(value).hostname);
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}
