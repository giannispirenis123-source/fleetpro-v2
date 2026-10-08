// src/lib/photoUpload.ts
// Ανέβασμα μίας φωτογραφίας από τον browser — ΚΟΙΝΟ για το PhotoManager
// (άμεσο ανέβασμα) και για τις φωτογραφίες νέου συμβολαίου που ανεβαίνουν
// μετά την πρώτη αποθήκευση. Ίδια endpoints, ίδια μηνύματα αιτίας.

import type { PhotoItem } from "./photoShared";

/** Ανέβασμα με XHR για να έχουμε πρόοδο (το fetch δεν δίνει upload progress). */
export function sendPhoto<B = { message?: string; data?: { photo: PhotoItem } }>(
  url: string,
  form: FormData,
  onProgress: (p: number) => void
): Promise<{ status: number; body: B }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body = {} as B;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* κενό ή μη JSON */
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(form);
  });
}

/**
 * Μήνυμα όταν ο server δεν έδωσε δικό του (π.χ. το Vercel κόβει μεγάλο
 * αίτημα με 413 σε HTML, ή timeout). Με μήνυμα από τον server, δείχνεται
 * εκείνο — είναι πάντα συγκεκριμένο και ασφαλές.
 */
export function uploadErrorFor(status: number, tr: (k: string) => string): string {
  if (status === 401) return tr("photos.errorSession");
  if (status === 403) return tr("photos.errorPermission");
  if (status === 413) return tr("photos.errorTooLarge");
  if (status === 415 || status === 400) return tr("photos.errorType");
  if (status === 0 || status === 502 || status === 504) return tr("photos.errorConnection");
  return `${tr("photos.errorUpload")} (HTTP ${status})`;
}
