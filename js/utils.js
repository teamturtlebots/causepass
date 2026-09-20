function randomToken() {
  const chars = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
  let t = "";
  for (let i = 0; i < 10; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

function initials(name) {
  return (name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

// Reads a query-param-style value out of the current hash, e.g. "#/p/TOKEN" -> "TOKEN"
function getCustomerTokenFromHash() {
  const match = window.location.hash.match(/^#\/p\/(.+)$/);
  return match ? match[1] : null;
}

// Human-readable pass number for staff to reference out loud, on paper, etc. —
// separate from the token, which stays the secure/URL identifier.
function formatPassNumber(n) {
  return "CP-" + String(n).padStart(4, "0");
}

// Pulls the video ID out of whatever YouTube URL format someone pastes in —
// a Shorts link, a regular watch link, or a shortened youtu.be link — so
// swapping the link later doesn't depend on getting the format exactly right.
function extractYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/shorts/")[1].split("/")[0] || null;
    if (u.pathname.startsWith("/embed/")) return u.pathname.split("/embed/")[1].split("/")[0] || null;
    if (u.searchParams.get("v")) return u.searchParams.get("v");
  } catch (e) {}
  return null;
}

// Builds a plain Google Maps link from a business name + street address, e.g.
// "Wang Restaurant, 123 Main St, Cumming, GA". Searching both together makes Google Maps open
// the business's own listing (hours, photos, reviews) when it finds a match. No API key or
// setup needed. Returns "" if there's no address.
function mapsUrl(address, name) {
  if (!address) return "";
  const mapQuery = name ? `${name}, ${address}` : address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;
}

// "📍 Directions" for a merchant, or "" if no address is saved. Opens Google Maps (or the Maps
// app on a phone) in a new tab.
//   full (default): the address in gray text plus a small Directions button — used in the offer sheet.
//   compact = true: just a small text link, no address line — used in tight lists.
function directionsLinkHtml(merchant, compact) {
  if (!merchant || !merchant.address) return "";
  const url = escapeHtml(mapsUrl(merchant.address, merchant.name));
  if (compact) {
    return `<a href="${url}" target="_blank" rel="noreferrer" style="display:inline-block; margin-top:4px; font-size:12px; text-decoration:none;">📍 Directions</a>`;
  }
  return `
    <div style="font-size:13px; color:var(--muted); margin-top:2px;">${escapeHtml(merchant.address)}</div>
    <a href="${url}" target="_blank" rel="noreferrer" style="text-decoration:none;">
      <button type="button" style="margin-top:8px; font-size:12px; padding:6px 10px;">📍 Directions</button>
    </a>`;
}
