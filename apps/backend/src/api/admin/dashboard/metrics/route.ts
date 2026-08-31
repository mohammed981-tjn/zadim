import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { computeMetrics } from "../../../../modules/dashboard/metrics";

/**
 * أرقامُ اللوحة — والحسابُ في `modules/dashboard/metrics.ts` لا هنا.
 *
 * لأن بوّابةَ المرحلة ٨ تشترط أن **يطابق كلُّ رقمٍ استعلاماً مباشراً على
 * القاعدة**، وذلك فحصٌ يجب أن يجري في CI في كل دفعة. ومنطقٌ يسكن مُعالِجَ
 * مسارٍ لا يُختبر إلا بخادمٍ يعمل — فيصير الفحصُ ثقيلاً ثم يُشطب.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json(await computeMetrics(req.scope));
}
