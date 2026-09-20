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
        <p style="font-size:12px; margin-top:6px;"><a href="#/">← Back to CausePass</a></p>
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
      toast: null,
      editingMerchantId: null, editingOfferId: null, editingProgramId: null,
      passSearch: "", merchantSearch: "", offerSearch: "",
      showArchivedMerchants: false, showArchivedOffers: false,
      batchBusy: false, batchProgress: "",
      reportCampaign: "", reportMerchant: "", reportStart: "", reportEnd: "",
      markingSoldId: null,
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
  async function createProgram(orgId, name, cap, exp, tagline, zeffyLink, isTest, videoUrl, mapUrl) {
    await db.collection("programs").add({
      orgId, name,
      maxRedemptions: cap ? parseInt(cap, 10) : null,
      expiresAt: exp || null,
      tagline: tagline || null,
      zeffyLink: zeffyLink || null,
      isTest: !!isTest,
      videoUrl: videoUrl || null,
      mapUrl: mapUrl || null,
    });
    showToast("Campaign created");
  }
  async function updateProgram(id, name, cap, exp, tagline, zeffyLink, isTest, videoUrl, mapUrl) {
    await db.collection("programs").doc(id).update({
      name,
      maxRedemptions: cap ? parseInt(cap, 10) : null,
      expiresAt: exp || null,
      tagline: tagline || null,
      zeffyLink: zeffyLink || null,
      isTest: !!isTest,
      videoUrl: videoUrl || null,
      mapUrl: mapUrl || null,
    });
    state.editingProgramId = null;
    showToast("Campaign updated");
  }
  async function createMerchant(orgId, name, address) {
    await db.collection("merchants").add({ orgId, name, address: address || null, archived: false });
    showToast("Merchant added");
  }
  async function updateMerchant(id, name, address) {
    await db.collection("merchants").doc(id).update({ name, address: address || null });
    state.editingMerchantId = null;
    showToast("Merchant updated");
  }
  async function setMerchantArchived(id, archived) {
    await db.collection("merchants").doc(id).update({ archived });
    showToast(archived ? "Merchant archived" : "Merchant restored");
  }
  async function createOffer(programId, merchantId, terms, exp, discountAmount, minPurchase, details, description) {
    if (!programId || !merchantId) { showToast("Create a campaign and a merchant first"); return; }
    await db.collection("offers").add({
      programId, merchantId, terms, details: details || null, description: description || null, expiresAt: exp || null, active: true, archived: false,
      discountAmount: discountAmount ? parseFloat(discountAmount) : null,
      minPurchase: minPurchase ? parseFloat(minPurchase) : null,
    });
    showToast("Offer added");
  }
  async function updateOffer(id, merchantId, terms, exp, discountAmount, minPurchase, details, description) {
    await db.collection("offers").doc(id).update({
      merchantId, terms, details: details || null, description: description || null, expiresAt: exp || null,
      discountAmount: discountAmount ? parseFloat(discountAmount) : null,
      minPurchase: minPurchase ? parseFloat(minPurchase) : null,
    });
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
  // Core pass-creation logic, shared by both the single "create a pass" button
  // and the batch generator below — a batch-created pass is not structurally
  // different from a one-off pass, it just skips asking for a customer name
  // upfront (these are printed blank and sold in person).
  async function createOnePass(programId, customerName, soldAmount) {
    const t = randomToken();
    const counterRef = db.collection("counters").doc("passes");
    const passRef = db.collection("passes").doc(t);
    const passNumber = await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const next = counterSnap.exists ? (counterSnap.data().next || 1) : 1;
      tx.set(counterRef, { next: next + 1 }, { merge: true });
      tx.set(passRef, {
        programId, customerName, status: "active", redeemedCount: 0, createdAt: Date.now(),
        passNumber: next,
        soldAmount: soldAmount != null ? soldAmount : null,
        soldAt: soldAmount != null ? Date.now() : null,
      });
      return next;
    });
    return { id: t, passNumber };
  }

  async function markPassSold(passId, amount, customerName) {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed < 0) { showToast("Enter a valid sale amount"); return; }
    const updates = { soldAmount: parsed, soldAt: Date.now() };
    if (customerName && customerName.trim()) updates.customerName = customerName.trim();
    await db.collection("passes").doc(passId).update(updates);
    state.markingSoldId = null;
    showToast("Marked as sold");
  }

  async function editPassSale(passId, amount, customerName) {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed < 0) { showToast("Enter a valid sale amount"); return; }
    // soldAt is deliberately left untouched — a correction shouldn't silently
    // move which reporting period the funds count toward.
    // Recorded quietly, not shown anywhere in the UI — cheap to keep for the rare
    // case you need to check whether/when a number was corrected, without adding
    // visual clutter to every sold pass in the list.
    const updates = { soldAmount: parsed, soldEditedAt: Date.now() };
    if (customerName != null) updates.customerName = customerName.trim();
    await db.collection("passes").doc(passId).update(updates);
    state.markingSoldId = null;
    showToast("Sale updated");
  }

  async function createPasses(programId, customerName, count, soldAmount) {
    if (!programId) { showToast("Choose a campaign first"); return; }
    const n = parseInt(count, 10);
    if (!n || n < 1 || n > 40) { showToast("Enter a number between 1 and 40"); return; }
    const parsedSoldAmount = soldAmount ? parseFloat(soldAmount) : null;

    const program = state.programs.find((p) => p.id === programId);
    const org = state.orgs[0];

    state.batchBusy = true;
    state.batchProgress = "Creating pass" + (n > 1 ? "es" : "") + "… (0 / " + n + ")";
    render();

    const created = [];
    try {
      // Sequential on purpose — these share one counter document, and creating
      // them one at a time keeps pass numbers assigned in a clean, predictable
      // order instead of racing many transactions against each other at once.
      for (let i = 0; i < n; i++) {
        const pass = await createOnePass(programId, customerName || "", parsedSoldAmount);
        created.push(pass);
        state.batchProgress = "Creating passes… (" + (i + 1) + " / " + n + ")";
        render();
      }

      state.batchProgress = "Building PDF…";
      render();

      const baseUrl = window.location.origin + window.location.pathname;
      await PrintCards.generate(org, program, created, baseUrl, formatPassNumber, (done, total) => {
        state.batchProgress = "Building PDF… (" + done + " / " + total + ")";
        render();
      });

      showToast(n + " pass" + (n > 1 ? "es" : "") + " created — PDF downloaded");
    } catch (e) {
      showToast("Something went wrong partway through — " + created.length + " of " + n + " passes were created");
    }
    state.batchBusy = false;
    state.batchProgress = "";
    render();
  }

  async function disablePass(token) {
    if (!confirm("Disable this pass? The customer will no longer be able to redeem any offers on it.")) return;
    await db.collection("passes").doc(token).update({ status: "disabled" });
    showToast("Pass disabled");
  }

  async function enablePass(token) {
    await db.collection("passes").doc(token).update({ status: "active" });
    showToast("Pass re-enabled");
  }

  // Permanent. Only offered on disabled passes. Only the pass itself is deleted —
  // its redemption records are deliberately left alone, because the Firestore rules
  // keep redemptions permanent outside test campaigns (merchants really did honor them).
  async function deletePass(token) {
    const pass = state.passes.find((p) => p.id === token);
    if (!pass || pass.status !== "disabled") { showToast("Only disabled passes can be deleted"); return; }
    if (!confirm("Are you sure you want to delete this pass? It will be gone forever.")) return;
    try {
      await db.collection("passes").doc(token).delete();
      showToast("Pass deleted");
    } catch (e) {
      showToast("Couldn't delete — try again");
    }
  }

  async function resetTestPass(passId) {
    const pass = state.passes.find((p) => p.id === passId);
    const program = pass && state.programs.find((pr) => pr.id === pass.programId);
    if (!program || !program.isTest) { showToast("Reset only works for passes under a test campaign"); return; }
    if (!confirm("Reset this pass? All redemption history on it will be permanently deleted and it will look brand new again — only possible because it's under a test campaign.")) return;

    try {
      const snap = await db.collection("redemptions").where("passToken", "==", passId).get();
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      batch.update(db.collection("passes").doc(passId), { redeemedCount: 0 });
      await batch.commit();
      showToast("Pass reset — ready for a fresh demo");
    } catch (e) {
      showToast("Couldn't reset — try again");
    }
  }

  // ---------- render ----------
  // Any Firestore listener firing (even for unrelated data, e.g. a customer redeeming
  // something live) triggers a full re-render. Without this, whatever the admin is
  // mid-typing in any field gets silently wiped the moment that happens.
  function captureFocus() {
    const el = document.activeElement;
    if (!el || !el.id || !("value" in el)) return null;
    return { id: el.id, value: el.value, start: el.selectionStart, end: el.selectionEnd };
  }
  function restoreFocus(saved) {
    if (!saved) return;
    const el = document.getElementById(saved.id);
    if (!el || !("value" in el)) return;
    el.value = saved.value;
    el.focus();
    if (typeof saved.start === "number" && typeof el.setSelectionRange === "function") {
      try { el.setSelectionRange(saved.start, saved.end); } catch (e) {}
    }
  }

  function render() {
    const savedFocus = captureFocus();
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
      restoreFocus(savedFocus);
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
    restoreFocus(savedFocus);
  }

  function renderTab(org) {
    if (state.tab === "dashboard") {
      const activeMerchants = state.merchants.filter((m) => !m.archived).length;
      // Dashboard is deliberately production-only — test campaigns (and anything
      // tied to them) never count toward these numbers, so what you see here is
      // always safe to screenshot or report without manually excluding test data.
      const liveProgramIds = state.programs.filter((p) => !p.isTest).map((p) => p.id);
      const livePassesCount = state.passes.filter((p) => liveProgramIds.includes(p.programId)).length;
      const liveRedemptionsCount = state.redemptions.filter((r) => {
        const offer = state.offers.find((o) => o.id === r.offerId);
        return offer && liveProgramIds.includes(offer.programId);
      }).length;
      return `
        <div class="stat-grid">
          <div class="stat-card"><div class="label">Passes issued</div><div class="value">${livePassesCount}</div></div>
          <div class="stat-card"><div class="label">Redemptions</div><div class="value">${liveRedemptionsCount}</div></div>
          <div class="stat-card"><div class="label">Active merchants</div><div class="value">${activeMerchants}</div></div>
          <div class="stat-card"><div class="label">Campaigns</div><div class="value">${liveProgramIds.length}</div></div>
        </div>

        <div style="font-size:13px; font-weight:700; margin:20px 0 10px;">Filter by campaign, merchant, or date</div>
        ${renderReportsTab()}`;
    }
    if (state.tab === "passes") return renderPassesTab();
    if (state.tab === "merchants") return renderMerchantsTab(org);
    if (state.tab === "offers") return renderOffersTab();
    if (state.tab === "programs") return renderProgramsTab(org);
    return "";
  }

  // Filters + totals for the report. Runs entirely over data already loaded
  // in memory (no extra Firestore queries) — every redemption's offer tells us
  // its campaign and merchant, so date/campaign/merchant filtering is just a
  // local array filter, and the numbers recompute instantly as filters change.
  function computeReport() {
    const startTs = state.reportStart ? new Date(state.reportStart + "T00:00:00").getTime() : null;
    const endTs = state.reportEnd ? new Date(state.reportEnd + "T23:59:59").getTime() : null;
    // The Dashboard/Reports screen is production-only — test campaigns are excluded
    // here unconditionally, not just when "All campaigns" is selected, so there's
    // no path (including a stale/bad selection) that lets test data slip into a
    // number you might screenshot or send to someone.
    const liveProgramIds = state.programs.filter((p) => !p.isTest).map((p) => p.id);

    const filtered = state.redemptions.filter((r) => {
      const offer = state.offers.find((o) => o.id === r.offerId);
      if (!offer) return false; // orphaned redemption record with no matching offer — excluded rather than guessed at
      if (!liveProgramIds.includes(offer.programId)) return false;
      if (state.reportCampaign && offer.programId !== state.reportCampaign) return false;
      if (state.reportMerchant && offer.merchantId !== state.reportMerchant) return false;
      if (startTs && r.timestamp < startTs) return false;
      if (endTs && r.timestamp > endTs) return false;
      return true;
    });

    let totalSavings = 0, totalRevenue = 0, reportedCount = 0, estimatedCount = 0, unknownCount = 0;
    filtered.forEach((r) => {
      totalSavings += r.discountAmount || 0;
      const offer = state.offers.find((o) => o.id === r.offerId);
      if (r.amountSpent != null) {
        totalRevenue += r.amountSpent;
        reportedCount++;
      } else if (offer && offer.minPurchase != null) {
        totalRevenue += offer.minPurchase;
        estimatedCount++;
      } else {
        unknownCount++;
      }
    });

    // Funds raised (pass sales) — filtered by campaign + the SAME date range, but by
    // when the pass was sold (soldAt), not by redemption activity. A pass sold in
    // January and redeemed in June should count toward January's fundraising total.
    const soldPasses = state.passes.filter((p) => {
      if (p.soldAmount == null) return false;
      if (!liveProgramIds.includes(p.programId)) return false;
      if (state.reportCampaign && p.programId !== state.reportCampaign) return false;
      if (startTs && (!p.soldAt || p.soldAt < startTs)) return false;
      if (endTs && (!p.soldAt || p.soldAt > endTs)) return false;
      return true;
    });
    const totalFundsRaised = soldPasses.reduce((sum, p) => sum + p.soldAmount, 0);
    const unsoldCount = state.passes.filter((p) => p.soldAmount == null && liveProgramIds.includes(p.programId) && (!state.reportCampaign || p.programId === state.reportCampaign)).length;

    // Merchant-specific insight — only meaningful once a merchant is actually selected:
    // of the passes that redeemed something at this merchant (within the filters above),
    // how much fundraising value do they represent? This is soft attribution (a pass can
    // support several merchants), not a revenue split, so it's kept separate from the
    // always-accurate totalFundsRaised above rather than replacing it.
    let merchantInsightFunds = null, merchantInsightPassCount = 0, merchantInsightSoldCount = 0;
    if (state.reportMerchant) {
      const uniquePassIds = [...new Set(filtered.map((r) => r.passToken))];
      merchantInsightPassCount = uniquePassIds.length;
      merchantInsightFunds = 0;
      uniquePassIds.forEach((id) => {
        const pass = state.passes.find((p) => p.id === id);
        if (pass && pass.soldAmount != null) {
          merchantInsightFunds += pass.soldAmount;
          merchantInsightSoldCount++;
        }
      });
    }

    return {
      count: filtered.length, totalSavings, totalRevenue, reportedCount, estimatedCount, unknownCount,
      totalFundsRaised, soldCount: soldPasses.length, unsoldCount,
      merchantInsightFunds, merchantInsightPassCount, merchantInsightSoldCount,
    };
  }

  function renderReportsTab() {
    const campaignOptions = `<option value="">All campaigns</option>` +
      state.programs.filter((p) => !p.isTest).map((p) => `<option value="${p.id}" ${state.reportCampaign === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
    const merchantOptions = `<option value="">All merchants</option>` +
      state.merchants.map((m) => `<option value="${m.id}" ${state.reportMerchant === m.id ? "selected" : ""}>${escapeHtml(m.name)}${m.archived ? " (archived)" : ""}</option>`).join("");

    const r = computeReport();

    return `
      <div class="card">
        <div class="row-flex">
          <select id="report-campaign">${campaignOptions}</select>
          <select id="report-merchant">${merchantOptions}</select>
          <input type="date" id="report-start" value="${state.reportStart || ""}" />
          <span style="font-size:12px; color:var(--muted);">to</span>
          <input type="date" id="report-end" value="${state.reportEnd || ""}" />
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="label">Funds raised</div><div class="value">$${r.totalFundsRaised.toFixed(2)}</div></div>
        <div class="stat-card"><div class="label">Redemptions</div><div class="value">${r.count}</div></div>
        <div class="stat-card"><div class="label">Total savings given</div><div class="value">$${r.totalSavings.toFixed(2)}</div></div>
        <div class="stat-card"><div class="label">Estimated revenue driven</div><div class="value">$${r.totalRevenue.toFixed(2)}</div></div>
      </div>

      <div style="font-size:12px; color:var(--muted); margin-top:12px;">
        Funds raised: ${r.soldCount} pass${r.soldCount === 1 ? "" : "es"} sold in this range, ${r.unsoldCount} still unsold inventory (based on when each pass was <em>sold</em>, not redeemed).
      </div>
      <div style="font-size:12px; color:var(--muted); margin-top:4px;">
        ${r.count === 0
          ? "No redemptions match these filters."
          : `Revenue figure: ${r.reportedCount} redemption${r.reportedCount === 1 ? "" : "s"} with a customer-reported purchase amount, ${r.estimatedCount} estimated from the offer's minimum purchase, ${r.unknownCount} with no amount available either way.`
        }
      </div>

      ${state.reportMerchant ? `
        <div class="banner" style="background:#E9F5EE; color:#1F6538; margin-top:14px;">
          💡 Insight: ${r.merchantInsightPassCount} distinct pass${r.merchantInsightPassCount === 1 ? "" : "es"} redeemed something at this merchant in this range — of those, ${r.merchantInsightSoldCount} were sold, together raising $${r.merchantInsightFunds.toFixed(2)}. (Soft attribution — a pass can support more than one merchant, so this isn't a strict revenue split.)
        </div>
      ` : ""}`;
  }

  function renderPassesTab() {
    const search = (state.passSearch || "").toLowerCase();
    const filtered = state.passes
      .filter((p) => !search || p.customerName.toLowerCase().includes(search) || p.id.toLowerCase().includes(search) || (p.passNumber && formatPassNumber(p.passNumber).toLowerCase().includes(search)))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // newest first

    const rows = filtered.map((p) => {
      const program = state.programs.find((pr) => pr.id === p.programId);
      const used = state.redemptions.filter((r) => r.passToken === p.id).length;
      const passLink = window.location.origin + window.location.pathname + "#/p/" + p.id;
      const sold = p.soldAmount != null;

      if (state.markingSoldId === p.id) {
        return `
          <div class="list-item">
            <div style="width:100%;">
              <div style="font-weight:600; margin-bottom:6px;">${sold ? "Edit sale for" : "Mark"} ${p.passNumber ? escapeHtml(formatPassNumber(p.passNumber)) : "pass"}${sold ? "" : " as sold"}</div>
              <input type="number" step="0.01" min="0" id="mark-sold-amount-${p.id}" placeholder="Sale amount $" value="${p.soldAmount ?? ""}" style="width:140px;" />
              <input id="mark-sold-customer-${p.id}" placeholder="Customer name (optional)" value="${escapeHtml(p.customerName || "")}" style="width:200px;" />
              <button class="primary" data-action="confirm-mark-sold" data-id="${p.id}">${sold ? "Save" : "Confirm"}</button>
              <button data-action="cancel-mark-sold">Cancel</button>
            </div>
          </div>`;
      }

      return `
        <div class="list-item">
          <div style="min-width:140px;">
            <div style="font-weight:600;">${p.passNumber ? escapeHtml(formatPassNumber(p.passNumber)) + " — " : ""}${p.customerName ? escapeHtml(p.customerName) : "(unassigned — printed card)"}</div>
            <div style="font-size:12px; color:var(--muted);">${escapeHtml(program && program.name)} · ${sold ? "Sold " + fmtDate(p.soldAt) : "Printed " + fmtDate(p.createdAt)}</div>
          </div>
          <div class="mono">${passLink}</div>
          <div>${used}${program && program.maxRedemptions ? ` / ${program.maxRedemptions}` : ""} redeemed</div>
          <span class="badge ${sold ? "green" : "grey"}">${sold ? "Sold $" + p.soldAmount.toFixed(2) : "Unsold"}</span>
          <span class="badge ${p.status === "disabled" ? "red" : "green"}">${p.status === "disabled" ? "Disabled" : "Active"}</span>
          <div class="row-flex">
            <a href="${passLink}" target="_blank" rel="noreferrer">View as customer</a>
            <button data-action="copy-link" data-link="${passLink}">Copy link</button>
            <button data-action="start-mark-sold" data-id="${p.id}">${sold ? "Edit sale" : "Mark as sold"}</button>
            ${program && program.isTest ? `<button data-action="reset-test-pass" data-id="${p.id}">Reset</button>` : ""}
            ${p.status !== "disabled"
              ? `<button class="danger" data-action="disable-pass" data-token="${p.id}">Disable</button>`
              : `<button data-action="enable-pass" data-token="${p.id}">Re-enable pass</button>
                 <button class="danger" data-action="delete-pass" data-token="${p.id}">Delete pass</button>`}
          </div>
        </div>`;
    }).join("");

    return `
      <div class="card">
        <div style="font-weight:700; margin-bottom:4px;">Create Passes</div>
        <div style="font-size:12px; color:var(--muted); margin-bottom:10px;">Works for a single customer pass or a whole order at once — creates real, working passes and gives you a print-ready PDF with each one's QR code, ready to email, print, or hand over.</div>
        <select id="create-program">${state.programs.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")}</select>
        <input id="create-customer" placeholder="Customer name (optional)" />
        <input id="create-count" type="number" min="1" max="40" placeholder="How many? (max 40)" style="width:150px;" />
        <input id="create-sold-amount" type="number" step="0.01" min="0" placeholder="Sale amount $ (optional)" style="width:170px;" />
        <div style="font-size:11px; color:var(--muted); margin:6px 0;">Leave sale amount blank for unsold inventory to print now and sell later — mark it sold from the list below once it's actually purchased.</div>
        <button class="primary" data-action="create-passes" ${state.batchBusy ? "disabled" : ""}>${state.batchBusy ? "Working…" : "Create & download PDF"}</button>
        ${state.batchProgress ? `<div style="font-size:13px; color:var(--muted); margin-top:8px;">${escapeHtml(state.batchProgress)}</div>` : ""}
      </div>

      <input id="pass-search" placeholder="Search by pass #, customer name, or token…" value="${escapeHtml(state.passSearch)}" style="margin-bottom:10px; width:100%;" />
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
            <input id="edit-merchant-address-${m.id}" value="${escapeHtml(m.address || "")}" placeholder="Street address (for the map link)" style="margin-bottom:8px; width:100%;" />
            <button class="primary" data-action="save-merchant" data-id="${m.id}">Save</button>
            <button data-action="cancel-edit-merchant">Cancel</button>
          </div>`;
      }
      return `
        <div style="display:inline-flex; align-items:center; gap:8px; border:1px solid var(--line); border-radius:8px; padding:6px 10px; margin-right:8px; margin-bottom:8px;">
          <span style="font-size:12px; font-weight:700;">${escapeHtml(initials(m.name))}</span> ${escapeHtml(m.name)}
          ${m.address ? `<a href="${escapeHtml(mapsUrl(m.address, m.name))}" target="_blank" rel="noreferrer" title="${escapeHtml(m.address)}" style="font-size:12px; text-decoration:none;">📍</a>` : ""}
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
        <input id="merchant-address" placeholder="Street address (for the map link)" style="min-width:240px;" />
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
      const p = state.programs.find((pp) => pp.id === o.programId);
      if (state.editingOfferId === o.id) {
        const merchantOptions = state.merchants.filter((mm) => !mm.archived || mm.id === o.merchantId);
        return `
          <div class="card">
            <div style="font-size:12px; color:var(--muted); margin-bottom:6px;">${p && p.isTest ? `<span class="badge amber">TEST</span> ` : ""}Campaign: ${escapeHtml(p && p.name)}</div>
            <select id="edit-offer-merchant-${o.id}">
              ${merchantOptions.map((mm) => `<option value="${mm.id}" ${mm.id === o.merchantId ? "selected" : ""}>${escapeHtml(mm.name)}</option>`).join("")}
            </select>
            <input type="date" id="edit-offer-expiry-${o.id}" value="${o.expiresAt || ""}" />
            <br/>
            <input id="edit-offer-terms-${o.id}" value="${escapeHtml(o.terms)}" placeholder="Short headline, e.g. $5 off $50+" style="margin-top:8px; width:280px;" />
            <br/>
            <textarea id="edit-offer-description-${o.id}" rows="3" placeholder="Description shown to customers before they redeem (optional)" style="margin-top:8px; width:100%; max-width:420px;">${escapeHtml(o.description || "")}</textarea>
            <br/>
            <textarea id="edit-offer-details-${o.id}" rows="3" placeholder="Fine print (optional) — one point per line" style="margin-top:8px; width:100%; max-width:420px;">${escapeHtml(o.details || "")}</textarea>
            <br/>
            <input type="number" step="0.01" min="0" id="edit-offer-discount-amount-${o.id}" value="${o.discountAmount ?? ""}" placeholder="Discount amount $" style="margin-top:8px; width:140px;" />
            <input type="number" step="0.01" min="0" id="edit-offer-min-purchase-${o.id}" value="${o.minPurchase ?? ""}" placeholder="Min. purchase $ (optional)" style="width:170px;" />
            <div style="margin-top:8px;">
              <button class="primary" data-action="save-offer" data-id="${o.id}">Save</button>
              <button data-action="cancel-edit-offer">Cancel</button>
            </div>
          </div>`;
      }
      return `<div style="font-size:13px; margin-bottom:6px;">
        <span style="color:var(--muted);">[${p && p.isTest ? "TEST · " : ""}${escapeHtml(p && p.name)}]</span>
        ${escapeHtml(m && m.name)} — ${escapeHtml(o.terms)} ${discountLabel(o)} ${o.expiresAt ? `(expires ${o.expiresAt})` : ""} — ${o.active ? "active" : "inactive"}
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
        <input id="offer-terms" placeholder="Short headline, e.g. $5 off $50+" style="margin-top:8px; width:240px;" />
        <br/>
        <textarea id="offer-description" rows="3" placeholder="Description shown to customers before they redeem (optional), e.g. what the offer includes" style="margin-top:8px; width:100%; max-width:420px;"></textarea>
        <br/>
        <textarea id="offer-details" rows="3" placeholder="Fine print (optional) — one point per line, e.g. Dine-in or takeout" style="margin-top:8px; width:100%; max-width:420px;"></textarea>
        <br/>
        <input type="number" step="0.01" min="0" id="offer-discount-amount" placeholder="Discount amount $" style="margin-top:8px; width:140px;" />
        <input type="number" step="0.01" min="0" id="offer-min-purchase" placeholder="Min. purchase $ (optional)" style="width:170px;" />
        <div style="font-size:11px; color:var(--muted); margin-top:6px;">
          E.g. for "$5 off $50+": Discount amount = 5, Minimum purchase = 50. This is the exact dollar amount shown to customers as their savings — no calculation needed.
        </div>
        <button class="primary" data-action="create-offer" style="margin-top:8px;">Add offer</button>
      </div>
      <div class="row-flex" style="margin-bottom:12px;">
        <input id="offer-search" placeholder="Search offers by merchant or terms…" value="${escapeHtml(state.offerSearch)}" style="flex:1; min-width:180px;" />
        <label style="font-size:13px; color:var(--muted); display:flex; align-items:center; gap:6px;">
          <input type="checkbox" id="offer-show-archived" ${state.showArchivedOffers ? "checked" : ""} /> Show archived
        </label>
      </div>
      ${rows || `<div style="font-size:13px; color:var(--muted);">${state.showArchivedOffers ? "No archived offers." : "No offers match."}</div>`}`;
  }

  function discountLabel(o) {
    if (o.discountAmount == null) return "(discount amount not set)";
    return o.minPurchase != null ? `($${o.discountAmount} off $${o.minPurchase}+)` : `($${o.discountAmount} off)`;
  }

  function renderProgramsTab(org) {
    const rows = state.programs.map((p) => {
      if (state.editingProgramId === p.id) {
        return `
          <div class="card">
            <input id="edit-program-name-${p.id}" value="${escapeHtml(p.name)}" />
            <input id="edit-program-cap-${p.id}" type="number" value="${p.maxRedemptions ?? ""}" placeholder="no cap" style="width:120px;" />
            <input id="edit-program-expiry-${p.id}" type="date" value="${p.expiresAt || ""}" />
            <br/>
            <input id="edit-program-tagline-${p.id}" value="${escapeHtml(p.tagline || "")}" placeholder="Tagline for printed cards (optional)" style="margin-top:8px; width:320px;" />
            <br/>
            <input id="edit-program-zeffy-${p.id}" value="${escapeHtml(p.zeffyLink || "")}" placeholder="Zeffy checkout link (optional)" style="margin-top:8px; width:400px;" />
            <br/>
            <input id="edit-program-video-${p.id}" value="${escapeHtml(p.videoUrl || "")}" placeholder="Demo video URL — YouTube (optional)" style="margin-top:8px; width:400px;" />
            <br/>
            <input id="edit-program-map-${p.id}" value="${escapeHtml(p.mapUrl || "")}" placeholder="Partner map: paste the Google My Maps embed code or link (optional)" style="margin-top:8px; width:400px;" />
            <br/>
            <label style="font-size:13px; display:flex; align-items:center; gap:6px; margin-top:8px;">
              <input type="checkbox" id="edit-program-istest-${p.id}" ${p.isTest ? "checked" : ""} /> Test campaign (hidden from the public landing page)
            </label>
            <div style="margin-top:8px;">
              <button class="primary" data-action="save-program" data-id="${p.id}">Save</button>
              <button data-action="cancel-edit-program">Cancel</button>
            </div>
          </div>`;
      }
      return `
        <div style="font-size:13px; margin-bottom:6px;">
          ${p.isTest ? `<span class="badge amber">TEST</span> ` : ""}${escapeHtml(p.name)} — cap: ${p.maxRedemptions ?? "none"} — expires: ${p.expiresAt || "never"}${p.tagline ? ` — "${escapeHtml(p.tagline)}"` : ""}${p.zeffyLink ? ` — <a href="${escapeHtml(p.zeffyLink)}" target="_blank" rel="noreferrer">Zeffy link ✓</a>` : " — no Zeffy link set"}${p.videoUrl ? ` — video ✓` : ""} ${p.mapUrl ? ` — map ✓` : ""}
          <button data-action="edit-program" data-id="${p.id}">Edit</button>
        </div>`;
    }).join("");
    return `
      <div class="card">
        <input id="program-name" placeholder="Campaign name" />
        <input id="program-cap" type="number" placeholder="Redemption cap" value="5" style="width:120px;" />
        <input id="program-expiry" type="date" />
        <br/>
        <input id="program-tagline" placeholder="Tagline for printed cards (optional)" style="margin-top:8px; width:320px;" />
        <br/>
        <input id="program-zeffy" placeholder="Zeffy checkout link (optional)" style="margin-top:8px; width:400px;" />
        <br/>
        <input id="program-video" placeholder="Demo video URL — YouTube (optional)" style="margin-top:8px; width:400px;" />
        <br/>
        <input id="program-map" placeholder="Partner map: paste the Google My Maps embed code or link (optional)" style="margin-top:8px; width:400px;" />
        <br/>
        <label style="font-size:13px; display:flex; align-items:center; gap:6px; margin-top:8px;">
          <input type="checkbox" id="program-is-test" /> Test campaign (hidden from the public landing page)
        </label>
        <button class="primary" data-action="create-program" data-org="${org.id}" style="margin-top:8px;">Create campaign</button>
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

    // --- reports ---
    const reportCampaignSelect = app.querySelector("#report-campaign");
    if (reportCampaignSelect) reportCampaignSelect.addEventListener("change", () => { state.reportCampaign = reportCampaignSelect.value; render(); });
    const reportMerchantSelect = app.querySelector("#report-merchant");
    if (reportMerchantSelect) reportMerchantSelect.addEventListener("change", () => { state.reportMerchant = reportMerchantSelect.value; render(); });
    const reportStartInput = app.querySelector("#report-start");
    if (reportStartInput) reportStartInput.addEventListener("change", () => { state.reportStart = reportStartInput.value; render(); });
    const reportEndInput = app.querySelector("#report-end");
    if (reportEndInput) reportEndInput.addEventListener("change", () => { state.reportEnd = reportEndInput.value; render(); });

    // --- passes ---
    const createPassesBtn = app.querySelector('[data-action="create-passes"]');
    if (createPassesBtn) createPassesBtn.addEventListener("click", () => {
      const programId = document.getElementById("create-program").value;
      const customerName = document.getElementById("create-customer").value.trim();
      const count = document.getElementById("create-count").value;
      const soldAmount = document.getElementById("create-sold-amount").value;
      createPasses(programId, customerName, count, soldAmount);
    });
    app.querySelectorAll('[data-action="disable-pass"]').forEach((el) => {
      el.addEventListener("click", () => disablePass(el.dataset.token));
    });
    app.querySelectorAll('[data-action="enable-pass"]').forEach((el) => {
      el.addEventListener("click", () => enablePass(el.dataset.token));
    });
    app.querySelectorAll('[data-action="delete-pass"]').forEach((el) => {
      el.addEventListener("click", () => deletePass(el.dataset.token));
    });
    app.querySelectorAll('[data-action="copy-link"]').forEach((el) => {
      el.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(el.dataset.link);
          showToast("Link copied");
        } catch (e) {
          showToast("Couldn't copy — select and copy the link manually");
        }
      });
    });
    app.querySelectorAll('[data-action="reset-test-pass"]').forEach((el) => {
      el.addEventListener("click", () => resetTestPass(el.dataset.id));
    });
    app.querySelectorAll('[data-action="start-mark-sold"]').forEach((el) => {
      el.addEventListener("click", () => { state.markingSoldId = el.dataset.id; render(); });
    });
    app.querySelectorAll('[data-action="cancel-mark-sold"]').forEach((el) => {
      el.addEventListener("click", () => { state.markingSoldId = null; render(); });
    });
    app.querySelectorAll('[data-action="confirm-mark-sold"]').forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.id;
        const amount = document.getElementById(`mark-sold-amount-${id}`).value;
        const customerName = document.getElementById(`mark-sold-customer-${id}`).value;
        const pass = state.passes.find((p) => p.id === id);
        if (pass && pass.soldAmount != null) {
          editPassSale(id, amount, customerName);
        } else {
          markPassSold(id, amount, customerName);
        }
      });
    });
    const passSearchInput = app.querySelector("#pass-search");
    if (passSearchInput) passSearchInput.addEventListener("input", () => { state.passSearch = passSearchInput.value; render(); });

    // --- merchants ---
    const createMerchantBtn = app.querySelector('[data-action="create-merchant"]');
    if (createMerchantBtn) createMerchantBtn.addEventListener("click", () => {
      const input = document.getElementById("merchant-name");
      const addressInput = document.getElementById("merchant-address");
      if (input.value.trim()) {
        createMerchant(createMerchantBtn.dataset.org, input.value.trim(), addressInput.value.trim());
        input.value = ""; addressInput.value = "";
      }
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
        const addr = document.getElementById(`edit-merchant-address-${id}`).value.trim();
        if (val) updateMerchant(id, val, addr);
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
      const discountAmount = document.getElementById("offer-discount-amount").value;
      const minPurchase = document.getElementById("offer-min-purchase").value;
      const termsInput = document.getElementById("offer-terms");
      const detailsInput = document.getElementById("offer-details");
      const descriptionInput = document.getElementById("offer-description");
      if (termsInput.value.trim()) {
        createOffer(programId, merchantId, termsInput.value.trim(), exp, discountAmount, minPurchase, detailsInput.value.trim(), descriptionInput.value.trim());
        termsInput.value = ""; detailsInput.value = ""; descriptionInput.value = "";
      }
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
        const discountAmount = document.getElementById(`edit-offer-discount-amount-${id}`).value;
        const minPurchase = document.getElementById(`edit-offer-min-purchase-${id}`).value;
        const terms = document.getElementById(`edit-offer-terms-${id}`).value.trim();
        const details = document.getElementById(`edit-offer-details-${id}`).value.trim();
        const description = document.getElementById(`edit-offer-description-${id}`).value.trim();
        if (terms) updateOffer(id, merchantId, terms, exp, discountAmount, minPurchase, details, description);
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
      const tagline = document.getElementById("program-tagline").value.trim();
      const zeffyLink = document.getElementById("program-zeffy").value.trim();
      const videoUrl = document.getElementById("program-video").value.trim();
      const mapInput = document.getElementById("program-map").value.trim();
      const mapUrl = mapInput ? myMapsEmbedUrl(mapInput) : "";
      if (mapInput && !mapUrl) { showToast("Couldn't find a map in that link \u2014 paste the My Maps embed code or link"); return; }
      const isTest = document.getElementById("program-is-test").checked;
      if (nameInput.value.trim()) { createProgram(createProgramBtn.dataset.org, nameInput.value.trim(), cap, exp, tagline, zeffyLink, isTest, videoUrl, mapUrl); nameInput.value = ""; }
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
        const tagline = document.getElementById(`edit-program-tagline-${id}`).value.trim();
        const zeffyLink = document.getElementById(`edit-program-zeffy-${id}`).value.trim();
        const videoUrl = document.getElementById(`edit-program-video-${id}`).value.trim();
        const mapInput = document.getElementById(`edit-program-map-${id}`).value.trim();
        const mapUrl = mapInput ? myMapsEmbedUrl(mapInput) : "";
        if (mapInput && !mapUrl) { showToast("Couldn't find a map in that link \u2014 paste the My Maps embed code or link"); return; }
        const isTest = document.getElementById(`edit-program-istest-${id}`).checked;
        if (name) updateProgram(id, name, cap, exp, tagline, zeffyLink, isTest, videoUrl, mapUrl);
      });
    });
  }

  return { initLogin, initDashboard };
})();
