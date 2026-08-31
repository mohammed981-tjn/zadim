import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { BULK_MODULE } from "../../../modules/bulk";
import type BulkModuleService from "../../../modules/bulk/service";

/** سجلُّ الدفعات — يُلحَق ولا يُحذف: تغييرٌ على خمسمئة صنفٍ لا أثرَ له. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const bulk = req.scope.resolve(BULK_MODULE) as BulkModuleService;
  const q = req.query as Record<string, string | undefined>;

  const filters: Record<string, unknown> = {};
  if (q.status) filters.status = q.status;
  if (q.kind) filters.kind = q.kind;

  const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
  const [operations, count] = await bulk.listAndCountBulkOperations(filters, {
    take: limit,
    order: { created_at: "DESC" },
  });

  res.json({ operations, count, limit });
}
