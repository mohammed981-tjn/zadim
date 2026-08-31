import { model } from "@medusajs/framework/utils";

/**
 * دفترُ حركات المخزون — **كلُّ تغيّرٍ في الموجود، بلا استثناء**.
 *
 * ── لماذا لا يُكتب من الكود ──────────────────────────────────────
 *
 * دفترٌ يكتبه التطبيق ينقص كلَّما نُسي نداؤه: سكربتُ استيراد، تصحيحٌ
 * يدويّ بـSQL، مسارٌ جديدٌ كتبه من لا يعرف الدفتر. وحين يُسأل «من أين
 * نقصت هذه الثلاثون؟» لا يكون الجوابُ «لا أدري» بل — وهو أسوأ —
 * **جوابٌ ناقصٌ يبدو كاملاً**.
 *
 * فالدفترُ يكتبه **مُطلِقٌ في القاعدة** على `inventory_level`. ولا
 * يستطيع أيُّ مسارِ كودٍ تجاوزَه، لأنه ليس في الكود.
 *
 * ── والسببُ (`reason`) من أين يأتي؟ ──────────────────────────────
 *
 * المُطلِقُ يرى الأرقام ولا يرى النيّة: زيادةُ عشرةٍ استلامُ بضاعةٍ أم
 * تصحيحُ جرد؟ فيقرأ متغيّرَ الجلسة `zadim.movement_reason` إن ضبطه
 * الكودُ داخل معاملته، وإلا سجّل `adjustment`.
 *
 * **والسببُ المجهول يُسجَّل ولا يُسقط الحركة**: دفترٌ يرفض القيدَ لأن
 * السببَ لم يُذكر يُوقف المتجرَ ليحمي حقلاً وصفياً — والحركةُ نفسُها
 * أثمنُ من وصفها.
 *
 * ── ولا يُعدَّل ولا يُحذف ────────────────────────────────────────
 *
 * قاعدةُ `DO INSTEAD NOTHING` في الهجرة، كما في `audit_logs`. ودفترٌ
 * يُعدَّل ليس دفتراً.
 */
export const StockMovement = model.define("zadim_stock_movement", {
  id: model.id({ prefix: "smov" }).primaryKey(),

  inventory_item_id: model.text(),
  location_id: model.text(),

  // موجبٌ زيادةً وسالبٌ نقصاً. والرصيدُ بعدها يُحفظ معها: إعادةُ بناء
  // الرصيد بجمع الفروق من أول الدفتر تصير أبطأَ كلَّ يوم، والرصيدُ
  // المحفوظ يجعل أيَّ سطرٍ نقطةَ بدايةٍ صالحة.
  delta: model.number(),
  balance_after: model.number(),

  reason: model
    .enum([
      "receipt", // استلامُ بضاعةٍ من مورّد
      "adjustment", // تسويةٌ يدوية — والافتراضيّ حين لا يُذكر سبب
      "stocktake", // جردٌ فعليّ
      "fulfilment", // خروجٌ مع طلبٍ نُفِّذ
      "return", // رجوعٌ إلى الرفّ بعد مرتجع
      "transfer_in",
      "transfer_out",
      "damage", // تلفٌ أو فقد
      "correction", // تصحيحُ خطأٍ سابقٍ في الدفتر نفسه
    ])
    .default("adjustment"),

  reference_type: model.text().nullable(),
  reference_id: model.text().nullable(),
  actor_id: model.text().nullable(),
  note: model.text().nullable(),
}).indexes([
  { on: ["inventory_item_id", "location_id"] },
  { on: ["created_at"] },
  { on: ["reference_type", "reference_id"] },
]);

export default StockMovement;
