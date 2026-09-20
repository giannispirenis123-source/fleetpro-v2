"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  Mail,
  Phone,
  MapPin,
  CalendarDays,
  Ban,
  User,
} from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { TAG_CLASS, type CustomerDTO } from "@/lib/customers";

/** Κενή φόρμα — ίδια σειρά πεδίων με το modal. */
const emptyForm = () => ({
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  phone2: "",
  idNumber: "",
  licenseNumber: "",
  licenseExpiry: "",
  licenseCountry: "GR",
  dateOfBirth: "",
  address: "",
  city: "",
  country: "GR",
  nationality: "",
  tags: "",
  isBlacklisted: false,
  notes: "",
});

type FormState = ReturnType<typeof emptyForm>;

const formFromCustomer = (c: CustomerDTO): FormState => ({
  firstName: c.firstName,
  lastName: c.lastName,
  email: c.email ?? "",
  phone: c.phone ?? "",
  phone2: c.phone2 ?? "",
  idNumber: c.idNumber ?? "",
  licenseNumber: c.licenseNumber ?? "",
  licenseExpiry: c.licenseExpiry ?? "",
  licenseCountry: c.licenseCountry ?? "",
  dateOfBirth: c.dateOfBirth ?? "",
  address: c.address ?? "",
  city: c.city ?? "",
  country: c.country ?? "",
  nationality: c.nationality ?? "",
  tags: c.tags.join(", "),
  isBlacklisted: c.isBlacklisted,
  notes: c.notes ?? "",
});

const formToPayload = (f: FormState) => ({
  firstName: f.firstName.trim(),
  lastName: f.lastName.trim(),
  email: f.email.trim() || null,
  phone: f.phone.trim() || null,
  phone2: f.phone2.trim() || null,
  idNumber: f.idNumber.trim() || null,
  licenseNumber: f.licenseNumber.trim() || null,
  licenseExpiry: f.licenseExpiry || null,
  licenseCountry: f.licenseCountry.trim() || null,
  dateOfBirth: f.dateOfBirth || null,
  address: f.address.trim() || null,
  city: f.city.trim() || null,
  country: f.country.trim() || null,
  nationality: f.nationality.trim() || null,
  tags: f.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
  isBlacklisted: f.isBlacklisted,
  notes: f.notes.trim() || null,
});

