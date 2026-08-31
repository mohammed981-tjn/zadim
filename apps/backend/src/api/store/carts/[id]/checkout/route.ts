import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { runCheckout } from "../../../../../modules/checkout/orchestrate";

/**
 * `POST /store/carts/:id/checkout` — **أخطرُ نداءٍ في النظام**.
 *
 * ترتيبُه السبعة والحرّاسُ كلُّها في
 * `modules/checkout/orchestrate.ts` — كي تُختبر في CI في كل دفعة بلا
 * خادمٍ يعمل. ومنطقٌ يسكن مُعالِجَ مسارٍ يصير اختبارُه ثقيلاً، ثم
 * يُشطب من CI، ثم يُنسى.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const key = String(req.headers["idempotency-key"] ?? "") || null;
  const { status, body } = await runCheckout(req.scope, req.params.id, key);
  res.status(status).json(body);
}
