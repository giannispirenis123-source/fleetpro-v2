// src/lib/legal/markdown.ts
// Περιορισμένο markdown για τα νομικά κείμενα — καθαρή λογική, χωρίς imports.
//
// ΑΣΦΑΛΕΙΑ (XSS): το κείμενο ΔΕΝ γίνεται ποτέ HTML. Μετατρέπεται σε απλή
// δομή (μπλοκ + κομμάτια κειμένου) που η σελίδα αποδίδει με React elements·
// ό,τι μοιάζει με <tag> μένει κείμενο. Links μόνο https:// και mailto:/tel:.
//
// Υποστηρίζονται: # / ## / ### επικεφαλίδες, παράγραφοι (κενή γραμμή),
// λίστες με "- " ή "* " και "1. ", **έντονα**, [κείμενο](https://…).
// Μία αλλαγή γραμμής μέσα σε παράγραφο = αλλαγή γραμμής.

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; v: string }
  | { t: "link"; v: string; href: string }
  | { t: "br" };

export type Block =
  | { t: "h"; level: 2 | 3 | 4; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] };

const SAFE_HREF = /^(https:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:\+?[\d\s()-]+)$/i;

/** Επιτρέπεται μόνο https:, mailto:, tel: — όχι javascript:, data:, http: κ.λπ. */
export const safeHref = (href: string): string | null => (SAFE_HREF.test(href.trim()) ? href.trim() : null);

const INLINE_RE = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of line.matchAll(INLINE_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", v: line.slice(last, at) });
    if (m[1] !== undefined) out.push({ t: "strong", v: m[1] });
    else {
      const href = safeHref(m[3]);
      out.push(href ? { t: "link", v: m[2], href } : { t: "text", v: m[2] });
    }
    last = at + m[0].length;
  }
  if (last < line.length) out.push({ t: "text", v: line.slice(last) });
  return out;
}

const UL_RE = /^\s*[-*]\s+(.*)$/;
const OL_RE = /^\s*\d{1,3}[.)]\s+(.*)$/;
const H_RE = /^(#{1,3})\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: Inline[][] } | null = null;

  const flushPara = () => {
    if (para.length === 0) return;
    const c: Inline[] = [];
    para.forEach((l, i) => {
      if (i > 0) c.push({ t: "br" });
      c.push(...parseInline(l));
    });
    blocks.push({ t: "p", c });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = H_RE.exec(line);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ t: "h", level: (h[1].length + 1) as 2 | 3 | 4, c: parseInline(h[2].trim()) });
      continue;
    }
    const ul = UL_RE.exec(line);
    const ol = ul ? null : OL_RE.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (!list || list.t !== kind) {
        flushList();
        list = { t: kind, items: [] };
      }
      list.items.push(parseInline((ul ?? ol)![1].trim()));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

/** Απλό κείμενο (για meta description κ.λπ.). */
export function plainText(blocks: Block[]): string {
  const inl = (c: Inline[]) => c.map((x) => (x.t === "br" ? " " : x.v)).join("");
  return blocks
    .map((b) => ("items" in b ? b.items.map(inl).join(" ") : inl(b.c)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