export default function CustomersClient({
  initialCustomers,
}: {
  initialCustomers: CustomerDTO[];
}) {
  const tr = useT();

  const [customers, setCustomers] = useState<CustomerDTO[]>(initialCustomers);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<CustomerDTO | null>(null);
  const [deleting, setDeleting] = useState<CustomerDTO | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [c.firstName, c.lastName, c.email ?? "", c.phone ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [customers, search]);

  const sortCustomers = (list: CustomerDTO[]) =>
    [...list].sort(
      (a, b) =>
        a.lastName.localeCompare(b.lastName) ||
        a.firstName.localeCompare(b.firstName)
    );

  return (
    <>
      <div className="dash-page-head dash-head-row">
        <div>
          <h1 className="dash-page-title">{tr("customers.title")}</h1>
          <p className="dash-page-sub">{tr("customers.subtitle")}</p>
        </div>
        <button
          className="dash-btn dash-btn--primary"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={17} /> {tr("customers.addCustomer")}
        </button>
      </div>

      <div className="dash-toolbar">
        <div className="dash-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("customers.searchPlaceholder")}
          />
        </div>
        <span className="dash-count">
          {visible.length}{" "}
          {visible.length === 1
            ? tr("customers.customerCountOne")
            : tr("customers.customerCount")}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="dash-panel dash-empty">
          {customers.length === 0
            ? tr("customers.empty")
            : tr("customers.emptyFiltered")}
        </div>
      ) : (
        <div className="dash-vehicles">
          {visible.map((c) => (
            <CustomerCard
              key={c.id}
              customer={c}
              tr={tr}
              onEdit={() => setEditing(c)}
              onDelete={() => setDeleting(c)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CustomerModal
          mode="create"
          tr={tr}
          onClose={() => setShowCreate(false)}
          onSaved={(customer) => {
            setCustomers((prev) => sortCustomers([...prev, customer]));
            setShowCreate(false);
          }}
        />
      )}

      {editing && (
        <CustomerModal
          mode="edit"
          customer={editing}
          tr={tr}
          onClose={() => setEditing(null)}
          onSaved={(customer) => {
            setCustomers((prev) =>
              sortCustomers(
                prev.map((c) => (c.id === customer.id ? customer : c))
              )
            );
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <DeleteCustomerModal
          customer={deleting}
          tr={tr}
          onClose={() => setDeleting(null)}
          onDeleted={(id) => {
            setCustomers((prev) => prev.filter((c) => c.id !== id));
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Κάρτα πελάτη
   ───────────────────────────────────────────── */

function CustomerCard({
  customer: c,
  tr,
  onEdit,
  onDelete,
}: {
  customer: CustomerDTO;
  tr: (key: string) => string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const initials = `${c.firstName[0] ?? ""}${c.lastName[0] ?? ""}`.toUpperCase();
  const hasContact = Boolean(c.email || c.phone);

  return (
    <div className="dash-vehicle">
      <div className="dash-vehicle-top">
        <div className="dash-customer-avatar">{initials || <User size={18} />}</div>
        <div className="dash-vehicle-id">
          <span className="dash-vehicle-name">
            {c.firstName} {c.lastName}
          </span>
          {c.city && (
            <span className="dash-vehicle-plate dash-customer-city">
              <MapPin size={11} /> {c.city}
            </span>
          )}
        </div>
        {c.bookingsCount > 0 && (
          <span className="dash-status dash-status--info">
            {c.bookingsCount}{" "}
            {c.bookingsCount === 1
              ? tr("customers.bookingsOne")
              : tr("customers.bookings")}
          </span>
        )}
      </div>

      <div className="dash-vehicle-specs">
        {c.email && (
          <span>
            <Mail size={13} /> {c.email}
          </span>
        )}
        {c.phone && (
          <span>
            <Phone size={13} /> {c.phone}
          </span>
        )}
        {c.licenseExpiry && (
          <span>
            <CalendarDays size={13} /> {c.licenseExpiry}
          </span>
        )}
        {!hasContact && !c.licenseExpiry && (
          <span className="dash-muted">{tr("customers.noContact")}</span>
        )}
      </div>

      {(c.tags.length > 0 || c.isBlacklisted) && (
        <div className="dash-vehicle-badges">
          {c.isBlacklisted && (
            <span className="dash-badge dash-badge--bad">
              <Ban size={12} /> {tr("customers.blacklisted")}
            </span>
          )}
          {c.tags.map((tag) => (
            <span
              key={tag}
              className={`dash-badge dash-badge--${TAG_CLASS[tag] ?? "muted"}`}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="dash-vehicle-foot">
        <span />
        <div className="dash-vehicle-actions">
          <button
            className="dash-icon-btn"
            onClick={onEdit}
            title={tr("customers.edit")}
            aria-label={tr("customers.edit")}
          >
            <Pencil size={16} />
          </button>
          <button
            className="dash-icon-btn dash-icon-btn--danger"
            onClick={onDelete}
            title={tr("customers.delete")}
            aria-label={tr("customers.delete")}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Modal δημιουργίας / επεξεργασίας
   ───────────────────────────────────────────── */

function CustomerModal({
  mode,
  customer,
  tr,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  customer?: CustomerDTO;
  tr: (key: string) => string;
  onClose: () => void;
  onSaved: (customer: CustomerDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(
    customer ? formFromCustomer(customer) : emptyForm()
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        mode === "create" ? "/api/customers" : `/api/customers/${customer!.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formToPayload(form)),
        }
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || tr("customers.errorSave"));
        return;
      }

      onSaved(data.data.customer);
    } catch {
      setError(tr("customers.errorConnection"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal-header">
          <h2>
            {mode === "create"
              ? tr("customers.newCustomer")
              : tr("customers.editCustomer")}
          </h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dash-modal-body">
          <h3 className="dash-form-section">{tr("customers.sectionBasics")}</h3>
          <div className="dash-form-grid">
            <label className="dash-field">
              {tr("customers.firstName")} *
              <input
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                autoFocus
              />
            </label>
            <label className="dash-field">
              {tr("customers.lastName")} *
              <input
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("customers.email")}
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("customers.phone")}
              <input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("customers.phone2")}
              <input
                value={form.phone2}
                onChange={(e) => set("phone2", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("customers.dateOfBirth")}
              <input
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
              />
            </label>
          </div>

          {/* ΑΔΤ & δίπλωμα προαιρετικά εδώ — validation θα μπει στο κομμάτι
              του συμβολαίου πριν την έκδοση. */}
          <h3 className="dash-form-section">
            {tr("customers.sectionIdentity")}
          </h3>
          <div className="dash-form-grid">
            <label className="dash-field">
              {tr("customers.idNumber")}
              <input
                value={form.idNumber}
                onChange={(e) => set("idNumber", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("customers.licenseNumber")}
              <input
                value={form.licenseNumber}
                onChange={(e) => set("licenseNumber", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("customers.licenseExpiry")}
              <input
                type="date"
                value={form.licenseExpiry}
                onChange={(e) => set("licenseExpiry", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("customers.licenseCountry")}
              <input
                value={form.licenseCountry}
                onChange={(e) => set("licenseCountry", e.target.value)}
              />
            </label>
          </div>

          <h3 className="dash-form-section">{tr("customers.sectionAddress")}</h3>
          <div className="dash-form-grid">
            <label className="dash-field dash-field--wide">
              {tr("customers.address")}
              <input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("customers.city")}
              <input
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("customers.country")}
              <input
                value={form.country}
                onChange={(e) => set("country", e.target.value)}
              />
            </label>
            <label className="dash-field">
              {tr("customers.nationality")}
              <input
                value={form.nationality}
                onChange={(e) => set("nationality", e.target.value)}
              />
            </label>
          </div>

          <h3 className="dash-form-section">{tr("customers.sectionOther")}</h3>
          <div className="dash-form-grid">
            <label className="dash-field dash-field--wide">
              {tr("customers.tags")}
              <input
                value={form.tags}
                onChange={(e) => set("tags", e.target.value)}
                placeholder={tr("customers.tagsHint")}
              />
            </label>
            <label className="dash-field dash-field--check">
              <input
                type="checkbox"
                checked={form.isBlacklisted}
                onChange={(e) => set("isBlacklisted", e.target.checked)}
              />
              {tr("customers.isBlacklisted")}
            </label>
            <label className="dash-field dash-field--wide">
              {tr("customers.notes")}
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </label>
          </div>

          {error && <div className="dash-form-error">{error}</div>}
          <p className="dash-form-note">{tr("customers.requiredNote")}</p>
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose} disabled={loading}>
            {tr("customers.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? tr("customers.saving") : tr("customers.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Επιβεβαίωση διαγραφής
   ───────────────────────────────────────────── */

function DeleteCustomerModal({
  customer,
  tr,
  onClose,
  onDeleted,
}: {
  customer: CustomerDTO;
  tr: (key: string) => string;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || tr("customers.errorSave"));
        return;
      }

      onDeleted(customer.id);
    } catch {
      setError(tr("customers.errorConnection"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dash-modal-overlay" onClick={onClose}>
      <div
        className="dash-modal dash-modal--sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dash-modal-header">
          <h2>{tr("customers.confirmDeleteTitle")}</h2>
          <button
            className="dash-modal-close"
            onClick={onClose}
            aria-label={tr("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dash-modal-body">
          <p className="dash-confirm-vehicle">
            {customer.firstName} {customer.lastName}
          </p>
          <p className="dash-form-note">{tr("customers.confirmDeleteBody")}</p>
          {error && <div className="dash-form-error">{error}</div>}
        </div>

        <div className="dash-modal-footer">
          <button className="dash-btn" onClick={onClose} disabled={loading}>
            {tr("customers.cancel")}
          </button>
          <button
            className="dash-btn dash-btn--danger"
            onClick={handleDelete}
            disabled={loading}
          >
            {loading ? tr("customers.deleting") : tr("customers.confirmDelete")}
          </button>
        </div>
      </div>
    </div>
  );
}
