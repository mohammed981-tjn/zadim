import { model } from "@medusajs/framework/utils";

/**
 * خاصيةُ منتج — «اللون» و«السعة» و«المقاس».
 *
 * وهي أصلُ **الفلاتر المتولّدة** (بند ٣): تصنيفٌ يُظهر فلاترَ خصائصه
 * هو، لا قائمةً واحدةً مبرمَجةً لكل التصنيفات. فـ«إلكترونيات» تُظهر
 * السعة، و«ملابس» تُظهر المقاس، بلا سطرِ كودٍ لأيٍّ منهما.
 */
export const Attribute = model.define("zadim_attribute", {
  id: model.id({ prefix: "attr" }).primaryKey(),
  code: model.text().unique(),
  name_ar: model.text(),
  name_en: model.text().nullable(),
  data_type: model.enum(["text", "number", "boolean", "select"]).default("text"),
  // خاصيةٌ غيرُ قابلةٍ للفلترة تبقى معروضةً في صفحة المنتج ولا تُنتج
  // فلتراً — كـ«بلد المنشأ»: يُعرض ولا يُفلتَر به.
  is_filterable: model.boolean().default(true),
  sort_order: model.number().default(0),
});

export default Attribute;
