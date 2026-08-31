import { model } from "@medusajs/framework/utils";

/**
 * بياناتُ SEO لكيان (بند ٣٨).
 *
 * ── لماذا جدولٌ واحدٌ متعدّدُ الكيانات ────────────────────────────
 *
 * المنتجُ والتصنيفُ والعلامةُ والصفحة تحتاج **نفسَ الحقول** بالضبط.
 * وجدولٌ لكلٍّ منها يعني أربعَ هجراتٍ وأربعةَ مسارات وأربعَ نسخٍ من
 * نفس المنطق — وأربعةَ مواضعَ يُنسى التحديثُ في أحدها.
 *
 * والثمن: لا مفتاحَ أجنبيّ على `entity_id`. وهو ثمنٌ مدفوعٌ أصلاً —
 * الكياناتُ الأربعة تسكن وحدةَ منتجات Medusa، والعبورُ بين الوحدات لا
 * يكون بـFK على أي حال.
 *
 * ── واللغةُ في المفتاح لا في الحقول ──────────────────────────────
 *
 * صفٌّ لكل لغة، لا `title_ar` و`title_en` في صفٍّ واحد. فإضافةُ لغةٍ
 * ثالثة صفوفٌ جديدة لا **هجرةٌ تُعدّل جدولاً فيه ملايين الصفوف**.
 */
export const SeoMeta = model.define("zadim_seo_meta", {
  id: model.id({ prefix: "seo" }).primaryKey(),
  entity: model.enum(["product", "category", "brand", "page"]),
  entity_id: model.text(),
  locale: model.text().default("ar"),
  title: model.text().nullable(),
  description: model.text().nullable(),
  canonical_url: model.text().nullable(),
  og_image: model.text().nullable(),
  // بياناتٌ مهيكلة (JSON-LD) — تُبنى آلياً وتُتجاوز يدوياً عند الحاجة.
  structured_data: model.json().nullable(),
  no_index: model.boolean().default(false),
}).indexes([
  { on: ["entity", "entity_id", "locale"], unique: true },
  { on: ["entity", "entity_id"] },
]);

export default SeoMeta;
