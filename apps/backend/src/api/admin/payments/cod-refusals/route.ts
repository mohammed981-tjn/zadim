import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PAYMENTS_MODULE } from "../../../../modules/payments";
import type PaymentsModuleService from "../../../../modules/payments/service";

type Body = {
  phone?: string | null;
  email?: string | null;
  order_id?: string | null;
  customer_id?: string | null;
  reason_ar?: string | null;
};

/**
 * رفضةٌ عند الباب — **تُقيَّد ولا تُمحى**.
 *
 * ولا مسارَ حذفٍ ولا تعديل: السياسةُ مبنيّةٌ على هذه الوقائع، ومن أراد
 * الصفحَ عن عميلٍ **يرفع العتبةَ في السياسة** — فيبقى التاريخُ ويتغيّر
 * الحكم. أما محوُ الواقعة فيُفقد القدرةَ على السؤال «كم مرّة؟» إلى الأبد.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const payments = req.scope.resolve(PAYMENTS_MODULE) as PaymentsModuleService;
  const q = req.query as Record<string, string | undefined>;

  const filters: Record<string, unknown> = {};
  if (q.phone || q.email) {
    filters.customer_key = payments.key({ phone: q.phone, email: q.email });
  }
  if (q.order_id) filters.order_id = q.order_id;

  const limit = Math.min(Number(q.limit ?? 50) || 50, 500);
  const [refusals, count] = await payments.listAndCountCodRefusals(filters, {
    take: limit,
    order: { created_at: "DESC" },
  });

  res.json({ refusals, count, limit });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const payments = req.scope.resolve(PAYMENTS_MODULE) as PaymentsModuleService;
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const key = payments.key({ phone: body.phone, email: body.email });
  if (!key) {
    return res.status(400).json({
      error: {
        code: "INVALID_BODY",
        message_ar: "جوّالٌ أو بريدٌ إلزاميّ — ولا تُقيَّد رفضةٌ بلا صاحب.",
      },
    });
  }

  const [refusal] = await payments.createCodRefusals([
    {
      customer_key: key,
      customer_id: body.customer_id ?? null,
      order_id: body.order_id ?? null,
      reason_ar: body.reason_ar ?? null,
      recorded_by: (req as any).auth_context?.actor_id ?? null,
    },
  ]);

  res.status(201).json({ refusal });
}
