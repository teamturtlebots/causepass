// ================= CUSTOMER VIEW =================
// Renders into #app. Called by app.js when the URL hash is "#/p/TOKEN".

const CustomerView = (function () {
  let state = {};
  let unsubscribers = [];
  let tickTimer = null;
  const LIVE_WINDOW_MS = 5 * 60 * 1000; // how long the live "happening now" screen counts down

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
      editingAmountId: null, // offer whose purchase total is being added/edited inline on its card
      amountEditDraft: "",
      amountEditError: "",
      focusAmount: false,
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
          <div class="offer-row">
            <div class="offer-left">
              <div class="avatar">${escapeHtml(initials(merchant && merchant.name))}</div>
              <div>
                <div class="offer-merchant">${escapeHtml(merchant && merchant.name)}</div>
                <div class="offer-savings">${escapeHtml(offer.terms)}</div>
                ${merchant && merchant.address ? `<div style="font-size:13px; color:var(--muted); margin-top:4px;">${escapeHtml(merchant.address)}</div>` : ""}
                ${directionsLinkHtml(merchant, true)}
              </div>
            </div>
            <span class="badge ${redeemed ? "grey" : "green"}">${redeemed ? "Redeemed" : "Available"}</span>
          </div>
          ${redeemed
            ? `<div style="font-size:11px; color:var(--muted); margin-top:8px;">
                 ✓ ${fmtDate(redemption.timestamp)}${redemption.discountAmount != null ? ` · $${redemption.discountAmount.toFixed(2)} saved` : ""}
               </div>
               ${renderCardAmount(offer.id, redemption)}`
            : `<button class="primary" style="width:100%; margin-top:10px;" ${disabled ? "disabled" : ""} data-action="confirm-offer" data-offer-id="${offer.id}">Redeem this offer</button>`
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

          <div style="text-align:center; font-size:12px; color:var(--muted); margin-top:18px;">
            Questions about your pass? <a href="mailto:causepass@gmail.com?subject=${encodeURIComponent("CausePass" + (state.pass.passNumber ? " \u2014 Pass " + formatPassNumber(state.pass.passNumber) : ""))}">causepass@gmail.com</a>
          </div>
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

  // The pop-up after "Redeem this offer": the terms and an on-site reminder, as a last chance to
  // double-check because redeeming can't be undone. Still two taps in total:
  // Redeem this offer (card) -> Redeem now (here).
  function renderOfferSheet(offer) {
    const merchant = state.merchants[offer.merchantId];
    const lines = offerDetailLines(offer).map((l) => `<li>${escapeHtml(l)}</li>`).join("");
    return `
      <div class="modal-backdrop">
        <div class="modal sheet">
          <div style="font-weight:700; font-size:18px;">Terms &amp; Conditions</div>
          <div style="font-weight:700; font-size:16px; margin-top:12px; line-height:1.25;">${escapeHtml(merchant && merchant.name)}</div>
          <div class="sheet-savings">${escapeHtml(offer.terms)}</div>
          <ul class="sheet-lines">${lines}</ul>
          <div class="sheet-reminder"><strong>Redeem on site only.</strong> Only redeem this offer when you're at the business and ready to pay. Redeeming can't be undone.</div>
          <div style="display:flex; gap:8px;">
            <button data-action="cancel-confirm" style="flex:1;">Cancel</button>
            <button class="primary" data-action="do-redeem" style="flex:2;">Redeem now</button>
          </div>
        </div>
      </div>`;
  }

  // Validates and saves the optional purchase total. Used by both the live screen and the
  // pass card. Blank = nothing to save (it's optional). Returns { ok, error }.
  async function saveAmountSpent(offerId, spendStr) {
    const trimmed = (spendStr || "").trim();
    if (trimmed === "") return { ok: true, skipped: true };
    const spend = parseFloat(trimmed);
    if (isNaN(spend) || spend < 0) return { ok: false, error: "Enter a valid amount." };
    try {
      await db.collection("redemptions").doc(`${state.token}_${offerId}`).update({ amountSpent: Math.round(spend * 100) / 100 });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "Couldn't save that \u2014 try again." };
    }
  }

  // Live screen's "Save" button.
  async function submitSpend(offerId, spendStr) {
    const result = await saveAmountSpent(offerId, spendStr);
    state.amountSavedError = result.ok ? "" : result.error;
    render();
  }

  // Purchase total line on a redeemed pass card: add it, see it, or edit it right there.
  // (It never reopens the live redemption screen.)
  function renderCardAmount(offerId, redemption) {
    if (state.editingAmountId === offerId) {
      return `
        <div style="margin-top:10px;">
          <label for="card-amount-input" style="font-size:12px; color:var(--muted);">Purchase total (optional)</label>
          <div class="row-flex" style="margin-top:4px;">
            <input id="card-amount-input" type="number" inputmode="decimal" step="0.01" min="0" placeholder="$" value="${escapeHtml(state.amountEditDraft)}" style="width:110px;" />
            <button class="primary" data-action="save-card-amount" data-offer-id="${offerId}">Save</button>
            <button data-action="cancel-card-amount">Cancel</button>
          </div>
          ${state.amountEditError ? `<div style="font-size:12px; color:#B3261E; margin-top:6px;">${escapeHtml(state.amountEditError)}</div>` : ""}
        </div>`;
    }
    if (redemption.amountSpent != null) {
      return `
        <div style="font-size:13px; margin-top:8px;">
          Purchase total: <strong>$${redemption.amountSpent.toFixed(2)}</strong> \u00b7
          <button type="button" data-action="edit-card-amount" data-offer-id="${offerId}" style="background:none; border:none; padding:0; color:var(--navy); font-weight:600; font-size:13px; text-decoration:underline; cursor:pointer;">Edit</button>
        </div>`;
    }
    return `<button style="margin-top:8px; font-size:12px; padding:6px 10px;" data-action="edit-card-amount" data-offer-id="${offerId}">Add purchase total (optional)</button>`;
  }

  // Ticks the big countdown and progress bar in place (so typing in the amount box isn't
  // interrupted). When the 5 minutes run out it re-renders once into the "window closed" screen.
  function updateLiveCountdown() {
    if (!state.liveOffer) return;
    const timerEl = document.getElementById("rv-timer");
    if (!timerEl) return; // no countdown on screen (closed / already-redeemed screens, or nothing open)
    const remaining = Math.max(0, LIVE_WINDOW_MS - (state.now - state.liveOffer.ts));
    if (remaining <= 0) { render(); return; }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    timerEl.textContent = `${mins}:${String(secs).padStart(2, "0")}`;
    const bar = document.getElementById("rv-bar-fill");
    if (bar) bar.style.width = `${Math.round((remaining / LIVE_WINDOW_MS) * 100)}%`;
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
              <li>When you're at the counter, tap <strong>Redeem this offer</strong>, check the terms, then tap <strong>Redeem now</strong></li>
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

  // The screen the cashier reads. Three looks, chosen automatically:
  //   live   - first 5 minutes after "Redeem now" (pulsing LIVE + countdown = proof it's happening now)
  //   closed - the 5 minutes ran out while this screen was open
  //   used   - the app found this offer was already redeemed (double-tap, refresh, second phone)
  // Merchant name and offer are deliberately huge so they can be read from across the counter.
  function renderLiveValidation() {
    const lo = state.liveOffer;
    const merchant = state.merchants[lo.offer.merchantId];
    const remaining = Math.max(0, LIVE_WINDOW_MS - (state.now - lo.ts));
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const usedAlready = !!lo.alreadyRedeemed;
    const variant = usedAlready ? "used" : (remaining > 0 ? "live" : "closed");
    const redemption = state.redemptions.find((r) => r.offerId === lo.offer.id);
    // discountAmount was locked in at the moment of redemption \u2014 always known, never depends on customer input.
    const discountAmount = lo.discountAmount != null ? lo.discountAmount : (redemption && redemption.discountAmount);
    const amountSpent = redemption && redemption.amountSpent;

    const icon = usedAlready
      ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3B1410" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>`
      : `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#173404" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>`;

    const statusBox = variant === "live"
      ? `<div class="rv-livebox">
           <div class="rv-live-row">
             <div class="rv-live-label"><span class="rv-dot"></span>LIVE</div>
             <div class="rv-timer" id="rv-timer">${mins}:${String(secs).padStart(2, "0")}</div>
           </div>
           <div class="rv-bar"><div class="rv-bar-fill" id="rv-bar-fill" style="width:${Math.round((remaining / LIVE_WINDOW_MS) * 100)}%"></div></div>
           <div class="rv-live-note">Live verification \u00b7 happening now</div>
         </div>`
      : variant === "closed"
        ? `<div class="rv-warn">
             <div class="rv-warn-title">LIVE WINDOW CLOSED</div>
             <div class="rv-warn-text">The 5-minute live check has ended. This screen can no longer prove a new redemption.</div>
           </div>`
        : `<div class="rv-warn">
             <div class="rv-warn-title">NOT A NEW REDEMPTION</div>
             <div class="rv-warn-text">This offer was already used on this pass. It can only be used once.</div>
           </div>`;

    let customer;
    if (usedAlready) {
      customer = discountAmount != null ? `<div class="rv-saved">Saved $${discountAmount.toFixed(2)} when it was used</div>` : "";
    } else {
      customer = `
        <div class="rv-saved">${discountAmount != null ? `You saved $${discountAmount.toFixed(2)}` : "Savings amount not set for this offer"}</div>
        ${amountSpent != null
          ? `<div class="rv-sub">Purchase total: $${amountSpent.toFixed(2)} \u00b7 thank you!</div>`
          : `
            <label class="rv-sub" for="amount-saved-input">Purchase total (optional)</label>
            <div class="rv-help">Helps us measure the impact for our restaurant partners.</div>
            <div class="rv-amount-row">
              <input type="number" inputmode="decimal" step="0.01" min="0" id="amount-saved-input" placeholder="$" value="${escapeHtml(state.amountSavedDraft || "")}" />
              <button class="primary" data-action="submit-amount" data-offer-id="${lo.offer.id}">Save</button>
            </div>
            ${state.amountSavedError ? `<div class="rv-error">${escapeHtml(state.amountSavedError)}</div>` : ""}
          `}`;
    }

    return `
      <div class="rv rv-${variant}" role="dialog" aria-modal="true" aria-label="${usedAlready ? "Already redeemed" : "Valid redemption"}">
        <div class="rv-inner">
          <div class="rv-status">
            <div class="rv-icon">${icon}</div>
            <div class="rv-status-text">${usedAlready ? "ALREADY REDEEMED" : "VALID REDEMPTION"}</div>
          </div>
          <div class="rv-hero">
            <div class="rv-merchant">${escapeHtml(merchant && merchant.name)}</div>
            <div class="rv-offer">${escapeHtml(lo.offer.terms)}</div>
            <div class="rv-time">${usedAlready ? "Used " : ""}${fmtDate(lo.ts)}</div>
          </div>
          ${statusBox}
          <div class="rv-customer">
            ${customer}
            <button class="rv-close" data-action="close-live">Close</button>
          </div>
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
    app.querySelectorAll('[data-action="edit-card-amount"]').forEach((el) => {
      el.addEventListener("click", () => {
        const offerId = el.dataset.offerId;
        const redemption = state.redemptions.find((r) => r.offerId === offerId);
        state.editingAmountId = offerId;
        state.amountEditDraft = redemption && redemption.amountSpent != null ? String(redemption.amountSpent) : "";
        state.amountEditError = "";
        state.focusAmount = true;
        render();
      });
    });
    app.querySelectorAll('[data-action="cancel-card-amount"]').forEach((el) => {
      el.addEventListener("click", () => { state.editingAmountId = null; state.amountEditError = ""; render(); });
    });
    app.querySelectorAll('[data-action="save-card-amount"]').forEach((el) => {
      el.addEventListener("click", async () => {
        const input = document.getElementById("card-amount-input");
        const result = await saveAmountSpent(el.dataset.offerId, input ? input.value : "");
        if (result.ok) { state.editingAmountId = null; state.amountEditError = ""; }
        else state.amountEditError = result.error;
        render();
      });
    });
    const cardAmountInput = app.querySelector("#card-amount-input");
    if (cardAmountInput) {
      cardAmountInput.addEventListener("input", () => { state.amountEditDraft = cardAmountInput.value; });
      if (state.focusAmount) { state.focusAmount = false; cardAmountInput.focus(); }
    }
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
