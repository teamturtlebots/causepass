// ================= PUBLIC LANDING PAGE =================
// No login, no auth check — everything here reads from collections that are
// publicly readable by design (same rule that lets a customer open a pass
// link with no account). Visible to anyone who lands on the site's root URL.

const LandingView = (function () {
  let state = { org: null, programs: [], merchants: [], offers: [], impactAnimated: false };
  let unsubscribers = [];

  function init() {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    state = { org: null, programs: [], merchants: [], offers: [], impactAnimated: false };
    render();

    unsubscribers.push(db.collection("organizations").onSnapshot((snap) => {
      state.org = snap.docs.length ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null;
      render();
    }));
    unsubscribers.push(db.collection("programs").onSnapshot((snap) => {
      state.programs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }));
    unsubscribers.push(db.collection("merchants").onSnapshot((snap) => {
      state.merchants = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => !m.archived);
      render();
    }));
    unsubscribers.push(db.collection("offers").where("active", "==", true).onSnapshot((snap) => {
      state.offers = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((o) => !o.archived);
      render();
    }));
  }

  function initials(name) {
    return (name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  }

  function renderProgramBlock(program) {
    const offers = state.offers.filter((o) => o.programId === program.id);
    const merchantIds = [...new Set(offers.map((o) => o.merchantId))];
    const org = state.org;

    const offerCards = offers.map((o) => {
      const m = state.merchants.find((mm) => mm.id === o.merchantId);
      return `
        <div class="offer-card">
          <div class="offer-row">
            <div class="offer-left">
              <div class="avatar">${escapeHtml(initials(m && m.name))}</div>
              <div>
                <div style="font-weight:700;">${escapeHtml(m && m.name)}</div>
                <div style="font-size:13px; color:var(--muted);">${escapeHtml(o.terms)}</div>
              </div>
            </div>
          </div>
        </div>`;
    }).join("");

    const ctaHtml = program.zeffyLink
      ? `<a href="${escapeHtml(program.zeffyLink)}" target="_blank" rel="noreferrer"><button class="primary" style="width:100%; margin-top:4px;">Get a Pass</button></a>`
      : `<button disabled style="width:100%; margin-top:4px;">Get a Pass (coming soon)</button>`;

    // Deliberately styled to match the real pass page exactly — same navy hero,
    // same offer-card list — so visiting the landing page previews exactly
    // what buying a pass actually looks like, not a separate marketing skin.
    return `
      <div style="margin-bottom:28px;">
        <div class="pass-hero" style="text-align:center;">
          <div style="font-size:11px; color:#9DBBDD; text-transform:uppercase; letter-spacing:0.5px;">Supporting</div>
          <div style="font-size:20px; font-weight:700;">${escapeHtml(org && org.cause)}</div>
          <div style="font-size:14px; color:#E9F0FA; margin-top:6px;">${escapeHtml(program.name)}</div>
          ${program.tagline ? `<div style="font-size:12px; color:#9DBBDD; font-style:italic; margin-top:2px;">${escapeHtml(program.tagline)}</div>` : ""}
          <div style="font-size:12px; color:#9DBBDD; margin-top:10px;">${merchantIds.length} partner business${merchantIds.length === 1 ? "" : "es"} · ${offers.length} active offer${offers.length === 1 ? "" : "s"}</div>
        </div>

        <div class="stat-grid" style="margin-bottom:16px;">
          <div class="stat-card"><div class="label">1</div><div style="font-size:13px; font-weight:600;">Browse offers</div></div>
          <div class="stat-card"><div class="label">2</div><div style="font-size:13px; font-weight:600;">Get your pass</div></div>
          <div class="stat-card"><div class="label">3</div><div style="font-size:13px; font-weight:600;">Redeem & save</div></div>
        </div>

        <div style="font-size:12px; color:var(--muted); margin:0 2px 8px;">Participating businesses</div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
          ${offerCards || `<div style="font-size:13px; color:var(--muted); text-align:center;">Partner businesses coming soon.</div>`}
        </div>

        ${ctaHtml}
      </div>`;
  }

  function render() {
    const app = document.getElementById("app");
    const org = state.org;
    const videoProgram = state.programs.find((p) => !p.isTest && p.videoUrl);
    const videoId = videoProgram ? extractYouTubeId(videoProgram.videoUrl) : null;

    app.innerHTML = `
      <div style="max-width:720px; margin:0 auto; padding:28px 16px 60px;">

        <div style="text-align:center; margin-bottom:28px;">
          <img src="logo-header.png" alt="CausePass — Local Perks. Greater Impact." style="width:100%; max-width:220px; height:auto; margin-bottom:8px;" />
          <div style="font-size:16px; color:var(--green); font-weight:700; margin-top:2px;">Support Local. Fund a Cause.</div>
          <p style="font-size:14px; color:var(--ink); max-width:480px; margin:16px auto 6px; line-height:1.65;">
            Local businesses provide special offers. Supporters purchase passes to access them.
            Businesses gain new customers. Proceeds support youth robotics and STEM education.
          </p>
          <div style="font-size:12px; color:var(--muted); margin-top:8px;">
            Created by <a href="https://www.teamturtlebots.org" target="_blank" rel="noreferrer">${escapeHtml(org ? org.name : "Team Turtlebots")}</a>
          </div>
        </div>

        ${videoId ? `
          <div style="max-width:280px; margin:0 auto 28px; aspect-ratio:9/16; border-radius:16px; overflow:hidden; box-shadow:0 4px 16px rgba(0,0,0,0.12);">
            <iframe
              src="https://www.youtube.com/embed/${videoId}"
              title="How CausePass works"
              style="width:100%; height:100%; border:none; display:block;"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen>
            </iframe>
          </div>
        ` : ""}

        <div class="row-flex" style="justify-content:center; margin-bottom:36px;">
          <button class="primary" data-action="scroll-to" data-target="supporters-section">I'm a Supporter</button>
          <button data-action="scroll-to" data-target="restaurants-section">I'm a Business</button>
        </div>

        <div id="supporters-section" style="margin-bottom:44px;">
          <div class="display" style="font-size:20px; text-align:center; margin-bottom:4px;">For Supporters</div>
          <div style="text-align:center; font-size:13px; color:var(--muted); margin-bottom:20px;">Save at local businesses while supporting STEM.</div>
          ${(() => {
            const liveCampaigns = state.programs.filter((p) => !p.isTest);
            return liveCampaigns.length
              ? liveCampaigns.map(renderProgramBlock).join("")
              : `<div style="text-align:center; font-size:13px; color:var(--muted);">Details coming soon.</div>`;
          })()}
        </div>

        <div id="restaurants-section" style="margin-bottom:44px;">
          <div class="display" style="font-size:20px; text-align:center; margin-bottom:4px;">For Restaurants</div>
          <div style="text-align:center; font-size:13px; color:var(--muted); margin-bottom:20px;">Bring local families through your doors — support youth STEM with no upfront cost.</div>

          <div style="background:var(--green); border-radius:16px; padding:16px 18px; margin-bottom:16px; color:#fff; text-align:center;">
            <div style="font-size:11px; color:#D6F0DF; text-transform:uppercase; letter-spacing:0.5px;">Become a</div>
            <div style="font-size:20px; font-weight:700;">Founding CausePass Partner</div>
            <div style="font-size:13px; color:#EAF7ED; margin-top:6px;">No upfront cost · No app or POS integration required</div>
          </div>

          <div class="card" style="margin-bottom:16px;">
            <div class="stat-grid" style="margin-bottom:16px;">
              <div class="stat-card"><div class="label">1 · You Choose</div><div style="font-size:12px;">A simple offer, e.g. $5 off $25</div></div>
              <div class="stat-card"><div class="label">2 · We Promote</div><div style="font-size:12px;">To local families & supporters</div></div>
              <div class="stat-card"><div class="label">3 · Guest Visits</div><div style="font-size:12px;">Redeem the digital pass at checkout</div></div>
              <div class="stat-card"><div class="label">4 · You See Results</div><div style="font-size:12px;">Redemptions, funds raised, est. spending</div></div>
            </div>
            <div style="text-align:left; font-size:14px; line-height:2;">
              ✓ <strong>Support local STEM.</strong> Help students learn robotics and engineering.<br/>
              ✓ <strong>Attract local families.</strong> Give supporters a reason to visit.<br/>
              ✓ <strong>Secure digital coupons.</strong> Unique passes prevent repeat use.<br/>
              ✓ <strong>Easy for staff.</strong> No app, account, equipment, or POS integration.<br/>
              ✓ <strong>Clear results.</strong> Track redemptions, funds raised, and estimated customer spending.<br/>
              ✓ <strong>Sponsor recognition.</strong> Partners may receive an in-kind contribution acknowledgment.
            </div>
            <a href="mailto:TeamTurtlebots@gmail.com?subject=Interested%20in%20joining%20CausePass">
              <button class="primary" style="width:100%; margin-top:16px;">Join the Network</button>
            </a>
          </div>
        </div>

        <div id="impact-section" style="text-align:center; margin-bottom:28px;">
          <div class="display" style="font-size:18px; margin-bottom:10px;">Our Impact</div>
          <div style="font-size:22px; font-weight:700; color:var(--green);"><span id="count-patrons" data-count="50000">0</span>+ patrons reached</div>
          <div style="font-size:13px; color:var(--muted); margin-top:2px;">through local community events</div>
          <div style="font-size:13px; color:var(--muted); margin-top:10px;">
            <span id="count-youtube" data-count="1100">0</span>+ YouTube Subscribers ·
            <span id="count-instagram" data-count="500">0</span>+ Instagram Followers ·
            <span id="count-newsletter" data-count="100">0</span>+ Newsletter Subscribers
          </div>
        </div>

        <div style="text-align:center; font-size:11px; color:var(--muted); border-top:1px solid var(--line); padding-top:16px;">
          <div>Team Turtlebots #66322 · Share the Joy of STEM · teamturtlebots.org</div>
          <div style="margin-top:4px;">Student-led FIRST LEGO League team supported through Georgia Robotics Alliance, Inc., a 501(c)(3) nonprofit</div>
          <div style="margin-top:10px;"><a href="#/admin">Admin Login</a></div>
        </div>

      </div>`;

    wireEvents();
  }

  function wireEvents() {
    const app = document.getElementById("app");
    app.querySelectorAll('[data-action="scroll-to"]').forEach((el) => {
      el.addEventListener("click", () => {
        const target = document.getElementById(el.dataset.target);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    setupImpactCounters();
  }

  // Counts each number up from 0 once it scrolls into view. Guarded by
  // state.impactAnimated (not a DOM flag) because this app re-renders the
  // whole page on every Firestore update elsewhere — the DOM node showing
  // these numbers gets destroyed and recreated each time, so a flag stored
  // on the element itself wouldn't survive; tracking it in `state` does.
  function setupImpactCounters() {
    if (state.impactAnimated) {
      // Already played once this visit — just show the final numbers directly, no re-animate.
      document.querySelectorAll("[data-count]").forEach((el) => {
        el.textContent = Number(el.dataset.count).toLocaleString();
      });
      return;
    }
    const section = document.getElementById("impact-section");
    if (!section) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        state.impactAnimated = true;
        section.querySelectorAll("[data-count]").forEach((el) => animateCount(el, Number(el.dataset.count)));
      });
    }, { threshold: 0.4 });
    observer.observe(section);
  }

  function animateCount(el, target) {
    const duration = 1200;
    const start = performance.now();
    function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out — fast start, gentle finish
      el.textContent = Math.round(eased * target).toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  return { init };
})();
