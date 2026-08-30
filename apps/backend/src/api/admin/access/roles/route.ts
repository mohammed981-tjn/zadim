import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ACCESS_MODULE } from "../../../../modules/access";
import type AccessModuleService from "../../../../modules/access/service";

/** الأدوار وحدودُها. الحدُّ **بيانات** يضبطها المدير (بند ٤٨). */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const access = req.scope.resolve<AccessModuleService>(ACCESS_MODULE);
  const roles = await access.listRoles({}, { relations: ["permissions", "limits"] });
  res.json({
    roles: roles.map((r: any) => ({
      id: r.id,
      slug: r.slug,
      name_ar: r.name_ar,
      is_system: r.is_system,
      permissions: (r.permissions ?? []).map((p: any) => p.slug).sort(),
      limits: (r.limits ?? []).map((l: any) => ({
        permission_slug: l.permission_slug,
        max_amount: l.max_amount == null ? null : String(l.max_amount),
        max_count: l.max_count,
        requires_second_approval: l.requires_second_approval,
      })),
    })),
  });
}
