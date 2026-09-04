import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { WAREHOUSE_MODULE } from "../../../../modules/warehouse";
import type WarehouseModuleService from "../../../../modules/warehouse/service";
import { requestAdjustment } from "../../../../modules/warehouse/adjust";

type Body = {
  inventory_item_id?: string;
  location_id?: string;
  delta?: number;
  reason?: "adjustment" | "stocktake" | "damage" | "correction";
  note?: string | null;
};

/**
 * تسوياتُ المخزون — **طلبٌ لا أثر**.
 *
 * 🔴 و`requested_by` **لا يُقبل من الجسم**: يُشتقّ من هويّة الطلب.
 * ولو قُبل لكتب من يريد التسويةَ اسمَ زميلٍ في «الطالب» ثمّ وافق
 * عليها بنفسه — فتمرّ بأربع عيونٍ في السجلّ وعينين في الواقع، وهو
 * بالضبط ما بُني هذا البند لمنعه.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const warehouse = req.scope.resolve<WarehouseModuleService>(WAREHOUSE_MODULE);
  const q = req.query as Record<string, string | undefined>;

  const filters: Record<string, unknown> = {};
  if (q.state) filters.state = q.state;

  const [adjustments, count] = await warehouse.listAndCountStockAdjustments(filters, {
    take: Math.min(Number(q.limit ?? 50) || 50, 200),
    skip: Number(q.offset ?? 0) || 0,
    order: { created_at: "DESC" },
  });
  res.json({ adjustments, count, policy: await warehouse.adjustmentPolicy() });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const actor = String((req as any).auth_context?.actor_id ?? "");
  if (!actor) {
    return res.status(401).json({
      error: { code: "ACTOR_REQUIRED", message_ar: "لا تسويةَ بلا هويّةٍ معروفة." },
    });
  }

  if (!body.inventory_item_id || !body.location_id) {
    return res.status(400).json({
      error: { code: "TARGET_REQUIRED", message_ar: "الصنفُ والموقعُ مطلوبان." },
    });
  }

  const out = await requestAdjustment(req.scope, {
    inventory_item_id: body.inventory_item_id,
    location_id: body.location_id,
    delta: Number(body.delta),
    reason: body.reason,
    requested_by: actor,
    note: body.note ?? null,
  });

  if (!out.ok) return res.status(400).json({ error: out });
  return res.status(201).json(out);
}
