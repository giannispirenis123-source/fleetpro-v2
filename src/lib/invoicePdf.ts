// src/lib/invoicePdf.ts
// PDF τιμολογίου — pdf-lib + DejaVu Sans (ελληνικά), ΧΩΡΙΣ headless browser,
// ίδια τεχνική με το PDF του συμβολαίου (src/lib/contractPdf.ts).
//
//  · Ετικέτες στη γλώσσα που επιλέχθηκε (el/en)· ποσά σε ελληνική μορφή.
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
  dmy,
  eurEl,
  invoiceLabels,
  lineLabel,
  parseHexColor,
  pct,
  statusLabel,
  type DocLang,
  type InvoiceDoc,
} from "./invoiceDocument";

export interface InvoicePdfInput {
  doc: InvoiceDoc;
  lang: DocLang;
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
const MONEY_W = 110;

const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);
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
  const { doc: inv, lang } = input;
  const L = invoiceLabels(lang);
  const [br, bg, bb] = parseHexColor(inv.company.brandColor) ?? DEFAULT_BRAND;
  const BRAND = rgb(br, bg, bb);
  // Πολύ ανοιχτό brand color δεν διαβάζεται ως κείμενο σε λευκό.
  const lum = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
  const BRAND_TEXT = lum > 0.72 ? INK : BRAND;
  const ON_BRAND = lum > 0.6 ? INK : WHITE;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [font, bold] = await Promise.all([
    pdf.embedFont(Buffer.from(DEJAVU_SANS_B64, "base64"), { subset: true }),
    pdf.embedFont(Buffer.from(DEJAVU_SANS_BOLD_B64, "base64"), { subset: true }),
  ]);
  pdf.setTitle(`${L.docTitle} ${inv.code}`);
  pdf.setSubject(inv.code);
  pdf.setCreator("FleetPro");
  pdf.setProducer("FleetPro");
  pdf.setCreationDate(input.now ?? new Date());

  const logo = await embedLogo(pdf, input.logo);
  const c = new Canvas(pdf, font, bold);

  /* ── Κεφαλίδα: λογότυπο/επωνυμία αριστερά, τίτλος + στοιχεία δεξιά ── */
  const top = c.y;
  const RIGHT = MARGIN + WIDTH;
  const leftW = WIDTH * 0.55;

  let leftY = top;
  if (logo) {
    const s = Math.min(150 / logo.width, 56 / logo.height, 1);
    const w = logo.width * s;
    const h = logo.height * s;
    c.page.drawImage(logo, { x: MARGIN, y: leftY - h, width: w, height: h });
    leftY -= h + 8;
  }
  c.y = leftY;
  c.para(v(inv.company.name) || "—", MARGIN, leftW, logo ? 12 : 16, { bold: true });
  leftY = c.y;

  let rightY = top;
  c.text(L.title, RIGHT, 20, { bold: true, color: BRAND_TEXT, align: "right", y: rightY });
  rightY -= 27;
  c.text(inv.code, RIGHT, 13, { bold: true, align: "right", y: rightY });
  rightY -= 19;
  for (const [label, value] of [
    [L.issueDate, dmy(inv.issueDate)],
    [L.dueDate, dmy(inv.dueDate)],
  ] as const) {
    const t = `${label}: ${value}`;
    c.text(t, RIGHT, 9, { color: INK, align: "right", y: rightY });
    rightY -= 13;
  }
  // Κατάσταση σαν «pill».
  const st = statusLabel(inv.status, lang);
  const stW = bold.widthOfTextAtSize(st, 9) + 14;
  rightY -= 3;
  c.page.drawRectangle({
    x: RIGHT - stW,
    y: rightY - 15,
    width: stW,
    height: 15,
    color: STATUS_COLOR[inv.status] ?? MUTED,
  });
  c.text(st, RIGHT - 7, 9, { bold: true, color: WHITE, align: "right", y: rightY - 3 });
  rightY -= 15;

  c.y = Math.min(leftY, rightY) - 10;
  c.rule(BRAND, 2);
  c.y -= 14;

  /* ── Εκδότης / Πελάτης σε δύο στήλες ── */
  const colW = (WIDTH - 24) / 2;
  const partyTop = c.y;
  const block = (x: number, title: string, lines: string[]) => {
    c.y = partyTop;
    c.text(upper(title), x, 8.5, { bold: true, color: BRAND_TEXT });
    c.y -= 14;
    lines.forEach((l, i) => c.para(l, x, colW, i === 0 ? 10 : 8.8, { bold: i === 0, color: i === 0 ? INK : MUTED }));
    return c.y;
  };
  const co = inv.company;
  const issuerEnd = block(
    MARGIN,
    L.issuer,
    [
      v(co.name) || "—",
      [v(co.address), v(co.region)].filter(Boolean).join(", "),
      [co.vat ? `${L.vat}: ${v(co.vat)}` : "", co.taxOffice ? `${L.taxOffice}: ${v(co.taxOffice)}` : ""]
        .filter(Boolean)
        .join(" · "),
      co.phone ? `${L.phone}: ${v(co.phone)}` : "",
      co.email ? `${L.email}: ${v(co.email)}` : "",
      co.iban ? `${L.iban}: ${v(co.iban)}` : "",
    ].filter(Boolean)
  );
  const cu = inv.customer;
  const customerEnd = block(
    MARGIN + colW + 24,
    L.customer,
    [
      vc(cu.name) || "—",
      vc(cu.address),
      cu.phone ? `${L.phone}: ${vc(cu.phone)}` : "",
      cu.email ? `${L.email}: ${vc(cu.email)}` : "",
    ].filter(Boolean)
  );
  c.y = Math.min(issuerEnd, customerEnd) - 12;

  /* ── Κράτηση ── */
  if (inv.booking) {
    const b = inv.booking;
    c.ensure(70);
    c.text(upper(L.booking), MARGIN, 8.5, { bold: true, color: BRAND_TEXT });
    c.y -= 13;
    c.rule(LINE);
    c.y -= 6;
    const cells: [string, string][] = [
      [L.bookingNo, v(b.number) || "—"],
      [L.vehicle, v(b.vehicle) || "—"],
      [L.plate, v(b.plate) || "—"],
      [L.pickup, `${dmy(b.pickupDate)}${b.pickupTime ? ` ${b.pickupTime}` : ""}`],
      [L.return, `${dmy(b.returnDate)}${b.returnTime ? ` ${b.returnTime}` : ""}`],
    ];
    // 3 στήλες ανά σειρά: ετικέτα από πάνω, τιμή από κάτω.
    const cellW = (WIDTH - 2 * 12) / 3;
    for (let i = 0; i < cells.length; i += 3) {
      const rowTop = c.y;
      let rowEnd = rowTop;
      cells.slice(i, i + 3).forEach(([label, value], j) => {
        const x = MARGIN + j * (cellW + 12);
        c.y = rowTop;
        c.text(label, x, 7.8, { color: MUTED });
        c.y -= 11;
        c.para(value, x, cellW, 9.2, { bold: true });
        rowEnd = Math.min(rowEnd, c.y);
      });
      c.y = rowEnd - 5;
    }
    c.y -= 8;
  }

  /* ── Πίνακας γραμμών ── */
  const descW = WIDTH - MONEY_W - 20;
  const tableHeader = () => {
    const h = 20;
    c.page.drawRectangle({ x: MARGIN, y: c.y - h, width: WIDTH, height: h, color: BRAND });
    c.text(L.description, MARGIN + 8, 8.8, { bold: true, color: ON_BRAND, y: c.y - 5.5 });
    c.text(L.amount, RIGHT - 8, 8.8, { bold: true, color: ON_BRAND, align: "right", y: c.y - 5.5 });
    c.y -= h;
  };
  c.ensure(60);
  tableHeader();
  c.onNewPage = tableHeader;
  inv.lines.forEach((line, idx) => {
    const size = 9.2;
    const lh = size * 1.35;
    const ls = wrap(stripCardNumbers(lineLabel(line, lang)), font, size, descW);
    const h = ls.length * lh + 9;
    c.ensure(h);
    if (idx % 2 === 1) {
      c.page.drawRectangle({ x: MARGIN, y: c.y - h, width: WIDTH, height: h, color: ZEBRA });
    }
    const rowTop = c.y;
    ls.forEach((l, i) => {
      c.page.drawText(l, { x: MARGIN + 8, y: rowTop - 5 - size - i * lh, size, font, color: INK });
    });
    c.text(eurEl(line.amount), RIGHT - 8, size, { align: "right", y: rowTop - 5 });
    c.y -= h;
    c.rule(LINE, 0.5);
  });
  c.onNewPage = null;
  c.y -= 10;

  /* ── Σύνολα (ΑΠΟΘΗΚΕΥΜΕΝΑ ποσά) ── */
  const totalsX = RIGHT - 250;
  c.ensure(80);
  const totalRow = (label: string, value: string, strong = false) => {
    const size = strong ? 12 : 9.5;
    c.text(label, totalsX, size, { bold: strong, color: strong ? INK : MUTED });
    c.text(value, RIGHT - 8, size, { bold: strong, color: strong ? BRAND_TEXT : INK, align: "right" });
    c.y -= size * 1.6;
  };
  totalRow(L.net, eurEl(inv.net));
  totalRow(`${L.vatLine} ${pct(inv.vatRate)}%`, eurEl(inv.vatAmount));
  c.page.drawLine({
    start: { x: totalsX, y: c.y + 4 },
    end: { x: RIGHT, y: c.y + 4 },
    thickness: 1.2,
    color: BRAND,
  });
  c.y -= 4;
  totalRow(L.total, eurEl(inv.total), true);

  if (inv.paidAt && inv.status === "PAID") {
    c.text(`${L.paidAt}: ${dmy(inv.paidAt)}`, RIGHT - 8, 8.8, { color: STATUS_COLOR.PAID, align: "right" });
    c.y -= 14;
  }
  c.y -= 6;
  c.para(L.vatNote, MARGIN, WIDTH, 8, { color: MUTED });

  /* ── Πληρωμή ── */
  if (co.iban && inv.status !== "PAID" && inv.status !== "CANCELLED") {
    c.y -= 10;
    c.ensure(50);
    c.text(upper(L.payment), MARGIN, 8.5, { bold: true, color: BRAND_TEXT });
    c.y -= 13;
    c.para(`${L.paymentIban}: ${v(co.iban)}`, MARGIN, WIDTH, 9.2, { bold: true });
    c.para(L.paymentRef, MARGIN, WIDTH, 8.5, { color: MUTED });
  }

  /* ── Υποσέλιδο σε κάθε σελίδα ── */
  const total = c.pages.length;
  c.pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN, y: MARGIN - 2 },
      end: { x: RIGHT, y: MARGIN - 2 },
      thickness: 0.5,
      color: LINE,
    });
    p.drawText(clean(L.issuedBy), { x: MARGIN, y: MARGIN - 13, size: 7.5, font, color: MUTED });
    const t = `${L.docTitle} ${inv.code} · ${i + 1}/${total}`;
    p.drawText(t, { x: RIGHT - font.widthOfTextAtSize(t, 7.5), y: MARGIN - 13, size: 7.5, font, color: MUTED });
  });

  return pdf.save({ useObjectStreams: true });
}
