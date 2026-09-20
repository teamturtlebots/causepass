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
      instructionsOpen: false,
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
      updateLiveCountdown(); // updates just the countdown text, not the whole modal — typing in the amount field stays intact
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
          const existing = redemptionSnap.data();
          return { alreadyRedeemed: true, ts: existing.timestamp, discountAmount: existing.discountAmount != null ? existing.discountAmount : null };
        }
        if (passData.status === "disabled") throw new Error("This pass has been disabled.");
        if (state.program && state.program.maxRedemptions && passData.redeemedCount >= state.program.maxRedemptions) {
          throw new Error("Redemption limit reached for this pass.");
        }

        const ts = Date.now();
        // discountAmount is a fixed, known property of the offer — recording it here
        // means "you saved $X" is correct immediately, with zero dependency on the
        // customer typing anything. The optional purchase-total field below is purely
        // a separate, later add-on for merchant-impact reporting.
        tx.set(redemptionRef, { passToken: token, offerId, timestamp: ts, discountAmount: offer.discountAmount != null ? offer.discountAmount : null });
        tx.update(passRef, { redeemedCount: (passData.redeemedCount || 0) + 1 });
        return { alreadyRedeemed: false, ts, discountAmount: offer.discountAmount != null ? offer.discountAmount : null };
      });
      state.liveOffer = { offer, ts: result.ts, alreadyRedeemed: result.alreadyRedeemed, discountAmount: result.discountAmount };
      state.confirmOffer = null;
      state.amountSavedDraft = "";
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
          <div class="offer-row ${disabled || redeemed ? "" : "tappable"}" ${disabled || redeemed ? "" : `data-action="confirm-offer" data-offer-id="${offer.id}"`}>
            <div class="offer-left">
              <div class="avatar">${escapeHtml(initials(merchant && merchant.name))}</div>
              <div>
                <div class="offer-merchant">${escapeHtml(merchant && merchant.name)}</div>
                <div class="offer-savings">${escapeHtml(offer.terms)}</div>
              </div>
            </div>
            <span class="badge ${redeemed ? "grey" : "green"}">${redeemed ? "Redeemed" : "Available"}</span>
          </div>
          ${redeemed
            ? `<div style="font-size:11px; color:var(--muted); margin-top:8px;">
                 ✓ ${fmtDate(redemption.timestamp)}${redemption.discountAmount != null ? ` · $${redemption.discountAmount.toFixed(2)} saved` : ""}
               </div>
               ${redemption.amountSpent == null
                 ? `<button style="margin-top:8px; font-size:12px; padding:6px 10px;" data-action="reopen-amount" data-offer-id="${offer.id}">Add purchase total (optional)</button>`
                 : ""
               }`
            : `<button style="width:100%; margin-top:10px;" ${disabled ? "disabled" : ""} data-action="confirm-offer" data-offer-id="${offer.id}">View details</button>`
          }
        </div>`;
    }).join("");

    app.innerHTML = `
      <div class="customer-wrap">
        <div class="customer-inner">
          <div style="text-align:center; margin-bottom:18px;">
            <div class="display" style="font-size:20px;">${escapeHtml(state.org && state.org.name)} ${escapeHtml(state.program.name)}</div>
            <div style="font-size:12px; color:var(--muted); margin-top:2px;">Powered by CausePass${state.pass.passNumber ? ` · Pass ${escapeHtml(formatPassNumber(state.pass.passNumber))}` : ""}</div>
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

          ${renderInstructions(cap)}

          ${expired ? `<div class="banner red">This pass's campaign has expired.</div>` : ""}
          ${state.pass.status === "disabled" ? `<div class="banner red">This pass has been disabled.</div>` : ""}
          ${capped && !expired ? `<div class="banner amber">Redemption limit reached — get a new pass to keep saving.</div>` : ""}
          ${state.error ? `<div class="banner red">${escapeHtml(state.error)}</div>` : ""}

          <div style="font-size:12px; color:var(--muted); margin:0 2px 8px;">Participating businesses</div>
          ${offersHtml}

          ${renderHistorySection()}
        </div>
      </div>

      ${state.confirmOffer ? renderOfferSheet(state.confirmOffer) : ""}

      ${state.liveOffer ? renderLiveValidation() : ""}
    `;

    wireEvents();
  }

  // Money like "$50" or "$5.01" (no needless ".00").
  function fmtMoneyShort(n) {
    return "$" + (Number.isInteger(n) ? n : n.toFixed(2));
  }

  // "2026-12-31" -> "Dec 31, 2026" without timezone shifting the day.
  function fmtOfferDate(str) {
    const [y, m, d] = String(str).split("-").map(Number);
    if (!y || !m || !d) return str;
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  // The fine-print lines for an offer: built from fields the admin already fills in
  // (minimum purchase, expiry) plus the optional free-text "details" (one line per point).
  function offerDetailLines(offer) {
    const lines = [];
    if (offer.minPurchase != null && offer.minPurchase > 0) lines.push(`Minimum purchase: ${fmtMoneyShort(offer.minPurchase)} (before tax)`);
    lines.push("One-time use");
    if (offer.expiresAt) lines.push(`Valid through ${fmtOfferDate(offer.expiresAt)}`);
    String(offer.details || "").split("\n").map((l) => l.trim()).filter(Boolean).forEach((l) => lines.push(l));
    return lines;
  }

  // One pop-up that is both the offer details and the "are you sure?" step, so redeeming
  // is still two taps: Redeem (on the card) -> Redeem now (here).
  function renderOfferSheet(offer) {
    const merchant = state.merchants[offer.merchantId];
    const lines = offerDetailLines(offer).map((l) => `<li>${escapeHtml(l)}</li>`).join("");
    const location = directionsLinkHtml(merchant);
    return `
      <div class="modal-backdrop">
        <div class="modal sheet">
          <div style="font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">Ready to redeem?</div>
          <div style="font-weight:700; font-size:20px; margin-top:6px; line-height:1.25;">${escapeHtml(merchant && merchant.name)}</div>
          <div class="sheet-savings">${escapeHtml(offer.terms)}</div>
          <ul class="sheet-lines">${lines}</ul>
          ${location ? `<div style="margin-top:12px;">${location}</div>` : ""}
          <div class="sheet-warning">Only redeem this offer when you're at the business and ready to pay. It can only be used once.</div>
          <div style="display:flex; gap:8px;">
            <button data-action="cancel-confirm" style="flex:1;">Cancel</button>
            <button class="primary" data-action="do-redeem" style="flex:2;">Redeem now</button>
          </div>
        </div>
      </div>`;
  }

  async function submitSpend(offerId, spendStr) {
    const trimmed = (spendStr || "").trim();
    if (trimmed === "") {
      // Optional field — leaving it blank is a completely normal, valid choice. Nothing to save, nothing to error on.
      state.amountSavedError = "";
      render();
      return;
    }
    const spend = parseFloat(trimmed);
    if (isNaN(spend) || spend < 0) {
      state.amountSavedError = "Enter a valid amount.";
      render();
      return;
    }
    const redemptionId = `${state.token}_${offerId}`;
    try {
      await db.collection("redemptions").doc(redemptionId).update({ amountSpent: spend });
      state.amountSavedError = "";
    } catch (e) {
      state.amountSavedError = "Couldn't save that — try again.";
    }
    render();
  }

  function updateLiveCountdown() {
    if (!state.liveOffer) return;
    const el = document.getElementById("live-timer-chip");
    if (!el) return; // modal isn't open right now, nothing to update
    const lo = state.liveOffer;
    const remaining = Math.max(0, 300000 - (state.now - lo.ts));
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const live = remaining > 0 && !lo.alreadyRedeemed;
    el.outerHTML = live
      ? `<div id="live-timer-chip" style="font-size:11px; background:rgba(255,255,255,0.1); display:inline-block; padding:5px 12px; border-radius:20px;">Live verification · ${mins}:${String(secs).padStart(2, "0")} remaining</div>`
      : `<div id="live-timer-chip" style="font-size:11px; color:#97C459;">Live window closed</div>`;
  }

  function renderInstructions(cap) {
    const open = state.instructionsOpen;
    return `
      <div style="margin-bottom:16px; border:1px solid var(--line); border-radius:12px; overflow:hidden;">
        <button data-action="toggle-instructions" style="width:100%; text-align:left; background:#fff; border:none; border-radius:0; padding:10px 12px; font-size:13px; font-weight:600; display:flex; justify-content:space-between; align-items:center;">
          <span>ℹ️ How to use this pass</span>
          <span style="color:var(--muted);">${open ? "▲" : "▼"}</span>
        </button>
        ${open ? `
          <div style="padding:0 14px 14px; font-size:13px; color:var(--ink); line-height:1.6;">
            <ol style="margin:0; padding-left:18px;">
              <li>Browse the offers below, and pick one when you're ready to pay</li>
              <li>When you're at the counter, tap <strong>View details</strong>, then <strong>Redeem now</strong></li>
              <li>Show the green <strong>Valid redemption</strong> screen to the cashier</li>
              <li>No app, no login, nothing to install — this page is your pass</li>
            </ol>
            ${cap
              ? `<div style="margin-top:10px; font-size:12px; color:var(--muted);">You can redeem up to <strong>${cap}</strong> offers total on this pass. Once you reach that, this pass is done — grab a new one to keep saving.</div>`
              : ""
            }
          </div>
        ` : ""}
      </div>`;
  }

  function renderLiveValidation() {
    const lo = state.liveOffer;
    const merchant = state.merchants[lo.offer.merchantId];
    const remaining = Math.max(0, 300000 - (state.now - lo.ts));
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const live = remaining > 0 && !lo.alreadyRedeemed;
    const redemption = state.redemptions.find((r) => r.offerId === lo.offer.id);
    // discountAmount was locked in at the moment of redemption — always known, never depends on customer input.
    const discountAmount = lo.discountAmount != null ? lo.discountAmount : (redemption && redemption.discountAmount);
    const amountSpent = redemption && redemption.amountSpent;

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
            ? `<div id="live-timer-chip" style="font-size:11px; background:rgba(255,255,255,0.1); display:inline-block; padding:5px 12px; border-radius:20px;">Live verification · ${mins}:${String(secs).padStart(2, "0")} remaining</div>`
            : `<div id="live-timer-chip" style="font-size:11px; color:#97C459;">Live window closed</div>`
          }

          <div style="margin-top:16px; padding-top:16px; border-top:1px solid rgba(255,255,255,0.14);">
            <div style="font-size:14px; color:#8FE0AA; font-weight:700;">
              ${discountAmount != null ? `You saved $${discountAmount.toFixed(2)}` : "Savings amount not set for this offer"}
            </div>

            ${amountSpent != null
              ? `<div style="font-size:11px; color:#9DBBDD; margin-top:6px;">Purchase total: $${amountSpent.toFixed(2)} — thank you!</div>`
              : `
                <div style="font-size:12px; color:#C0DD97; margin-top:14px; margin-bottom:2px;">Purchase total (optional)</div>
                <div style="font-size:11px; color:#9DBBDD; margin-bottom:8px;">Helps us measure the impact for our restaurant partners.</div>
                <div class="row-flex" style="justify-content:center;">
                  <input type="number" step="0.01" min="0" id="amount-saved-input" placeholder="$" value="${escapeHtml(state.amountSavedDraft || "")}" style="width:100px;" />
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
    if (state.redemptions.length === 0) return "";
    const total = state.redemptions.reduce((sum, r) => sum + (r.discountAmount || 0), 0);
    const hasUnknown = state.redemptions.some((r) => r.discountAmount == null);
    return `
      <div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.14);">
        <div style="font-size:11px; color:#9DBBDD;">You've saved</div>
        <div style="font-size:20px; font-weight:700; color:#8FE0AA;">$${total.toFixed(2)}${hasUnknown ? "+" : ""}</div>
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
            ${r.discountAmount != null ? `<div style="color:#8FE0AA; font-weight:600;">$${r.discountAmount.toFixed(2)} saved</div>` : ""}
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
    const toggleInstructionsBtn = app.querySelector('[data-action="toggle-instructions"]');
    if (toggleInstructionsBtn) toggleInstructionsBtn.addEventListener("click", () => {
      state.instructionsOpen = !state.instructionsOpen;
      render();
    });
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
        state.liveOffer = { offer, ts: redemption.timestamp, alreadyRedeemed: true, discountAmount: redemption.discountAmount };
        state.amountSavedDraft = "";
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
      submitSpend(submitAmountBtn.dataset.offerId, val);
    });
    const amountInput = app.querySelector("#amount-saved-input");
    if (amountInput) amountInput.addEventListener("input", () => { state.amountSavedDraft = amountInput.value; });
  }

  return { init };
})();
