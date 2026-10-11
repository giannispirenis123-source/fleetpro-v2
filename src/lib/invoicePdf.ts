// src/lib/invoicePdf.ts
// PDF τιμολογίου — pdf-lib + DejaVu Sans (ελληνικά), ΧΩΡΙΣ headless browser,
// ίδια τεχνική με το PDF του συμβολαίου (src/lib/contractPdf.ts).
//
//  · ΠΑΝΤΑ δίγλωσσο: κάθε σταθερή ετικέτα στα ελληνικά και από κάτω, μικρότερη
//    και γκρι, στα αγγλικά. Οι ετικέτες ζουν σε ΕΝΑ σημείο: INVOICE_LABELS
//    (src/lib/invoiceDocument.ts). Οι τιμές γράφονται μία φορά· ποσά σε
//    ελληνική μορφή.
//  · Ποσά καθαρό/ΦΠΑ/σύνολο = τα ΑΠΟΘΗΚΕΥΜΕΝΑ του τιμολογίου.
//  · Λογότυπο (PNG/JPEG) επάνω αριστερά αν δοθεί· οτιδήποτε άλλο ή
//    χαλασμένο αρχείο → μόνο η επωνυμία, χωρίς σφάλμα.
//  · Brand color της εταιρίας για τίτλους/γραμμές.
//  · Ο πίνακας συνεχίζει σε νέα σελίδα (με ξανά την κεφαλίδα του) αν δεν χωρά.

import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { DEJAVU_SANS_B64, DEJAVU_SANS_BOLD_B64 } from "./pdfFonts";
import { stripCardNumbers } from "./contractEmail";
import {
  L,
  dmy,
  eurEl,
  lineLabel,
  parseHexColor,
  statusLabel,
  vatLabel,
  type BiLabel,
  type InvoiceDoc,
} from "./invoiceDocument";

export interface InvoicePdfInput {
  doc: InvoiceDoc;
  /** Bytes του λογοτύπου (PNG/JPEG) ή null. */
  logo?: Uint8Array | null;
  /** Για τη χρονοσφραγίδα δημιουργίας (tests). */
  now?: Date;
}

/* ─────────────────────────────────────────────
   Διάταξη
   ───────────────────────────────────────────── */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const WIDTH = A4[0] - MARGIN * 2;
const FOOTER = 30;

const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);
/** Η αγγλική γραμμή κάθε ετικέτας: μικρότερη και πιο ανοιχτή. */
const EN_GRAY = rgb(0.56, 0.59, 0.63);
/** Μέγεθος της αγγλικής γραμμής σε σχέση με την ελληνική. */
const EN_RATIO = 0.84;
/** Διάστιχο των δίγλωσσων ετικετών. */
const LH = 1.25;
const LINE = rgb(0.84, 0.86, 0.89);
const ZEBRA = rgb(0.965, 0.97, 0.98);
const WHITE = rgb(1, 1, 1);
const DEFAULT_BRAND: [number, number, number] = [0.15, 0.39, 0.92];

const STATUS_COLOR: Record<string, RGB> = {
  PAID: rgb(0.09, 0.5, 0.24),
  UNPAID: rgb(0.72, 0.45, 0.02),
  OVERDUE: rgb(0.78, 0.13, 0.13),
  CANCELLED: rgb(0.42, 0.45, 0.5),
};

/** Κάθε κείμενο: χωρίς χαρακτήρες ελέγχου. */
const clean = (s: string) =>
  s.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");

const v = (s: string | null | undefined) => (s && s.trim() ? s.trim() : "");

/**
 * Ελεύθερο κείμενο του ΠΕΛΑΤΗ (διεύθυνση κ.λπ.): χωρίς σειρές τύπου κάρτας.
 * Όχι στα στοιχεία της εταιρίας — το IBAN έχει θεμιτά πολλά ψηφία.
 */
const vc = (s: string | null | undefined) => stripCardNumbers(v(s));

