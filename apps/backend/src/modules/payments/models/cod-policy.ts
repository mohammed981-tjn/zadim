import { model } from "@medusajs/framework/utils";

/**
 * سياسةُ الدفع عند الاستلام — **بيانات لا كود** (بند ٤٨).
 *
 * ── لماذا سياسةٌ أصلاً ───────────────────────────────────────────
 *
 * COD ليس خياراً تقنياً بل **مخاطرةٌ تشغيلية**: نسبةُ الرفض عند الباب
 * حقيقية، وكلفةُ الرفضة **شحنتان وبضاعةٌ عادت** — ذهاباً وإياباً على
 * حساب المتجر، والبضاعةُ تعود بعد أيام قد لا تُباع بسعرها.
 *
 * فالحدُّ الأعلى لقيمة طلب COD ليس رقماً هندسياً: هو قرارُ مالكٍ يوازن
 * بين بيعٍ يكسبه وشحنتين قد يخسرهما. **ولا يُبرمَج**.
 *
 * وكذلك عددُ الرفضات الذي يمنع العميل: واحدةٌ قد تكون ظرفاً، وثلاثٌ
 * نمطٌ. والفرقُ بينهما حكمُ إدارةٍ لا سطرُ كود.
 */
export const CodPolicy = model.define("zadim_cod_policy", {
  id: model.id({ prefix: "codp" }).primaryKey(),

  is_enabled: model.boolean().default(true),

  /** بالهللات. `null` = بلا حدّ أعلى. */
  max_order_total: model.number().nullable(),
  /** بالهللات. طلبٌ صغيرٌ جداً كلفةُ تحصيله أعلى من ربحه. */
  min_order_total: model.number().nullable(),

  /** عددُ الرفضات السابقة التي تمنع العميلَ من COD. `null` = لا منع. */
  refusals_before_block: model.number().nullable(),

  /** مدنٌ لا يُقبل فيها COD — قائمةٌ يضبطها المدير. */
  excluded_cities: model.array().nullable(),

  note: model.text().nullable(),
});

export default CodPolicy;
