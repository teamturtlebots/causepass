// ================= CUSTOMER VIEW =================
// Renders into #app. Called by app.js when the URL hash is "#/p/TOKEN".

const CustomerView = (function () {
  let state = {};
  let unsubscribers = [];
  let tickTimer = null;

  function resetState(token) {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    if (tickTimer) clearInterval(tickTimer);
    state = {
      token,
      pass: undefined, // undefined = loading, null = not found
      program: null,
      org: null,
      offers: [],
      merchants: {},
      offerDetails: {}, // cache for offers referenced by past redemptions but no longer in the active offers list (e.g. archived since)
      redemptions: [],
      confirmOffer: null,
      liveOffer: null,
      error: "",
      amountSavedError: "",
      now: Date.now(),
    };
  }

  function init(token) {
    resetState(token);
    render();

    tickTimer = setInterval(() => {
      state.now = Date.now();
      if (state.liveOffer) render(); // only need to re-render every second while the countdown is showing
    }, 1000);

    const passUnsub = db.collection("passes").doc(token).onSnapshot((snap) => {
      if (!snap.exists) {
        state.pass = null;
        render();
        return;
      }
      state.pass = { id: snap.id, ...snap.data() };
      loadProgramAndDownstream(state.pass.programId);
      render();
    });
    unsubscribers.push(passUnsub);

    const redemptionsUnsub = db.collection("redemptions").where("passToken", "==", token)
      .onSnapshot((snap) => {
        state.redemptions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        ensureHistoryDetails();
        render();
      });
    unsubscribers.push(redemptionsUnsub);
  }

  // Makes sure every redemption in the history has a merchant name + offer terms to show,
  // even if that offer has since been deactivated or archived (and so dropped out of state.offers).
  function ensureHistoryDetails() {
    const missing = state.redemptions
      .map((r) => r.offerId)
      .filter((offerId) => !state.offers.some((o) => o.id === offerId) && !state.offerDetails[offerId]);
    const uniqueMissing = [...new Set(missing)];
    if (uniqueMissing.length === 0) return;

    Promise.all(uniqueMissing.map((offerId) =>
      db.collection("offers").doc(offerId).get().then((snap) => {
        if (!snap.exists) return null;
        const offerData = { id: snap.id, ...snap.data() };
        state.offerDetails[offerId] = offerData;
        if (!state.merchants[offerData.merchantId]) {
          return db.collection("merchants").doc(offerData.merchantId).get().then((mSnap) => {
            state.merchants[offerData.merchantId] = mSnap.exists ? mSnap.data() : { name: "Unknown merchant" };
          });
        }
      })
    )).then(() => render());
  }

  function getOfferInfo(offerId) {
    return state.offers.find((o) => o.id === offerId) || state.offerDetails[offerId] || null;
  }

  function loadProgramAndDownstream(programId) {
    if (state.program && state.program.id === programId) return; // already loaded
    db.collection("programs").doc(programId).get().then((snap) => {
      if (!snap.exists) return;
      state.program = { id: snap.id, ...snap.data() };
      db.collection("organizations").doc(state.program.orgId).get().then((oSnap) => {
        if (oSnap.exists) state.org = oSnap.data();
        render();
      });

      const offersUnsub = db.collection("offers")
        .where("programId", "==", programId)
        .where("active", "==", true)
        .onSnapshot((snap) => {
          state.offers = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((o) => !o.archived); // archived offers stay out of the customer view even if still "active"
          const merchantIds = [...new Set(state.offers.map((o) => o.merchantId))];
          Promise.all(merchantIds.map((id) =>
            db.collection("merchants").doc(id).get().then((mSnap) => [id, mSnap.exists ? mSnap.data() : { name: "Unknown" }])
          )).then((entries) => {
            state.merchants = Object.fromEntries(entries);
            render();
          });
          render();
        });
      unsubscribers.push(offersUnsub);
      render();
    });
  }

  async function attemptRedeem(offerId) {
    state.error = "";
    const offer = state.offers.find((o) => o.id === offerId);
    const token = state.token;
    const redemptionId = `${token}_${offerId}`;
    const passRef = db.collection("passes").doc(token);
    const redemptionRef = db.collection("redemptions").doc(redemptionId);

    try {
      const result = await db.runTransaction(async (tx) => {
        const passSnap = await tx.get(passRef);
        const redemptionSnap = await tx.get(redemptionRef);
        if (!passSnap.exists) throw new Error("Pass not found.");
        const passData = passSnap.data();

        if (redemptionSnap.exists) {
          return { alreadyRedeemed: true, ts: redemptionSnap.data().timestamp };
        }
        if (passData.status === "disabled") throw new Error("This pass has been disabled.");
        if (state.program && state.program.maxRedemptions && passData.redeemedCount >= state.program.maxRedemptions) {
          throw new Error("Redemption limit reached for this pass.");
        }

        const ts = Date.now();
        tx.set(redemptionRef, { passToken: token, offerId, timestamp: ts });
        tx.update(passRef, { redeemedCount: (passData.redeemedCount || 0) + 1 });
        return { alreadyRedeemed: false, ts };
      });
      state.liveOffer = { offer, ts: result.ts, alreadyRedeemed: result.alreadyRedeemed };
      state.confirmOffer = null;
    } catch (e) {
      state.error = e.message || "Couldn't redeem this offer.";
      state.confirmOffer = null;
    }
    render();
  }

  function render() {
    const app = document.getElementById("app");

    if (state.pass === undefined) {
      app.innerHTML = `<div class="centered">Loading your pass…</div>`;
      return;
    }
    if (state.pass === null) {
      app.innerHTML = `<div class="centered">We couldn't find this pass. Check the link and try again.</div>`;
      return;
    }
    if (!state.program) {
      app.innerHTML = `<div class="centered">Loading…</div>`;
      return;
    }

    const used = state.pass.redeemedCount || 0;
    const cap = state.program.maxRedemptions;
    const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
    const expired = state.program.expiresAt && new Date(state.program.expiresAt).getTime() < state.now;
    const capped = cap && used >= cap;

    const offersHtml = state.offers.map((offer) => {
      const merchant = state.merchants[offer.merchantId];
      const redemption = state.redemptions.find((r) => r.offerId === offer.id);
      const redeemed = !!redemption;
      const offerExpired = offer.expiresAt && new Date(offer.expiresAt).getTime() < state.now;
      const disabled = redeemed || offerExpired || expired || capped || state.pass.status === "disabled";
      return `
        <div class="offer-card ${redeemed ? "redeemed" : ""}">
          <div class="offer-row">
            <div class="offer-left">
              <div class="avatar">${escapeHtml(initials(merchant && merchant.name))}</div>
              <div>
                <div style="font-weight:700;">${escapeHtml(merchant && merchant.name)}</div>
                <div style="font-size:13px; color:var(--muted);">${escapeHtml(offer.terms)}</div>
              </div>
            </div>
            <span class="badge ${redeemed ? "grey" : "green"}">${redeemed ? "Redeemed" : "Available"}</span>
          </div>
          ${redeemed
            ? `<div style="font-size:11px; color:var(--muted); margin-top:8px;">
                 ✓ ${fmtDate(redemption.timestamp)}${redemption.amountSaved != null ? ` · $${redemption.amountSaved.toFixed(2)} saved` : ""}
               </div>
               ${redemption.amountSaved == null
                 ? `<button style="margin-top:8px; font-size:12px; padding:6px 10px;" data-action="reopen-amount" data-offer-id="${offer.id}">Add how much you saved</button>`
                 : ""
               }`
            : `<button class="primary" style="width:100%; margin-top:10px;" ${disabled ? "disabled" : ""} data-action="confirm-offer" data-offer-id="${offer.id}">Redeem this offer</button>`
          }
        </div>`;
    }).join("");

    app.innerHTML = `
      <div class="customer-wrap">
        <div class="customer-inner">
          <div style="text-align:center; margin-bottom:18px;">
            <div class="display" style="font-size:20px;">${escapeHtml(state.org && state.org.name)} ${escapeHtml(state.program.name)}</div>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;">Powered by CausePass</div>
          </div>

          <div class="pass-hero">
            <div style="font-size:11px; color:#9DBBDD; text-transform:uppercase;">Supporting</div>
            <div style="font-size:16px; font-weight:700;">${escapeHtml(state.org && state.org.cause)}</div>
            ${cap ? `
              <div style="font-size:12px; color:#9DBBDD; margin-top:10px;">${used} of ${cap} offers redeemed</div>
              <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;"></div></div>
            ` : `
              <div style="font-size:12px; color:#9DBBDD; margin-top:10px;">${used} offer${used === 1 ? "" : "s"} redeemed</div>
            `}
            ${renderSavedAmount()}
          </div>

          ${expired ? `<div class="banner red">This pass's campaign has expired.</div>` : ""}
          ${state.pass.status === "disabled" ? `<div class="banner red">This pass has been disabled.</div>` : ""}
          ${capped && !expired ? `<div class="banner amber">Redemption limit reached — get a new pass to keep saving.</div>` : ""}
          ${state.error ? `<div class="banner red">${escapeHtml(state.error)}</div>` : ""}

          <div style="font-size:12px; color:var(--muted); margin:0 2px 8px;">Participating businesses</div>
          ${offersHtml}

          ${renderHistorySection()}
        </div>
      </div>

      ${state.confirmOffer ? `
        <div class="modal-backdrop">
          <div class="modal">
            <div style="font-weight:700; font-size:18px; margin-bottom:8px;">Ready to redeem?</div>
            <div style="font-size:13px; color:var(--muted); margin-bottom:16px;">
              Only redeem this offer when you're at the business and ready to pay. This offer can only be used once.
            </div>
            <button data-action="cancel-confirm" style="margin-right:8px;">Cancel</button>
            <button class="primary" data-action="do-redeem">Redeem now</button>
          </div>
        </div>
      ` : ""}

      ${state.liveOffer ? renderLiveValidation() : ""}
    `;

    wireEvents();
  }

  async function submitAmountSaved(offerId, value) {
    const amount = parseFloat(value);
    if (isNaN(amount) || amount < 0) {
      state.amountSavedError = "Enter a valid amount.";
      render();
      return;
    }
    const redemptionId = `${state.token}_${offerId}`;
    try {
      await db.collection("redemptions").doc(redemptionId).update({ amountSaved: amount });
      state.amountSavedError = "";
    } catch (e) {
      state.amountSavedError = "Couldn't save that — try again.";
    }
    render();
  }

  function renderLiveValidation() {
    const lo = state.liveOffer;
    const merchant = state.merchants[lo.offer.merchantId];
    const remaining = Math.max(0, 300000 - (state.now - lo.ts));
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const live = remaining > 0 && !lo.alreadyRedeemed;
    const redemption = state.redemptions.find((r) => r.offerId === lo.offer.id);
    const amountSaved = redemption && redemption.amountSaved;

    return `
      <div class="modal-backdrop">
        <div class="modal dark">
          <div style="font-size:19px; font-weight:700; color:#EAF3DE; margin-bottom:10px;">
            ${lo.alreadyRedeemed ? "Already redeemed" : "Valid redemption"}
          </div>
          <div style="font-weight:700;">${escapeHtml(merchant && merchant.name)}</div>
          <div style="font-size:13px; color:#C0DD97;">${escapeHtml(lo.offer.terms)}</div>
          <div style="font-size:12px; color:#97C459; margin-bottom:16px;">${fmtDate(lo.ts)}</div>
          ${live
            ? `<div style="font-size:11px; background:rgba(255,255,255,0.1); display:inline-block; padding:5px 12px; border-radius:20px;">Live verification · ${mins}:${String(secs).padStart(2, "0")} remaining</div>`
            : `<div style="font-size:11px; color:#97C459;">Live window closed</div>`
          }

          <div style="margin-top:16px; padding-top:16px; border-top:1px solid rgba(255,255,255,0.14);">
            ${amountSaved != null
              ? `<div style="font-size:14px; color:#8FE0AA; font-weight:700;">You saved $${amountSaved.toFixed(2)}</div>`
              : `
                <div style="font-size:12px; color:#C0DD97; margin-bottom:8px;">How much did you save?</div>
                <div class="row-flex" style="justify-content:center;">
                  <input type="number" step="0.01" min="0" id="amount-saved-input" placeholder="$" style="width:100px;" />
                  <button class="primary" data-action="submit-amount" data-offer-id="${lo.offer.id}">Save</button>
                </div>
                ${state.amountSavedError ? `<div style="font-size:12px; color:#F4A9A9; margin-top:6px;">${escapeHtml(state.amountSavedError)}</div>` : ""}
              `
            }
          </div>

          <div style="margin-top:16px;"><button data-action="close-live">Close</button></div>
        </div>
      </div>`;
  }

  function renderSavedAmount() {
    const withAmount = state.redemptions.filter((r) => r.amountSaved != null);
    if (withAmount.length === 0) return "";
    const total = withAmount.reduce((sum, r) => sum + r.amountSaved, 0);
    const hasUnentered = state.redemptions.length > withAmount.length;
    return `
      <div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.14);">
        <div style="font-size:11px; color:#9DBBDD;">You've saved</div>
        <div style="font-size:20px; font-weight:700; color:#8FE0AA;">$${total.toFixed(2)}${hasUnentered ? "+" : ""}</div>
      </div>`;
  }

  function renderHistorySection() {
    if (state.redemptions.length === 0) return "";
    const sorted = [...state.redemptions].sort((a, b) => b.timestamp - a.timestamp);
    const rows = sorted.map((r) => {
      const offer = getOfferInfo(r.offerId);
      const merchant = offer ? state.merchants[offer.merchantId] : null;
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-top:1px solid var(--line);">
          <div>
            <div style="font-size:13px; font-weight:600;">${escapeHtml(merchant ? merchant.name : "Unknown merchant")}</div>
            <div style="font-size:12px; color:var(--muted);">${escapeHtml(offer ? offer.terms : "")}</div>
          </div>
          <div style="font-size:11px; color:var(--muted); text-align:right;">
            ✓ ${fmtDate(r.timestamp)}
            ${r.amountSaved != null ? `<div style="color:#8FE0AA; font-weight:600;">$${r.amountSaved.toFixed(2)} saved</div>` : ""}
          </div>
        </div>`;
    }).join("");

    return `
      <div style="margin-top:22px;">
        <div style="font-size:12px; color:var(--muted); margin:0 2px 8px;">Redemption history</div>
        <div class="card" style="padding:4px 14px;">${rows}</div>
      </div>`;
  }

  function wireEvents() {
    const app = document.getElementById("app");
    app.querySelectorAll('[data-action="confirm-offer"]').forEach((el) => {
      el.addEventListener("click", () => {
        state.confirmOffer = state.offers.find((o) => o.id === el.dataset.offerId);
        render();
      });
    });
    app.querySelectorAll('[data-action="reopen-amount"]').forEach((el) => {
      el.addEventListener("click", () => {
        const offerId = el.dataset.offerId;
        const offer = state.offers.find((o) => o.id === offerId) || getOfferInfo(offerId);
        const redemption = state.redemptions.find((r) => r.offerId === offerId);
        state.liveOffer = { offer, ts: redemption.timestamp, alreadyRedeemed: true };
        render();
      });
    });
    const cancelBtn = app.querySelector('[data-action="cancel-confirm"]');
    if (cancelBtn) cancelBtn.addEventListener("click", () => { state.confirmOffer = null; render(); });
    const doRedeemBtn = app.querySelector('[data-action="do-redeem"]');
    if (doRedeemBtn) doRedeemBtn.addEventListener("click", () => attemptRedeem(state.confirmOffer.id));
    const closeLiveBtn = app.querySelector('[data-action="close-live"]');
    if (closeLiveBtn) closeLiveBtn.addEventListener("click", () => { state.liveOffer = null; state.amountSavedError = ""; render(); });
    const submitAmountBtn = app.querySelector('[data-action="submit-amount"]');
    if (submitAmountBtn) submitAmountBtn.addEventListener("click", () => {
      const val = document.getElementById("amount-saved-input").value;
      submitAmountSaved(submitAmountBtn.dataset.offerId, val);
    });
  }

  return { init };
})();
