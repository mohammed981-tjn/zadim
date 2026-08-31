import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { FULFILMENT_MODULE } from "../../../../../../modules/fulfilment";
import type FulfilmentModuleService from "../../../../../../modules/fulfilment/service";

type Body = { barcode?: string };

/**
 * مسحةُ باركود — **أكثرُ نداءٍ يُستدعى في المستودع**.
 *
 * والردُّ يجب أن يُقرأ في لمحة: الملقّطُ ينظر إلى الشاشة وبيده صنف.
 * فالرمزُ والرسالةُ العربيةُ و**هل تُوقف** ثلاثتُها في الردّ، ولا يُترك
 * للواجهة أن تستنتجها — واجهةٌ تستنتج تخطئ يوماً فتُكمل بعد خطأِ صنف.
 */
export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const ful = req.scope.resolve(FULFILMENT_MODULE) as FulfilmentModuleService;
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const [list] = await ful.listPickLists({ id: req.params.id });
  if (!list) {
    return res.status(404).json({
      error: { code: "PICK_LIST_NOT_FOUND", message_ar: "لا قائمةَ بهذا المعرّف." },
    });
  }

  try {
    const result = await ful.scan(req.params.id, String(body.barcode ?? ""));
    if (result.accepted) {
      return res.json({
        accepted: true,
        item_id: result.item.id,
        title: result.item.title,
        picked_quantity: result.picked_quantity,
        quantity: result.item.quantity,
        complete: result.complete,
      });
    }
    return res.status(409).json({
      accepted: false,
      blocked: result.blocks,
      error: { code: result.code, message_ar: result.reason_ar },
    });
  } catch (e: any) {
    // حارسُ القاعدة رفض اللقط: القائمةُ متوقّفةٌ أو مختومة.
    return res.status(409).json({
      accepted: false,
      blocked: true,
      error: {
        code: "PICKING_NOT_ALLOWED",
        message_ar: "لا يُلقط في هذه القائمة الآن — راجع حالَها.",
      },
    });
  }
}
