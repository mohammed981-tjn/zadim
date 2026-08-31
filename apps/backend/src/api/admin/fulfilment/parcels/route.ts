import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { FULFILMENT_MODULE } from "../../../../modules/fulfilment";
import type FulfilmentModuleService from "../../../../modules/fulfilment/service";

type Body = {
  barcode?: string;
  weight_grams?: number;
  pick_list_id?: string | null;
  fulfillment_id?: string | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
};

/**
 * الطردُ المغلَّف.
 *
 * والوزنُ إلزاميّ **هنا وفي القاعدة**: الرسالةُ العربية تُقرأ في شاشة
 * التغليف، والقيدُ يمنع أيَّ مسارٍ آخر. وطردٌ بلا وزنٍ يُردّ عند إصدار
 * البوليصة — **بعد أن يكون قد أُغلق ولُصق**.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const ful = req.scope.resolve(FULFILMENT_MODULE) as FulfilmentModuleService;
  const q = req.query as Record<string, string | undefined>;

  const filters: Record<string, unknown> = {};
  if (q.pick_list_id) filters.pick_list_id = q.pick_list_id;
  if (q.fulfillment_id) filters.fulfillment_id = q.fulfillment_id;

  const parcels = await ful.listParcels(filters, { order: { created_at: "DESC" }, take: 100 });
  res.json({ parcels, count: parcels.length });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const ful = req.scope.resolve(FULFILMENT_MODULE) as FulfilmentModuleService;
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const weight = Number(body.weight_grams);
  if (!body.barcode || !Number.isInteger(weight) || weight <= 0) {
    return res.status(400).json({
      error: {
        code: "INVALID_BODY",
        message_ar: "باركودُ الطرد ووزنُه بالغرامات إلزاميّان، والوزنُ أكبرُ من صفر.",
      },
    });
  }

  try {
    const [parcel] = await ful.createParcels([
      {
        barcode: body.barcode,
        weight_grams: weight,
        pick_list_id: body.pick_list_id ?? null,
        fulfillment_id: body.fulfillment_id ?? null,
        length_mm: body.length_mm ?? null,
        width_mm: body.width_mm ?? null,
        height_mm: body.height_mm ?? null,
        packed_by: (req as any).auth_context?.actor_id ?? null,
      },
    ]);
    return res.status(201).json({ parcel });
  } catch {
    return res.status(409).json({
      error: {
        code: "PARCEL_BARCODE_TAKEN",
        message_ar: "هذا الباركود مستعملٌ لطردٍ آخر. الصق ملصقاً جديداً.",
      },
    });
  }
}
