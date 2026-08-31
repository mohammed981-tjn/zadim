import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { RETURNS_MODULE } from "../../../../modules/returns";
import type ReturnsModuleService from "../../../../modules/returns/service";

/**
 * سياسةُ الإرجاع — يقرؤها المديرُ ويضبطها.
 *
 * ── ولماذا مسارُ كتابةٍ هنا وليس لجدول الانتقالات ────────────────
 *
 * لأن الاثنين ليسا من نوعٍ واحد. جدولُ الانتقالات **آلةُ الحالات
 * نفسُها**، وتغييرُه تغييرٌ في المنطق يمرّ بهجرةٍ تُراجَع. والسياسةُ
 * **قرارُ تاجرٍ** يتغيّر بالموسم: نافذةٌ أضيق في التخفيضات، وتصنيفٌ
 * يُستثنى. ولو كانت كوداً لصار تضييقُ النافذةَ يوماً واحداً نشرةَ
 * إصدار (بند ٤٨).
 *
 * والمسارُ تحت `returns-flow` لا `returns`: الثاني يملكه Medusa،
 * و`/admin/returns/policy` قد يُلتقط كـ`:id = policy` — نفسُ سببِ
 * `order-flow` في المرحلة ٥.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const returns = req.scope.resolve(RETURNS_MODULE) as ReturnsModuleService;
  const policy = await returns.policy();

  // **وغيابُ السياسة حالةٌ صريحة**: `is_configured: false` لا `{}`
  // فارغة. فالواجهةُ تعرض «الإرجاع غيرُ مفعَّل» بدل أن تعرض نموذجاً
  // بحقولٍ خاليةٍ يظنّه المديرُ سياسةً قائمة.
  res.json({ is_configured: Boolean(policy), policy: policy ?? null });
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const returns = req.scope.resolve(RETURNS_MODULE) as ReturnsModuleService;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const fields: Record<string, unknown> = {
    is_enabled: body.is_enabled ?? true,
    window_days: body.window_days ?? null,
    accepts_opened: body.accepts_opened ?? true,
    excluded_category_ids: body.excluded_category_ids ?? null,
    min_order_total: body.min_order_total ?? null,
    who_pays_shipping: body.who_pays_shipping ?? "customer",
    note: body.note ?? null,
  };

  const existing = await returns.policy();
  const saved = existing
    ? await returns.updateReturnPolicies({ id: (existing as any).id, ...fields } as any)
    : (await returns.createReturnPolicies([fields as any]))[0];

  res.status(existing ? 200 : 201).json({ policy: saved });
}
