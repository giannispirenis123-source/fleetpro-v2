"use client";

// src/app/(dashboard)/dashboard/storefront/ContentTabs.tsx
// Καρτέλες «Μέρη» και «Κριτικές» του «Η σελίδα μου» — πάνω στο ResourceList
// (/api/public-site/places, /api/public-site/reviews). Μόνο Διαχειριστής με
// publicSite (ο server το ελέγχει σε κάθε αίτημα).

import { useEffect, useState } from "react";
import { Plus, Star, X } from "lucide-react";
import VehiclePhotos from "@/components/photos/VehiclePhotos";
import { useT } from "@/lib/i18n/I18nProvider";
import { suggestPlaceSlug, PLACE_DETAILS_MAX } from "@/lib/public/places";
import type { LocalizedText } from "@/lib/public/text";
import type { VehiclePhotoView } from "@/lib/vehiclePhotos";
import ResourceList from "./ResourceList";
import { Check, I18nInput, Select, api } from "./ui";

const el = (t: LocalizedText) => t.el || t.en || Object.values(t)[0] || "";

interface LocationOpt {
  id: string;
  name: LocalizedText;
  isActive: boolean;
}

function useLocations() {
  const [locations, setLocations] = useState<LocationOpt[]>([]);
  useEffect(() => {
    api<{ items: LocationOpt[] }>("/api/public-site/locations").then((r) => r.data && setLocations(r.data.items));
  }, []);
  return locations;
}

/* ─────────────────────────────────────────────
   Μέρη για επίσκεψη
   ───────────────────────────────────────────── */

export interface PlaceItem {
  slug: string;
  nameI18n: LocalizedText;
  shortI18n: LocalizedText;
  descriptionI18n: LocalizedText;
  detailsI18n: { label: LocalizedText; value: LocalizedText }[];
  mapUrl: string | null;
  allLocations: boolean;
  locationIds: string[];
  isActive: boolean;
  sortOrder: number;
  photos?: VehiclePhotoView[];
}

