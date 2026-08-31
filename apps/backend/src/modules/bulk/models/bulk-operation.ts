import { model } from "@medusajs/framework/utils";

/**
 * دفعةٌ إدارية — **وشرطُها أن تُتراجَع**.
 *
 * ── لماذا التراجعُ شرطٌ لا ميزة ─────────────────────────────────
 *
 * الدفعةُ تُغيّر خمسمئة صفٍّ في ثانية. والخطأُ فيها لا يُصحَّح باليد:
 * من يرفع الأسعارَ ١٠٪ ويكتشف أنه اختار التصنيفَ الخطأ **لا يعرف
 * الأسعارَ القديمة** — ذهبت مع الكتابة. فالدفعةُ بلا تراجعٍ عمليةٌ
 * **لا يجرؤ أحدٌ على استعمالها**، فتُترك وتُصنع بيدٍ صنفاً صنفاً.
 *
 * فالقيمُ القديمة تُحفظ **قبل** الكتابة لا بعدها، والتراجعُ يعيدها.
 */
export const BulkOperation = model.define("zadim_bulk_operation", {
  id: model.id({ prefix: "bulk" }).primaryKey(),

  kind: model.text(),
  entity_type: model.text(),

  status: model.enum(["prepared", "applied", "reverted", "failed"]).default("prepared"),

  item_count: model.number(),
  applied_count: model.number().default(0),
  reverted_count: model.number().default(0),
  /** صفوفٌ تغيّرت بعد الدفعة فلم تُعَد — تُعرض ولا تُكتم. */
  skipped_count: model.number().default(0),

  requested_by: model.text().nullable(),
  note: model.text().nullable(),
  applied_at: model.dateTime().nullable(),
  reverted_at: model.dateTime().nullable(),
}).indexes([
  { on: ["status"] },
]);

export default BulkOperation;
