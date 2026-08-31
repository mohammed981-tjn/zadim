import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ORDERS_MODULE } from "../../../../modules/orders";
import type OrdersModuleService from "../../../../modules/orders/service";

const STATUSES = ["draft", "pending", "requires_action", "completed", "canceled", "archived"];

/**
 * جدولُ الانتقالات كما تقرؤه القاعدة.
 *
 * ── ولماذا يُعرض أصلاً ───────────────────────────────────────────
 *
 * لأن اللوحةَ تبني أزرارَها منه: «ما الذي يمكن فعلُه بهذا الطلب الآن؟»
 * جوابُه صفوفُ هذا الجدول لا `switch` في الواجهة. **وواجهةٌ تحمل نسختَها
 * من القواعد تفترق عن الحارس** — فتعرض زرّاً يرفضه الخادم، ويحار
 * المستخدمُ في زرٍّ يراه ولا يعمل.
 *
 * ⚠️ **ولا مسارَ كتابةٍ له**: تغييرُ جدول الانتقالات تغييرٌ في آلة
 * الحالات نفسِها — يمرّ بهجرةٍ تُراجَع، لا بنداءٍ من لوحة.
 *
 * والمسارُ تحت `/admin/order-flow` لا `/admin/orders`: الثاني يملكه
 * Medusa، و`/admin/orders/transitions` قد يُلتقط كـ`:id = transitions`.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const orders = req.scope.resolve(ORDERS_MODULE) as OrdersModuleService;
  const rules = await orders.rules();

  res.json({
    statuses: STATUSES,
    transitions: rules,
    terminal: orders.terminal(STATUSES, rules),
    by_status: Object.fromEntries(STATUSES.map((s) => [s, orders.targets(s, rules)])),
  });
}
