// src/lib/imageCompress.ts
// Συμπίεση φωτογραφίας ΣΤΟΝ BROWSER πριν το ανέβασμα: μέγιστη πλευρά
// ~1600px, JPEG ~0.8. Μια φωτογραφία κινητού (4–8 MB) γίνεται ~300 KB,
// ώστε να μη «τρώει» τα δεδομένα του κινητού.
//
// Client-only (canvas).

import { PHOTO_JPEG_QUALITY, PHOTO_MAX_SIDE } from "./photoShared";

async function decode(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; close: () => void }> {
  // createImageBitmap γυρίζει την εικόνα σωστά με βάση το EXIF.
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      /* πέφτουμε στο <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    return { img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * Επιστρέφει JPEG. Αν ο browser δεν μπορεί να διαβάσει την εικόνα (π.χ.
 * HEIC σε μη-Safari), πετά σφάλμα και το UI δείχνει καθαρό μήνυμα.
 */
export async function compressImage(file: File): Promise<Blob> {
  const { img, w, h, close } = await decode(file);
  try {
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(w, h));
    const width = Math.max(1, Math.round(w * scale));
    const height = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    // Λευκό φόντο: τα διάφανα PNG δεν γίνονται μαύρα στο JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", PHOTO_JPEG_QUALITY)
    );
    if (!blob) throw new Error("encode");

    // Πάντα το νέο αρχείο: η επανακωδικοποίηση σβήνει και τα EXIF
    // (π.χ. τοποθεσία GPS του κινητού).
    return blob;
  } finally {
    close();
  }
}
