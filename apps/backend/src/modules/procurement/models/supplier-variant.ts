import { model } from "@medusajs/framework/utils";

/**
 * ما يبيعه هذا المورّدُ لنا من هذا المتغيّر — وبكم (بند ٣٢).
 *
 * ── لماذا التكلفةُ هنا **وليست** هي تكلفتَنا ─────────────────────
 *
 * هذه **تسعيرةُ مورّد**: عرضُه القائم. وتكلفتُنا النافذة صفٌّ في
 * `zadim_variant_cost` تكتبه **إيصالاتُ الاستلام** بالسعر الذي دُفع
 * فعلاً — لا بالسعر المعروض.
 *
 * والفرقُ ليس تجميلياً: عرضُ المورّد قد يتغيّر ولا نشتري به شيئاً،
 * وقد نشتري بسعرٍ متفاوَضٍ عليه غيرِ المعروض. فلو قرأنا الربحَ من
 * التسعيرة لحسبنا ربحاً على سعرٍ لم يُدفع.
 *
 * `is_preferred`: مورّدٌ واحدٌ مفضَّلٌ لكل متغيّرٍ حين تتعدّد العروض —
 * يحرسه فهرسٌ فريدٌ جزئيّ، لا شرطٌ في الكود.
 */
export const SupplierVariant = model.define("zadim_supplier_variant", {
  id: model.id({ prefix: "supvar" }).primaryKey(),

  supplier_id: model.text(),
  variant_id: model.text(),

  /** رمزُ الصنف عند المورّد — يُكتب في أمر الشراء كي يفهمه هو. */
  supplier_sku: model.text().nullable(),

  /** تسعيرةُ المورّد بالهللات صحيحةً (ADR-008). */
  unit_cost: model.number(),

  /** مهلةُ التوريد المعلَنة — أساسُ «متى نطلب» لا وعدٌ ملزِم. */
  lead_time_days: model.number().default(0),

  is_preferred: model.boolean().default(false),
});

export default SupplierVariant;
