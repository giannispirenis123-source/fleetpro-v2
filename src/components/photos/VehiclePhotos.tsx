"use client";

// Φωτογραφίες οχήματος (Στόλος) — gallery + lightbox, με το ΚΟΙΝΟ PhotoManager.
//
// Ανέβασμα (μόνο Διαχειριστής):
//  1. συμπίεση στον browser (PhotoManager → compressImage: JPEG, 1600px, 0.85, και HEIC)
//  2. POST /api/vehicles/{id}/photos/sign → υπογραφή (ο server ελέγχει ρόλο, εταιρία, όριο 10)
//  3. ανέβασμα ΑΠΕΥΘΕΙΑΣ στο Cloudinary με πρόοδο (sendPhoto)
//  4. POST /api/vehicles/{id}/photos { publicId, version, format } → ο server ξαναελέγχει όριο και φάκελο
// Σειρά: «Πάνω/Κάτω» → PATCH { order }. Η πρώτη είναι η κύρια.

import { useState } from "react";
import { useT } from "@/lib/i18n/I18nProvider";
import PhotoManager from "./PhotoManager";
import PhotoLightbox from "./PhotoLightbox";
import { sendPhoto, uploadErrorFor } from "@/lib/photoUpload";
import type { PhotoItem } from "@/lib/photoShared";
import {
  MAX_VEHICLE_PHOTOS,
  cloudinaryThumb,
  movePhoto,
  type VehiclePhotoView,
} from "@/lib/vehiclePhotos";

type Updater = (fn: (prev: VehiclePhotoView[]) => VehiclePhotoView[]) => void;

interface SignResponse {
  success?: boolean;
  message?: string;
  data?: {
    cloudName: string;
    apiKey: string;
    timestamp: number;
    folder: string;
    allowedFormats: string;
    signature: string;
    uploadUrl: string;
  };
}

interface CloudinaryResponse {
  public_id?: string;
  version?: number;
  format?: string;
  error?: { message?: string };
}

export default function VehiclePhotos({
  vehicleId,
  photos,
  canManage,
  onChange,
  alt,
}: {
  vehicleId: string;
  photos: VehiclePhotoView[];
  canManage: boolean;
  onChange: Updater;
  alt: string;
}) {
  const tr = useT();
  const [open, setOpen] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/vehicles/${vehicleId}/photos`;

  const upload = async (blob: Blob, onProgress: (p: number) => void): Promise<PhotoItem> => {
    // 1. Υπογραφή
    let signRes: Response;
    try {
      signRes = await fetch(`${base}/sign`, { method: "POST" });
    } catch {
      throw new Error(tr("photos.errorConnection"));
    }
    const sign = (await signRes.json().catch(() => ({}))) as SignResponse;
    if (!signRes.ok || !sign.data) throw new Error(sign.message || uploadErrorFor(signRes.status, tr));
    const s = sign.data;

    // 2. Cloudinary (το secret δεν υπάρχει εδώ — μόνο η υπογραφή)
    const form = new FormData();
    form.append("file", blob, "photo.jpg");
    form.append("api_key", s.apiKey);
    form.append("timestamp", String(s.timestamp));
    form.append("folder", s.folder);
    form.append("allowed_formats", s.allowedFormats);
    form.append("signature", s.signature);
    let up: { status: number; body: CloudinaryResponse };
    try {
      up = await sendPhoto<CloudinaryResponse>(s.uploadUrl, form, onProgress);
    } catch {
      throw new Error(tr("photos.errorConnection"));
    }
    if (up.status < 200 || up.status >= 300 || !up.body.public_id || !up.body.version || !up.body.format) {
      const msg = up.body.error?.message ?? "";
      throw new Error(/format|file type|invalid image/i.test(msg) ? tr("photos.errorType") : tr("vehiclePhotos.errorCloudinary"));
    }

    // 3. Αποθήκευση στη βάση
    let saveRes: Response;
    try {
      saveRes = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId: up.body.public_id, version: up.body.version, format: up.body.format }),
      });
    } catch {
      throw new Error(tr("photos.errorConnection"));
    }
    const saved = (await saveRes.json().catch(() => ({}))) as {
      message?: string;
      data?: { photo: VehiclePhotoView };
    };
    if (!saveRes.ok || !saved.data?.photo) throw new Error(saved.message || uploadErrorFor(saveRes.status, tr));
    return { ...saved.data.photo, takenAt: null, note: "" };
  };

  const move = async (id: string, dir: -1 | 1) => {
    const next = movePhoto(photos, id, dir);
    if (next === photos) return;
    setMoving(true);
    setError("");
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: next.map((p) => p.id) }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; data?: { photos: VehiclePhotoView[] } };
      if (!res.ok || !body.data) {
        setError(body.message || tr("vehiclePhotos.errorOrder"));
        return;
      }
      onChange(() => body.data!.photos);
    } catch {
      setError(tr("photos.errorConnection"));
    } finally {
      setMoving(false);
    }
  };

  return (
    <>
      <PhotoManager
        photos={photos.map((p) => ({ id: p.id, url: p.url, takenAt: null, note: "" }))}
        uploadUrl={base}
        itemUrl={(id) => `${base}/${id}`}
        editable={canManage}
        withNotes={false}
        max={MAX_VEHICLE_PHOTOS}
        lockedText={canManage ? undefined : tr("vehiclePhotos.viewOnly")}
        onAdded={(photo) =>
          onChange((prev) =>
            prev.some((p) => p.id === photo.id) ? prev : [...prev, { id: photo.id, url: photo.url ?? "" }]
          )
        }
        onRemoved={(id) => onChange((prev) => prev.filter((p) => p.id !== id))}
        onNoted={() => {}}
        upload={upload}
        onMove={move}
        moving={moving}
        onOpen={setOpen}
        thumb={(url) => cloudinaryThumb(url, 400)}
        mainLabel={tr("vehiclePhotos.main")}
      />
      {error && <div className="dash-form-error">{error}</div>}
      {open !== null && photos.length > 0 && (
        <PhotoLightbox
          urls={photos.map((p) => cloudinaryThumb(p.url, 1600))}
          index={Math.min(open, photos.length - 1)}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          alt={alt}
        />
      )}
    </>
  );
}
