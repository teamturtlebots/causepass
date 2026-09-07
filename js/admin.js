// ================= ADMIN VIEW =================

const AdminView = (function () {
  let state = {};
  let unsubscribers = [];

  // ---------- Login screen ----------
  function initLogin(notAdmin) {
    const app = document.getElementById("app");
    if (notAdmin) {
      app.innerHTML = `
        <div class="login-wrap" style="text-align:center;">
          <p>This account isn't set up as a CausePass admin.</p>
          <p style="font-size:13px; color:var(--muted);">Add this user's UID to the <code>admins</code> collection in Firestore to grant access.</p>
          <button data-action="sign-out">Sign out</button>
        </div>`;
      app.querySelector('[data-action="sign-out"]').addEventListener("click", () => auth.signOut());
      return;
    }

    app.innerHTML = `
      <form class="login-wrap" id="login-form">
        <h2 style="margin-bottom:16px;">CausePass admin</h2>
        <input type="email" id="login-email" placeholder="Email" required />
        <input type="password" id="login-password" placeholder="Password" required />
        <div id="login-error" class="banner red" style="display:none;"></div>
        <button type="submit" class="primary">Sign in</button>
        <p style="font-size:12px; color:var(--muted); margin-top:14px;">Admin accounts are created in the Firebase console, not here.</p>
      </form>`;

    document.getElementById("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorBox = document.getElementById("login-error");
      errorBox.style.display = "none";
      const email = document.getElementById("login-email").value;
      const password = document.getElementById("login-password").value;
      try {
        await auth.signInWithEmailAndPassword(email, password);
        // App.js's onAuthStateChanged listener takes over from here.
      } catch (err) {
        errorBox.textContent = "Couldn't sign in. Check the email and password.";
        errorBox.style.display = "block";
      }
    });
  }

  // ---------- Dashboard ----------
  function initDashboard(user) {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    state = { user, tab: "dashboard", orgs: [], programs: [], merchants: [], offers: [], passes: [], redemptions: [], toast: null, lastLink: null };

    subscribe("organizations", "orgs");
    subscribe("programs", "programs");
    subscribe("merchants", "merchants");
    subscribe("offers", "offers");
    subscribe("passes", "passes");
    subscribe("redemptions", "redemptions");

    render();
  }

  function subscribe(collectionName, stateKey) {
    const unsub = db.collection(collectionName).onSnapshot((snap) => {
      state[stateKey] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    });
    unsubscribers.push(unsub);
  }

  function showToast(msg) {
    state.toast = msg;
    render();
    setTimeout(() => { state.toast = null; render(); }, 2000);
  }

  // ---------- writes ----------
  async function createOrg(name, cause) {
    await db.collection("organizations").add({ name, cause });
    showToast("Organization created");
  }
  async function createProgram(orgId, name, cap, exp) {
    await db.collection("programs").add({
      orgId, name,
      maxRedemptions: cap ? parseInt(cap, 10) : null,
      expiresAt: exp || null,
    });
    showToast("Campaign created");
  }
  async function createMerchant(orgId, name) {
    await db.collection("merchants").add({ orgId, name });
    showToast("Merchant added");
  }
  async function createOffer(programId, merchantId, terms, exp) {
    await db.collection("offers").add({ programId, merchantId, terms, expiresAt: exp || null, active: true });
    showToast("Offer added");
  }
  async function toggleOffer(offer) {
    await db.collection("offers").doc(offer.id).update({ active: !offer.active });
  }
  async function createPass(programId, customerName) {
    const t = randomToken();
    await db.collection("passes").doc(t).set({
      programId, customerName, status: "active", redeemedCount: 0, createdAt: Date.now(),
    });
    state.lastLink = t;
    showToast("Pass created");
  }
  async function disablePass(token) {
    await db.collection("passes").doc(token).update({ status: "disabled" });
    showToast("Pass disabled");
  }

  // ---------- render ----------
  function render() {
    const app = document.getElementById("app");
    const org = state.orgs[0];

    if (!org) {
      app.innerHTML = `
        <div class="login-wrap">
          <h3>Create your organization</h3>
          <input id="org-name" placeholder="Organization name (e.g. Team TurtleBots)" />
          <input id="org-cause" placeholder="Cause / beneficiary" />
          <button class="primary" id="org-create">Create</button>
          <div style="margin-top:10px;"><button data-action="sign-out">Sign out</button></div>
        </div>`;
      app.querySelector("#org-create").addEventListener("click", () => {
        const name = document.getElementById("org-name").value.trim();
        const cause = document.getElementById("org-cause").value.trim();
        if (name) createOrg(name, cause);
      });
      app.querySelector('[data-action="sign-out"]').addEventListener("click", () => auth.signOut());
      return;
    }

    app.innerHTML = `
      <div class="admin-wrap">
        <div class="admin-header">
          <div>
            <h2>CausePass admin</h2>
            <div style="font-size:13px; color:var(--muted);">${escapeHtml(org.name)} · ${escapeHtml(org.cause)} · signed in as ${escapeHtml(state.user.email)}</div>
          </div>
          <button data-action="sign-out">Sign out</button>
        </div>

        <div class="tabs">
          ${["dashboard", "passes", "merchants", "offers", "programs"].map((t) =>
            `<button class="${state.tab === t ? "active" : ""}" data-action="set-tab" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`
          ).join("")}
        </div>

        ${state.toast ? `<div class="toast" style="border-radius:6px; margin-bottom:14px;">${escapeHtml(state.toast)}</div>` : ""}

        <div id="tab-content"></div>
      </div>`;

    document.getElementById("tab-content").innerHTML = renderTab(org);
    wireGlobalEvents(org);
    wireTabEvents();
  }

  function renderTab(org) {
    if (state.tab === "dashboard") {
      return `
        <div class="stat-grid">
          <div class="stat-card"><div class="label">Passes issued</div><div class="value">${state.passes.length}</div></div>
          <div class="stat-card"><div class="label">Redemptions</div><div class="value">${state.redemptions.length}</div></div>
          <div class="stat-card"><div class="label">Merchants</div><div class="value">${state.merchants.length}</div></div>
          <div class="stat-card"><div class="label">Campaigns</div><div class="value">${state.programs.length}</div></div>
        </div>`;
    }
    if (state.tab === "passes") return renderPassesTab();
    if (state.tab === "merchants") return renderMerchantsTab(org);
    if (state.tab === "offers") return renderOffersTab();
    if (state.tab === "programs") return renderProgramsTab(org);
    return "";
  }

  function renderPassesTab() {
    const link = state.lastLink ? window.location.origin + window.location.pathname + "#/p/" + state.lastLink : null;
    const rows = state.passes.map((p) => {
      const program = state.programs.find((pr) => pr.id === p.programId);
      const used = state.redemptions.filter((r) => r.passToken === p.id).length;
      const passLink = window.location.origin + window.location.pathname + "#/p/" + p.id;
      return `
        <div class="list-item">
          <div style="min-width:140px;">
            <div style="font-weight:600;">${escapeHtml(p.customerName)}</div>
            <div style="font-size:12px; color:var(--muted);">${escapeHtml(program && program.name)}</div>
          </div>
          <div class="mono">${passLink}</div>
          <div>${used}${program && program.maxRedemptions ? ` / ${program.maxRedemptions}` : ""} redeemed</div>
          <span class="badge ${p.status === "disabled" ? "red" : "green"}">${p.status === "disabled" ? "Disabled" : "Active"}</span>
          <div class="row-flex">
            <a href="${passLink}" target="_blank" rel="noreferrer">View as customer</a>
            ${p.status !== "disabled" ? `<button class="danger" data-action="disable-pass" data-token="${p.id}">Disable</button>` : ""}
          </div>
        </div>`;
    }).join("");

    return `
      <div class="card">
        <div style="font-weight:700; margin-bottom:10px;">Create a customer pass</div>
        <select id="pass-program">${state.programs.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}</select>
        <input id="pass-customer" placeholder="Customer name" />
        <button class="primary" data-action="create-pass">Create pass</button>
        ${link ? `<div style="margin-top:10px; font-size:13px;">Link: <code>${link}</code></div>` : ""}
      </div>
      <div class="list-box">${rows || `<div style="padding:16px; font-size:13px; color:var(--muted);">No passes yet.</div>`}</div>`;
  }

  function renderMerchantsTab(org) {
    const chips = state.merchants.map((m) => `
      <div style="display:inline-flex; align-items:center; gap:8px; border:1px solid var(--line); border-radius:8px; padding:6px 10px; margin-right:8px; margin-bottom:8px;">
        <span style="font-size:12px; font-weight:700;">${escapeHtml(initials(m.name))}</span> ${escapeHtml(m.name)}
      </div>`).join("");
    return `
      <div style="margin-bottom:14px;">
        <input id="merchant-name" placeholder="Merchant name" />
        <button class="primary" data-action="create-merchant" data-org="${org.id}">Add merchant</button>
      </div>
      <div>${chips}</div>`;
  }

  function renderOffersTab() {
    const rows = state.offers.map((o) => {
      const m = state.merchants.find((mm) => mm.id === o.merchantId);
      return `<div style="font-size:13px; margin-bottom:6px;">
        ${escapeHtml(m && m.name)} — ${escapeHtml(o.terms)} ${o.expiresAt ? `(expires ${o.expiresAt})` : ""} — ${o.active ? "active" : "inactive"}
        <button data-action="toggle-offer" data-id="${o.id}">${o.active ? "Deactivate" : "Activate"}</button>
      </div>`;
    }).join("");
    return `
      <div class="card">
        <select id="offer-program">${state.programs.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}</select>
        <select id="offer-merchant">${state.merchants.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("")}</select>
        <input type="date" id="offer-expiry" />
        <br/>
        <input id="offer-terms" placeholder="Offer terms, e.g. $5 off $5.01+" style="margin-top:8px; width:240px;" />
        <button class="primary" data-action="create-offer">Add offer</button>
      </div>
      ${rows}`;
  }

  function renderProgramsTab(org) {
    const rows = state.programs.map((p) => `
      <div style="font-size:13px; margin-bottom:6px;">
        ${escapeHtml(p.name)} — cap: ${p.maxRedemptions ?? "none"} — expires: ${p.expiresAt || "never"}
      </div>`).join("");
    return `
      <div class="card">
        <input id="program-name" placeholder="Campaign name" />
        <input id="program-cap" type="number" placeholder="Redemption cap" value="5" style="width:120px;" />
        <input id="program-expiry" type="date" />
        <button class="primary" data-action="create-program" data-org="${org.id}">Create campaign</button>
      </div>
      ${rows}`;
  }

  function wireGlobalEvents(org) {
    const app = document.getElementById("app");
    app.querySelector('[data-action="sign-out"]').addEventListener("click", () => auth.signOut());
    app.querySelectorAll('[data-action="set-tab"]').forEach((el) => {
      el.addEventListener("click", () => { state.tab = el.dataset.tab; render(); });
    });
  }

  function wireTabEvents() {
    const app = document.getElementById("app");

    const createPassBtn = app.querySelector('[data-action="create-pass"]');
    if (createPassBtn) createPassBtn.addEventListener("click", () => {
      const programId = document.getElementById("pass-program").value;
      const nameInput = document.getElementById("pass-customer");
      if (nameInput.value.trim()) { createPass(programId, nameInput.value.trim()); nameInput.value = ""; }
    });

    app.querySelectorAll('[data-action="disable-pass"]').forEach((el) => {
      el.addEventListener("click", () => disablePass(el.dataset.token));
    });

    const createMerchantBtn = app.querySelector('[data-action="create-merchant"]');
    if (createMerchantBtn) createMerchantBtn.addEventListener("click", () => {
      const input = document.getElementById("merchant-name");
      if (input.value.trim()) { createMerchant(createMerchantBtn.dataset.org, input.value.trim()); input.value = ""; }
    });

    const createOfferBtn = app.querySelector('[data-action="create-offer"]');
    if (createOfferBtn) createOfferBtn.addEventListener("click", () => {
      const programId = document.getElementById("offer-program").value;
      const merchantId = document.getElementById("offer-merchant").value;
      const exp = document.getElementById("offer-expiry").value;
      const termsInput = document.getElementById("offer-terms");
      if (termsInput.value.trim()) { createOffer(programId, merchantId, termsInput.value.trim(), exp); termsInput.value = ""; }
    });

    app.querySelectorAll('[data-action="toggle-offer"]').forEach((el) => {
      el.addEventListener("click", () => toggleOffer(state.offers.find((o) => o.id === el.dataset.id)));
    });

    const createProgramBtn = app.querySelector('[data-action="create-program"]');
    if (createProgramBtn) createProgramBtn.addEventListener("click", () => {
      const nameInput = document.getElementById("program-name");
      const cap = document.getElementById("program-cap").value;
      const exp = document.getElementById("program-expiry").value;
      if (nameInput.value.trim()) { createProgram(createProgramBtn.dataset.org, nameInput.value.trim(), cap, exp); nameInput.value = ""; }
    });
  }

  return { initLogin, initDashboard };
})();
