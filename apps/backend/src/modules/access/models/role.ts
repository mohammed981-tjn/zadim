import { model } from "@medusajs/framework/utils";
import { Permission } from "./permission";
import { RoleLimit } from "./role-limit";

/**
 * الدور. سبعةٌ منها أدوارُ نظام (بند ٤٥) لا تُحذف ولا يُعاد تسميةُ
 * رمزها — الكودُ يعتمد عليها.
 */
export const Role = model.define("zadim_role", {
  id: model.id({ prefix: "role" }).primaryKey(),
  slug: model.text().unique(),
  name_ar: model.text(),
  is_system: model.boolean().default(false),
  permissions: model.manyToMany(() => Permission, {
    pivotTable: "zadim_role_permission",
    mappedBy: "roles",
  }),
  limits: model.hasMany(() => RoleLimit, { mappedBy: "role" }),
});

export default Role;
