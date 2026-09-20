// ================= HOME SCREEN HELPERS (customer pass page only) =================
// Two things, both only on pass links (#/p/...):
//   1. A small, dismissible banner that shows a customer how to put their pass on their phone's
//      home screen, with steps that match their phone (iPhone/iPad vs. Android).
//   2. Names the home screen icon after the pass number (e.g. "CP-0002") instead of "CausePass",
//      so a customer with more than one pass can tell their icons apart.
//
// Deliberately standalone: it doesn't touch customer.js / admin.js / style.css. The banner is
// inserted just BEFORE #app (not inside it), because customer.js re-draws everything inside
// #app on every update and would wipe it out.
//
// It only appears when ALL of these are true:
//   - the page is a pass link (#/p/...)
//   - the visitor is on a phone/tablet (iPhone, iPad, Android) - never on desktop
//   - the pass isn't already open from the home screen
//   - the customer hasn't tapped the X before (remembered on that phone)

(function () {
  const DISMISS_KEY = "causepass-add-to-home-tip-dismissed";
  let banner = null;

  function isPassPage() {
    return /^#\/p\//.test(window.location.hash);
  }

  // True once the pass is opened from the home screen icon - no need to explain it then.
  function isInstalled() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  // "ios" | "samsung" | "android" | null (null = desktop or unknown: show nothing)
  function detectPlatform() {
    const ua = navigator.userAgent || "";
    // iPadOS reports itself as a Mac, so a touch screen is the giveaway.
    const isIOS = /iPhone|iPad|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) return "ios";
    if (/Android/i.test(ua)) return /SamsungBrowser/i.test(ua) ? "samsung" : "android";
    return null;
  }

  function wasDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch (e) { return false; }
  }
  function rememberDismissed() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch (e) { /* private mode etc. - just won't be remembered */ }
  }

  // The steps for each kind of phone. Edit the wording here.
  const STEPS = {
    ios: {
      steps: [
        "Tap the <strong>Share</strong> button in Safari (the square with an arrow pointing up). If you can't see it, tap the <strong>&bull;&bull;&bull;</strong> button first.",
        "Scroll down and tap <strong>Add to Home Screen</strong>.",
        "Tap <strong>Add</strong>. Your pass now has its own icon.",
      ],
      note: "Opened this link from an email or message? Choose <strong>Open in Safari</strong> first, then follow the steps.",
    },
    android: {
      steps: [
        "Tap the <strong>&#8942;</strong> menu (three dots) at the top right of Chrome.",
        "Tap <strong>Add to Home screen</strong>.",
        "Tap <strong>Add</strong> (and <strong>Add</strong> again if asked). Your pass now has its own icon.",
      ],
      note: "",
    },
    samsung: {
      steps: [
        "Tap the <strong>&#8801;</strong> menu (three lines) at the bottom right of Samsung Internet.",
        "Tap <strong>Add page to</strong>, then choose <strong>Home screen</strong>.",
        "Tap <strong>Add</strong>. Your pass now has its own icon.",
      ],
      note: "",
    },
  };

  function addStyles() {
    if (document.getElementById("causepass-tip-style")) return;
    const css = document.createElement("style");
    css.id = "causepass-tip-style";
    css.textContent = `
      .cp-tip { display: flex; justify-content: center; padding: 12px 1rem 0; }
      .cp-tip-card { width: 100%; max-width: 380px; background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; font-size: 13px; color: var(--ink); line-height: 1.4; }
      .cp-tip-row { display: flex; align-items: center; gap: 10px; }
      .cp-tip-text { flex: 1; }
      .cp-tip-text strong { color: var(--navy); }
      .cp-tip button { font-size: 12px; padding: 7px 12px; }
      .cp-tip .cp-tip-close { border: none; background: transparent; color: var(--muted); font-size: 18px; line-height: 1; padding: 4px 6px; }
      .cp-tip ol { margin: 10px 0 0; padding-left: 20px; }
      .cp-tip li { margin: 6px 0; }
      .cp-tip-note { margin-top: 8px; font-size: 12px; color: var(--muted); }
    `;
    document.head.appendChild(css);
  }

  function buildBanner(platform) {
    const info = STEPS[platform];
    const wrap = document.createElement("div");
    wrap.className = "cp-tip";
    wrap.innerHTML = `
      <div class="cp-tip-card">
        <div class="cp-tip-row">
          <div class="cp-tip-text"><strong>Keep your pass handy.</strong> Add it to your home screen for one-tap access.</div>
          <button type="button" class="cp-tip-toggle" aria-expanded="false">Show me how</button>
          <button type="button" class="cp-tip-close" aria-label="Dismiss">&times;</button>
        </div>
        <div class="cp-tip-steps" hidden>
          <ol>${info.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
          ${info.note ? `<div class="cp-tip-note">${info.note}</div>` : ""}
        </div>
      </div>`;

    const toggle = wrap.querySelector(".cp-tip-toggle");
    const steps = wrap.querySelector(".cp-tip-steps");
    toggle.addEventListener("click", () => {
      const open = steps.hidden;
      steps.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Hide steps" : "Show me how";
    });
    wrap.querySelector(".cp-tip-close").addEventListener("click", () => {
      rememberDismissed();
      removeBanner();
    });
    return wrap;
  }

  function removeBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  // Runs on load and whenever the address changes (e.g. landing page -> pass link).
  function update() {
    const platform = detectPlatform();
    const shouldShow = isPassPage() && platform && !isInstalled() && !wasDismissed();
    if (!shouldShow) { removeBanner(); return; }
    if (banner) return; // already showing
    const app = document.getElementById("app");
    if (!app || !app.parentNode) return;
    addStyles();
    banner = buildBanner(platform);
    app.parentNode.insertBefore(banner, app);
  }

  // ---- Home screen icon name ----
  // iPhone uses the apple-mobile-web-app-title tag, other phones use the page title, when
  // "Add to Home Screen" is tapped - so both are set to the pass number once we know it.
  // Passes without a number (and every non-pass page) keep the normal "CausePass" name.
  const originalTitle = document.title;
  const titleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  const originalMetaTitle = titleMeta ? titleMeta.getAttribute("content") : null;
  let namedToken = null; // the pass we've already looked up, so we don't ask twice

  function setHomeScreenName(pageTitle, metaTitle) {
    document.title = pageTitle;
    if (titleMeta && metaTitle != null) titleMeta.setAttribute("content", metaTitle);
  }

  function updateName() {
    const match = window.location.hash.match(/^#\/p\/(.+)$/);
    if (!match) {
      namedToken = null;
      setHomeScreenName(originalTitle, originalMetaTitle);
      return;
    }
    const token = match[1];
    if (namedToken === token) return;
    namedToken = token;
    if (!window.db || typeof formatPassNumber !== "function") return;
    window.db.collection("passes").doc(token).get().then((doc) => {
      if (namedToken !== token) return; // they moved to another page while we were looking
      const number = doc.exists ? doc.data().passNumber : null;
      if (number) {
        const name = formatPassNumber(number);
        setHomeScreenName(name, name);
      }
    }).catch(() => { /* couldn't look it up - keep the default name */ });
  }

  window.addEventListener("hashchange", () => { update(); updateName(); });
  update();
  updateName();
})();
