import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ACCESS_MODULE } from "../../../../modules/access";
import type AccessModuleService from "../../../../modules/access/service";

/**
 * قراءةُ سجلّ التدقيق — للمالية والمدير العام وحدهما
 * (`05-rbac-matrix.md`).
 *
 * ولا `POST` ولا `PATCH` ولا `DELETE` هنا **عمداً**: السجلُّ يُكتب من
 * طبقة الوسيط وحدها، ولا مسارَ في الواجهة يكتب فيه أو يمحو منه.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const access = req.scope.resolve<AccessModuleService>(ACCESS_MODULE);

  const filter: Record<string, unknown> = {};
  for (const key of ["entity", "entity_id", "actor_id", "action"]) {
    if (req.query[key]) filter[key] = String(req.query[key]);
  }

  const take = Math.min(Number(req.query.limit ?? 50), 200);
  const skip = Number(req.query.offset ?? 0);

  const [logs, count] = await access.listAndCountAuditLogs(filter, {
    take,
    skip,
    order: { created_at: "DESC" },
  });

  res.json({ audit_logs: logs, count, limit: take, offset: skip });
}
