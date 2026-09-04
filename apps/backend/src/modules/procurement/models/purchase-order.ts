import { model } from "@medusajs/framework/utils";

/**
 * أمرُ الشراء (بند ٣٣) — **وهو الذي يزيد المخزون**.
 *
 * وحالاتُه خمسٌ، وانتقالاتُها يحرسها مُطلِقٌ في القاعدة لا الكود:
 *
 *   draft ⇐ يُحرَّر ويُعدَّل
 *     ↓ place()      ⇒ الكمياتُ تُحجز في `incoming` عند المورّد
 *   placed ⇐ أُرسل، والسطورُ **تُجمَّد**
 *     ↓ استلامٌ جزئيّ
 *   partially_received
 *     ↓ اكتمالُ الاستلام
 *   received  (نهائيّة)
 *
 *   ومن draft أو placed ⇒ cancelled (نهائيّة) — **ما لم يُستلَم شيء**.
 *
 * ⚠️ **ولماذا تُجمَّد السطورُ عند الإرسال**: لأن «طلبنا عشراً بعشرين»
 * تتحوّل بتعديلٍ واحدٍ بعد الاستلام إلى «طلبنا مئةً باثنين» — فيصير
 * الفرقُ بضاعةً ناقصةً في الدفتر لا خطأً مرئياً. والمُرسَلُ إلى المورّد
 * لا يُعدَّل بأثرٍ رجعيّ: يُلغى ويُعاد.
 */
export const PurchaseOrder = model.define("zadim_purchase_order", {
  id: model.id({ prefix: "po" }).primaryKey(),

  supplier_id: model.text(),
  /** موقعُ الاستلام — البضاعةُ تصل رفّاً بعينه لا «المخزون». */
  location_id: model.text(),

  status: model
    .enum(["draft", "placed", "partially_received", "received", "cancelled"])
    .default("draft"),

  currency_code: model.text().default("sar"),

  placed_at: model.dateTime().nullable(),
  /** متى ننتظرها — من مهلة المورّد، ويعدّله المشتري. */
  expected_at: model.dateTime().nullable(),
  received_at: model.dateTime().nullable(),
  cancelled_at: model.dateTime().nullable(),

  /** من أنشأ ومن ألغى — نسخةُ الاسم لا المعرّفُ وحدَه، كسجلّ التدقيق. */
  created_by: model.text().nullable(),
  created_by_label: model.text().nullable(),

  note: model.text().nullable(),
});

export default PurchaseOrder;
