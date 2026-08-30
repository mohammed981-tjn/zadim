import { model } from "@medusajs/framework/utils";
import { Role } from "./role";

/**
 * حدُّ الدور على صلاحيةٍ بعينها.
 *
 * بند ٤٨ «لا قاعدةَ عملٍ مبرمَجة»: سقفُ استرداد الدعم صفٌّ يرفعه
 * المديرُ العام حين يثق ويخفضه حين يشكّ — لا ثابتٌ في الكود.
 *
 * والمبلغ **هللاتٌ صحيحة** (ADR-008): لا FLOAT في حقلٍ ماليّ.
 */
export const RoleLimit = model.define("zadim_role_limit", {
  id: model.id({ prefix: "rlim" }).primaryKey(),
  role: model.belongsTo(() => Role, { mappedBy: "limits" }),
  permission_slug: model.text(),
  max_amount: model.bigNumber().nullable(),
  max_count: model.number().nullable(),
  requires_second_approval: model.boolean().default(false),
}).indexes([{ on: ["role_id", "permission_slug"], unique: true }]);

export default RoleLimit;
