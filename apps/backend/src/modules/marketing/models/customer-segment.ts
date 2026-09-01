import { model } from "@medusajs/framework/utils";

/**
 * شريحةُ عملاء — **قواعدُها بياناتٌ لا كود** (بند ٤٨).
 *
 * والقواعدُ تُقيَّم بـ`segments.ts::matchesSegment` — دالّةٍ خالصةٍ لا
 * تقرأ قاعدة. فالشريحةُ تُجرَّب على صفوفٍ مكتوبةٍ بخطّ اليد قبل أن
 * تُرسَل حملةٌ إلى أحد.
 */
export const CustomerSegment = model.define("zadim_customer_segment", {
  id: model.id({ prefix: "seg" }).primaryKey(),

  name_ar: model.text(),
  name_en: model.text().nullable(),

  /** `{ match: "all" | "any", rules: [...] }` */
  definition: model.json(),

  is_active: model.boolean().default(true),
});

export default CustomerSegment;