export function PlacesTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const locations = useLocations();
  const locName = (id: string) => el(locations.find((l) => l.id === id)?.name ?? {});

  return (
    <ResourceList<PlaceItem>
      resource="places"
      intro={t("placesIntro")}
      movable
      empty={() => ({
        slug: "",
        nameI18n: {},
        shortI18n: {},
        descriptionI18n: {},
        detailsI18n: [],
        mapUrl: null,
        allLocations: true,
        locationIds: [],
        isActive: true,
        sortOrder: 0,
      })}
      title={(p) => el(p.nameI18n)}
      summary={(p) => (
        <>
          /{p.slug} · {(p.photos ?? []).length} {t("placePhotosCount")} ·{" "}
          {p.allLocations ? t("placeAllLocations") : p.locationIds.map(locName).filter(Boolean).join(", ")}
          {!p.isActive && <span className="dash-ps-badge">{t("inactive")}</span>}
        </>
      )}
      renderForm={(f) => {
        const v = f.value;
        const setDetail = (i: number, key: "label" | "value", x: LocalizedText) =>
          f.set(
            "detailsI18n",
            v.detailsI18n.map((d, k) => (k === i ? { ...d, [key]: x } : d))
          );
        return (
          <>
            <I18nInput
              label={t("name")}
              value={v.nameI18n}
              onChange={(x) => {
                f.set("nameI18n", x);
                // Νέο μέρος: το slug προτείνεται από το ελληνικό όνομα (μέχρι να το αλλάξεις).
                if (!f.saved && (!v.slug || v.slug === suggestPlaceSlug(v.nameI18n.el ?? ""))) {
                  f.set("slug", suggestPlaceSlug(x.el ?? ""));
                }
              }}
              maxLength={80}
              required
            />
            <label className="dash-field">
              {t("slug")} *
              <input
                value={v.slug}
                maxLength={60}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => f.set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="balos-lagoon"
              />
              <span className="dash-form-note">{t("placeSlugHint")}</span>
            </label>
            <I18nInput label={t("placeShort")} value={v.shortI18n} onChange={(x) => f.set("shortI18n", x)} maxLength={120} />
            <I18nInput label={t("description")} value={v.descriptionI18n} onChange={(x) => f.set("descriptionI18n", x)} maxLength={4000} multiline />

            <div className="dash-field dash-field--wide">
              <span>{t("placeDetails")}</span>
              <span className="dash-form-note">{t("placeDetailsHint")}</span>
              <ul className="dash-place-details">
                {v.detailsI18n.map((d, i) => (
                  <li key={i} className="dash-place-detail">
                    <div className="dash-place-detail-row">
                      <input aria-label={`${t("placeDetailLabel")} ${i + 1} (ΕΛ)`} placeholder={`${t("placeDetailLabel")} ΕΛ`} maxLength={60} value={d.label.el ?? ""} onChange={(e) => setDetail(i, "label", { ...d.label, el: e.target.value })} />
                      <input aria-label={`${t("placeDetailValue")} ${i + 1} (ΕΛ)`} placeholder={`${t("placeDetailValue")} ΕΛ`} maxLength={200} value={d.value.el ?? ""} onChange={(e) => setDetail(i, "value", { ...d.value, el: e.target.value })} />
                    </div>
                    <div className="dash-place-detail-row">
                      <input aria-label={`${t("placeDetailLabel")} ${i + 1} (EN)`} placeholder={`${t("placeDetailLabel")} EN`} maxLength={60} value={d.label.en ?? ""} onChange={(e) => setDetail(i, "label", { ...d.label, en: e.target.value })} />
                      <input aria-label={`${t("placeDetailValue")} ${i + 1} (EN)`} placeholder={`${t("placeDetailValue")} EN`} maxLength={200} value={d.value.en ?? ""} onChange={(e) => setDetail(i, "value", { ...d.value, en: e.target.value })} />
                    </div>
                    <button
                      type="button"
                      className="dash-icon-btn"
                      aria-label={t("placeDetailRemove")}
                      title={t("placeDetailRemove")}
                      onClick={() => f.set("detailsI18n", v.detailsI18n.filter((_, k) => k !== i))}
                    >
                      <X size={15} />
                    </button>
                  </li>
                ))}
              </ul>
              {v.detailsI18n.length < PLACE_DETAILS_MAX && (
                <button type="button" className="dash-btn dash-btn--sm" onClick={() => f.set("detailsI18n", [...v.detailsI18n, { label: {}, value: {} }])}>
                  <Plus size={14} /> {t("placeDetailAdd")}
                </button>
              )}
            </div>

            <label className="dash-field dash-field--wide">
              {t("placeMapUrl")}
              <input
                type="url"
                inputMode="url"
                value={v.mapUrl ?? ""}
                maxLength={500}
                placeholder="https://maps.google.com/…"
                onChange={(e) => f.set("mapUrl", e.target.value.trim() || null)}
              />
            </label>

            <div className="dash-field dash-field--wide">
              <span>{t("placeLocations")}</span>
              <div className="dash-ps-row">
                <Check label={t("placeAllLocations")} checked={v.allLocations} onChange={(x) => f.set("allLocations", x)} />
              </div>
              {!v.allLocations && (
                <div className="dash-ps-row">
                  {locations
                    .filter((l) => l.isActive || v.locationIds.includes(l.id))
                    .map((l) => (
                      <Check
                        key={l.id}
                        label={el(l.name)}
                        checked={v.locationIds.includes(l.id)}
                        onChange={(on) =>
                          f.set("locationIds", on ? [...v.locationIds, l.id] : v.locationIds.filter((x) => x !== l.id))
                        }
                      />
                    ))}
                </div>
              )}
              <span className="dash-form-note">{t("placeLocationsHint")}</span>
            </div>

            <Check label={t("isActive")} checked={v.isActive} onChange={(x) => f.set("isActive", x)} />

            <div className="dash-field dash-field--wide">
              <span>{t("photos")}</span>
              {f.saved ? (
                <>
                  <span className="dash-form-note">{t("placePhotosHint")}</span>
                  <VehiclePhotos
                    vehicleId={f.saved.id}
                    apiBase={`/api/public-site/place-photos/${f.saved.id}`}
                    photos={v.photos ?? []}
                    canManage
                    onChange={(fn) => f.set("photos", fn(v.photos ?? []))}
                    alt={el(v.nameI18n)}
                  />
                </>
              ) : (
                <span className="dash-form-note">{t("photosAfterSave")}</span>
              )}
            </div>
          </>
        );
      }}
    />
  );
}