/** Κεφαλαία χωρίς τόνους, όπως γράφονται στα ελληνικά («ΕΚΔΟΤΗΣ», όχι «ΕΚΔΌΤΗΣ»). */
const upper = (s: string) =>
  s.normalize("NFD").replace(/[\u0301\u0342]/g, "").toUpperCase().normalize("NFC");

/** Αναδίπλωση σε λέξεις· πολύ μεγάλες λέξεις σπάνε σε χαρακτήρες. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    let line = "";
    for (const w of para.split(/ +/).filter(Boolean)) {
      const cand = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(cand, size) <= width) {
        line = cand;
        continue;
      }
      if (line) out.push(line);
      line = "";
      let chunk = "";
      for (const ch of Array.from(w)) {
        if (font.widthOfTextAtSize(chunk + ch, size) > width && chunk) {
          out.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

/** PNG ή JPEG από τα «μαγικά» bytes· οτιδήποτε άλλο (π.χ. WebP) → null. */
export async function embedLogo(doc: PDFDocument, bytes: Uint8Array | null | undefined): Promise<PDFImage | null> {
  if (!bytes || bytes.length < 8) return null;
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return await doc.embedPng(bytes);
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return await doc.embedJpg(bytes);
    }
  } catch {
    // Χαλασμένη εικόνα: συνεχίζουμε χωρίς λογότυπο.
  }
  return null;
}

class Canvas {
  page!: PDFPage;
  y = 0;
  readonly pages: PDFPage[] = [];
  private doc: PDFDocument;
  readonly font: PDFFont;
  readonly bold: PDFFont;
  /** Τι ξαναζωγραφίζεται στην κορυφή κάθε νέας σελίδας (π.χ. κεφαλίδα πίνακα). */
  onNewPage: (() => void) | null = null;

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - MARGIN;
    this.onNewPage?.();
  }

  ensure(h: number) {
    if (this.y - h < MARGIN + FOOTER) this.newPage();
  }

  text(s: string, x: number, size: number, o: { bold?: boolean; color?: RGB; align?: "left" | "right"; y?: number } = {}) {
    const font = o.bold ? this.bold : this.font;
    const t = clean(s);
    const dx = o.align === "right" ? x - font.widthOfTextAtSize(t, size) : x;
    this.page.drawText(t, { x: dx, y: (o.y ?? this.y) - size, size, font, color: o.color ?? INK });
  }

  /** Παράγραφος με αναδίπλωση από το x, πλάτος w. Επιστρέφει το ύψος. */
  para(s: string, x: number, w: number, size: number, o: { bold?: boolean; color?: RGB } = {}) {
    const font = o.bold ? this.bold : this.font;
    const lh = size * 1.35;
    for (const l of wrap(s, font, size, w)) {
      this.ensure(lh);
      this.page.drawText(l, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= lh;
    }
  }

  rule(color: RGB, thickness = 0.6, y = this.y) {
    this.page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + WIDTH, y }, thickness, color });
  }
}

