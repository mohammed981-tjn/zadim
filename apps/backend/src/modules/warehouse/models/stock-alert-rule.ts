import { model } from "@medusajs/framework/utils";

/**
 * حدُّ تنبيهِ النفاد — **بيانات لا ثابتٌ في الكود** (بند ٤٨).
 *
 * `if (available < 5) alert()` خطأٌ مرّتين: خمسةٌ كثيرةٌ لمنتجٍ يُباع
 * واحداً في الشهر، وقليلةٌ لآخرَ يُباع خمسين في اليوم. والثاني أن
 * تغييرَها يحتاج نشرةَ كود.
 *
 * ── الأخصُّ يغلب ─────────────────────────────────────────────────
 *
 * أربعةُ نطاقاتٍ مرتّبةٌ بالخصوصية، ويُطبَّق أخصُّ قاعدةٍ نشطة:
 *
 * | النطاق | يعني |
 * |---|---|
 * | `item_location` | هذه المادة في هذا المستودع |
 * | `item` | هذه المادة في كل مستودع |
 * | `location` | كلُّ مادةٍ في هذا المستودع |
 * | `global` | ما لم تُذكر له قاعدة |
 *
 * فالمديرُ يضع حدّاً عامّاً مرّةً، ثم يستثني ما يستحقّ الاستثناء — بدل
 * أن يضع لكل مادةٍ قاعدة.
 */
export const StockAlertRule = model.define("zadim_stock_alert_rule", {
  id: model.id({ prefix: "salrt" }).primaryKey(),

  scope: model.enum(["global", "item", "location", "item_location"]),

  inventory_item_id: model.text().nullable(),
  location_id: model.text().nullable(),

  // يُنبَّه حين ينزل **المتاح** (الموجود ناقصَ المحجوز) إلى هذا الحدّ
  // أو دونه. والمتاحُ لا الموجود: بضاعةٌ كلُّها محجوزةٌ نفدت فعلاً.
  threshold_quantity: model.number(),

  is_active: model.boolean().default(true),
  note: model.text().nullable(),
}).indexes([
  { on: ["scope", "inventory_item_id", "location_id"] },
]);

export default StockAlertRule;
