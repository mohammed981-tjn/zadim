import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { FULFILMENT_MODULE } from "../../../../modules/fulfilment";
import type FulfilmentModuleService from "../../../../modules/fulfilment/service";

/**
 * قوائمُ اللقط.
 *
 * ⚠️ **وهذه شاشةُ مستودعٍ تحت `/admin` لا تحت `/ops`** كما في العقد
 * (`04-api-contract.md`). والسببُ أن الحارسَ يغطّي `/admin` وحدَه اليوم؛
 * وفصلُ `/ops` يقع مع تطبيق المستودع في المرحلة ٨. **ومكتوبٌ هنا لا
 * مطويّ**: انحرافٌ عن العقد يُعلن أو يُنسى فيصير أمراً واقعاً.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const ful = req.scope.resolve(FULFILMENT_MODULE) as FulfilmentModuleService;
  const q = req.query as Record<string, string | undefined>;

  const filters: Record<string, unknown> = {};
  if (q.state) filters.state = q.state;
  if (q.location_id) filters.location_id = q.location_id;
  if (q.order_id) filters.order_id = q.order_id;

  const limit = Math.min(Number(q.limit ?? 50) || 50, 500);
  const [lists, count] = await ful.listAndCountPickLists(filters, {
    take: limit,
    order: { created_at: "DESC" },
  });

  res.json({ pick_lists: lists, count, limit, transitions: await ful.transitions() });
}
