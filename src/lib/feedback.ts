// src/lib/feedback.ts
// «Πες μας τη γνώμη σου» — σχήμα και DTO. Όλα προαιρετικά· τουλάχιστον ένα
// πεδίο συμπληρωμένο. Η 3η απάντηση (οχήματα) αποθηκεύεται ως ΑΡΙΘΜΟΣ, για
// να φαίνεται αν τα όρια των πλάνων ταιριάζουν.

import { z } from "zod";

export const FEEDBACK_TEXT_MAX = 2000;

const text = z
  .string()
  .trim()
  .max(FEEDBACK_TEXT_MAX)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const feedbackSchema = z
  .object({
    helpedMost: text,
    missing: text,
    vehicleCount: z.union([z.number().int().min(0).max(100000), z.null()]).optional(),
  })
  .refine((v) => Boolean(v.helpedMost) || Boolean(v.missing) || typeof v.vehicleCount === "number", {
    message: "empty",
  });

export type FeedbackInput = z.infer<typeof feedbackSchema>;

export interface FeedbackDTO {
  id: string;
  tenantName: string | null;
  userName: string | null;
  helpedMost: string | null;
  missing: string | null;
  vehicleCount: number | null;
  createdAt: string;
}
