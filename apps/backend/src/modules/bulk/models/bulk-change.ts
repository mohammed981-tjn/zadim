import { model } from "@medusajs/framework/utils";

/**
 * تغييرٌ واحدٌ في دفعة — **بالقديم والجديد**.
 *
 * والقديمُ يُقرأ ويُحفظ قبل الكتابة. وقراءتُه بعدها تعطي الجديد،
 * فيصير «التراجع» كتابةَ ما هو مكتوبٌ أصلاً — عمليةٌ تنجح ولا تفعل
 * شيئاً، وهي أسوأُ من فشلٍ صريح.
 */
export const BulkChange = model.define("zadim_bulk_change", {
  id: model.id({ prefix: "bchg" }).primaryKey(),

  bulk_operation_id: model.text(),
  entity_id: model.text(),
  field: model.text(),

  old_value: model.text().nullable(),
  new_value: model.text().nullable(),

  state: model.enum(["prepared", "applied", "reverted", "skipped"]).default("prepared"),
  /** سببُ التخطّي عند التراجع — أوضحُها «تغيّر بعد الدفعة». */
  skip_reason: model.text().nullable(),
}).indexes([
  { on: ["bulk_operation_id"] },
  { on: ["entity_id"] },
]);

export default BulkChange;
