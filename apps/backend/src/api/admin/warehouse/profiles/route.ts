import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { WAREHOUSE_MODULE } from "../../../../modules/warehouse";
import type WarehouseModuleService from "../../../../modules/warehouse/service";

type Body = {
  location_id?: string;
  city?: string | null;
  region_code?: string | null;
  priority?: number;
  is_fulfilment_enabled?: boolean;
  display_name_ar?: string | null;
};

/**
 * ملفّاتُ المستودعات — ما يقرّر «من أين يُشحن».
 *
 * والكتابةُ **إحلالٌ بالمعرّف** (upsert): استمارةٌ تُرسَل مرّتين تُنتج
 * ملفَّين للمستودع نفسِه بأولويتين، ثم يعتمد الاختيارُ على أيِّهما
 * قُرئ أوّلاً. والفهرسُ الفريد يمنعه في القاعدة، وهذا يمنعه برسالةٍ
 * مفهومة بدل خطأٍ عن قيد.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const warehouse = req.scope.resolve<WarehouseModuleService>(WAREHOUSE_MODULE);
  const profiles = await warehouse.listLocationProfiles({});
  res.json({ profiles });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const warehouse = req.scope.resolve<WarehouseModuleService>(WAREHOUSE_MODULE);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  if (!body.location_id) {
    return res.status(400).json({
      error: { code: "INVALID_BODY", message_ar: "location_id إلزاميّ" },
    });
  }

  const priority = body.priority === undefined ? 0 : Number(body.priority);
  if (!Number.isInteger(priority)) {
    return res.status(400).json({
      error: { code: "INVALID_PRIORITY", message_ar: "priority عددٌ صحيح" },
    });
  }

  const fields = {
    location_id: body.location_id,
    city: body.city ?? null,
    region_code: body.region_code ?? null,
    priority,
    is_fulfilment_enabled: body.is_fulfilment_enabled ?? true,
    display_name_ar: body.display_name_ar ?? null,
  };

  const [existing] = await warehouse.listLocationProfiles({
    location_id: body.location_id,
  });

  const profile = existing
    ? await warehouse.updateLocationProfiles({ id: existing.id, ...fields })
    : (await warehouse.createLocationProfiles([fields]))[0];

  res.status(existing ? 200 : 201).json({ profile });
}
