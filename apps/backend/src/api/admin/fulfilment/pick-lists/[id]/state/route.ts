import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { FULFILMENT_MODULE } from "../../../../../../modules/fulfilment";
import type FulfilmentModuleService from "../../../../../../modules/fulfilment/service";

type Body = { state?: string; blocked_reason?: string | null };

/**
 * نقلُ حالِ القائمة.
 *
 * والحارسُ في القاعدة لا هنا: نفسُ سببِ [ADR-016] — سيرُ عملٍ آخرُ أو
 * سكربتٌ يكتب الحالةَ لا يمرّ من هذا المسار. وهذا يترجم رفضَ القاعدة
 * إلى رسالةٍ عربيةٍ تُقرأ في شاشة المستودع.
 */
export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const ful = req.scope.resolve(FULFILMENT_MODULE) as FulfilmentModuleService;
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  if (!body.state) {
    return res.status(400).json({
      error: { code: "INVALID_BODY", message_ar: "state إلزاميّ." },
    });
  }

  const [list] = await ful.listPickLists({ id: req.params.id });
  if (!list) {
    return res.status(404).json({
      error: { code: "PICK_LIST_NOT_FOUND", message_ar: "لا قائمةَ بهذا المعرّف." },
    });
  }

  try {
    await ful.updatePickLists({
      id: req.params.id,
      state: body.state as any,
      blocked_reason: body.blocked_reason ?? null,
    });
    const [updated] = await ful.listPickLists({ id: req.params.id });
    return res.json({ pick_list: updated });
  } catch (e: any) {
    const raw = String(e?.message ?? "");
    const incomplete = /اللقطُ ناقص/.test(raw);
    const missing = incomplete ? await ful.complete(req.params.id) : null;

    return res.status(409).json({
      error: {
        code: incomplete ? "PICK_INCOMPLETE" : "TRANSITION_NOT_ALLOWED",
        message_ar: incomplete
          ? "اللقطُ ناقص — أكمل المسح أو أبلِغ عن النقص."
          : `انتقالٌ ممنوع من «${(list as any).state}» إلى «${body.state}».`,
        details: missing?.missing ?? undefined,
      },
    });
  }
}
