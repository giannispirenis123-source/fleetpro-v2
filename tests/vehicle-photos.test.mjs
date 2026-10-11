// tests/vehicle-photos.test.mjs
// Φωτογραφίες οχήματος (Cloudinary): src/lib/vehiclePhotos.ts (καθαρή λογική)
// και src/lib/cloudinary.ts (ρυθμίσεις + υπογραφή). Τρέχει με `npm test`.

import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Τα .ts του src εισάγουν σχετικά αρχεία χωρίς κατάληξη ("./vehiclePhotos").
register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }"
    )
);

const {
  MAX_VEHICLE_PHOTOS,
  VEHICLE_PHOTO_MSG,
  canAddPhoto,
  cloudinaryImageUrl,
  cloudinaryThumb,
  isPublicIdInFolder,
  mainPhotoUrl,
  movePhoto,
  publicIdFromUrl,
  readVehiclePhotos,
  reorderPhotos,
  toPhotoViews,
  vehiclePhotoFolder,
} = await import("../src/lib/vehiclePhotos.ts");
const { cloudinaryConfig, signVehicleUpload } = await import("../src/lib/cloudinary.ts");

const URL_A = "https://res.cloudinary.com/demo/image/upload/v1700000000/fleetpro/t1/vehicles/v1/aaa.jpg";
const photo = (id, order, extra = {}) => ({
  id,
  url: `https://res.cloudinary.com/demo/image/upload/v1/fleetpro/t1/vehicles/v1/${id}.jpg`,
  publicId: `fleetpro/t1/vehicles/v1/${id}`,
  order,
  ...extra,
});

test("όριο 10 φωτογραφιών", () => {
  assert.equal(MAX_VEHICLE_PHOTOS, 10);
  assert.equal(canAddPhoto(0), true);
  assert.equal(canAddPhoto(9), true);
  assert.equal(canAddPhoto(10), false);
  assert.equal(canAddPhoto(11), false);
});

test("φάκελος: fleetpro/{companyId}/vehicles/{vehicleId}, μόνο ασφαλή ids", () => {
  assert.equal(vehiclePhotoFolder("t1", "v1"), "fleetpro/t1/vehicles/v1");
  assert.equal(vehiclePhotoFolder("t1/../t2", "v1"), null);
  assert.equal(vehiclePhotoFolder("t1", ""), null);
  assert.equal(vehiclePhotoFolder("t 1", "v1"), null);
});

test("publicId δεκτό ΜΟΝΟ μέσα στον φάκελο του οχήματος της εταιρίας", () => {
  const folder = "fleetpro/t1/vehicles/v1";
  assert.equal(isPublicIdInFolder("fleetpro/t1/vehicles/v1/abc123", folder), true);
  // άλλη εταιρία / άλλο όχημα
  assert.equal(isPublicIdInFolder("fleetpro/t2/vehicles/v1/abc123", folder), false);
  assert.equal(isPublicIdInFolder("fleetpro/t1/vehicles/v2/abc123", folder), false);
  // πρόθεμα που μοιάζει (v1 → v10)
  assert.equal(isPublicIdInFolder("fleetpro/t1/vehicles/v10/abc123", folder), false);
  // υποφάκελος, «..», κενό, μη string
  assert.equal(isPublicIdInFolder("fleetpro/t1/vehicles/v1/x/abc", folder), false);
  assert.equal(isPublicIdInFolder("fleetpro/t1/vehicles/v1/../../t2/x", folder), false);
  assert.equal(isPublicIdInFolder("fleetpro/t1/vehicles/v1/", folder), false);
  assert.equal(isPublicIdInFolder(42, folder), false);
});

test("το URL φτιάχνεται στον server από cloud, έκδοση, publicId, τύπο", () => {
  assert.equal(
    cloudinaryImageUrl("demo", 1700000000, "fleetpro/t1/vehicles/v1/aaa", "jpg"),
    URL_A
  );
});

