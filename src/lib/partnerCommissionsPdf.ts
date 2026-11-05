// src/lib/partnerCommissionsPdf.ts
// PDF «Αναφορά προμηθειών συνεργατών» — ΙΔΙΑ τεχνική με τα PDF τιμολογίων/
// συμβολαίων: pdf-lib + DejaVu Sans (ελληνικά), λογότυπο με embedLogo (μόνο
// PNG/JPEG), ποσά ΜΟΝΟ με formatMoney. Τα δεδομένα είναι ΑΚΡΙΒΩΣ αυτά της
// οθόνης (loadPartnerCommissions / loadPartnerCommissionDetail → partnerFinance).
//
//  · Λογότυπο πάνω αριστερά (αναλογίες, μέγιστο 150×56)· χωρίς λογότυπο → η
//    επωνυμία της εταιρίας στη θέση του.
//  · Πίνακας ανά συνεργάτη + «Σύνολο όλων»· για έναν συνεργάτη και οι κρατήσεις
//    του (αριθμός, πελάτης, ημερομηνίες, κατάσταση, ποσό, προμήθεια) — από τον
//    πελάτη ΜΟΝΟ ονοματεπώνυμο (ποτέ στοιχεία επικοινωνίας ή εγγράφου).
//  · Νέα σελίδα με ξανά την κεφαλίδα του πίνακα· «Σελίδα X / Y» στο κάτω μέρος.

import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { DEJAVU_SANS_B64, DEJAVU_SANS_BOLD_B64 } from "./pdfFonts";
import { embedLogo } from "./invoicePdf";
import { parseHexColor } from "./invoiceDocument";
import { formatMoney } from "./public/money";
import { t } from "./i18n/index";
import type { Locale } from "./i18n/locale";
import type { PartnerFinanceRow, PartnerFinanceTotals, Period } from "./partnerFinance";

export interface CommissionsPdfLine extends PartnerFinanceTotals {
  id: string;
  name: string;
  isActive: boolean;
  rate: number;
}

export interface CommissionsPdfInput {
  lang: Locale;
  company: { name: string; brandColor?: string | null };
  /** Bytes λογοτύπου (PNG/JPEG) ή null. */
  logo: Uint8Array | null;
  period: Period;
  issuedAt: Date;
  partners: CommissionsPdfLine[];
  totals: PartnerFinanceTotals;
  /** Ένας συνεργάτης: και οι κρατήσεις του. */
  bookings?: PartnerFinanceRow[] | null;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const WIDTH = A4[0] - MARGIN * 2;
const FOOTER = 34;
const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.84, 0.86, 0.89);
const ZEBRA = rgb(0.965, 0.97, 0.98);
const FADED = rgb(0.62, 0.64, 0.68);
const DEFAULT_BRAND: [number, number, number] = [0.15, 0.39, 0.92];

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ");

/** Κείμενο που χωρά στο πλάτος (με «…»). */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  const s = clean(text);
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  let out = s;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > width) out = out.slice(0, -1);
  return `${out}…`;
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function periodLabel(p: Period, lang: Locale): string {
  if (p.kind === "all") return t("partner.allMonths", lang);
  return `${dmy(p.from)} – ${dmy(p.to)}`;
}

