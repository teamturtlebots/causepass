// ================= PUBLIC LANDING PAGE =================
// No login, no auth check — everything here reads from collections that are
// publicly readable by design (same rule that lets a customer open a pass
// link with no account). Visible to anyone who lands on the site's root URL.

const LandingView = (function () {
  let state = { org: null, programs: [], merchants: [], offers: [] };
  let unsubscribers = [];

  function init() {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    state = { org: null, programs: [], merchants: [], offers: [] };
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

    const offerCards = offers.map((o) => {
      const m = state.merchants.find((mm) => mm.id === o.merchantId);
      return `
        <div class="offer-card" style="text-align:left;">
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
      ? `<a href="${escapeHtml(program.zeffyLink)}" target="_blank" rel="noreferrer"><button class="primary" style="width:100%; margin-top:6px;">Get a Pass</button></a>`
      : `<button disabled style="width:100%; margin-top:6px;">Get a Pass (coming soon)</button>`;

    return `
      <div class="card" style="text-align:center; margin-bottom:20px;">
        <div class="display" style="font-size:19px;">${escapeHtml(program.name)}</div>
        ${program.tagline ? `<div style="color:var(--green); font-style:italic; font-size:13px; margin-top:2px;">${escapeHtml(program.tagline)}</div>` : ""}
        <div style="font-size:13px; color:var(--muted); margin:10px 0 16px;">${merchantIds.length} partner business${merchantIds.length === 1 ? "" : "es"} · ${offers.length} active offer${offers.length === 1 ? "" : "s"}</div>

        <div class="stat-grid" style="margin-bottom:18px;">
          <div class="stat-card"><div class="label">1</div><div style="font-size:13px; font-weight:600;">Browse offers</div></div>
          <div class="stat-card"><div class="label">2</div><div style="font-size:13px; font-weight:600;">Get your pass</div></div>
          <div class="stat-card"><div class="label">3</div><div style="font-size:13px; font-weight:600;">Redeem & save</div></div>
        </div>

        <div style="text-align:left; display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
          ${offerCards || `<div style="font-size:13px; color:var(--muted); text-align:center;">Partner businesses coming soon.</div>`}
        </div>

        ${ctaHtml}
      </div>`;
  }

  function render() {
    const app = document.getElementById("app");
    const org = state.org;

    app.innerHTML = `
      <div style="max-width:720px; margin:0 auto; padding:28px 16px 60px;">

        <div style="text-align:center; margin-bottom:28px;">
          <div class="display" style="font-size:30px;">CausePass</div>
          <div style="font-size:16px; color:var(--green); font-weight:700; margin-top:2px;">Support Local. Fund a Cause.</div>
          <p style="font-size:14px; color:var(--ink); max-width:480px; margin:16px auto 6px; line-height:1.65;">
            Local businesses provide special offers. Supporters purchase passes to access them.
            Businesses gain new customers. Proceeds support youth robotics and STEM education.
          </p>
          <div style="font-size:12px; color:var(--muted); margin-top:8px;">
            Created by <a href="https://www.teamturtlebots.org" target="_blank" rel="noreferrer">${escapeHtml(org ? org.name : "Team Turtlebots")}</a>
          </div>
        </div>

        <div class="row-flex" style="justify-content:center; margin-bottom:36px;">
          <button class="primary" data-action="scroll-to" data-target="supporters-section">I'm a Supporter</button>
          <button data-action="scroll-to" data-target="restaurants-section">I'm a Business</button>
        </div>

        <div id="supporters-section" style="margin-bottom:44px;">
          <div class="display" style="font-size:20px; text-align:center; margin-bottom:4px;">For Supporters</div>
          <div style="text-align:center; font-size:13px; color:var(--muted); margin-bottom:20px;">Save at local businesses while supporting STEM.</div>
          ${state.programs.length
            ? state.programs.map(renderProgramBlock).join("")
            : `<div style="text-align:center; font-size:13px; color:var(--muted);">Details coming soon.</div>`
          }
        </div>

        <div id="restaurants-section" style="margin-bottom:44px;">
          <div class="display" style="font-size:20px; text-align:center; margin-bottom:4px;">For Restaurants</div>
          <div style="text-align:center; font-size:13px; color:var(--muted); margin-bottom:20px;">Bring local families through your doors — support youth STEM with no upfront cost.</div>

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

        <div style="text-align:center; margin-bottom:28px;">
          <div class="display" style="font-size:18px; margin-bottom:10px;">Our Impact</div>
          <div style="font-size:13px; color:var(--muted);">1.1K+ YouTube Subscribers · 500+ Instagram Followers · 100+ Newsletter Subscribers</div>
          <div style="font-size:13px; color:var(--muted); margin-top:4px;">Active in local community events</div>
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
  }

  return { init };
})();