export async function buildInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const { doc: inv } = input;
  const [br, bg, bb] = parseHexColor(inv.company.brandColor) ?? DEFAULT_BRAND;
  const BRAND = rgb(br, bg, bb);
  // Πολύ ανοιχτό brand color δεν διαβάζεται ως κείμενο σε λευκό.
  const lum = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
  const BRAND_TEXT = lum > 0.72 ? INK : BRAND;
  const darkOnBrand = lum > 0.6;
  const ON_BRAND = darkOnBrand ? INK : WHITE;
  const ON_BRAND_EN = darkOnBrand ? MUTED : rgb(0.86, 0.89, 0.93);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [font, bold] = await Promise.all([
    pdf.embedFont(Buffer.from(DEJAVU_SANS_B64, "base64"), { subset: true }),
    pdf.embedFont(Buffer.from(DEJAVU_SANS_BOLD_B64, "base64"), { subset: true }),
  ]);
  pdf.setTitle(`${L.docTitle.el} / ${L.docTitle.en} ${inv.code}`);
  pdf.setSubject(inv.code);
  pdf.setCreator("FleetPro");
  pdf.setProducer("FleetPro");
  pdf.setCreationDate(input.now ?? new Date());

  const logo = await embedLogo(pdf, input.logo);
  const c = new Canvas(pdf, font, bold);
  const RIGHT = MARGIN + WIDTH;

  /* ── Δίγλωσσες ετικέτες: ελληνικά, και από κάτω αγγλικά (μικρότερα, γκρι) ── */
  type PairStyle = { size?: number; bold?: boolean; color?: RGB; enColor?: RGB; align?: "left" | "right"; upper?: boolean };
  const pairLines = (p: BiLabel, w: number, o: PairStyle) => {
    const size = o.size ?? 8;
    const elText = o.upper ? upper(p.el) : p.el;
    const el = wrap(elText, o.bold ? bold : font, size, w);
    // Ίδιο κείμενο στις δύο γλώσσες (π.χ. «Email», «IBAN») → μία φορά.
    const en = p.en === p.el ? [] : wrap(p.en, font, size * EN_RATIO, w);
    return { el, en, size, enSize: size * EN_RATIO };
  };
  const pairHeight = (p: BiLabel, w: number, o: PairStyle = {}) => {
    const l = pairLines(p, w, o);
    return l.el.length * l.size * LH + l.en.length * l.enSize * LH;
  };
  /** Σχεδιάζει το ζεύγος με πάνω άκρη το y· επιστρέφει το ύψος. */
  const drawPair = (p: BiLabel, x: number, w: number, y: number, o: PairStyle = {}) => {
    const l = pairLines(p, w, o);
    let yy = y;
    const draw = (t: string, size: number, f: PDFFont, color: RGB) => {
      const dx = o.align === "right" ? x + w - f.widthOfTextAtSize(t, size) : x;
      c.page.drawText(t, { x: dx, y: yy - size, size, font: f, color });
      yy -= size * LH;
    };
    for (const t of l.el) draw(t, l.size, o.bold ? bold : font, o.color ?? MUTED);
    for (const t of l.en) draw(t, l.enSize, font, o.enColor ?? EN_GRAY);
    return y - yy;
  };
  /** Τίτλος ενότητας: ΕΛΛΗΝΙΚΑ (κεφαλαία, brand) + αγγλικά από κάτω. */
  const heading = (p: BiLabel, x = MARGIN, w = WIDTH) => {
    c.y -= drawPair(p, x, w, c.y, { size: 8.5, bold: true, color: BRAND_TEXT, upper: true }) + 4;
  };

  /* ── Κεφαλίδα: λογότυπο/επωνυμία αριστερά, τίτλος + στοιχεία δεξιά ── */
  const top = c.y;
  const RB = 250; // πλάτος δεξιού μπλοκ
  const leftW = WIDTH - RB - 18;

  let leftY = top;
  if (logo) {
    const s = Math.min(150 / logo.width, 56 / logo.height, 1);
    const w = logo.width * s;
    const h = logo.height * s;
    c.page.drawImage(logo, { x: MARGIN, y: leftY - h, width: w, height: h });
    leftY -= h + 8;
  }
  c.y = leftY;
  c.para(v(inv.company.name) || "—", MARGIN, leftW, logo ? 12 : 15, { bold: true });
  leftY = c.y;

  // Τίτλος «ΤΙΜΟΛΟΓΙΟ / INVOICE» σε μία γραμμή· μικραίνει αν δεν χωρά.
  const titleText = `${L.title.el} / ${L.title.en}`;
  let titleSize = 18;
  while (titleSize > 12 && bold.widthOfTextAtSize(titleText, titleSize) > RB) titleSize -= 0.5;
  c.text(titleText, RIGHT, titleSize, { bold: true, color: BRAND_TEXT, align: "right", y: top });
  let rightY = top - titleSize - 12;

  // Πεδία: ετικέτα (ΕΛ/EN) αριστερά, τιμή δεξιά.
  const fx = RIGHT - RB;
  const labelW = 120;
  const valueW = RB - labelW - 8;
  const field = (p: BiLabel, value: string, size = 9.5) => {
    const vs = wrap(value, bold, size, valueW);
    vs.forEach((t, i) =>
      c.page.drawText(t, {
        x: RIGHT - bold.widthOfTextAtSize(t, size),
        y: rightY - size - i * size * 1.3,
        size,
        font: bold,
        color: INK,
      })
    );
    const h = Math.max(drawPair(p, fx, labelW, rightY), vs.length * size * 1.3);
    rightY -= h + 5;
  };
  field(L.code, inv.code, 11);
  field(L.issueDate, dmy(inv.issueDate));
  field(L.dueDate, dmy(inv.dueDate));

  // Κατάσταση: «pill» με ελληνικά και από κάτω αγγλικά.
  const st = statusLabel(inv.status);
  const stSize = 8.5;
  const stEn = stSize * EN_RATIO;
  const pillW =
    Math.max(bold.widthOfTextAtSize(st.el, stSize), font.widthOfTextAtSize(st.en, stEn)) + 16;
  const pillH = stSize * 1.3 + stEn * 1.3 + 7;
  const statusLabelH = drawPair(L.status, fx, labelW, rightY);
  c.page.drawRectangle({
    x: RIGHT - pillW,
    y: rightY - pillH,
    width: pillW,
    height: pillH,
    color: STATUS_COLOR[inv.status] ?? MUTED,
  });
  // +2 pt περιθώριο: το κείμενο μετρήθηκε ακριβώς — να μη «σπάσει» από στρογγυλοποίηση.
  drawPair(st, RIGHT - pillW + 7, pillW - 14, rightY - 3.5, {
    size: stSize,
    bold: true,
    color: WHITE,
    enColor: rgb(0.93, 0.95, 0.97),
    align: "right",
  });
  rightY -= Math.max(statusLabelH, pillH);

  c.y = Math.min(leftY, rightY) - 10;
  c.rule(BRAND, 2);
  c.y -= 14;

  /* ── Εταιρεία / Πελάτης σε δύο στήλες ── */
  const colW = (WIDTH - 24) / 2;
  const kvLabelW = 74;
  const partyTop = c.y;
  const block = (x: number, title: BiLabel, name: string, rows: [BiLabel, string][]) => {
    c.y = partyTop;
    heading(title, x, colW);
    c.para(name || "—", x, colW, 10, { bold: true });
    c.y -= 2;
    for (const [label, value] of rows) {
      if (!value) continue;
      const lines = wrap(value, font, 8.8, colW - kvLabelW - 6);
      lines.forEach((t, i) =>
        c.page.drawText(t, { x: x + kvLabelW + 6, y: c.y - 8.8 - i * 8.8 * 1.3, size: 8.8, font, color: INK })
      );
      const h = Math.max(drawPair(label, x, kvLabelW, c.y, { size: 7.8 }), lines.length * 8.8 * 1.3);
      c.y -= h + 2.5;
    }
    return c.y;
  };
  const co = inv.company;
  const companyEnd = block(MARGIN, L.company, v(co.name), [
    [L.address, [v(co.address), v(co.region)].filter(Boolean).join(", ")],
    [L.vat, v(co.vat)],
    [L.taxOffice, v(co.taxOffice)],
    [L.phone, v(co.phone)],
    [L.email, v(co.email)],
    [L.iban, v(co.iban)],
  ]);
  const cu = inv.customer;
  const customerEnd = block(MARGIN + colW + 24, L.customer, vc(cu.name), [
    [L.address, vc(cu.address)],
    [L.phone, vc(cu.phone)],
    [L.email, vc(cu.email)],
  ]);
  c.y = Math.min(companyEnd, customerEnd) - 10;

  /* ── Αναφορά κράτησης ── */
  if (inv.booking) {
    const b = inv.booking;
    c.ensure(110);
    heading(L.booking);
    c.rule(LINE);
    c.y -= 6;
    const cells: [BiLabel, string][] = [
      [L.bookingNo, v(b.number) || "—"],
      [L.vehicle, v(b.vehicle) || "—"],
      [L.plate, v(b.plate) || "—"],
      [L.pickup, `${dmy(b.pickupDate)}${b.pickupTime ? ` ${b.pickupTime}` : ""}`],
      [L.return, `${dmy(b.returnDate)}${b.returnTime ? ` ${b.returnTime}` : ""}`],
    ];
    // Μία σειρά, 5 στήλες (το όχημα πιο φαρδύ): ετικέτα (ΕΛ/EN), από κάτω η τιμή.
    const gap = 10;
    const weights = [0.9, 1.5, 0.85, 1, 1];
    const unit = (WIDTH - gap * (cells.length - 1)) / weights.reduce((x, y) => x + y, 0);
    const rowTop = c.y;
    let rowEnd = rowTop;
    let x = MARGIN;
    cells.forEach(([label, value], j) => {
      const w = unit * weights[j];
      c.y = rowTop - drawPair(label, x, w, rowTop, { size: 7.8 }) - 1;
      c.para(value, x, w, 9, { bold: true });
      rowEnd = Math.min(rowEnd, c.y);
      x += w + gap;
    });
    c.y = rowEnd - 2;
    c.y -= 6;
  }

  /* ── Πίνακας γραμμών ── */
  const AMOUNT_W = 120;
  const descW = WIDTH - AMOUNT_W - 24;
  const headStyle: PairStyle = { size: 8.8, bold: true, color: ON_BRAND, enColor: ON_BRAND_EN };
  const tableHeader = () => {
    const h = Math.max(pairHeight(L.description, descW, headStyle), pairHeight(L.amount, AMOUNT_W, headStyle)) + 10;
    c.page.drawRectangle({ x: MARGIN, y: c.y - h, width: WIDTH, height: h, color: BRAND });
    drawPair(L.description, MARGIN + 8, descW, c.y - 5, headStyle);
    drawPair(L.amount, RIGHT - 8 - AMOUNT_W, AMOUNT_W, c.y - 5, { ...headStyle, align: "right" });
    c.y -= h;
  };
  c.ensure(70);
  tableHeader();
  c.onNewPage = tableHeader;
  const rowStyle: PairStyle = { size: 9, color: INK };
  inv.lines.forEach((line, idx) => {
    const raw = lineLabel(line);
    const label = { el: stripCardNumbers(raw.el), en: stripCardNumbers(raw.en) };
    const h = pairHeight(label, descW, rowStyle) + 8;
    c.ensure(h);
    if (idx % 2 === 1) {
      c.page.drawRectangle({ x: MARGIN, y: c.y - h, width: WIDTH, height: h, color: ZEBRA });
    }
    drawPair(label, MARGIN + 8, descW, c.y - 4, rowStyle);
    c.text(eurEl(line.amount), RIGHT - 8, 9, { align: "right", y: c.y - 4 });
    c.y -= h;
    c.rule(LINE, 0.5);
  });
  c.onNewPage = null;
  c.y -= 10;

  /* ── Σύνολα (ΑΠΟΘΗΚΕΥΜΕΝΑ ποσά) δεξιά, πληρωμή (IBAN) αριστερά ── */
  const totalsW = 260;
  const totalsX = RIGHT - totalsW;
  const totalsLabelW = 150;
  const totalStyle = (strong: boolean): PairStyle => ({ size: strong ? 11 : 9, bold: strong, color: strong ? INK : MUTED });
  const paidLabel: BiLabel | null =
    inv.paidAt && inv.status === "PAID"
      ? { el: `${L.paidAt.el}: ${dmy(inv.paidAt)}`, en: `${L.paidAt.en}: ${dmy(inv.paidAt)}` }
      : null;
  const paidStyle: PairStyle = { size: 8.8, color: STATUS_COLOR.PAID, align: "right" };
  const totalsH =
    pairHeight(L.net, totalsLabelW, totalStyle(false)) +
    pairHeight(vatLabel(inv.vatRate), totalsLabelW, totalStyle(false)) +
    pairHeight(L.total, totalsLabelW, totalStyle(true)) +
    3 * 4 + 5 +
    (paidLabel ? pairHeight(paidLabel, totalsW - 8, paidStyle) + 4 : 0);

  const showPayment = Boolean(co.iban) && inv.status !== "PAID" && inv.status !== "CANCELLED";
  const PW = WIDTH - totalsW - 20;
  const headStyleL: PairStyle = { size: 8.5, bold: true, color: BRAND_TEXT, upper: true };
  const ibanLines = wrap(v(co.iban), bold, 9.5, PW);
  const paymentH = showPayment
    ? pairHeight(L.payment, PW, headStyleL) + 4 +
      pairHeight(L.paymentIban, PW, { size: 8 }) + 1 +
      ibanLines.length * 9.5 * LH + 4 +
      pairHeight(L.paymentRef, PW, { size: 7.8 })
    : 0;

  // Το μπλοκ μένει ενωμένο: αν δεν χωρά, πάει ολόκληρο στην επόμενη σελίδα.
  c.ensure(Math.max(totalsH, paymentH));
  const blockTop = c.y;

  if (showPayment) {
    let y = blockTop;
    y -= drawPair(L.payment, MARGIN, PW, y, headStyleL) + 4;
    y -= drawPair(L.paymentIban, MARGIN, PW, y, { size: 8 }) + 1;
    for (const t of ibanLines) {
      c.page.drawText(t, { x: MARGIN, y: y - 9.5, size: 9.5, font: bold, color: INK });
      y -= 9.5 * LH;
    }
    y -= 4;
    drawPair(L.paymentRef, MARGIN, PW, y, { size: 7.8 });
  }

  const totalRow = (label: BiLabel, value: string, strong = false) => {
    const size = strong ? 11 : 9;
    const h = drawPair(label, totalsX, totalsLabelW, c.y, totalStyle(strong));
    c.text(value, RIGHT - 8, size + 1, { bold: strong, color: strong ? BRAND_TEXT : INK, align: "right" });
    c.y -= h + 4;
  };
  totalRow(L.net, eurEl(inv.net));
  totalRow(vatLabel(inv.vatRate), eurEl(inv.vatAmount));
  c.page.drawLine({
    start: { x: totalsX, y: c.y + 3 },
    end: { x: RIGHT, y: c.y + 3 },
    thickness: 1.2,
    color: BRAND,
  });
  c.y -= 5;
  totalRow(L.total, eurEl(inv.total), true);
  if (paidLabel) c.y -= drawPair(paidLabel, totalsX, totalsW - 8, c.y, paidStyle) + 4;

  c.y = blockTop - Math.max(totalsH, paymentH) - 8;
  c.ensure(pairHeight(L.vatNote, WIDTH, { size: 8 }));
  c.y -= drawPair(L.vatNote, MARGIN, WIDTH, c.y, { size: 8 });

  /* ── Υποσέλιδο σε κάθε σελίδα ── */
  const total = c.pages.length;
  const fs = 7;
  c.pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN, y: MARGIN - 2 },
      end: { x: RIGHT, y: MARGIN - 2 },
      thickness: 0.5,
      color: LINE,
    });
    const right = `${L.docTitle.el} / ${L.docTitle.en} ${inv.code} · ${i + 1}/${total}`;
    const rightW = font.widthOfTextAtSize(right, fs);
    p.drawText(right, { x: RIGHT - rightW, y: MARGIN - 12, size: fs, font, color: MUTED });
    const one = `${L.issuedBy.el} · ${L.issuedBy.en}`;
    if (font.widthOfTextAtSize(one, fs) <= WIDTH - rightW - 12) {
      p.drawText(one, { x: MARGIN, y: MARGIN - 12, size: fs, font, color: MUTED });
    } else {
      p.drawText(L.issuedBy.el, { x: MARGIN, y: MARGIN - 12, size: fs, font, color: MUTED });
      p.drawText(L.issuedBy.en, { x: MARGIN, y: MARGIN - 21, size: fs * EN_RATIO, font, color: EN_GRAY });
    }
  });

  return pdf.save({ useObjectStreams: true });
}