/** Ημερομηνία/ώρα έκδοσης σε ώρα Ελλάδας. */
export function issuedLabel(d: Date, lang: Locale): string {
  return d.toLocaleString(lang === "en" ? "en-GB" : "el-GR", {
    timeZone: "Europe/Athens",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const commissionsPdfFilename = (p: Period, partnerName?: string | null) =>
  `promitheies-${p.kind === "all" ? "ola" : `${p.from}_${p.to}`}${partnerName ? "-synergatis" : ""}.pdf`;

type Col = { label: string; w: number; align?: "left" | "right" };

export async function buildCommissionsPdf(input: CommissionsPdfInput): Promise<Uint8Array> {
  const { lang } = input;
  const tr = (k: string) => t(k, lang);
  const money = (c: number) => formatMoney(c, lang, { plainSpace: true });
  const pct = (n: number) => `${String(n).replace(".", lang === "en" ? "." : ",")}%`;
  const [br, bg, bb] = parseHexColor(input.company.brandColor ?? "") ?? DEFAULT_BRAND;
  const lum = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
  const BRAND: RGB = lum > 0.72 ? INK : rgb(br, bg, bb);

  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(Buffer.from(DEJAVU_SANS_B64, "base64"), { subset: true });
  const bold = await pdf.embedFont(Buffer.from(DEJAVU_SANS_BOLD_B64, "base64"), { subset: true });
  const logo = await embedLogo(pdf, input.logo);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  let onNewPage: (() => void) | null = null;
  const newPage = () => {
    page = pdf.addPage(A4);
    pages.push(page);
    y = A4[1] - MARGIN;
    onNewPage?.();
  };
  const ensure = (h: number) => {
    if (y - h < MARGIN + FOOTER) newPage();
  };
  const text = (s: string, x: number, size: number, o: { bold?: boolean; color?: RGB; align?: "left" | "right"; w?: number } = {}) => {
    const f = o.bold ? bold : font;
    const str = o.w ? fit(s, f, size, o.w) : clean(s);
    const dx = o.align === "right" ? x - f.widthOfTextAtSize(str, size) : x;
    page.drawText(str, { x: dx, y: y - size, size, font: f, color: o.color ?? INK });
  };

  newPage();

  /* ── Κεφαλίδα: λογότυπο (ή επωνυμία) αριστερά, τίτλος/διάστημα/έκδοση δεξιά ── */
  const top = y;
  let leftBottom = top;
  if (logo) {
    const s = Math.min(150 / logo.width, 56 / logo.height, 1);
    const w = logo.width * s;
    const h = logo.height * s;
    page.drawImage(logo, { x: MARGIN, y: top - h, width: w, height: h });
    y = top - h - 6;
    text(input.company.name || "—", MARGIN, 10, { bold: true, w: 240 });
    leftBottom = y - 14;
  } else {
    text(input.company.name || "—", MARGIN, 16, { bold: true, w: 260, color: BRAND });
    leftBottom = y - 22;
  }
  y = top;
  const right = MARGIN + WIDTH;
  text(tr("partnerCommissions.pdfTitle"), right, 14, { bold: true, align: "right", color: BRAND });
  y -= 20;
  text(`${tr("partnerCommissions.pdfPeriod")}: ${periodLabel(input.period, lang)}`, right, 9.5, { align: "right" });
  y -= 13;
  text(`${tr("partnerCommissions.pdfIssued")}: ${issuedLabel(input.issuedAt, lang)}`, right, 9, { align: "right", color: MUTED });
  y = Math.min(leftBottom, y - 14) - 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1.2, color: BRAND });
  y -= 16;

  /* ── Πίνακας ── */
  const table = (cols: Col[], rows: { cells: string[]; bold?: boolean; faded?: boolean; total?: boolean }[], size = 8.6) => {
    const rowH = 17;
    const header = () => {
      let x = MARGIN;
      page.drawRectangle({ x: MARGIN, y: y - rowH + 3, width: WIDTH, height: rowH, color: ZEBRA });
      for (const c of cols) {
        const pad = 4;
        text(c.label, c.align === "right" ? x + c.w - pad : x + pad, 7.8, { bold: true, color: MUTED, align: c.align, w: c.w - pad * 2 });
        x += c.w;
      }
      y -= rowH;
    };
    onNewPage = header;
    header();
    rows.forEach((r, i) => {
      ensure(rowH + (r.total ? 4 : 0));
      if (r.total) {
        page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: MARGIN + WIDTH, y: y + 2 }, thickness: 1, color: INK });
        y -= 3;
      } else if (i % 2 === 1) {
        page.drawRectangle({ x: MARGIN, y: y - rowH + 4, width: WIDTH, height: rowH, color: rgb(0.985, 0.987, 0.99) });
      }
      let x = MARGIN;
      cols.forEach((c, k) => {
        const pad = 4;
        text(r.cells[k] ?? "", c.align === "right" ? x + c.w - pad : x + pad, size, {
          bold: r.bold || r.total,
          color: r.faded ? FADED : INK,
          align: c.align,
          w: c.w - pad * 2,
        });
        x += c.w;
      });
      y -= rowH;
      if (!r.total) page.drawLine({ start: { x: MARGIN, y: y + 3 }, end: { x: MARGIN + WIDTH, y: y + 3 }, thickness: 0.4, color: LINE });
    });
    onNewPage = null;
  };

  const heading = (s: string) => {
    ensure(40);
    text(s, MARGIN, 11, { bold: true, color: BRAND });
    y -= 20;
  };

  heading(tr("partnerCommissions.pdfPartners"));
  table(
    [
      { label: tr("partnerCommissions.partner"), w: WIDTH - 4 * 88 },
      { label: tr("partnerCommissions.rate"), w: 70, align: "right" },
      { label: tr("partnerCommissions.bookings"), w: 70, align: "right" },
      { label: tr("partner.totalBookings"), w: 106, align: "right" },
      { label: tr("partnerCommissions.commission"), w: 106, align: "right" },
    ],
    [
      ...input.partners.map((p) => ({
        cells: [p.isActive ? p.name : `${p.name} (${tr("partnerCommissions.inactive")})`, pct(p.rate), String(p.bookings), money(p.totalCents), money(p.commissionCents)],
      })),
      {
        total: true,
        cells: [tr("partnerCommissions.allPartners"), "", String(input.totals.bookings), money(input.totals.totalCents), money(input.totals.commissionCents)],
      },
    ]
  );

  if (input.bookings) {
    y -= 14;
    heading(tr("partnerCommissions.pdfBookings"));
    if (input.bookings.length === 0) {
      text(tr("partner.empty"), MARGIN, 9, { color: MUTED });
      y -= 16;
    } else {
      table(
        [
          { label: tr("partnerCommissions.pdfNumber"), w: 66 },
          { label: tr("partner.customer"), w: 112 },
          { label: tr("partnerCommissions.pdfDates"), w: 108 },
          { label: tr("partner.status"), w: 72 },
          { label: tr("partnerCommissions.pdfAmount"), w: 62, align: "right" },
          { label: tr("partner.commission"), w: WIDTH - 66 - 112 - 108 - 72 - 62, align: "right" },
        ],
        input.bookings.map((b) => ({
          faded: !b.counted,
          cells: [
            b.bookingNumber,
            b.customer,
            `${dmy(b.pickupDate)} – ${dmy(b.returnDate)}`,
            // Πλήρης επιστροφή: αυτή είναι η πληροφορία που εξηγεί γιατί δεν μετρά.
            b.refunded ? tr("partner.refunded") : tr(`status.${b.status}`),
            money(b.totalCents),
            // Κωδικός συνεργάτη: μειωμένο ποσοστό δίπλα στο ποσό (βλ. σημείωση κάτω).
            b.code ? `${money(b.commissionCents)} (${pct(b.code.ratePct)}*)` : money(b.commissionCents),
          ],
        })),
        7.8
      );
    }
  }

  y -= 10;
  ensure(30);
  text(tr("partner.countedNote"), MARGIN, 8, { color: MUTED, w: WIDTH });
  if (input.bookings?.some((b) => b.code)) {
    y -= 12;
    ensure(20);
    text(`* ${tr("partner.codeNote")}`, MARGIN, 8, { color: MUTED, w: WIDTH });
  }

  /* ── Υποσέλιδο: «Σελίδα X / Y» ── */
  pages.forEach((p, i) => {
    const label = tr("partnerCommissions.pdfPage").replace("{n}", String(i + 1)).replace("{total}", String(pages.length));
    const w = font.widthOfTextAtSize(label, 8);
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 14 }, end: { x: MARGIN + WIDTH, y: MARGIN + 14 }, thickness: 0.4, color: LINE });
    p.drawText(label, { x: MARGIN + WIDTH - w, y: MARGIN, size: 8, font, color: MUTED });
    p.drawText(fit(input.company.name, font, 8, WIDTH / 2), { x: MARGIN, y: MARGIN, size: 8, font, color: MUTED });
  });

  return pdf.save();
}
