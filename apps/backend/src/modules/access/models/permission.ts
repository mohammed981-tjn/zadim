import { model } from "@medusajs/framework/utils";
import { Role } from "./role";

/**
 * الصلاحية: أدقُّ فعلٍ يُؤذن به.
 *
 * الرمز (`slug`) مقروءٌ بذاته — 'orders.refund' تُقرأ في سجلّ التدقيق
 * وفي أي استعلامٍ بلا وصلٍ بجدولٍ آخر.
 */
export const Permission = model.define("zadim_permission", {
  id: model.id({ prefix: "perm" }).primaryKey(),
  slug: model.text().unique(),
  domain: model.text(),
  description: model.text(),
  // الطرفُ المقابل إلزاميّ: علاقةُ many-to-many بلا `mappedBy` على أحد
  // الطرفين تُسقط تحميلَ الوحدة كلِّها — ومعها مسارُ الهجرات.
  // `pivotTable` تُذكر على طرفٍ واحد فقط — وهو Role.
  roles: model.manyToMany(() => Role, { mappedBy: "permissions" }),
});

export default Permission;
