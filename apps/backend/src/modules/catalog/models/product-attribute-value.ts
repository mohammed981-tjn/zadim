import { model } from "@medusajs/framework/utils";
import { Attribute } from "./attribute";

/**
 * قيمةُ الخاصية لمنتج.
 *
 * و`value_normalized` **ليست تكراراً**: هي القيمةُ بعد تطبيع العربية
 * (`arabic.ts`)، تُخزَّن كي تُطابَق الفلترةُ والبحثُ بلا تطبيعٍ في كل
 * استعلام — ولا فهرسَ يعمل على دالّةٍ تُحسب وقت القراءة.
 *
 * وتُملأ في الخدمة عند كل كتابة، فلا تفترق عن الأصل أبداً.
 */
export const ProductAttributeValue = model.define("zadim_product_attribute_value", {
  id: model.id({ prefix: "pattr" }).primaryKey(),
  product_id: model.text(),
  attribute: model.belongsTo(() => Attribute),
  value: model.text(),
  value_normalized: model.text(),
}).indexes([
  { on: ["product_id", "attribute_id"], unique: true },
  { on: ["attribute_id", "value_normalized"] },
]);

export default ProductAttributeValue;
