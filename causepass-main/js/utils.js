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

// Builds a plain Google Maps link from a street address — opens the location in Google Maps
// (or the Maps app on a phone). No API key or setup needed. Returns "" if there's no address.
function mapsUrl(address) {
  if (!address) return "";
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
}

// Address text plus a small "📍 Directions" button for a merchant, or "" if no address is saved.
// The button opens the location in Google Maps (or the Maps app on a phone) in a new tab.
function directionsLinkHtml(merchant) {
  if (!merchant || !merchant.address) return "";
  return `
    <div style="font-size:12px; color:var(--muted); margin-top:2px;">${escapeHtml(merchant.address)}</div>
    <a href="${escapeHtml(mapsUrl(merchant.address))}" target="_blank" rel="noreferrer" style="text-decoration:none;">
      <button type="button" style="margin-top:6px; font-size:12px; padding:6px 10px;">📍 Directions</button>
    </a>`;
}
