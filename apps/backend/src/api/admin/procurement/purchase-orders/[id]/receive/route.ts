import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { receivePurchaseLine } from "../../../../../../modules/procurement/receive";

type Body = { line_id?: string; quantity?: number; note?: string | null };

/**
 * استلامُ بضاعةٍ على سطرٍ من أمر الشراء — **وهو ما يزيد المخزون**.
 *
 * وصلاحيتُه `inventory.adjust` لا `purchase_orders.*`: هو تغييرُ مخزونٍ
 * حقيقيٍّ على الرفّ، ومن لا يُؤتمن على التسوية لا يُؤتمن على أن يقول
 * «وصلت مئةٌ» وهي تسعون.
 *
 * والكميةُ **قد تكون سالبة**: تصحيحُ استلامٍ زائدٍ يُكتب إيصالاً سالباً
 * مقابلاً — لأن الدفترَ يُلحَق ولا يُمسّ، فأثرُ الخطأ ومن ارتكبه يبقى.
 */
export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;
  const lineId = String(body.line_id ?? "").trim();

  if (!lineId) {
    return res.status(400).json({
      error: { code: "LINE_REQUIRED", message_ar: "حدّدْ سطرَ أمر الشراء المستلَم." },
    });
  }

  const out = await receivePurchaseLine(req.scope, {
    purchase_order_line_id: lineId,
    quantity: Number(body.quantity),
    actor_id: (req as any).auth_context?.actor_id ?? null,
    actor_label: (req as any).auth_context?.app_metadata?.email ?? null,
    note: body.note ?? null,
  });

  if (!out.ok) {
    const status =
      out.code === "LINE_NOT_FOUND" || out.code === "ORDER_NOT_FOUND"
        ? 404
        : out.code === "QUANTITY_INVALID"
          ? 400
          : 409;
    return res.status(status).json({ error: { code: out.code, message_ar: out.message_ar } });
  }

  return res.status(201).json({
    received: true,
    receipt_id: out.receipt_id,
    stocked_after: out.stocked_after,
    cost_recorded: out.cost_recorded,
  });
}
