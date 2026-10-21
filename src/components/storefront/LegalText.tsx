// src/components/storefront/LegalText.tsx
// Απόδοση του περιορισμένου markdown των νομικών κειμένων (src/lib/legal/markdown.ts)
// ΜΟΝΟ με React elements — κανένα dangerouslySetInnerHTML: ό,τι γράψει η
// εταιρία (ακόμη και <script>) εμφανίζεται ως κείμενο. Χωρίς hooks: δουλεύει
// στο δημόσιο site (server) και στην προεπισκόπηση του dashboard (client).

import { Fragment } from "react";
import { parseMarkdown, type Inline } from "@/lib/legal/markdown";

function Inlines({ c }: { c: Inline[] }) {
  return (
    <>
      {c.map((x, i) =>
        x.t === "br" ? (
          <br key={i} />
        ) : x.t === "strong" ? (
          <strong key={i}>{x.v}</strong>
        ) : x.t === "link" ? (
          <a key={i} href={x.href} rel="noopener noreferrer nofollow" target={x.href.startsWith("https:") ? "_blank" : undefined}>
            {x.v}
          </a>
        ) : (
          <Fragment key={i}>{x.v}</Fragment>
        )
      )}
    </>
  );
}

/**
 * `# …` → h2, `## …` → h3, `### …` → h4: το h1 το βάζει η σελίδα. Με
 * `skipTitle` φεύγει μια αρχική επικεφαλίδα `# …` (ίδια με το h1 της σελίδας).
 */
export default function LegalText({ body, className, skipTitle = false }: { body: string; className?: string; skipTitle?: boolean }) {
  const all = parseMarkdown(body);
  const blocks = skipTitle && all[0]?.t === "h" && all[0].level === 2 ? all.slice(1) : all;
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        if (b.t === "h") {
          const H = `h${b.level}` as "h2" | "h3" | "h4";
          return (
            <H key={i}>
              <Inlines c={b.c} />
            </H>
          );
        }
        if (b.t === "p") {
          return (
            <p key={i}>
              <Inlines c={b.c} />
            </p>
          );
        }
        const L = b.t;
        return (
          <L key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Inlines c={it} />
              </li>
            ))}
          </L>
        );
      })}
    </div>
  );
}
