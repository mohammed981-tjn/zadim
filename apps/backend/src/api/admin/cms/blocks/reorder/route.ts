import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CMS_MODULE } from "../../../../../modules/cms";
import type CmsModuleService from "../../../../../modules/cms/service";

type Body = { page?: string; ordered_ids?: string[] };

/**
 * إعادةُ ترتيب الرئيسية — **بوّابةُ المرحلة ٩ نفسُها**.
 *
 * نداءٌ واحدٌ يغيّر ما يراه العميلُ في الصفحة الأولى. ولا بناءَ ولا نشر.
 */
export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const cms = req.scope.resolve(CMS_MODULE) as CmsModuleService;
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  if (!Array.isArray(body.ordered_ids) || !body.ordered_ids.length) {
    return res.status(400).json({
      error: { code: "INVALID_BODY", message_ar: "ordered_ids قائمةٌ غيرُ فارغة — الأولُ أعلى." },
    });
  }

  try {
    const blocks = await cms.reorder(body.page ?? "home", body.ordered_ids);
    return res.json({ blocks });
  } catch (e: any) {
    return res.status(400).json({
      error: { code: "UNKNOWN_BLOCKS", message_ar: String(e?.message ?? "") },
    });
  }
}
