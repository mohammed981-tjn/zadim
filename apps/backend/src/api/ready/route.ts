import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { readiness } from "../../modules/health/readiness";

/**
 * `GET /ready` — جهوزيّةُ النشرة، برقمٍ لا بظنّ.
 *
 * والمنطقُ في `modules/health/readiness.ts` لأن المسارَ لا يُختبَر إلا
 * بخادمٍ يعمل؛ ومن هناك تحرسه بوّابةٌ في CI. وهذا الملفُّ هو مسارُ
 * الإنتاج الذي يفرضه فاحصُ الوصل.
 *
 * ⚠️ **وليست هي فحصَ المنصّة**: `railway.json` يبقى على `/health`
 * عمداً. لأن `/ready` يردّ ٥٠٣ ما دامت الهجرةُ الأولى تعمل — ومنصّةٌ
 * تقرؤه تقتل الحاويةَ **في منتصف الهجرة**، فتُقلع أخرى تبدأ من جديد:
 * وهو نفسُ سباقِ الإقلاعين الذي أسقط أوّلَ نشرة. فهذه للإنسان وتلك
 * للمنصّة.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const result = await readiness(pg);
  res.status(result.ok ? 200 : 503).json(result);
}
