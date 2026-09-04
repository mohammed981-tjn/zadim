import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { placePurchaseOrder } from "../../../../../../modules/procurement/receive";

/**
 * إرسالُ أمرِ شراءٍ إلى المورّد — **وصلاحيتُه `purchase_orders.approve`**.
 *
 * وفصلُها عن `purchase_orders.create` مكتوبٌ في `05-rbac-matrix.md`:
 * من يُصدر الأمرَ ليس من يعتمده. وتركيزُهما في يدٍ واحدة يجعل «اشترِ
 * من نفسك» مساراً كاملاً — أمرٌ يُنشأ ويُعتمد ويُستلَم بلا عينٍ ثانية.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const out = await placePurchaseOrder(req.scope, req.params.id);
  if (!out.ok) {
    const status =
      out.code === "ORDER_NOT_FOUND" ? 404 : out.code === "ORDER_EMPTY" ? 400 : 409;
    return res.status(status).json({ error: { code: out.code, message_ar: out.message_ar } });
  }
  return res.json({ placed: true, lines: out.lines });
}
