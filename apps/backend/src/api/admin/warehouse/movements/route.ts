import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { WAREHOUSE_MODULE } from "../../../../modules/warehouse";
import type WarehouseModuleService from "../../../../modules/warehouse/service";

/**
 * دفترُ الحركات — **قراءةٌ فقط، ولا مسارَ كتابةٍ له بحال**.
 *
 * يكتبه مُطلِقُ القاعدة على `inventory_level`. ومسارُ كتابةٍ هنا يعني
 * أن السجلَّ الذي يُحتكم إليه في «من أين نقصت هذه الثلاثون» يمكن أن
 * يُملى بيدٍ — فيبطل معناه كلَّه.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const warehouse = req.scope.resolve<WarehouseModuleService>(WAREHOUSE_MODULE);
  const q = req.query as Record<string, string | undefined>;

  const filters: Record<string, unknown> = {};
  if (q.inventory_item_id) filters.inventory_item_id = q.inventory_item_id;
  if (q.location_id) filters.location_id = q.location_id;
  if (q.reason) filters.reason = q.reason;
  if (q.reference_id) filters.reference_id = q.reference_id;

  // سقفٌ افتراضيّ: دفترٌ يُعيد مليونَ سطرٍ لأن أحداً نسي `limit` يُسقط
  // اللوحةَ لا القاعدة، والعطلُ يظهر بعيداً عن سببه.
  const limit = Math.min(Number(q.limit ?? 50) || 50, 500);
  const offset = Number(q.offset ?? 0) || 0;

  const [movements, count] = await warehouse.listAndCountStockMovements(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  });

  res.json({ movements, count, limit, offset });
}
