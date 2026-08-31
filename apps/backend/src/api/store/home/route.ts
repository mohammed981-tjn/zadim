import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CMS_MODULE } from "../../../modules/cms";
import type CmsModuleService from "../../../modules/cms/service";

/**
 * `GET /store/home` — **الرئيسيةُ كما رتّبها المدير**.
 *
 * والواجهةُ تعرض ما يأتي بالترتيب الذي يأتي، ولا تعرف قسماً قبل قسم.
 * فتقديمُ قسمٍ في موسم التخفيضات **سحبٌ وإفلاتٌ في اللوحة**، لا نشرةُ
 * إصدار.
 *
 * ⚠️ **وصفحةٌ فارغةٌ حالةٌ صريحة**: `blocks: []` مع `is_configured:
 * false`. والواجهةُ تعرض حالةَ فراغٍ مفهومة، لا شاشةً بيضاء يظنّها
 * الزائرُ عطلاً.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const cms = req.scope.resolve(CMS_MODULE) as CmsModuleService;
  const page = String((req.query as any).page ?? "home");

  const blocks = await cms.blocksFor(page);

  res.json({
    page,
    is_configured: blocks.length > 0,
    blocks: (blocks as any[]).map((b) => ({
      id: b.id,
      type: b.type,
      position: b.position,
      payload: b.payload ?? {},
    })),
  });
}
