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