/* ─────────────────────────────────────────────
   Κριτικές (χειροκίνητες)
   ───────────────────────────────────────────── */

export interface ReviewItem {
  authorName: string;
  rating: number;
  text: LocalizedText;
  reviewDate: string;
  sourceUrl: string | null;
  pickupLocationId: string | null;
  isActive: boolean;
  sortOrder: number;
}

const today = () => new Date().toISOString().slice(0, 10);

function Stars({ n }: { n: number }) {
  return (
    <span className="dash-stars" aria-label={`${n}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={13} fill={i < n ? "currentColor" : "none"} />
      ))}
    </span>
  );
}

export function ReviewsTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const locations = useLocations();
  return (
    <ResourceList<ReviewItem>
      resource="reviews"
      intro={t("reviewsIntro")}
      movable
      empty={() => ({
        authorName: "",
        rating: 5,
        text: {},
        reviewDate: today(),
        sourceUrl: null,
        pickupLocationId: null,
        isActive: true,
        sortOrder: 0,
      })}
      title={(r) => r.authorName}
      summary={(r) => (
        <>
          <Stars n={r.rating} /> · {r.reviewDate}
          {r.pickupLocationId && ` · ${el(locations.find((l) => l.id === r.pickupLocationId)?.name ?? {})}`}
          {` · ${el(r.text).slice(0, 80)}${el(r.text).length > 80 ? "…" : ""}`}
          {!r.isActive && <span className="dash-ps-badge">{t("inactive")}</span>}
        </>
      )}
      renderForm={(f) => {
        const v = f.value;
        return (
          <>
            <label className="dash-field">
              {t("reviewAuthor")} *
              <input value={v.authorName} maxLength={80} onChange={(e) => f.set("authorName", e.target.value)} />
            </label>
            <Select
              label={t("reviewRating")}
              value={String(v.rating) as "1" | "2" | "3" | "4" | "5"}
              options={(["5", "4", "3", "2", "1"] as const).map((n) => ({ value: n, label: "★".repeat(Number(n)) + "☆".repeat(5 - Number(n)) }))}
              onChange={(x) => f.set("rating", Number(x))}
            />
            <label className="dash-field">
              {t("reviewDate")}
              <input type="date" value={v.reviewDate} max={today()} onChange={(e) => f.set("reviewDate", e.target.value)} />
            </label>
            <label className="dash-field">
              {t("reviewLocation")}
              <select value={v.pickupLocationId ?? ""} onChange={(e) => f.set("pickupLocationId", e.target.value || null)}>
                <option value="">{t("reviewGeneral")}</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {el(l.name)}
                  </option>
                ))}
              </select>
            </label>
            <I18nInput label={t("reviewText")} value={v.text} onChange={(x) => f.set("text", x)} maxLength={1500} multiline />
            <label className="dash-field dash-field--wide">
              {t("reviewSourceUrl")}
              <input type="url" inputMode="url" value={v.sourceUrl ?? ""} maxLength={500} placeholder="https://…" onChange={(e) => f.set("sourceUrl", e.target.value.trim() || null)} />
              <span className="dash-form-note">{t("reviewSourceHint")}</span>
            </label>
            <Check label={t("isActive")} checked={v.isActive} onChange={(x) => f.set("isActive", x)} />
          </>
        );
      }}
    />
  );
}
