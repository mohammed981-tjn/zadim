import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { WAREHOUSE_MODULE } from "../../../../modules/warehouse";
import type WarehouseModuleService from "../../../../modules/warehouse/service";

type Body = {
  lines?: Array<{ inventory_item_id?: string; quantity?: number }>;
  destination_city?: string | null;
};

/**
 * معاينةُ خطّة الشحن: من أيّ مستودعٍ يخرج كلُّ بند.
 *
 * ── معاينةٌ لا تحجز ─────────────────────────────────────────────
 *
 * تُعيد الخطّةَ ولا تُنشئ حجزاً. والفرقُ جوهريّ: الحجزُ هنا يعني أن
 * فتحَ الشاشة يقضم المخزون، فيُسحب من عميلٍ يدفع لمصلحة موظّفٍ يستطلع.
 * والحجزُ يقع في مكانٍ واحد: سيرُ عمل Checkout، تحت قفلٍ.
 *
 * **ولذلك الخطّةُ تقديريّة**: المخزونُ قد يتغيّر بين المعاينة والتنفيذ،
 * ولا يُبنى عليها وعدٌ للعميل.
 */
export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const warehouse = req.scope.resolve<WarehouseModuleService>(WAREHOUSE_MODULE);
  const inventory = req.scope.resolve(Modules.INVENTORY);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const lines = (body.lines ?? [])
    .filter((l) => l?.inventory_item_id && Number(l.quantity) > 0)
    .map((l) => ({
      inventory_item_id: l.inventory_item_id as string,
      quantity: Number(l.quantity),
    }));

  if (!lines.length) {
    return res.status(400).json({
      error: {
        code: "INVALID_BODY",
        message_ar: "lines قائمةٌ غيرُ فارغة، كلُّ بندٍ بـ inventory_item_id و quantity > 0",
      },
    });
  }

  const levels = await inventory.listInventoryLevels({
    inventory_item_id: lines.map((l) => l.inventory_item_id),
  });

  const profiles = await warehouse.listLocationProfiles({});

  const plan = warehouse.planAllocation({
    lines,
    availability: levels.map((l: any) => ({
      inventory_item_id: l.inventory_item_id,
      location_id: l.location_id,
      available: Number(l.stocked_quantity) - Number(l.reserved_quantity),
    })),
    profiles: profiles.map((p: any) => ({
      location_id: p.location_id,
      city: p.city,
      priority: Number(p.priority),
      is_fulfilment_enabled: p.is_fulfilment_enabled,
    })),
    destination_city: body.destination_city ?? null,
  });

  res.json({ plan, is_preview: true });
}
