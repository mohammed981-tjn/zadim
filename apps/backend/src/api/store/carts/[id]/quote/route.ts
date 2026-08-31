import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { runQuote } from "../../../../../modules/checkout/orchestrate";

/**
 * `POST /store/carts/:id/quote` — **يثبّت ما رآه العميل**.
 *
 * تناديه الواجهةُ قبل شاشة المراجعة الأخيرة. وما يُعاد هنا هو الرقمُ
 * الذي وافق عليه العميل، وإليه يُقارَن كلُّ شيءٍ عند الإتمام.
 *
 * والمنطقُ في `modules/checkout/orchestrate.ts` لا هنا — كي يُختبر في
 * CI بلا خادمٍ يعمل.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { status, body } = await runQuote(req.scope, req.params.id);
  res.status(status).json(body);
}
