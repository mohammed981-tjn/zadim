import { model } from "@medusajs/framework/utils";

/**
 * سياسةُ الإرجاع — **بيانات لا كود** (بند ٤٨).
 *
 * ── لماذا لا رقمَ في الكود ───────────────────────────────────────
 *
 * مدّةُ الإرجاع ليست ثابتاً هندسياً: تتغيّر بالموسم (التخفيضاتُ نافذتُها
 * أضيق)، وبنوعِ الصنف، وبنظامٍ قد يُعدَّل. ورقمٌ في الكود يجعل تغييرَه
 * **نشرةَ إصدار** — مبرمجٌ ومراجعةٌ وبناءٌ ونشر، لتغيير عدد.
 *
 * ── وصفٌّ حيٌّ واحد ──────────────────────────────────────────────
 *
 * بفهرسٍ فريدٍ على `((true)) where deleted_at is null`، كما في
 * `zadim_cod_policy`. وسياستان نافذتان تعني أن الحكمَ يعتمد على
 * أيِّهما قُرئت أوّلاً — وذاك عطلٌ لا يظهر إلا يومَ يختلفان.
 *
 * ⚠️ **وغيابُ الصفّ ليس سماحاً**: بلا سياسةٍ لا إرجاع (انظر
 * `policy.ts`). قبولُ مرتجعٍ التزامٌ ماليٌّ وتشغيليّ، ولا يُلتزَم به
 * لأن أحداً نسي أن يملأ استمارة.
 */
export const ReturnPolicy = model.define("zadim_return_policy", {
  id: model.id({ prefix: "retp" }).primaryKey(),

  is_enabled: model.boolean().default(true),

  /** أيامٌ من **الاستلام** لا من الطلب. `null` = بلا حدٍّ زمنيّ. */
  window_days: model.number().nullable(),

  /** هل يُقبل الصنفُ بعد فتح عبوته؟ */
  accepts_opened: model.boolean().default(true),

  /** تصنيفاتٌ لا تُرجَع — كالأطعمة والعناية الشخصية. */
  excluded_category_ids: model.json().nullable(),

  /** بالهللات. `null` = بلا حدّ أدنى. */
  min_order_total: model.number().nullable(),

  /** من يدفع شحنةَ الإرجاع: المتجر أم العميل — يختلف بسبب الإرجاع. */
  who_pays_shipping: model.enum(["store", "customer"]).default("customer"),

  note: model.text().nullable(),
});

export default ReturnPolicy;
