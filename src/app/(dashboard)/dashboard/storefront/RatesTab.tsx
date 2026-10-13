"use client";

// Σεζόν & Τιμές: σεζόν (λίστα) + κλίμακες ανά (ομάδα ή όχημα) × σεζόν
// + «Δοκιμαστικός υπολογισμός» (quote() στον server).
// Εισαγωγή σε € με κόμμα, αποθήκευση σε cents.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { centsToInput, formatCents, parseEuroInput } from "@/lib/public/money";
import type { QuoteResult, Tier } from "@/lib/public/pricing";
import { tiersProblem } from "@/lib/public/rates";
import { defaultInsuranceFor } from "@/lib/public/insuranceDefaults";
import type { LocalizedText } from "@/lib/public/text";
import { SeasonsList } from "./ListTabs";
import { Status, api } from "./ui";

interface Target {
  kind: "group" | "vehicle";
  id: string;
  label: string;
  vehicleType: string;
  basePriceCents: number;
  isActive: boolean;
}
interface RatesData {
  seasons: { id: string; name: LocalizedText; startMonthDay: string; endMonthDay: string }[];
  targets: Target[];
  rates: { seasonId: string | null; rentalGroupId: string | null; vehicleId: string | null; tiers: Tier[] }[];
}

const el = (t: LocalizedText) => t.el || t.en || "";
const targetKey = (t: Target) => `${t.kind}:${t.id}`;

/* ─────────────────────────────────────────────
   Κελί: κλίμακες μίας σεζόν
   ───────────────────────────────────────────── */

interface Row {
  min: string;
  max: string;
  price: string;
}

