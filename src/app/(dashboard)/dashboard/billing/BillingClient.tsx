"use client";

// «Συνδρομή»: πλάνο, δοκιμή, έκπτωση ιδρυτή, Checkout / Πύλη πελάτη του Stripe.
// Τιμές και όρια έρχονται από τη βάση (πίνακας plans) μέσω του server· ό,τι
// αποφασίζει τη χρέωση (τιμή, δοκιμή, έκπτωση) το ξανακάνει ο server.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CreditCard, RefreshCw } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import { daysLeft, formatEuro, founderPriceCents, type BillingInterval } from "@/lib/billing/core";
import type { BillingOverview } from "@/lib/billing/billingServer";

export default function BillingClient({ initial, checkout }: { initial: BillingOverview; checkout: "success" | "cancel" | null }) {
  const tr = useT();
  const locale = useLocale();
  const router = useRouter();
  const [o, setO] = useState(initial);
  const [interval, setBillingInterval] = useState<BillingInterval>(initial.interval);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(checkout ? tr(checkout === "success" ? "billing.checkoutSuccess" : "billing.checkoutCancel") : "");

  const lang = locale === "en" ? "en" : "el";
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { timeZone: "Europe/Athens" }) : "";

  const reload = useCallback(async () => {
    const res = await fetch("/api/billing", { cache: "no-store" });
    if (res.ok) setO((await res.json()).data);
    router.refresh();
  }, [router]);

  const post = async (path: string, body?: unknown): Promise<{ url?: string } | null> => {
    setError("");
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message || tr("billing.error"));
      return null;
    }
    return data.data ?? {};
  };

  const sync = useCallback(async () => {
    setBusy("sync");
    try {
      await fetch("/api/billing/sync", { method: "POST" });
      await reload();
    } finally {
      setBusy("");
    }
  }, [reload]);

  // Επιστροφή από το Checkout: εφεδρικός συγχρονισμός (αν το webhook αργεί).
  useEffect(() => {
    if (checkout === "success") void sync();
  }, [checkout, sync]);

  const go = async (key: string, path: string, body?: unknown) => {
    setBusy(key);
    try {
      const r = await post(path, body);
      if (r?.url) window.location.href = r.url;
    } catch {
      setError(tr("billing.error"));
    } finally {
      setBusy("");
    }
  };

  const choosePlan = async (plan: string) => {
    setBusy(`plan-${plan}`);
    try {
      if (await post("/api/billing/plan", { plan, interval })) {
        setNotice("");
        await reload();
      }
    } catch {
      setError(tr("billing.error"));
    } finally {
      setBusy("");
    }
  };

  const plan = o.plans.find((p) => p.key === o.planKey) ?? null;
  const founder = o.founder;
  const founderActive = Boolean(founder && founder.monthsLeft > 0);
  // Με test clock (μόνο Preview) οι ημέρες μετρούν από την ώρα του clock.
  const days = daysLeft(o.trialEndsAt ? new Date(o.trialEndsAt) : null, o.testClockAt ? new Date(o.testClockAt) : new Date());
  const vehiclesText =
    o.vehicles.limit === null
      ? tr("billing.vehiclesUnlimited").replace("{used}", String(o.vehicles.used))
      : tr("billing.vehiclesOf").replace("{used}", String(o.vehicles.used)).replace("{limit}", String(o.vehicles.limit));
  const checkoutLabel =
    o.billingStatus === "awaiting_checkout"
      ? tr("billing.startTrial")
      : o.billingStatus === "founder_trial" && o.access.mode === "full"
        ? tr("billing.addCard")
        : tr("billing.activate");

  return (
    <>
      <div className="dash-page-head">
        <h1 className="dash-page-title">{tr("billing.title")}</h1>
        <p className="dash-page-sub">{tr("billing.subtitle")}</p>
      </div>

      {notice && <div className="dash-billing-banner dash-billing-banner--trial" role="status">{notice}</div>}
      {error && <div className="dash-billing-banner dash-billing-banner--read_only" role="alert">{error}</div>}
      {o.access.mode === "read_only" && o.access.reason && (
        <div className="dash-billing-banner dash-billing-banner--read_only" role="status" data-testid="billing-readonly">
          {tr(`billing.readOnly_${o.access.reason}`)} {tr("billing.readOnlyNote")}
        </div>
      )}
      {o.access.warning === "past_due" && (
        <div className="dash-billing-banner dash-billing-banner--past_due" role="status">
          {tr("billing.pastDue").replace("{date}", fmtDate(o.access.until))}
        </div>
      )}

      <div className="dash-panel dash-settings-panel dash-billing" data-testid="billing-page">
        <dl className="dash-billing-dl">
          <dt>{tr("billing.currentPlan")}</dt>
          <dd>{plan?.name ?? "—"}{plan ? ` · ${tr(o.interval === "year" ? "billing.yearly" : "billing.monthly")}` : ""}</dd>
          <dt>{tr("billing.status")}</dt>
          <dd data-testid="billing-status">{tr(`billing.statusLabel_${o.billingStatus}`)}</dd>
          <dt>{tr("billing.vehicles")}</dt>
          <dd>{vehiclesText}</dd>
        </dl>

        {founder && (
          <div className="dash-billing-founder" data-testid="billing-founder">
            <strong>{tr("billing.founderBadge").replace("{slot}", String(founder.slot))}</strong>
            <span>{tr("billing.founderMonths").replace("{paid}", String(founder.monthsPaid))}</span>
            {founder.discountEndsAt && <span>{tr("billing.founderEnds").replace("{date}", fmtDate(founder.discountEndsAt))}</span>}
          </div>
        )}

        {o.billingStatus === "founder_trial" && !o.trialStarted && <p className="dash-form-note">{tr("billing.trialNotStarted")}</p>}
        {(o.billingStatus === "founder_trial" || o.billingStatus === "trialing") && o.trialEndsAt && days !== null && days > 0 && (
          <p className="dash-form-note">
            {tr("billing.trialLeft").replace("{n}", String(days)).replace("{date}", fmtDate(o.trialEndsAt))}
            {o.billingStatus === "founder_trial" ? ` ${tr("billing.trialCardHint")}` : ""}
          </p>
        )}
        {o.cancelAtPeriodEnd && o.currentPeriodEnd && <p className="dash-form-note">{tr("billing.cancelAtEnd").replace("{date}", fmtDate(o.currentPeriodEnd))}</p>}
        {!o.cancelAtPeriodEnd && o.billingStatus === "active" && o.currentPeriodEnd && (
          <p className="dash-form-note">{tr("billing.renewsOn").replace("{date}", fmtDate(o.currentPeriodEnd))}</p>
        )}

        {o.billingStatus === "exempt" ? (
          <p className="dash-form-note">{tr("billing.exempt")}</p>
        ) : !o.ready ? (
          <p className="dash-form-note">{tr("billing.notConfigured")}</p>
        ) : (
          <>
            {(o.canCheckout || o.canChangePlan) && (
              <>
                <div className="dash-lang dash-lang--page" role="group" aria-label={tr("billing.monthly")}>
                  {(["month", "year"] as const).map((i) => (
                    <button key={i} type="button" className={`dash-lang-btn ${interval === i ? "active" : ""}`} aria-pressed={interval === i} onClick={() => setBillingInterval(i)}>
                      {tr(i === "month" ? "billing.monthly" : "billing.yearly")}
                    </button>
                  ))}
                </div>
                <div className="dash-billing-plans">
                  {o.plans.map((p) => {
                    const cents = interval === "year" ? p.priceYearlyCents : p.priceMonthlyCents;
                    const selected = p.key === o.planKey && interval === o.interval;
                    return (
                      <div key={p.key} className={`dash-billing-plan ${selected ? "is-selected" : ""}`} data-testid={`plan-${p.key}`}>
                        <h3>{p.name}</h3>
                        <div className="dash-billing-price">
                          {founderActive ? (
                            <>
                              <s>{formatEuro(cents, lang)}</s> <strong>{formatEuro(founderPriceCents(cents), lang)}</strong>
                            </>
                          ) : (
                            <strong>{formatEuro(cents, lang)}</strong>
                          )}
                          <span>{tr(interval === "year" ? "billing.perYear" : "billing.perMonth")} · {tr("billing.exclVat")}</span>
                        </div>
                        {founderActive && <p className="dash-billing-founder-note">{tr("billing.founderPrice")}</p>}
                        <ul>
                          <li>
                            <Check size={14} />{" "}
                            {p.maxVehicles === null ? tr("billing.unlimitedVehicles") : tr("billing.upToVehicles").replace("{n}", String(p.maxVehicles))}
                          </li>
                          <li><Check size={14} /> {tr("billing.publicSite")}</li>
                          {p.multiStore && <li><Check size={14} /> {tr("billing.multiStore")}</li>}
                        </ul>
                        {o.canChangePlan && (
                          <button
                            type="button"
                            className="dash-btn"
                            disabled={selected || Boolean(busy)}
                            onClick={() => choosePlan(p.key)}
                          >
                            {selected ? tr("billing.chosen") : tr("billing.choose")}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="dash-billing-actions">
              {o.canCheckout && (
                <button
                  type="button"
                  className="dash-btn dash-btn--primary"
                  disabled={Boolean(busy) || !o.planKey || !o.plans.some((p) => p.key === o.planKey)}
                  onClick={() => go("checkout", "/api/billing/checkout", { plan: o.planKey, interval })}
                  data-testid="billing-checkout"
                >
                  <CreditCard size={16} /> {busy === "checkout" ? tr("billing.working") : checkoutLabel}
                </button>
              )}
              {o.canPortal && (
                <button type="button" className="dash-btn" disabled={Boolean(busy)} onClick={() => go("portal", "/api/billing/portal")} data-testid="billing-portal">
                  {busy === "portal" ? tr("billing.working") : tr("billing.manage")}
                </button>
              )}
              {o.hasCustomer && (
                <button type="button" className="dash-btn" disabled={Boolean(busy)} onClick={sync}>
                  <RefreshCw size={15} /> {busy === "sync" ? tr("billing.working") : tr("billing.refresh")}
                </button>
              )}
            </div>
            {o.canPortal && <p className="dash-form-note">{tr("billing.manageHint")}</p>}
          </>
        )}
      </div>
    </>
  );
}
