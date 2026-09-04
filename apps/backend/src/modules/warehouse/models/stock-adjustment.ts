import { model } from "@medusajs/framework/utils";

/**
 * تسويةُ مخزونٍ يدوية — **وأربعُ عيونٍ لا اثنتان** فوق الحدّ.
 *
 * ── والقاعدةُ مكتوبةٌ في `05-rbac-matrix.md` ─────────────────────
 *
 * > «تسويةُ الجرد بموافقةٍ ثانية — **تسويةٌ منفردة أسهلُ طريقةٍ
 * > لإخفاء سرقةٍ من المستودع**.»
 *
 * فمن يأخذ عشرَ قطعٍ ثمّ يكتب «تلفت عشر» يجعل الدفترَ يوافق الرفّ،
 * ولا يبقى في النظام أثرٌ يدلّ على شيء. والموافقةُ الثانيةُ لا تمنع
 * السرقة — **تمنع إخفاءَها بلا شريك**، وذلك يكفي.
 *
 * ── ولماذا صفٌّ ينتظر لا تسويةٌ تقع ثمّ تُراجَع ─────────────────
 *
 * 🔴 لأن شرطَ القبول يُقاس **بالأثر**: «الرصيدُ لا يتغيّر قبل الموافقة
 * الثانية». وتسويةٌ تقع ثمّ تُراجَع تعني أن البضاعةَ خرجت من الدفتر
 * ساعةً على الأقلّ — وفي تلك الساعة يُطلَب الصنفُ ولا يُباع، أو
 * يُعاد شراؤه بلا حاجة. فالطلبُ يُحجز ولا يُنفَّذ حتى يوافق ثانٍ.
 *
 * ⚠️ **والمُنفِّذُ يُسجَّل ثالثاً**: من طلب، ومن وافق، ومن ضغط
 * «طبِّق». وقد يكون المنفّذُ أحدَهما، لكن السؤال «متى وقع الأمرُ على
 * الرفّ فعلاً» له جوابٌ منفصلٌ عن «متى وُوفق عليه».
 */
export const StockAdjustment = model
  .define("zadim_stock_adjustment", {
    id: model.id({ prefix: "sadj" }).primaryKey(),

    inventory_item_id: model.text(),
    location_id: model.text(),

    /** الفرقُ المطلوب: موجبٌ يزيد وسالبٌ ينقص. ولا يُقبل صفر. */
    delta: model.number(),

    /** `damage` · `stocktake` · `correction` — من تعداد دفتر الحركات. */
    reason: model.text().default("adjustment"),

    /** `pending` · `approved` · `applied` · `rejected`. */
    state: model.text().default("pending"),

    /** هل تجاوزت الحدَّ فلزمت موافقةٌ ثانية؟ يُحسب عند الطلب ويُثبَّت. */
    needs_approval: model.boolean().default(true),

    requested_by: model.text(),
    approved_by: model.text().nullable(),
    applied_by: model.text().nullable(),

    approved_at: model.dateTime().nullable(),
    applied_at: model.dateTime().nullable(),

    /** قيمةُ التسوية لحظةَ الطلب — لتُقرأ بعدها بلا إعادةِ حساب. */
    value_halalas: model.number().nullable(),

    note: model.text().nullable(),
    reject_reason: model.text().nullable(),
  })
  .indexes([
    { on: ["state"] },
    { on: ["inventory_item_id", "location_id"] },
  ]);

export default StockAdjustment;
