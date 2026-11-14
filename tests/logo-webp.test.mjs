// tests/logo-webp.test.mjs — λογότυπο WebP: μετατρέπεται σε PNG στο ανέβασμα,
// ώστε να μπαίνει στα PDF (το pdf-lib δέχεται μόνο PNG/JPEG).

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const { logoOutputType, LOGO_TYPES } = await import("../src/lib/imageCompress.ts");
const { embedLogo } = await import("../src/lib/invoicePdf.ts");
const { PDFDocument } = await import("pdf-lib");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("WebP και PNG ανεβαίνουν ως PNG· JPEG μένει JPEG· κάθε επιτρεπτός τύπος καταλήγει σε μορφή που δέχεται το PDF", () => {
  assert.equal(logoOutputType("image/webp"), "image/png");
  assert.equal(logoOutputType("image/png"), "image/png");
  assert.equal(logoOutputType("image/jpeg"), "image/jpeg");
  assert.equal(logoOutputType(""), "image/png");
  for (const t of LOGO_TYPES) assert.ok(["image/png", "image/jpeg"].includes(logoOutputType(t)), t);
  assert.match(read("src/lib/imageCompress.ts"), /const type = logoOutputType\(file\.type\);/);
});

test("PDF: PNG μπαίνει· παλιό αποθηκευμένο WebP εξακολουθεί να δίνει null (PDF με την επωνυμία, χωρίς σφάλμα)", async () => {
  const doc = await PDFDocument.create();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  assert.ok(await embedLogo(doc, new Uint8Array(png)));
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c]);
  assert.equal(await embedLogo(doc, webp), null);
});
