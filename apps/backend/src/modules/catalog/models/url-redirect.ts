import { model } from "@medusajs/framework/utils";

/**
 * تحويلُ مسارٍ قديم إلى جديد (بند ٣٨).
 *
 * ── لماذا يلزم ──────────────────────────────────────────────────
 *
 * تغييرُ `slug` منتجٍ مفهرَسٍ في جوجل **يقتل ترتيبَه**: الرابطُ القديم
 * يصير 404، ويُسقط جوجل الصفحة ومعها كلَّ ما بنته من ثقةٍ عبر شهور.
 * و301 ينقل تلك الثقة إلى الرابط الجديد.
 *
 * وهو أيضاً ما ينقذ روابطَ شاركها العملاء في واتساب — تلك لا تُحدَّث
 * أبداً.
 */
export const UrlRedirect = model.define("zadim_url_redirect", {
  id: model.id({ prefix: "rdr" }).primaryKey(),
  from_path: model.text().unique(),
  to_path: model.text(),
  // 301 دائمٌ (ينقل ثقة الفهرسة) · 302 مؤقّتٌ (لا ينقلها).
  status: model.number().default(301),
  hits: model.number().default(0),
});

export default UrlRedirect;
