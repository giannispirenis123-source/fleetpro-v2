// src/components/contracts/ContractDocument.tsx
// Το αντίγραφο του συμβολαίου: δίγλωσσο (ΕΛ / EN), καθαρό σε Α4.
//
// Χωρίς hooks και χωρίς handlers, ώστε να αποδίδεται από server component
// (σελίδα εκτύπωσης) — και αργότερα από τη δημόσια σελίδα του πελάτη.
// Τα ποσά έρχονται από το snapshot του συμβολαίου, ποτέ από σημερινές τιμές.

import {
  BI,
  DEPOSIT_LABEL,
  FUEL_TYPE_LABEL,
  GDPR_TEXT,
  ID_TYPE_LABEL,
  PAYMENT_LABEL,
  STATUS_LABEL,
  fuelLabel,
  type ContractDTO,
  type ContractDriver,
} from "@/lib/contracts";
import DamageSketch from "./DamageSketch";
import "./contract-document.css";

const eur = (n: number) =>
  new Intl.NumberFormat("el-GR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

/** "YYYY-MM-DD" → "dd/mm/yyyy" · κενό → "—". */
const d = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, day] = iso.slice(0, 10).split("-");
  return y && m && day ? `${day}/${m}/${y}` : "—";
};

const dt = (date: string | undefined, time: string | null | undefined) =>
  date ? `${d(date)}${time ? ` ${time}` : ""}` : "—";

/** ISO χρονοσφραγίδα → "dd/mm/yyyy HH:mm" (ώρα Ελλάδας). */
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

const v = (s: string | null | undefined) => (s && s.trim() ? s : "—");

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="cdoc-row">
      <span className="cdoc-label">{label}</span>
      <span className="cdoc-value">{value}</span>
    </div>
  );
}

function MainDriver({ driver }: { driver: ContractDriver }) {
  return (
    <div className="cdoc-grid">
      <Row label={BI.name} value={v(driver.fullName)} />
      <Row label={BI.country} value={v(driver.country)} />
      <Row label={BI.licenseNo} value={v(driver.licenseNumber)} />
      <Row label={BI.licenseExpiry} value={d(driver.licenseExpiry)} />
      <Row label={BI.birthDate} value={d(driver.birthDate)} />
      <Row
        label={BI.idDoc}
        value={`${ID_TYPE_LABEL[driver.idType] ?? ""} · ${v(driver.idNumber)}`}
      />
      <Row label={BI.phone} value={v(driver.phone)} />
      <Row label={BI.email} value={v(driver.email)} />
      <div className="cdoc-row cdoc-row--wide">
        <span className="cdoc-label">{BI.address}</span>
        <span className="cdoc-value">{v(driver.address)}</span>
      </div>
    </div>
  );
}

