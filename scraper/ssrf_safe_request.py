"""
DNS-aware SSRF protection for the scraper's outbound HTTP requests.

api/lib/urlValidation.js already rejects obvious private/local IP
*literals* at write time (when a URL is saved to the DB). That check
never resolves DNS, so it can't catch:

  - a public-looking hostname whose DNS record points at a private/
    local address ("DNS rebinding" if it changes between requests, or
    just a plain internal-pointing A record)
  - a redirect chain that starts at a legitimate public URL and ends
    at http://127.0.0.1/... or a cloud metadata address

This module re-validates at the point of the actual network call,
right before it's made, and re-validates every redirect hop the same
way instead of trusting requests' allow_redirects=True to follow
blindly.

Known limitation: there is a small time-of-check-to-time-of-use gap
between resolve_safe_ip() validating an address and requests actually
connecting to it, since we rely on requests re-resolving the hostname
rather than pinning the exact validated socket. Closing that gap fully
needs a custom transport that connects to a pre-resolved IP directly.
That's a reasonable follow-up if this scraper ever becomes a higher-
value target, but resolving + validating immediately before each
connection (as done here) already blocks the realistic cases: plain
internal-pointing DNS records and redirect-based SSRF.
"""

import ipaddress
import socket
from urllib.parse import urlparse

import requests

MAX_REDIRECTS = 5
REQUEST_TIMEOUT = 10


class SSRFBlocked(Exception):
    """Raised when a URL (or a redirect target) resolves to a
    disallowed address, or otherwise fails the safety checks."""


def _is_unsafe_ip(ip_str):
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # unparseable -- treat as unsafe rather than let it through

    if (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_unspecified
        or ip.is_reserved
    ):
        return True

    # IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) carries a real IPv4
    # address that needs the same check re-run against it.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return _is_unsafe_ip(str(ip.ipv4_mapped))

    return False


def _validate_scheme_and_host(url):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SSRFBlocked(f"disallowed URL scheme: {parsed.scheme!r}")
    if not parsed.hostname:
        raise SSRFBlocked("URL has no hostname")
    if parsed.hostname.lower() in ("localhost",) or parsed.hostname.lower().endswith(".localhost"):
        raise SSRFBlocked("localhost is not allowed")
    return parsed


def resolve_safe_ip(hostname):
    """Resolve hostname via DNS and confirm at least one resolved
    address is public. Raises SSRFBlocked otherwise."""
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        raise SSRFBlocked(f"DNS resolution failed for {hostname!r}: {e}")

    resolved_ips = {info[4][0] for info in infos}
    if not resolved_ips:
        raise SSRFBlocked(f"no addresses resolved for {hostname!r}")

    if all(_is_unsafe_ip(ip) for ip in resolved_ips):
        raise SSRFBlocked(f"{hostname!r} resolves only to private/local/reserved addresses")


def safe_get(url, headers=None, timeout=REQUEST_TIMEOUT, max_redirects=MAX_REDIRECTS):
    """Drop-in-ish replacement for requests.get(url, allow_redirects=True)
    that validates DNS + every redirect hop against private/local
    ranges instead of trusting requests to follow blindly."""
    current_url = url
    redirects_followed = 0

    while True:
        parsed = _validate_scheme_and_host(current_url)
        resolve_safe_ip(parsed.hostname)

        resp = requests.get(
            current_url,
            headers=headers,
            timeout=timeout,
            allow_redirects=False,  # we handle + validate redirects ourselves
        )

        if resp.is_redirect or resp.is_permanent_redirect:
            location = resp.headers.get("Location")
            if not location:
                return resp  # malformed redirect with no target -- just return it
            if redirects_followed >= max_redirects:
                raise SSRFBlocked(f"too many redirects (> {max_redirects})")
            next_url = requests.compat.urljoin(current_url, location)
            # Re-validate scheme/host on the redirect target before ever
            # following it -- this is the actual redirect-SSRF fix, not
            # just a redirect-count cap.
            _validate_scheme_and_host(next_url)
            current_url = next_url
            redirects_followed += 1
            resp.close()
            continue

        return resp
