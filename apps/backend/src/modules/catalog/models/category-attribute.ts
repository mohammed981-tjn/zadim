import { model } from "@medusajs/framework/utils";
import { Attribute } from "./attribute";

/**
 * ربطُ الخاصية بالتصنيف — وهو ما يجعل الفلاتر تتولّد.
 *
 * `category_id` نصٌّ بلا مفتاحٍ أجنبيّ: التصنيفاتُ تسكن وحدة المنتجات
 * في Medusa، والربطُ عبر حدود الوحدات يكون بـModule Link لا بـFK
 * (نفسُ ما فُعل بـ`user_id` في وحدة access).
 */
export const CategoryAttribute = model.define("zadim_category_attribute", {
  id: model.id({ prefix: "catattr" }).primaryKey(),
  category_id: model.text(),
  attribute: model.belongsTo(() => Attribute),
  sort_order: model.number().default(0),
}).indexes([
  { on: ["category_id", "attribute_id"], unique: true },
  { on: ["category_id"] },
]);

export default CategoryAttribute;
