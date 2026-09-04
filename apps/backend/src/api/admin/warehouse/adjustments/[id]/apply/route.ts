import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { applyAdjustment } from "../../../../../../modules/warehouse/adjust";

/**
 * التطبيق — **وهنا وحدَه يتغيّر الرصيد**.
 *
 * والقاعدةُ تمنع التطبيقَ قبل الموافقة الثانية بمُطلِق، وهذا المسارُ
 * يترجم المنعَ إلى رسالةٍ مفهومة — **لا يستبدله**.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const id = String((req.params as any).id);
  const actor = String((req as any).auth_context?.actor_id ?? "");
  if (!actor) {
    return res.status(401).json({
      error: { code: "ACTOR_REQUIRED", message_ar: "لا تطبيقَ بلا هويّةٍ معروفة." },
    });
  }

  const out = await applyAdjustment(req.scope, id, actor);
  if (!out.ok) {
    return res.status(out.code === "APPROVAL_REQUIRED" ? 409 : 400).json({ error: out });
  }
  return res.json(out);
}
