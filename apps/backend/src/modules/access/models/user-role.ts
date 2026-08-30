import { model } from "@medusajs/framework/utils";
import { Role } from "./role";

/**
 * إسنادُ دورٍ لمستخدم.
 *
 * `user_id` معرّفُ مستخدم Medusa بلا مفتاحٍ أجنبيّ — الربطُ عبر حدود
 * الوحدات في Medusa v2 يكون بـ Module Link لا بـ FK.
 *
 * و`vendor_id` فارغاً = دورٌ عامّ، وغيرَ فارغٍ = محصورٌ ببائع
 * (ADR-004: السوقُ في المخطط اليوم ومعطَّلٌ في الإطلاق).
 */
export const UserRole = model.define("zadim_user_role", {
  id: model.id({ prefix: "urole" }).primaryKey(),
  user_id: model.text(),
  role: model.belongsTo(() => Role),
  vendor_id: model.text().nullable(),
}).indexes([
  { on: ["user_id", "role_id"], unique: true },
  { on: ["user_id"] },
]);

export default UserRole;
