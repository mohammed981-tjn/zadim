import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { approveAdjustment, rejectAdjustment } from "../../../../../../modules/warehouse/adjust";

type Body = { reject?: boolean; reason?: string };

/**
 * الموافقةُ على تسوية — **والموافِقُ من الرمز لا من الجسم**.
 *
 * ⚠️ والصلاحيةُ `inventory.stocktake` لا `inventory.adjust`: من يطلب
 * التسويةَ ليس من يوافق عليها، وتركيزُهما في صلاحيةٍ واحدةٍ يجعل
 * «أربعُ عيونٍ» عبارةً في وثيقة.
 */
export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;
  const id = String((req.params as any).id);

  const actor = String((req as any).auth_context?.actor_id ?? "");
  if (!actor) {
    return res.status(401).json({
      error: { code: "ACTOR_REQUIRED", message_ar: "لا موافقةَ بلا هويّةٍ معروفة." },
    });
  }

  const out = body.reject
    ? await rejectAdjustment(req.scope, id, actor, String(body.reason ?? ""))
    : await approveAdjustment(req.scope, id, actor);

  if (!out.ok) {
    // ورفضُ «لا يوافق أحدٌ على تسويةِ نفسِه» ٤٠٩ لا ٤٠٠: الطلبُ سليمُ
    // الشكل، والحالةُ هي التي تمنعه.
    return res.status(out.code === "SELF_APPROVAL" ? 409 : 400).json({ error: out });
  }
  return res.json(out);
}
