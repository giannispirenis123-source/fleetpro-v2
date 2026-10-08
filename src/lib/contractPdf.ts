// src/lib/contractPdf.ts
// PDF του συμβολαίου για το email του πελάτη — pdf-lib + DejaVu Sans
// (ελληνικά), ΧΩΡΙΣ headless browser. Μικρό (~40 KB): οι γραμματοσειρές
// μπαίνουν ως subset, οι φωτογραφίες ζημιών ΔΕΝ μπαίνουν (μόνο πλήθος και
// σημείωση ότι υπάρχουν στο link), αντί για QR γράφεται το link.
//
// Ίδια στοιχεία με το Α4 (ContractDocument, mode="print"), δίγλωσσα (BI),
// σε μία στήλη: ετικέτα αριστερά, τιμή δεξιά, και οι δύο με αναδίπλωση.
//
// ΑΣΦΑΛΕΙΑ: κάρτα ΜΟΝΟ ως «Visa •••• 1234». Ο πλήρης αριθμός δεν φτάνει
// καν εδώ (το DTO δεν τον έχει)· επιπλέον ΚΑΘΕ κείμενο περνά από το
// stripCardNumbers (σειρές 13+ ψηφίων → «[•••]»).

import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  BI,
  CARD_BRAND_LABEL,
  DEPOSIT_LABEL,
  FUEL_TYPE_LABEL,
  GDPR_TEXT,
  ID_TYPE_LABEL,
  PAYMENT_LABEL,
  STATUS_LABEL,
  fuelLabel,
  type CardInfo,
  type ContractDTO,
  type ContractDriver,
} from "./contracts";
import { toDisplayBreakdown } from "./pricing";
import { withManualRental } from "./priceOverride";
import { splitVatInclusive } from "./invoices";
import { stripCardNumbers } from "./contractEmail";
import { DEJAVU_SANS_B64, DEJAVU_SANS_BOLD_B64 } from "./pdfFonts";

export interface ContractPdfInput {
  contract: ContractDTO;
  /** Το link πελάτη (/c/<token>) — τυπώνεται αντί για QR. */
  url: string;
  /** Για παλιά snapshot χωρίς ΦΠΑ. */
  fallbackVatRate?: number;
  /** Για τη χρονοσφραγίδα δημιουργίας (tests). */
  now?: Date;
}

/* ─────────────────────────────────────────────
   Μορφοποίηση (ίδια με το Α4)
   ───────────────────────────────────────────── */

const eur = (n: number) =>
  new Intl.NumberFormat("el-GR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(n)
    .replace(/[  ]/g, " ");

const d = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, day] = iso.slice(0, 10).split("-");
  return y && m && day ? `${day}/${m}/${y}` : "—";
};

const dt = (date: string | undefined, time: string | null | undefined) =>
  date ? `${d(date)}${time ? ` ${time}` : ""}` : "—";

const stamp = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("el-GR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Athens",
      }).format(new Date(iso))
    : "—";

const v = (s: string | null | undefined) => (s && s.trim() ? s.trim() : "—");

/** Κάρτα ΜΟΝΟ ως «Visa •••• 1234» — χωρίς κάτοχο/λήξη, ποτέ πλήρης αριθμός. */
export function maskedCard(c: CardInfo | null): string {
  if (!c || !/^\d{4}$/.test(c.last4)) return "";
  const brand = c.brand === "OTHER" ? "Κάρτα / Card" : CARD_BRAND_LABEL[c.brand] ?? "Κάρτα / Card";
  // Αδιάσπαστο κενό: το «•••• 1234» δεν σπάει ποτέ σε δύο γραμμές.
  return `${brand}\u00a0••••\u00a0${c.last4}`;
}

/* ─────────────────────────────────────────────
   Διάταξη
   ───────────────────────────────────────────── */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const WIDTH = A4[0] - MARGIN * 2;
