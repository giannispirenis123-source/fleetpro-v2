"use client";

// src/components/menu/MenuButton.tsx
// Μικρό κουμπί που ανοίγει μενού — ΚΟΙΝΟ για το δημόσιο site («Είσοδος»,
// «Γλώσσα») και το dashboard («Γλώσσα»). Ουδέτερα χρώματα (μεταβλητές --menu-*
// με ουδέτερες προεπιλογές), κλείνει με κλικ έξω, Escape και Tab, πλήρες
// πληκτρολόγιο (↑ ↓ Home End), aria-haspopup / aria-expanded / aria-controls.
// Τα στοιχεία είναι σύνδεσμοι (href) ή ενέργειες (onSelect)· με `checked` γίνονται
// menuitemradio (π.χ. η τρέχουσα γλώσσα με ✓).

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import "./menu-button.css";

export interface MenuItem {
  key: string;
  label: ReactNode;
  href?: string;
  onSelect?: () => void;
  /** Ορισμένο → menuitemradio με aria-checked (✓ στο τρέχον). */
  checked?: boolean;
  target?: "_blank";
  rel?: string;
  lang?: string;
  hrefLang?: string;
  title?: string;
  disabled?: boolean;
  testId?: string;
}

export default function MenuButton({
  label,
  ariaLabel,
  items,
  align = "end",
  className = "",
  testId,
}: {
  label: ReactNode;
  /** Όταν το ορατό κείμενο δεν αρκεί (π.χ. «Γλώσσα: Ελληνικά»). */
  ariaLabel?: string;
  items: MenuItem[];
  /** Σε ποια άκρη του κουμπιού στοιχίζεται το μενού (end = δεξιά: δεν βγαίνει από την οθόνη στο header). */
  align?: "start" | "end";
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const itemEls = () => Array.from(wrap.current?.querySelectorAll<HTMLElement>("[data-menu-item]:not([aria-disabled='true'])") ?? []);
  const focusItem = (index: number) => {
    const els = itemEls();
    if (els.length) els[(index + els.length) % els.length].focus();
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  // Κλικ/άγγιγμα έξω → κλείσιμο.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  // Με το άνοιγμα, εστίαση στο επιλεγμένο (✓) ή στο πρώτο στοιχείο.
  const focusOnOpen = useRef(false);
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const els = Array.from(wrap.current?.querySelectorAll<HTMLElement>("[data-menu-item]:not([aria-disabled='true'])") ?? []);
    (els.find((el) => el.getAttribute("aria-checked") === "true") ?? els[0])?.focus();
  }, [open]);

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusOnOpen.current = true;
      setOpen(true);
    }
  };

  // Escape: κλείνει ΜΟΝΟ αυτό το μενού. preventDefault = «το χειρίστηκα» — ένα
  // εξωτερικό μενού (π.χ. λογαριασμού) το ελέγχει, γιατί στο Next το React ακούει
  // στο document και το stopPropagation δεν φτάνει.
  const onWrapKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    const els = itemEls();
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(at + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(at < 0 ? -1 : at - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(-1);
    }
  };

  return (
    <div className={`menu-btn-wrap ${className}`.trim()} ref={wrap} onKeyDown={onWrapKey}>
      <button
        ref={button}
        type="button"
        className="menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          focusOnOpen.current = false;
          setOpen((v) => !v);
        }}
        onKeyDown={onButtonKey}
        data-testid={testId}
      >
        <span className="menu-btn-label">{label}</span>
        <svg className="menu-btn-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className={`menu-pop menu-pop--${align}`} id={menuId} role="menu" data-testid={testId ? `${testId}-menu` : undefined}>
          {items.map((it) => {
            const radio = it.checked !== undefined;
            const common = {
              className: `menu-item${it.checked ? " is-checked" : ""}`,
              role: radio ? "menuitemradio" : "menuitem",
              "aria-checked": radio ? it.checked : undefined,
              "aria-disabled": it.disabled || undefined,
              tabIndex: -1,
              lang: it.lang,
              title: it.title,
              "data-menu-item": "",
              "data-testid": it.testId,
            } as const;
            const body = (
              <>
                <span className="menu-item-check" aria-hidden="true">
                  {radio ? (it.checked ? "✓" : "") : null}
                </span>
                <span className="menu-item-label">{it.label}</span>
              </>
            );
            return it.href ? (
              <a
                key={it.key}
                {...common}
                href={it.href}
                hrefLang={it.hrefLang}
                target={it.target}
                rel={it.rel}
                onClick={() => setOpen(false)}
              >
                {body}
              </a>
            ) : (
              <button
                key={it.key}
                type="button"
                {...common}
                disabled={it.disabled}
                onClick={() => {
                  close(true);
                  it.onSelect?.();
                }}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
