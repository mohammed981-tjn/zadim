import { model } from "@medusajs/framework/utils";

/**
 * عمليةٌ ماليّة بمفتاحٍ — **حارسُ «لا يُحصَّل مرّتين»** (بوّابة المرحلة ٦).
 *
 * حارسُ الإتمام في المرحلة ٤ يحمي **إنشاءَ الطلب**. وهذا يحمي ما بعده:
 * التحصيلَ والاسترداد. وهما أخطر: طلبٌ مكرَّر يُرى ويُلغى، **وتحصيلٌ
 * مكرَّر لا يراه أحدٌ حتى يشتكي العميل** — وقد لا يشتكي إن كان المبلغ
 * صغيراً، فيبقى في الحساب.
 *
 * والمفتاحُ يُحجز بقيدٍ فريدٍ **قبل** النداء لا بعده: بين الفحص
 * والكتابة يمرّ النداءُ الثاني (ADR-014).
 */
export const MoneyOperation = model.define("zadim_money_operation", {
  id: model.id({ prefix: "mop" }).primaryKey(),

  idempotency_key: model.text().unique(),
  kind: model.enum(["capture", "refund", "void"]),

  payment_id: model.text().nullable(),
  order_id: model.text().nullable(),
  amount: model.number(),

  status: model.enum(["in_progress", "completed", "failed"]).default("in_progress"),
  result: model.json().nullable(),
  error_code: model.text().nullable(),
}).indexes([
  { on: ["payment_id"] },
  { on: ["order_id"] },
]);

export default MoneyOperation;
