// tests/photo-file.test.mjs
// Έλεγχος τύπου αρχείου για «Κάμερα»/«Συλλογή» (src/lib/photoShared.ts):
// iPhone δίνει συχνά κενό file.type (π.χ. HEIC) — δεκτό με βάση την κατάληξη.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_JPEG_QUALITY, PHOTO_MAX_SIDE, PHOTO_TYPES, isImageFile } from "../src/lib/photoShared.ts";

test("image/*: δεκτά (και HEIC/HEIF με τύπο)", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "IMAGE/JPEG"]) {
    assert.equal(isImageFile({ type, name: "x" }), true, type);
  }
});

test("κενός τύπος (iOS): δεκτό με κατάληξη εικόνας ή χωρίς όνομα (κάμερα)", () => {
  for (const name of ["IMG_0001.HEIC", "photo.heif", "a.jpg", "a.JPEG", "b.png", "c.webp"]) {
    assert.equal(isImageFile({ type: "", name }), true, name);
  }
  assert.equal(isImageFile({ type: "", name: "" }), true);
  assert.equal(isImageFile({ type: "application/octet-stream", name: "IMG_2.heic" }), true);
});

test("όχι εικόνες: απορρίπτονται", () => {
  assert.equal(isImageFile({ type: "application/pdf", name: "a.pdf" }), false);
  assert.equal(isImageFile({ type: "video/quicktime", name: "IMG_3.MOV" }), false);
  assert.equal(isImageFile({ type: "", name: "notes.txt" }), false);
  assert.equal(isImageFile({ type: "application/octet-stream", name: "a.zip" }), false);
  // Ψεύτικη κατάληξη με γνωστό μη-εικόνα τύπο: μετρά ο τύπος.
  assert.equal(isImageFile({ type: "text/plain", name: "a.jpg" }), false);
});

test("συμπίεση: JPEG ~0.85, μέγιστη πλευρά 1600· ο server δέχεται JPEG/PNG/WebP", () => {
  assert.equal(PHOTO_JPEG_QUALITY, 0.85);
  assert.equal(PHOTO_MAX_SIDE, 1600);
  assert.deepEqual([...PHOTO_TYPES], ["image/jpeg", "image/png", "image/webp"]);
});