const LABEL_W = 168;
const GAP = 10;
const VALUE_W = WIDTH - LABEL_W - GAP;
const MONEY_W = 90;
const FOOTER = 28;

const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.82, 0.84, 0.87);
const ACCENT = rgb(0.15, 0.39, 0.92);

/** Κάθε κείμενο του PDF: χωρίς αριθμούς κάρτας, χωρίς χαρακτήρες ελέγχου. */
const clean = (s: string) =>
  stripCardNumbers(s.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ""));

class Writer {
  private page!: PDFPage;
  private y = 0;
  readonly pages: PDFPage[] = [];
  private doc: PDFDocument;
  private font: PDFFont;
  private bold: PDFFont;

  // Χωρίς «parameter properties»: τα tests τρέχουν με type stripping του Node.
  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.newPage();
  }

  private newPage() {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - MARGIN;
  }

  /** Χώρος για `h` pt· αλλιώς νέα σελίδα. */
  ensure(h: number) {
    if (this.y - h < MARGIN + FOOTER) this.newPage();
  }

  gap(h: number) {
    this.y -= h;
  }

  /** Αναδίπλωση σε λέξεις· πολύ μεγάλες λέξεις (π.χ. URL) σπάνε σε χαρακτήρες. */
  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of clean(text).split("\n")) {
      const words = para.split(/ +/).filter((w, i, a) => w !== "" || a.length === 1);
      let line = "";
      const push = (w: string) => {
        const cand = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(cand, size) <= width) {
          line = cand;
          return;
        }
        if (line) out.push(line);
        line = "";
        // Η λέξη μόνη της δεν χωρά: σπάσιμο σε χαρακτήρες.
        let chunk = "";
        for (const ch of Array.from(w)) {
          if (font.widthOfTextAtSize(chunk + ch, size) > width && chunk) {
            out.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      };
      for (const w of words) push(w);
      out.push(line);
    }
    return out;
  }

  /** Παράγραφος σε όλο το πλάτος. */
  para(text: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number } = {}) {
    const size = o.size ?? 9;
    const font = o.bold ? this.bold : this.font;
    const lh = size * 1.32;
    for (const l of this.wrap(text, font, size, o.width ?? WIDTH)) {
      this.ensure(lh);
      this.page.drawText(l, { x: MARGIN + (o.x ?? 0), y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= lh;
    }
  }

  /** Τίτλος ενότητας με γραμμή από κάτω· δεν μένει ορφανός στο τέλος σελίδας. */
  heading(text: string) {
    this.ensure(46);
    this.gap(8);
    this.para(text, { size: 10.5, bold: true, color: ACCENT });
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 1 },
      end: { x: MARGIN + WIDTH, y: this.y + 1 },
      thickness: 0.6,
      color: LINE,
    });
    this.gap(5);
  }

  subheading(text: string) {
    this.ensure(30);
    this.gap(3);
    this.para(text, { size: 9.5, bold: true });
    this.gap(1);
  }

  /**
   * Γραμμή «ετικέτα — τιμή»: δύο στήλες, η καθεμία με δική της αναδίπλωση·
   * το ύψος = το μεγαλύτερο από τα δύο, ώστε να μην επικαλύπτονται ποτέ.
   */
  row(label: string, value: string, o: { boldValue?: boolean; money?: boolean } = {}) {
    const size = 9;
    const lh = size * 1.32;
    const vFont = o.boldValue ? this.bold : this.font;
    // Ποσά: φαρδιά ετικέτα (σε όλο σχεδόν το πλάτος), ποσό δεξιά.
    const labelW = o.money ? WIDTH - MONEY_W - GAP : LABEL_W;
    const valueW = o.money ? MONEY_W : VALUE_W;
    const labelSize = o.money ? 9 : 8.5;
    const ls = this.wrap(label, this.font, labelSize, labelW);
    const vs = this.wrap(value, vFont, size, valueW);
    const n = Math.max(ls.length, vs.length);
    // Μικρές γραμμές δεν σπάνε ανάμεσα σε σελίδες.
    if (n * lh <= 120) this.ensure(n * lh + 3);
    for (let i = 0; i < n; i++) {
      this.ensure(lh);
      if (ls[i]) {
        this.page.drawText(ls[i], {
          x: MARGIN,
          y: this.y - size,
          size: labelSize,
          font: this.font,
          color: o.money ? INK : MUTED,
        });
      }
      if (vs[i]) {
        const x = o.money
          ? MARGIN + WIDTH - vFont.widthOfTextAtSize(vs[i], size)
          : MARGIN + LABEL_W + GAP;
        this.page.drawText(vs[i], { x, y: this.y - size, size, font: vFont, color: INK });
      }
      this.y -= lh;
    }
    this.y -= 3;
  }

  image(img: PDFImage, maxW: number, maxH: number) {
    const s = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * s;
    const h = img.height * s;
    this.ensure(h + 4);
    this.page.drawImage(img, { x: MARGIN, y: this.y - h, width: w, height: h });
    this.y -= h + 4;
  }

  /** Αρίθμηση σελίδων και κωδικός σε κάθε υποσέλιδο. */
  footer(code: string) {
    const total = this.pages.length;
    this.pages.forEach((p, i) => {
      const text = `${code} · ${i + 1}/${total}`;
      p.drawText(text, {
        x: MARGIN + WIDTH - this.font.widthOfTextAtSize(text, 7.5),
        y: MARGIN - 10,
        size: 7.5,
        font: this.font,
        color: MUTED,
      });
    });
  }
}

