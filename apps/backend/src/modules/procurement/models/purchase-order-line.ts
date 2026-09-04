import { model } from "@medusajs/framework/utils";

/**
 * سطرُ أمر شراء — الكميةُ والتكلفةُ التي **تُدفع فعلاً**.
 *
 * `unit_cost` هنا هو مصدرُ تكلفتنا: عند الاستلام يُكتب صفٌّ في
 * `zadim_variant_cost` بهذا الرقم بمصدر `purchase_order`. وهو ما كان
 * يجعل جدولَ التكلفة يصل الإنتاجَ **فارغاً** — تكلفةٌ لا يكتبها أحد.
 *
 * و`inventory_item_id` يُخزَّن مع `variant_id` عمداً: المخزونُ يُزاد على
 * **عنصر المخزون** لا على المتغيّر، والوصلةُ بينهما تُقرأ وقتَ الإنشاء
 * لا وقتَ الاستلام — فمتغيّرٌ فُصلت وصلتُه لاحقاً لا يُضيّع طرداً واصلاً.
 */
export const PurchaseOrderLine = model.define("zadim_purchase_order_line", {
  id: model.id({ prefix: "poline" }).primaryKey(),

  purchase_order_id: model.text(),
  variant_id: model.text(),
  inventory_item_id: model.text(),

  quantity_ordered: model.number(),
  /** **لا يُكتب بيد**: يحدّثه مُطلِقُ دفتر الإيصالات. */
  quantity_received: model.number().default(0),

  /** بالهللات صحيحةً. صفرٌ مسموح (هديّةٌ أو عيّنة)، والسالبُ ممنوعٌ بقيد. */
  unit_cost: model.number(),
});

export default PurchaseOrderLine;
