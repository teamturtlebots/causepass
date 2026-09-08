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
    state = {
      user, tab: "dashboard",
      orgs: [], programs: [], merchants: [], offers: [], passes: [], redemptions: [],
      toast: null, lastLink: null,
      editingMerchantId: null, editingOfferId: null, editingProgramId: null,
      passSearch: "", merchantSearch: "", offerSearch: "",
      showArchivedMerchants: false, showArchivedOffers: false,
    };

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
  async function updateProgram(id, name, cap, exp) {
    await db.collection("programs").doc(id).update({
      name,
      maxRedemptions: cap ? parseInt(cap, 10) : null,
      expiresAt: exp || null,
    });
    state.editingProgramId = null;
    showToast("Campaign updated");
  }
  async function createMerchant(orgId, name) {
    await db.collection("merchants").add({ orgId, name, archived: false });
    showToast("Merchant added");
  }
  async function updateMerchant(id, name) {
    await db.collection("merchants").doc(id).update({ name });
    state.editingMerchantId = null;
    showToast("Merchant updated");
  }
  async function setMerchantArchived(id, archived) {
    await db.collection("merchants").doc(id).update({ archived });
    showToast(archived ? "Merchant archived" : "Merchant restored");
  }
  async function createOffer(programId, merchantId, terms, exp) {
    if (!programId || !merchantId) { showToast("Create a campaign and a merchant first"); return; }
    await db.collection("offers").add({ programId, merchantId, terms, expiresAt: exp || null, active: true, archived: false });
    showToast("Offer added");
  }
  async function updateOffer(id, merchantId, terms, exp) {
    await db.collection("offers").doc(id).update({ merchantId, terms, expiresAt: exp || null });
    state.editingOfferId = null;
    showToast("Offer updated");
  }
  async function toggleOffer(offer) {
    await db.collection("offers").doc(offer.id).update({ active: !offer.active });
  }
  async function setOfferArchived(id, archived) {
    await db.collection("offers").doc(id).update({ archived });
    showToast(archived ? "Offer archived" : "Offer restored");
  }
  async function createPass(programId, customerName) {
    if (!programId) { showToast("Create a campaign first"); return; }
    const t = randomToken();
    await db.collection("passes").doc(t).set({
      programId, customerName, status: "active", redeemedCount: 0, createdAt: Date.now(),
    });
    state.lastLink = t;
    showToast("Pass created");
  }
  async function disablePass(token) {
    if (!confirm("Disable this pass? The customer will no longer be able to redeem any offers on it.")) return;
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
    wireGlobalEvents();
    wireTabEvents(org);
  }

  function renderTab(org) {
    if (state.tab === "dashboard") {
      const activeMerchants = state.merchants.filter((m) => !m.archived).length;
      return `
        <div class="stat-grid">
          <div class="stat-card"><div class="label">Passes issued</div><div class="value">${state.passes.length}</div></div>
          <div class="stat-card"><div class="label">Redemptions</div><div class="value">${state.redemptions.length}</div></div>
          <div class="stat-card"><div class="label">Active merchants</div><div class="value">${activeMerchants}</div></div>
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
    const search = (state.passSearch || "").toLowerCase();
    const filtered = state.passes
      .filter((p) => !search || p.customerName.toLowerCase().includes(search) || p.id.toLowerCase().includes(search))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // newest first

    const rows = filtered.map((p) => {
      const program = state.programs.find((pr) => pr.id === p.programId);
      const used = state.redemptions.filter((r) => r.passToken === p.id).length;
      const passLink = window.location.origin + window.location.pathname + "#/p/" + p.id;
      return `
        <div class="list-item">
          <div style="min-width:140px;">
            <div style="font-weight:600;">${escapeHtml(p.customerName)}</div>
            <div style="font-size:12px; color:var(--muted);">${escapeHtml(program && program.name)} · ${fmtDate(p.createdAt)}</div>
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
      <input id="pass-search" placeholder="Search by customer name or token…" value="${escapeHtml(state.passSearch)}" style="margin-bottom:10px; width:100%;" />
      <div class="list-box">${rows || `<div style="padding:16px; font-size:13px; color:var(--muted);">No passes match.</div>`}</div>`;
  }

  function renderMerchantsTab(org) {
    const search = (state.merchantSearch || "").toLowerCase();
    const visible = state.merchants.filter((m) => {
      const archivedMatch = state.showArchivedMerchants ? !!m.archived : !m.archived;
      const searchMatch = !search || m.name.toLowerCase().includes(search);
      return archivedMatch && searchMatch;
    });

    const chips = visible.map((m) => {
      if (state.editingMerchantId === m.id) {
        return `
          <div class="card" style="display:inline-block; margin-right:8px; margin-bottom:8px; min-width:220px;">
            <input id="edit-merchant-name-${m.id}" value="${escapeHtml(m.name)}" style="margin-bottom:8px; width:100%;" />
            <button class="primary" data-action="save-merchant" data-id="${m.id}">Save</button>
            <button data-action="cancel-edit-merchant">Cancel</button>
          </div>`;
      }
      return `
        <div style="display:inline-flex; align-items:center; gap:8px; border:1px solid var(--line); border-radius:8px; padding:6px 10px; margin-right:8px; margin-bottom:8px;">
          <span style="font-size:12px; font-weight:700;">${escapeHtml(initials(m.name))}</span> ${escapeHtml(m.name)}
          ${state.showArchivedMerchants
            ? `<button data-action="unarchive-merchant" data-id="${m.id}" style="padding:4px 8px; font-size:12px;">Restore</button>`
            : `<button data-action="edit-merchant" data-id="${m.id}" style="padding:4px 8px; font-size:12px;">Edit</button>
               <button class="danger" data-action="archive-merchant" data-id="${m.id}" style="padding:4px 8px; font-size:12px;">Archive</button>`
          }
        </div>`;
    }).join("");

    return `
      <div style="margin-bottom:14px;">
        <input id="merchant-name" placeholder="Merchant name" />
        <button class="primary" data-action="create-merchant" data-org="${org.id}">Add merchant</button>
      </div>
      <div class="row-flex" style="margin-bottom:12px;">
        <input id="merchant-search" placeholder="Search merchants…" value="${escapeHtml(state.merchantSearch)}" style="flex:1; min-width:180px;" />
        <label style="font-size:13px; color:var(--muted); display:flex; align-items:center; gap:6px;">
          <input type="checkbox" id="merchant-show-archived" ${state.showArchivedMerchants ? "checked" : ""} /> Show archived
        </label>
      </div>
      <div>${chips || `<div style="font-size:13px; color:var(--muted);">${state.showArchivedMerchants ? "No archived merchants." : "No merchants match."}</div>`}</div>`;
  }

  function renderOffersTab() {
    const search = (state.offerSearch || "").toLowerCase();
    const visible = state.offers.filter((o) => {
      const m = state.merchants.find((mm) => mm.id === o.merchantId);
      const archivedMatch = state.showArchivedOffers ? !!o.archived : !o.archived;
      const searchMatch = !search || o.terms.toLowerCase().includes(search) || (m && m.name.toLowerCase().includes(search));
      return archivedMatch && searchMatch;
    });

    const rows = visible.map((o) => {
      const m = state.merchants.find((mm) => mm.id === o.merchantId);
      if (state.editingOfferId === o.id) {
        const merchantOptions = state.merchants.filter((mm) => !mm.archived || mm.id === o.merchantId);
        return `
          <div class="card">
            <select id="edit-offer-merchant-${o.id}">
              ${merchantOptions.map((mm) => `<option value="${mm.id}" ${mm.id === o.merchantId ? "selected" : ""}>${escapeHtml(mm.name)}</option>`).join("")}
            </select>
            <input type="date" id="edit-offer-expiry-${o.id}" value="${o.expiresAt || ""}" />
            <br/>
            <input id="edit-offer-terms-${o.id}" value="${escapeHtml(o.terms)}" style="margin-top:8px; width:280px;" />
            <button class="primary" data-action="save-offer" data-id="${o.id}">Save</button>
            <button data-action="cancel-edit-offer">Cancel</button>
          </div>`;
      }
      return `<div style="font-size:13px; margin-bottom:6px;">
        ${escapeHtml(m && m.name)} — ${escapeHtml(o.terms)} ${o.expiresAt ? `(expires ${o.expiresAt})` : ""} — ${o.active ? "active" : "inactive"}
        ${state.showArchivedOffers
          ? `<button data-action="unarchive-offer" data-id="${o.id}">Restore</button>`
          : `<button data-action="edit-offer" data-id="${o.id}">Edit</button>
             <button data-action="toggle-offer" data-id="${o.id}">${o.active ? "Deactivate" : "Activate"}</button>
             <button class="danger" data-action="archive-offer" data-id="${o.id}">Archive</button>`
        }
      </div>`;
    }).join("");

    const merchantOptionsForNew = state.merchants.filter((m) => !m.archived);

    return `
      <div class="card">
        <select id="offer-program">${state.programs.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}</select>
        <select id="offer-merchant">${merchantOptionsForNew.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("")}</select>
        <input type="date" id="offer-expiry" />
        <br/>
        <input id="offer-terms" placeholder="Offer terms, e.g. $5 off $5.01+" style="margin-top:8px; width:240px;" />
        <button class="primary" data-action="create-offer">Add offer</button>
      </div>
      <div class="row-flex" style="margin-bottom:12px;">
        <input id="offer-search" placeholder="Search offers by merchant or terms…" value="${escapeHtml(state.offerSearch)}" style="flex:1; min-width:180px;" />
        <label style="font-size:13px; color:var(--muted); display:flex; align-items:center; gap:6px;">
          <input type="checkbox" id="offer-show-archived" ${state.showArchivedOffers ? "checked" : ""} /> Show archived
        </label>
      </div>
      ${rows || `<div style="font-size:13px; color:var(--muted);">${state.showArchivedOffers ? "No archived offers." : "No offers match."}</div>`}`;
  }

  function renderProgramsTab(org) {
    const rows = state.programs.map((p) => {
      if (state.editingProgramId === p.id) {
        return `
          <div class="card">
            <input id="edit-program-name-${p.id}" value="${escapeHtml(p.name)}" />
            <input id="edit-program-cap-${p.id}" type="number" value="${p.maxRedemptions ?? ""}" placeholder="no cap" style="width:120px;" />
            <input id="edit-program-expiry-${p.id}" type="date" value="${p.expiresAt || ""}" />
            <div style="margin-top:8px;">
              <button class="primary" data-action="save-program" data-id="${p.id}">Save</button>
              <button data-action="cancel-edit-program">Cancel</button>
            </div>
          </div>`;
      }
      return `
        <div style="font-size:13px; margin-bottom:6px;">
          ${escapeHtml(p.name)} — cap: ${p.maxRedemptions ?? "none"} — expires: ${p.expiresAt || "never"}
          <button data-action="edit-program" data-id="${p.id}">Edit</button>
        </div>`;
    }).join("");
    return `
      <div class="card">
        <input id="program-name" placeholder="Campaign name" />
        <input id="program-cap" type="number" placeholder="Redemption cap" value="5" style="width:120px;" />
        <input id="program-expiry" type="date" />
        <button class="primary" data-action="create-program" data-org="${org.id}">Create campaign</button>
      </div>
      ${rows}`;
  }

  function wireGlobalEvents() {
    const app = document.getElementById("app");
    app.querySelector('[data-action="sign-out"]').addEventListener("click", () => auth.signOut());
    app.querySelectorAll('[data-action="set-tab"]').forEach((el) => {
      el.addEventListener("click", () => { state.tab = el.dataset.tab; render(); });
    });
  }

  function wireTabEvents(org) {
    const app = document.getElementById("app");

    // --- passes ---
    const createPassBtn = app.querySelector('[data-action="create-pass"]');
    if (createPassBtn) createPassBtn.addEventListener("click", () => {
      const programId = document.getElementById("pass-program").value;
      const nameInput = document.getElementById("pass-customer");
      if (nameInput.value.trim()) { createPass(programId, nameInput.value.trim()); nameInput.value = ""; }
    });
    app.querySelectorAll('[data-action="disable-pass"]').forEach((el) => {
      el.addEventListener("click", () => disablePass(el.dataset.token));
    });
    const passSearchInput = app.querySelector("#pass-search");
    if (passSearchInput) passSearchInput.addEventListener("input", () => { state.passSearch = passSearchInput.value; render(); });

    // --- merchants ---
    const createMerchantBtn = app.querySelector('[data-action="create-merchant"]');
    if (createMerchantBtn) createMerchantBtn.addEventListener("click", () => {
      const input = document.getElementById("merchant-name");
      if (input.value.trim()) { createMerchant(createMerchantBtn.dataset.org, input.value.trim()); input.value = ""; }
    });
    const merchantSearchInput = app.querySelector("#merchant-search");
    if (merchantSearchInput) merchantSearchInput.addEventListener("input", () => { state.merchantSearch = merchantSearchInput.value; render(); });
    const merchantArchivedToggle = app.querySelector("#merchant-show-archived");
    if (merchantArchivedToggle) merchantArchivedToggle.addEventListener("change", () => { state.showArchivedMerchants = merchantArchivedToggle.checked; render(); });
    app.querySelectorAll('[data-action="edit-merchant"]').forEach((el) => {
      el.addEventListener("click", () => { state.editingMerchantId = el.dataset.id; render(); });
    });
    app.querySelectorAll('[data-action="cancel-edit-merchant"]').forEach((el) => {
      el.addEventListener("click", () => { state.editingMerchantId = null; render(); });
    });
    app.querySelectorAll('[data-action="save-merchant"]').forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.id;
        const val = document.getElementById(`edit-merchant-name-${id}`).value.trim();
        if (val) updateMerchant(id, val);
      });
    });
    app.querySelectorAll('[data-action="archive-merchant"]').forEach((el) => {
      el.addEventListener("click", () => setMerchantArchived(el.dataset.id, true));
    });
    app.querySelectorAll('[data-action="unarchive-merchant"]').forEach((el) => {
      el.addEventListener("click", () => setMerchantArchived(el.dataset.id, false));
    });

    // --- offers ---
    const createOfferBtn = app.querySelector('[data-action="create-offer"]');
    if (createOfferBtn) createOfferBtn.addEventListener("click", () => {
      const programId = document.getElementById("offer-program").value;
      const merchantId = document.getElementById("offer-merchant").value;
      const exp = document.getElementById("offer-expiry").value;
      const termsInput = document.getElementById("offer-terms");
      if (termsInput.value.trim()) { createOffer(programId, merchantId, termsInput.value.trim(), exp); termsInput.value = ""; }
    });
    const offerSearchInput = app.querySelector("#offer-search");
    if (offerSearchInput) offerSearchInput.addEventListener("input", () => { state.offerSearch = offerSearchInput.value; render(); });
    const offerArchivedToggle = app.querySelector("#offer-show-archived");
    if (offerArchivedToggle) offerArchivedToggle.addEventListener("change", () => { state.showArchivedOffers = offerArchivedToggle.checked; render(); });
    app.querySelectorAll('[data-action="toggle-offer"]').forEach((el) => {
      el.addEventListener("click", () => toggleOffer(state.offers.find((o) => o.id === el.dataset.id)));
    });
    app.querySelectorAll('[data-action="edit-offer"]').forEach((el) => {
      el.addEventListener("click", () => { state.editingOfferId = el.dataset.id; render(); });
    });
    app.querySelectorAll('[data-action="cancel-edit-offer"]').forEach((el) => {
      el.addEventListener("click", () => { state.editingOfferId = null; render(); });
    });
    app.querySelectorAll('[data-action="save-offer"]').forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.id;
        const merchantId = document.getElementById(`edit-offer-merchant-${id}`).value;
        const exp = document.getElementById(`edit-offer-expiry-${id}`).value;
        const terms = document.getElementById(`edit-offer-terms-${id}`).value.trim();
        if (terms) updateOffer(id, merchantId, terms, exp);
      });
    });
    app.querySelectorAll('[data-action="archive-offer"]').forEach((el) => {
      el.addEventListener("click", () => setOfferArchived(el.dataset.id, true));
    });
    app.querySelectorAll('[data-action="unarchive-offer"]').forEach((el) => {
      el.addEventListener("click", () => setOfferArchived(el.dataset.id, false));
    });

    // --- programs ---
    const createProgramBtn = app.querySelector('[data-action="create-program"]');
    if (createProgramBtn) createProgramBtn.addEventListener("click", () => {
      const nameInput = document.getElementById("program-name");
      const cap = document.getElementById("program-cap").value;
      const exp = document.getElementById("program-expiry").value;
      if (nameInput.value.trim()) { createProgram(createProgramBtn.dataset.org, nameInput.value.trim(), cap, exp); nameInput.value = ""; }
    });
    app.querySelectorAll('[data-action="edit-program"]').forEach((el) => {
      el.addEventListener("click", () => { state.editingProgramId = el.dataset.id; render(); });
    });
    app.querySelectorAll('[data-action="cancel-edit-program"]').forEach((el) => {
      el.addEventListener("click", () => { state.editingProgramId = null; render(); });
    });
    app.querySelectorAll('[data-action="save-program"]').forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.id;
        const name = document.getElementById(`edit-program-name-${id}`).value.trim();
        const cap = document.getElementById(`edit-program-cap-${id}`).value;
        const exp = document.getElementById(`edit-program-expiry-${id}`).value;
        if (name) updateProgram(id, name, cap, exp);
      });
    });
  }

  return { initLogin, initDashboard };
})();
