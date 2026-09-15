// ================= PRINTABLE CARD PDF GENERATION =================
// Pure client-side: draws cards directly onto a jsPDF document (no server,
// no external rendering/mail-merge service) and triggers a normal browser
// file download when done.

const PrintCards = (function () {
  const MARGIN = 0.4;
  const GAP = 0.15;
  const COLS = 2, ROWS = 4; // 8 cards per US Letter page

  const NAVY = [31, 58, 95];
  const GREEN = [46, 139, 79];
  const MUTED = [107, 112, 97];
  const LINE = [228, 225, 214];

  // Derived from the page size so the grid always exactly fills the printable area.
  const CARD_W = (8.5 - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
  const CARD_H = (11 - 2 * MARGIN - (ROWS - 1) * GAP) / ROWS;

  // Draws a QR into a temporary, invisible element (qrcode.js needs a real DOM
  // node to render into) then reads the resulting canvas back out as an image.
  function makeQrDataUrl(text) {
    const holder = document.createElement("div");
    holder.style.position = "fixed";
    holder.style.left = "-9999px";
    document.body.appendChild(holder);
    new QRCode(holder, {
      text, width: 300, height: 300,
      colorDark: "#1F3A5F", colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
    const canvas = holder.querySelector("canvas");
    const dataUrl = canvas ? canvas.toDataURL("image/png") : null;
    document.body.removeChild(holder);
    return dataUrl;
  }

  function drawCard(doc, x, y, org, program, pass, baseUrl, formatPassNumber) {
    // The card's own border doubles as the cut guide — cut along the shared line between adjacent cards.
    doc.setDrawColor.apply(doc, LINE);
    doc.setLineWidth(0.008);
    doc.rect(x, y, CARD_W, CARD_H);

    const cx = x + CARD_W / 2;
    const textW = CARD_W - 0.24;
    let cy = y + 0.19;

    doc.setTextColor.apply(doc, NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text(org.name || "", cx, cy, { align: "center", maxWidth: textW });
    cy += 0.155;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(program.name || "", cx, cy, { align: "center", maxWidth: textW });
    cy += 0.135;

    if (program.tagline) {
      doc.setTextColor.apply(doc, GREEN);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(6.5);
      doc.text(program.tagline, cx, cy, { align: "center", maxWidth: textW });
      cy += 0.13;
    }

    doc.setDrawColor.apply(doc, LINE);
    doc.line(x + 0.2, cy, x + CARD_W - 0.2, cy);
    cy += 0.1;

    const qrSize = Math.min(1.05, CARD_W - 0.5);
    const link = baseUrl + "#/p/" + pass.id;
    const qrDataUrl = makeQrDataUrl(link);
    if (qrDataUrl) doc.addImage(qrDataUrl, "PNG", cx - qrSize / 2, cy, qrSize, qrSize);
    cy += qrSize + 0.09;

    doc.setTextColor.apply(doc, MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.text("Scan to open your Pass", cx, cy, { align: "center" });
    cy += 0.14;

    doc.setTextColor.apply(doc, NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(pass.passNumber ? formatPassNumber(pass.passNumber) : "", cx, cy, { align: "center" });

    // Footer branding — text only at this size; a logo icon this small wouldn't read as anything but a smudge.
    doc.setTextColor(165, 165, 165);
    doc.setFontSize(5.5);
    doc.text("Powered by CausePass", cx, y + CARD_H - 0.1, { align: "center" });
  }

  async function generate(org, program, passes, baseUrl, formatPassNumber, onProgress) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "in", format: "letter" });

    let col = 0, row = 0;
    passes.forEach((p, i) => {
      if (i > 0 && col === 0 && row === 0) doc.addPage();
      const x = MARGIN + col * (CARD_W + GAP);
      const y = MARGIN + row * (CARD_H + GAP);
      drawCard(doc, x, y, org, program, p, baseUrl, formatPassNumber);
      if (onProgress) onProgress(i + 1, passes.length);

      col++;
      if (col >= COLS) { col = 0; row++; }
      if (row >= ROWS) { row = 0; col = 0; }
    });

    const safe = (s) => (s || "cards").replace(/[^a-z0-9]+/gi, "-");
    doc.save(`${safe(org.name)}-${safe(program.name)}-cards.pdf`);
  }

  return { generate };
})();