export default function ContractDocument({ contract }: { contract: ContractDTO }) {
  const s = contract.snapshot;
  const [main, ...others] = contract.drivers;
  const electric = s?.vehicle.fuel === "ELECTRIC";
  const fuelTitle = electric ? BI.battery : BI.fuel;

  return (
    <article className="cdoc">
      {/* ── Κεφαλίδα ── */}
      <header className="cdoc-head">
        <div className="cdoc-company">
          <strong className="cdoc-company-name">{s?.company.name ?? "—"}</strong>
          {s?.company.region && <span>{s.company.region}</span>}
          {s?.company.address && <span>{s.company.address}</span>}
          <span>
            {BI.vat}: {v(s?.company.vat)} · {BI.taxOffice}: {v(s?.company.taxOffice)}
          </span>
          <span>
            {BI.phone}: {v(s?.company.phone)} · {BI.email}: {v(s?.company.email)}
          </span>
        </div>
        <div className="cdoc-logo">
          {s?.company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.company.logoUrl} alt="" />
          ) : (
            <span>{BI.logo}</span>
          )}
        </div>
      </header>

      <div className="cdoc-title">
        <h1>{BI.contract}</h1>
        <div className="cdoc-meta">
          <span>
            {BI.code}: <strong>{contract.contractNumber}</strong>
          </span>
          <span>
            {BI.booking}: {s?.booking.number ?? contract.bookingNumber}
          </span>
          <span>
            {BI.issuedBy}: {v(contract.createdByName)}
          </span>
          <span>
            {BI.status}: {STATUS_LABEL[contract.status]}
          </span>
        </div>
      </div>

      {/* ── Οδηγοί ── */}
      <section className="cdoc-section">
        <h2>{BI.mainDriver}</h2>
        {main ? <MainDriver driver={main} /> : <p>—</p>}
      </section>

      {others.length > 0 && (
        <section className="cdoc-section">
          <h2>{BI.extraDrivers}</h2>
          <table className="cdoc-table cdoc-drivers">
            <thead>
              <tr>
                <th>#</th>
                <th>{BI.name}</th>
                <th>{BI.country}</th>
                <th>{BI.license}</th>
                <th>{BI.idDoc}</th>
                <th>{BI.phone}</th>
                <th>{BI.birthDate}</th>
              </tr>
            </thead>
            <tbody>
              {others.map((o, i) => (
                <tr key={o.id}>
                  <td>{i + 2}</td>
                  <td>
                    <strong>{v(o.fullName)}</strong>
                    <small>
                      {[o.email, o.address].filter(Boolean).join(" · ") || "—"}
                    </small>
                  </td>
                  <td>{v(o.country)}</td>
                  <td>
                    {v(o.licenseNumber)}
                    <small>{d(o.licenseExpiry)}</small>
                  </td>
                  <td>
                    {v(o.idNumber)}
                    <small>{ID_TYPE_LABEL[o.idType]}</small>
                  </td>
                  <td>{v(o.phone)}</td>
                  <td>{d(o.birthDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Όχημα, παραλαβή, παράδοση ── */}
      <section className="cdoc-section cdoc-cols3">
        <div>
          <h2>{BI.vehicle}</h2>
          <Row label={BI.model} value={s ? `${s.vehicle.brand} ${s.vehicle.model}` : "—"} />
          <Row label={BI.plate} value={v(s?.vehicle.plate)} />
          <Row label={BI.fuelType} value={FUEL_TYPE_LABEL[s?.vehicle.fuel ?? ""] ?? "—"} />
        </div>
        <div>
          <h2>{BI.pickup}</h2>
          <Row label={BI.location} value={v(contract.pickupLocation)} />
          <Row label={BI.dateTime} value={dt(s?.booking.pickupDate, s?.booking.pickupTime)} />
          <Row label={fuelTitle} value={fuelLabel(contract.fuelPickup)} />
        </div>
        <div>
          <h2>{BI.return}</h2>
          <Row label={BI.location} value={v(contract.returnLocation)} />
          <Row label={BI.dateTime} value={dt(s?.booking.returnDate, s?.booking.returnTime)} />
          <Row label={fuelTitle} value={fuelLabel(contract.fuelReturn)} />
        </div>
      </section>

      {/* ── Ζημιές παραλαβής ── */}
      <section className="cdoc-section cdoc-damages">
        <DamageSketch marks={contract.damageMarks} className="cdoc-sketch" />
        <div>
          <h2>{BI.damages}</h2>
          {contract.damageMarks.length === 0 ? (
            <p className="cdoc-muted">{BI.noDamages}</p>
          ) : (
            <ol className="cdoc-marks">
              {contract.damageMarks.map((m) => (
                <li key={m.id}>{v(m.note)}</li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {contract.vehicleChanges.length > 0 && (
        <section className="cdoc-section">
          <h2>{BI.vehicleChanges}</h2>
          <table className="cdoc-table">
            <thead>
              <tr>
                <th>{BI.date}</th>
                <th>{BI.model}</th>
                <th>{BI.plate}</th>
              </tr>
            </thead>
            <tbody>
              {contract.vehicleChanges.map((c) => (
                <tr key={c.id}>
                  <td>{d(c.date)}</td>
                  <td>{c.label}</td>
                  <td>{c.plate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {contract.notes.trim() && (
        <section className="cdoc-section">
          <h2>{BI.notes}</h2>
          <p className="cdoc-pre">{contract.notes}</p>
        </section>
      )}

      {/* ── Χρεώσεις ── */}
      <section className="cdoc-section cdoc-cols2">
        <div>
          <h2>{BI.charges}</h2>
          {s ? (
            <table className="cdoc-table cdoc-money">
              <tbody>
                <tr>
                  <td>
                    {BI.rental} · {s.booking.totalDays} {BI.days} × {eur(s.booking.dailyRate)}
                  </td>
                  <td>{eur(s.booking.subtotal)}</td>
                </tr>
                {s.extras.map((x, i) => (
                  <tr key={`x${i}`}>
                    <td>
                      {BI.extras}: {x.name}
                    </td>
                    <td>{eur(x.lineTotal)}</td>
                  </tr>
                ))}
                {s.insurance.map((x, i) => (
                  <tr key={`i${i}`}>
                    <td>
                      {BI.insurance}: {x.name}
                      {x.excess !== null && (
                        <small>
                          {BI.excess}: {eur(x.excess)}
                        </small>
                      )}
                    </td>
                    <td>{eur(x.lineTotal)}</td>
                  </tr>
                ))}
                {s.booking.discountAmount > 0 && (
                  <tr>
                    <td>
                      {BI.discount}
                      {s.booking.discountCode ? ` (${s.booking.discountCode})` : ""}
                    </td>
                    <td>−{eur(s.booking.discountAmount)}</td>
                  </tr>
                )}
                <tr className="cdoc-total">
                  <td>{BI.total}</td>
                  <td>{eur(s.booking.total)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p>—</p>
          )}
        </div>
        <div>
          <h2>{BI.payment}</h2>
          <Row
            label={BI.payment}
            value={contract.paymentMethod ? PAYMENT_LABEL[contract.paymentMethod] : "—"}
          />
          <Row
            label={BI.deposit}
            value={
              [
                contract.depositAmount !== null ? eur(contract.depositAmount) : null,
                contract.depositMethod ? DEPOSIT_LABEL[contract.depositMethod] : null,
              ]
                .filter(Boolean)
                .join(" · ") || "—"
            }
          />
          {s && s.insurance.length === 0 && <Row label={BI.insurance} value="—" />}
        </div>
      </section>

      {/* ── Όροι ── */}
      {(s?.terms.el || s?.terms.en) && (
        <section className="cdoc-section cdoc-terms">
          <h2>{BI.terms}</h2>
          <div className="cdoc-cols2">
            {s.terms.el && <p className="cdoc-pre">{s.terms.el}</p>}
            {s.terms.en && <p className="cdoc-pre">{s.terms.en}</p>}
          </div>
        </section>
      )}

      <section className="cdoc-section cdoc-terms">
        <h2>{BI.gdpr}</h2>
        <p>
          <span className="cdoc-check">{contract.gdprConsent ? "☑" : "☐"}</span> {GDPR_TEXT.el}
        </p>
        <p>
          <span className="cdoc-check">{contract.gdprConsent ? "☑" : "☐"}</span> {GDPR_TEXT.en}
        </p>
      </section>

      {/* ── Υπογραφές ── */}
      <section className="cdoc-section">
        <h2>{BI.signatures}</h2>
        <div className="cdoc-signs">
          {contract.drivers.map((drv) => (
            <div key={drv.id} className="cdoc-sign">
              <div className="cdoc-sign-img">
                {drv.signature ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={drv.signature} alt="" />
                ) : (
                  <span className="cdoc-muted">{BI.notSigned}</span>
                )}
              </div>
              <strong>{v(drv.fullName)}</strong>
              {drv.signedAt && (
                <small>
                  {BI.signedAt}: {stamp(drv.signedAt)}
                </small>
              )}
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}