/** data:image/png;base64,… → bytes (μόνο PNG — έτσι αποθηκεύονται οι υπογραφές). */
function pngBytes(dataUrl: string | null): Uint8Array | null {
  const m = dataUrl ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  return m ? Uint8Array.from(Buffer.from(m[1], "base64")) : null;
}

function driverRows(w: Writer, drv: ContractDriver) {
  w.row(BI.name, v(drv.fullName));
  w.row(BI.country, v(drv.country));
  w.row(BI.licenseNo, v(drv.licenseNumber));
  w.row(BI.licenseExpiry, d(drv.licenseExpiry));
  w.row(BI.birthDate, d(drv.birthDate));
  w.row(BI.idDoc, `${ID_TYPE_LABEL[drv.idType] ?? ""} · ${v(drv.idNumber)}`);
  w.row(BI.phone, v(drv.phone));
  w.row(BI.email, v(drv.email));
  w.row(BI.address, v(drv.address));
}

export async function buildContractPdf(input: ContractPdfInput): Promise<Uint8Array> {
  const { contract, url } = input;
  const s = contract.snapshot;

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [font, bold] = await Promise.all([
    doc.embedFont(Buffer.from(DEJAVU_SANS_B64, "base64"), { subset: true }),
    doc.embedFont(Buffer.from(DEJAVU_SANS_BOLD_B64, "base64"), { subset: true }),
  ]);
  doc.setTitle(`${BI.contract} ${contract.contractNumber}`);
  doc.setSubject(contract.contractNumber);
  doc.setCreator("FleetPro");
  doc.setProducer("FleetPro");
  doc.setCreationDate(input.now ?? new Date());

  const w = new Writer(doc, font, bold);

  /* ── Κεφαλίδα εταιρίας ── */
  w.para(v(s?.company.name), { size: 14, bold: true });
  for (const line of [
    s?.company.region,
    s?.company.address,
    `${BI.vat}: ${v(s?.company.vat)} · ${BI.taxOffice}: ${v(s?.company.taxOffice)}`,
    `${BI.phone}: ${v(s?.company.phone)} · ${BI.email}: ${v(s?.company.email)}`,
  ]) {
    if (line && line.trim()) w.para(line, { size: 8.5, color: MUTED });
  }
  w.gap(10);

  /* ── Τίτλος ── */
  w.para(BI.contract, { size: 16, bold: true });
  w.gap(4);
  w.row(BI.code, contract.contractNumber, { boldValue: true });
  w.row(BI.booking, v(s?.booking.number || contract.bookingNumber));
  w.row(BI.issuedBy, v(contract.createdByName));
  w.row(BI.status, STATUS_LABEL[contract.status] ?? contract.status);

  /* ── Οδηγοί ── */
  const [main, ...others] = contract.drivers;
  w.heading(BI.mainDriver);
  if (main) driverRows(w, main);
  else w.para("—");

  if (others.length > 0) {
    w.heading(BI.extraDrivers);
    others.forEach((o, i) => {
      w.subheading(`#${i + 2} ${v(o.fullName)}`);
      driverRows(w, o);
    });
  }

  /* ── Όχημα, παραλαβή, παράδοση ── */
  w.heading(BI.vehicle);
  w.row(BI.model, s ? `${s.vehicle.brand} ${s.vehicle.model}`.trim() || "—" : "—");
  w.row(BI.plate, v(s?.vehicle.plate));
  w.row(BI.fuelType, FUEL_TYPE_LABEL[contract.fuelType ?? s?.vehicle.fuel ?? ""] ?? "—");

  const electric = s?.vehicle.fuel === "ELECTRIC";
  w.heading(BI.pickup);
  w.row(BI.location, v(contract.pickupLocation));
  w.row(BI.dateTime, dt(s?.booking.pickupDate, s?.booking.pickupTime));
  w.row(electric ? BI.battery : BI.fuel, fuelLabel(contract.fuelPickup));

  w.heading(BI.return);
  w.row(BI.location, v(contract.returnLocation));
  w.row(BI.dateTime, dt(s?.booking.returnDate, s?.booking.returnTime));

  /* ── Ζημιές: περιγραφή + ΠΛΗΘΟΣ φωτογραφιών (οι ίδιες στο link) ── */
  w.heading(BI.damagesTitle);
  const groups = [
    { group: "PICKUP", label: BI.damagesPickup, notes: contract.damageNotesPickup.trim() },
    { group: "RETURN", label: BI.damagesReturn, notes: contract.damageNotesReturn.trim() },
  ].map((g) => ({ ...g, count: contract.damagePhotos.filter((p) => p.group === g.group).length }));
  const anyDamage = groups.some((g) => g.notes || g.count > 0) || contract.damageMarks.length > 0;
  if (!anyDamage) {
    w.para(BI.noDamages);
  } else {
    for (const g of groups) {
      if (!g.notes && g.count === 0) continue;
      const parts = [
        g.notes,
        g.count > 0 ? `Φωτογραφίες / Photos: ${g.count}` : "",
      ].filter(Boolean);
      w.row(g.label, parts.join("\n"));
    }
    if (contract.damageMarks.length > 0) {
      w.row(
        BI.oldSketch,
        contract.damageMarks.map((m, i) => `${i + 1}. ${v(m.note)}`).join("\n")
      );
    }
    if (contract.damagePhotos.length > 0) {
      w.para(
        "Οι φωτογραφίες ζημιών υπάρχουν στο online συμβόλαιο (link παρακάτω). / The damage photos are available in the online agreement (link below).",
        { size: 8, color: MUTED }
      );
    }
  }

  if (contract.vehicleChanges.length > 0) {
    w.heading(BI.vehicleChanges);
    for (const c of contract.vehicleChanges) {
      w.row(d(c.date), `${v(c.label)} · ${v(c.plate)}`);
    }
  }

  if (contract.notes.trim()) {
    w.heading(BI.notes);
    w.para(contract.notes.trim());
  }

  /* ── Χρεώσεις (ίδιος υπολογισμός με το Α4) ── */
  w.heading(BI.charges);
  const manualRental = s?.priceOverride?.manualRental;
  const money = s
    ? manualRental !== undefined
      ? withManualRental(s.booking, manualRental)
      : toDisplayBreakdown(s.booking)
    : null;
  if (s && money) {
    const rentalLabel = `${BI.rental} · ${s.booking.totalDays} ${BI.days}${
      s.priceOverride ? "" : ` × ${eur(s.booking.dailyRate)}`
    }`;
    w.row(rentalLabel, eur(money.subtotal), { money: true });
    for (const x of s.extras) w.row(`${BI.extras}: ${x.name}`, eur(x.lineTotal), { money: true });
    for (const x of s.insurance) {
      w.row(
        `${BI.insurance}: ${x.name}${x.excess !== null ? ` (${BI.excess}: ${eur(x.excess)})` : ""}`,
        eur(x.lineTotal),
        { money: true }
      );
    }
    if (money.discountAmount > 0) {
      w.row(
        `${BI.discount}${s.booking.discountCode ? ` (${s.booking.discountCode})` : ""}`,
        `−${eur(money.discountAmount)}`,
        { money: true }
      );
    }
    w.row(BI.total, eur(money.total), { boldValue: true, money: true });
    const vatRate = s.vatRate ?? input.fallbackVatRate;
    if (vatRate !== undefined) {
      const vat = splitVatInclusive(money.total, vatRate);
      w.para(
        `${BI.ofWhich}: ${BI.net} ${eur(vat.net)} + ${BI.vatShort} ${vat.vatRate}% ${eur(vat.vatAmount)}`,
        { size: 8, color: MUTED }
      );
    }
  } else {
    w.para("—");
  }

  /* ── Πληρωμή / εγγύηση: κάρτα ΜΟΝΟ «•••• 1234» ── */
  w.heading(BI.payment);
  w.row(
    BI.payment,
    [contract.paymentMethod ? PAYMENT_LABEL[contract.paymentMethod] : null, maskedCard(contract.paymentCard) || null]
      .filter(Boolean)
      .join(" · ") || "—"
  );
  w.row(
    BI.deposit,
    [
      contract.depositAmount !== null ? eur(contract.depositAmount) : null,
      contract.depositMethod ? DEPOSIT_LABEL[contract.depositMethod] : null,
      maskedCard(contract.depositCard) || null,
    ]
      .filter(Boolean)
      .join(" · ") || "—"
  );
  if (s && s.insurance.length === 0) w.row(BI.insurance, "—");

  /* ── Όροι ── */
  if (s?.terms.el || s?.terms.en) {
    w.heading(BI.terms);
    if (s.terms.el) {
      w.para(s.terms.el, { size: 8 });
      w.gap(6);
    }
    if (s.terms.en) w.para(s.terms.en, { size: 8 });
  }

  w.heading(BI.gdpr);
  const box = contract.gdprConsent ? "☑" : "☐";
  w.para(`${box} ${GDPR_TEXT.el}`, { size: 8 });
  w.gap(3);
  w.para(`${box} ${GDPR_TEXT.en}`, { size: 8 });

  /* ── Υπογραφές ── */
  w.heading(BI.signatures);
  for (const drv of contract.drivers) {
    w.ensure(90);
    w.para(v(drv.fullName), { bold: true });
    const bytes = pngBytes(drv.signature);
    let drawn = false;
    if (bytes) {
      try {
        w.image(await doc.embedPng(bytes), 180, 60);
        drawn = true;
      } catch {
        // Χαλασμένη εικόνα: γράφουμε μόνο την ημερομηνία υπογραφής.
      }
    }
    if (!drawn && !drv.signedAt) w.para(BI.notSigned, { size: 8, color: MUTED });
    if (drv.signedAt) w.para(`${BI.signedAt}: ${stamp(drv.signedAt)}`, { size: 8, color: MUTED });
    w.gap(6);
  }

  /* ── Link αντί για QR ── */
  w.heading(BI.qr);
  w.para(url, { size: 9, color: ACCENT });

  w.footer(contract.contractNumber);
  return doc.save({ useObjectStreams: true });
}