function TierCard({
  title,
  subtitle,
  target,
  seasonId,
  initial,
  onSaved,
}: {
  title: string;
  subtitle?: string;
  target: Target;
  seasonId: string | null;
  initial: Tier[];
  onSaved: (d: RatesData) => void;
}) {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const [rows, setRows] = useState<Row[]>(
    initial.map((x) => ({ min: String(x.minDays), max: x.maxDays === null ? "" : String(x.maxDays), price: centsToInput(x.dailyPriceCents) }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const tiers: Tier[] | null = useMemo(() => {
    const out: Tier[] = [];
    for (const r of rows) {
      const price = parseEuroInput(r.price);
      if (!/^\d+$/.test(r.min) || (r.max !== "" && !/^\d+$/.test(r.max)) || price === null || Number.isNaN(price)) return null;
      out.push({ minDays: Number(r.min), maxDays: r.max === "" ? null : Number(r.max), dailyPriceCents: price });
    }
    return out;
  }, [rows]);
  const problem = tiers ? tiersProblem(tiers) : t("errorMoney");

  const set = (i: number, k: keyof Row, v: string) => {
    setSaved(false);
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  };

  const add = () => {
    setSaved(false);
    setRows((prev) => {
      const last = prev[prev.length - 1];
      const nextMin = last ? (last.max ? Number(last.max) + 1 : Number(last.min) + 1) : 1;
      const fixed = last && !last.max ? prev.map((r, j) => (j === prev.length - 1 ? { ...r, max: String(nextMin - 1) } : r)) : prev;
      return [...fixed, { min: String(nextMin), max: "", price: last?.price ?? "" }];
    });
  };

  const save = async () => {
    if (!tiers || problem) return;
    setBusy(true);
    setError("");
    const r = await api<RatesData>("/api/public-site/rates", "PUT", {
      seasonId,
      target: { kind: target.kind, id: target.id },
      tiers,
    });
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(r.message || tr("publicSite.errorSave"));
      return;
    }
    setSaved(true);
    onSaved(r.data);
  };

  return (
    <div className="dash-ps-tiercard">
      <div className="dash-ps-tiercard-head">
        <strong>{title}</strong>
        {subtitle && <span className="dash-form-note">{subtitle}</span>}
      </div>
      {rows.length === 0 && (
        <p className="dash-form-note">
          {t("noRateHint")}: {formatCents(target.basePriceCents)}
        </p>
      )}
      {rows.map((r, i) => (
        <div key={i} className="dash-ps-tier">
          <label>
            <span>{t("tierFrom")}</span>
            <input inputMode="numeric" value={r.min} onChange={(e) => set(i, "min", e.target.value.trim())} />
          </label>
          <label>
            <span>{t("tierTo")}</span>
            <input inputMode="numeric" value={r.max} placeholder="∞" title={t("tierToHint")} onChange={(e) => set(i, "max", e.target.value.trim())} />
          </label>
          <label>
            <span>{t("tierPrice")}</span>
            <input inputMode="decimal" value={r.price} onChange={(e) => set(i, "price", e.target.value)} />
          </label>
          <button
            className="dash-btn dash-btn--sm"
            aria-label={t("removeTier")}
            onClick={() => {
              setSaved(false);
              setRows((prev) => prev.filter((_, j) => j !== i));
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {rows.length > 0 && problem && <div className="dash-ps-err">{problem}</div>}
      <div className="dash-ps-actions">
        <button className="dash-btn dash-btn--sm" onClick={add}>
          <Plus size={14} /> {t("addTier")}
        </button>
        <button className="dash-btn dash-btn--primary dash-btn--sm" onClick={save} disabled={busy || (rows.length > 0 && !!problem)}>
          {busy ? t("saving") : t("save")}
        </button>
      </div>
      <Status error={error} saved={saved} />
    </div>
  );
}

/* ─────────────────────────────────────────────
   Δοκιμαστικός υπολογισμός
   ───────────────────────────────────────────── */

interface LocationOpt {
  id: string;
  name: LocalizedText;
  isActive: boolean;
  allowPickup: boolean;
  allowDropoff: boolean;
}
interface ExtraOpt {
  id: string;
  type: "EXTRA" | "INSURANCE";
  nameI18n: LocalizedText;
  maxQuantity: number;
  isActive: boolean;
  isDefault: boolean;
  vehicleTypes: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

function QuoteTester({ targets }: { targets: Target[] }) {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const [locations, setLocations] = useState<LocationOpt[]>([]);
  const [extras, setExtras] = useState<ExtraOpt[]>([]);
  const tomorrow = addDays(isoDate(new Date()), 1);
  const [form, setForm] = useState({
    target: targets[0] ? targetKey(targets[0]) : "",
    pickupDate: tomorrow,
    pickupTime: "10:00",
    dropoffDate: addDays(tomorrow, 3),
    dropoffTime: "10:00",
    pickupLocationId: "",
    dropoffLocationId: "",
    driverAge: "",
    insuranceId: "",
  });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ items: LocationOpt[] }>("/api/public-site/locations").then((r) => r.data && setLocations(r.data.items.filter((l) => l.isActive)));
    api<{ items: ExtraOpt[] }>("/api/public-site/extras").then((r) => r.data && setExtras(r.data.items.filter((e) => e.isActive)));
    api<{ booking: { defaultPickupTime: string; defaultDropoffTime: string; defaultRentalDays: number } }>(
      "/api/public-site/settings"
    ).then((r) => {
      const b = r.data?.booking;
      if (b) {
        setForm((f) => ({
          ...f,
          pickupTime: b.defaultPickupTime,
          dropoffTime: b.defaultDropoffTime,
          dropoffDate: addDays(f.pickupDate, b.defaultRentalDays),
        }));
      }
    });
  }, []);

  useEffect(() => {
    if (!form.target && targets[0]) setForm((f) => ({ ...f, target: targetKey(targets[0]) }));
  }, [targets, form.target]);

  // Η προεπιλεγμένη ασφάλεια για τον τύπο του οχήματος — όπως θα κάνει το site.
  const vehicleType = targets.find((x) => targetKey(x) === form.target)?.vehicleType ?? "car";
  useEffect(() => {
    const def = defaultInsuranceFor(extras, vehicleType);
    setForm((f) => ({ ...f, insuranceId: def?.id ?? "" }));
  }, [extras, vehicleType]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const run = async () => {
    const [kind, id] = form.target.split(":");
    if (!kind || !id) return;
    setBusy(true);
    setError("");
    const r = await api<QuoteResult>("/api/public-site/quote", "POST", {
      target: { kind, id },
      pickupAt: `${form.pickupDate}T${form.pickupTime}`,
      dropoffAt: `${form.dropoffDate}T${form.dropoffTime}`,
      pickupLocationId: form.pickupLocationId || null,
      dropoffLocationId: form.dropoffLocationId || null,
      driverAge: form.driverAge ? Number(form.driverAge) : null,
      extras: Object.entries(qty)
        .filter(([, q]) => q > 0)
        .map(([eid, q]) => ({ id: eid, qty: q })),
      insuranceId: form.insuranceId || null,
    });
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(r.message || t("errorLoad"));
      setResult(null);
      return;
    }
    setResult(r.data);
  };

  if (targets.length === 0) return null;

  return (
    <div className="dash-panel dash-settings-panel">
      <h2 className="dash-section-title">{t("quoteTitle")}</h2>
      <p className="dash-form-note dash-settings-lead">{t("quoteIntro")}</p>
      <div className="dash-form-grid">
        <label className="dash-field dash-field--wide">
          {t("target")}
          <select value={form.target} onChange={(e) => set("target", e.target.value)}>
            {targets.map((x) => (
              <option key={targetKey(x)} value={targetKey(x)}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        {(["pickup", "dropoff"] as const).map((k) => (
          <div key={k} className="dash-field dash-ps-dt-field">
            <span>{t(`${k}At`)}</span>
            <div className="dash-ps-dt">
              <input type="date" value={form[`${k}Date`]} onChange={(e) => set(`${k}Date`, e.target.value)} />
              <input type="time" value={form[`${k}Time`]} onChange={(e) => set(`${k}Time`, e.target.value)} />
            </div>
          </div>
        ))}
        <label className="dash-field">
          {t("pickupLocation")}
          <select value={form.pickupLocationId} onChange={(e) => set("pickupLocationId", e.target.value)}>
            <option value="">{t("noLocation")}</option>
            {locations.filter((l) => l.allowPickup).map((l) => (
              <option key={l.id} value={l.id}>
                {el(l.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="dash-field">
          {t("dropoffLocation")}
          <select value={form.dropoffLocationId} onChange={(e) => set("dropoffLocationId", e.target.value)}>
            <option value="">{t("sameAsPickup")}</option>
            {locations.filter((l) => l.allowDropoff).map((l) => (
              <option key={l.id} value={l.id}>
                {el(l.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="dash-field">
          {t("driverAge")}
          <input
            type="number"
            min={16}
            max={120}
            value={form.driverAge}
            placeholder={t("driverAgeHint")}
            onChange={(e) => set("driverAge", e.target.value)}
          />
        </label>
        <label className="dash-field">
          {t("insurance")}
          <select value={form.insuranceId} onChange={(e) => set("insuranceId", e.target.value)}>
            <option value="">{t("noInsurance")}</option>
            {extras.filter((x) => x.type === "INSURANCE").map((x) => (
              <option key={x.id} value={x.id}>
                {el(x.nameI18n)}
              </option>
            ))}
          </select>
        </label>
        {extras.some((x) => x.type === "EXTRA") && (
          <div className="dash-field dash-field--wide">
            <span>{t("extras")}</span>
            <div className="dash-ps-extras">
              {extras
                .filter((x) => x.type === "EXTRA")
                .map((x) => (
                  <label key={x.id} className="dash-ps-extra">
                    <input
                      type="number"
                      min={0}
                      max={x.maxQuantity}
                      value={qty[x.id] ?? 0}
                      onChange={(e) => setQty((q) => ({ ...q, [x.id]: Math.max(0, Number(e.target.value) || 0) }))}
                    />
                    {el(x.nameI18n)}
                  </label>
                ))}
            </div>
          </div>
        )}
      </div>
      <div className="dash-ps-actions">
        <button className="dash-btn dash-btn--primary" onClick={run} disabled={busy || !form.target}>
          {busy ? t("loading") : t("calculate")}
        </button>
      </div>
      {error && <div className="dash-form-error">{error}</div>}
      {result && <QuoteView result={result} />}
    </div>
  );
}

/** Η ανάλυση όπως θα φαίνεται στο site: γραμμές, διαγραμμένη αρχική, σήμα έκπτωσης. */
function QuoteView({ result }: { result: QuoteResult }) {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  return (
    <div className="dash-ps-quote">
      {result.errors.length > 0 && (
        <ul className="dash-form-error dash-ps-quote-errors">
          {result.errors.map((e) => (
            <li key={e.code + e.message.el}>{e.message.el}</li>
          ))}
        </ul>
      )}
      {result.lines.length > 0 && (
        <>
          <p className="dash-form-note">
            {t("days")}: <strong>{result.days}</strong>
          </p>
          <table className="dash-ps-quote-table">
            <tbody>
              {result.lines.map((l, i) => (
                <tr key={i} className={l.totalCents < 0 ? "is-discount" : undefined}>
                  <td>{l.label.el || l.label.en}</td>
                  <td className="num">{l.qty > 1 ? `${l.qty} × ${formatCents(l.unitCents)}` : ""}</td>
                  <td className="num">{formatCents(l.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dash-ps-quote-total">
            {result.discountBadge && <span className="dash-ps-discount">{el(result.discountBadge)}</span>}
            {result.discountCents > 0 && <s className="dash-ps-list-price">{formatCents(result.listTotalCents)}</s>}
            <span className="dash-ps-total">
              {t("total")}: {formatCents(result.totalCents)}
            </span>
            <span className="dash-form-note">
              {formatCents(result.avgDailyCents)} {t("perDay")} · {t("vatIncluded")} {formatCents(result.vatCents)}
            </span>
          </div>
          {(result.discounts.applied || result.discounts.others.length > 0) && (
            <div className="dash-ps-discounts">
              {result.discounts.applied && (
                <p className="dash-form-note">
                  ✓ {t("discountApplied")}: <strong>{el(result.discounts.applied.name)}</strong> (
                  {t(result.discounts.applied.source === "location" ? "discountFromLocation" : "discountFromPromotion")}) −
                  {formatCents(result.discounts.applied.amountCents)}
                </p>
              )}
              {result.discounts.others.map((o) => (
                <p key={`${o.source}:${o.id}`} className="dash-form-note dash-ps-lost">
                  ✗ {t("discountLost")}: {el(o.name)} (
                  {t(o.source === "location" ? "discountFromLocation" : "discountFromPromotion")}) −{formatCents(o.amountCents)}
                </p>
              ))}
            </div>
          )}
          {(result.depositCents !== null || result.excessCents !== null) && (
            <p className="dash-form-note">
              {result.depositCents !== null && `${t("deposit")}: ${formatCents(result.depositCents)}`}
              {result.depositCents !== null && result.excessCents !== null && " · "}
              {result.excessCents !== null && `${t("excess")}: ${formatCents(result.excessCents)}`}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Καρτέλα
   ───────────────────────────────────────────── */

export default function RatesTab() {
  const tr = useT();
  const t = (k: string) => tr(`publicSite.${k}`);
  const [data, setData] = useState<RatesData | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");

  const load = useCallback(() => {
    api<RatesData>("/api/public-site/rates").then((r) => {
      if (r.ok && r.data) setData(r.data);
      else setError(r.message || tr("publicSite.errorLoad"));
    });
  }, [tr]);
  useEffect(load, [load]);

  const targets = useMemo(() => data?.targets ?? [], [data]);
  const current = targets.find((x) => targetKey(x) === selected) ?? targets[0];
  const tiersFor = (seasonId: string | null) =>
    data?.rates.find(
      (r) =>
        r.seasonId === seasonId &&
        (current?.kind === "group" ? r.rentalGroupId === current.id : r.vehicleId === current?.id)
    )?.tiers ?? [];

  return (
    <>
      <SeasonsList onChange={load} />

      <div className="dash-panel dash-settings-panel">
        <h2 className="dash-section-title">{t("rates")}</h2>
        <p className="dash-form-note dash-settings-lead">{t("ratesIntro")}</p>
        {error && <div className="dash-form-error">{error}</div>}
        {data && targets.length === 0 && <p className="dash-form-note">{t("noTargets")}</p>}
        {data && current && (
          <>
            <label className="dash-field">
              {t("target")}
              <select value={targetKey(current)} onChange={(e) => setSelected(e.target.value)}>
                {targets.map((x) => (
                  <option key={targetKey(x)} value={targetKey(x)}>
                    {x.label}
                    {x.isActive ? "" : ` (${t("inactive")})`}
                  </option>
                ))}
              </select>
            </label>
            <div className="dash-ps-tiers">
              {[{ id: null as string | null, title: t("allYear"), subtitle: "" }, ...data.seasons.map((s) => ({ id: s.id as string | null, title: el(s.name), subtitle: `${s.startMonthDay} → ${s.endMonthDay}` }))].map(
                (col) => (
                  <TierCard
                    key={`${targetKey(current)}|${col.id ?? "all"}|${JSON.stringify(tiersFor(col.id))}`}
                    title={col.title}
                    subtitle={col.subtitle}
                    target={current}
                    seasonId={col.id}
                    initial={tiersFor(col.id)}
                    onSaved={setData}
                  />
                )
              )}
            </div>
          </>
        )}
      </div>

      <QuoteTester targets={targets} />
    </>
  );
}