test("μικρογραφία: f_auto, q_auto, πλάτος — ξένα URL μένουν ίδια", () => {
  assert.equal(
    cloudinaryThumb(URL_A, 400),
    "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_400/v1700000000/fleetpro/t1/vehicles/v1/aaa.jpg"
  );
  assert.match(cloudinaryThumb(URL_A, 99999), /w_2000\//);
  assert.equal(cloudinaryThumb("https://example.com/a.jpg", 400), "https://example.com/a.jpg");
});

test("publicId από παλιό URL (μεταφορά της στήλης images)", () => {
  assert.equal(publicIdFromUrl(URL_A), "fleetpro/t1/vehicles/v1/aaa");
  assert.equal(publicIdFromUrl("https://res.cloudinary.com/demo/image/upload/car.png"), "car");
  assert.equal(publicIdFromUrl("https://example.com/a.jpg"), null);
});

test("ανάγνωση: ταξινόμηση κατά order, επαναρίθμηση, αγνοεί σκουπίδια", () => {
  const list = readVehiclePhotos([
    photo("bbbbbb", 5),
    null,
    { id: "x", url: "javascript:alert(1)" },
    photo("aaaaaa", 2),
    { id: "nopub1", url: "https://example.com/c.jpg" },
  ]);
  assert.deepEqual(
    list.map((p) => [p.id, p.order]),
    [
      ["aaaaaa", 0],
      ["nopub1", 1],
      ["bbbbbb", 2],
    ]
  );
  assert.equal(list[1].publicId, null);
  assert.deepEqual(readVehiclePhotos("όχι πίνακας"), []);
  assert.deepEqual(readVehiclePhotos(null), []);
});

test("κύρια = η πρώτη· χωρίς φωτογραφίες → null (placeholder)", () => {
  const list = readVehiclePhotos([photo("bbbbbb", 1), photo("aaaaaa", 0)]);
  assert.equal(mainPhotoUrl(list), list[0].url);
  assert.equal(list[0].id, "aaaaaa");
  assert.equal(mainPhotoUrl([]), null);
  // η οθόνη δεν παίρνει publicId
  assert.deepEqual(Object.keys(toPhotoViews(list)[0]).sort(), ["id", "url"]);
});

test("Πάνω/Κάτω: αλλάζει θέση, στα άκρα μένει ίδιο", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(movePhoto(list, "b", -1).map((p) => p.id), ["b", "a", "c"]);
  assert.deepEqual(movePhoto(list, "b", 1).map((p) => p.id), ["a", "c", "b"]);
  assert.equal(movePhoto(list, "a", -1), list);
  assert.equal(movePhoto(list, "c", 1), list);
  assert.equal(movePhoto(list, "zzz", 1), list);
});

test("νέα σειρά: μόνο ακριβώς οι ίδιες φωτογραφίες", () => {
  const cur = [photo("aaaaaa", 0), photo("bbbbbb", 1), photo("cccccc", 2)];
  const next = reorderPhotos(cur, ["cccccc", "aaaaaa", "bbbbbb"]);
  assert.deepEqual(next.map((p) => [p.id, p.order]), [
    ["cccccc", 0],
    ["aaaaaa", 1],
    ["bbbbbb", 2],
  ]);
  assert.equal(next[0].publicId, "fleetpro/t1/vehicles/v1/cccccc");
  assert.equal(reorderPhotos(cur, ["aaaaaa", "bbbbbb"]), null); // λείπει
  assert.equal(reorderPhotos(cur, ["aaaaaa", "aaaaaa", "bbbbbb"]), null); // διπλή
  assert.equal(reorderPhotos(cur, ["aaaaaa", "bbbbbb", "zzzzzz"]), null); // ξένη
  assert.equal(reorderPhotos(cur, "aaaaaa"), null);
});

test("μηνύματα στα ελληνικά", () => {
  assert.match(VEHICLE_PHOTO_MSG.limit, /Έως 10 φωτογραφίες/);
  assert.match(VEHICLE_PHOTO_MSG.adminOnly, /Διαχειριστής/);
  assert.match(VEHICLE_PHOTO_MSG.badType, /JPEG, PNG ή WebP/);
});

test("ρυθμίσεις Cloudinary: μόνο ονόματα όσων λείπουν", () => {
  assert.deepEqual(cloudinaryConfig({}), {
    ok: false,
    missing: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
  });
  const partial = cloudinaryConfig({ CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "k" });
  assert.deepEqual(partial, { ok: false, missing: ["CLOUDINARY_API_SECRET"] });
  const full = cloudinaryConfig({
    CLOUDINARY_CLOUD_NAME: ' "demo" ',
    CLOUDINARY_API_KEY: "k",
    CLOUDINARY_API_SECRET: "s",
  });
  assert.equal(full.ok, true);
  assert.equal(full.config.cloudName, "demo");
  // παλιό όνομα από το .env.example
  assert.equal(
    cloudinaryConfig({ NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" }).ok,
    true
  );
});

test("υπογραφή: SHA-1 των ταξινομημένων παραμέτρων + secret, χωρίς το secret στην απάντηση", () => {
  const secret = "test-secret-not-real";
  const signed = signVehicleUpload(
    { cloudName: "demo", apiKey: "key-1", apiSecret: secret },
    "fleetpro/t1/vehicles/v1",
    new Date("2026-10-08T10:00:00Z")
  );
  const expected = createHash("sha1")
    .update(`allowed_formats=jpg,jpeg,png,webp&folder=fleetpro/t1/vehicles/v1&timestamp=${signed.timestamp}${secret}`)
    .digest("hex");
  assert.equal(signed.signature, expected);
  assert.equal(signed.timestamp, Date.parse("2026-10-08T10:00:00Z") / 1000);
  assert.equal(signed.folder, "fleetpro/t1/vehicles/v1");
  assert.equal(signed.uploadUrl, "https://api.cloudinary.com/v1_1/demo/image/upload");
  assert.ok(!JSON.stringify(signed).includes(secret));
});
