import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ACCESS_MODULE } from "../../../../modules/access";
import type AccessModuleService from "../../../../modules/access/service";
import { validate, warningFor } from "../../../../modules/access/lockout-rules";

// ويُعاد تصديرُهما ليبقى المسارُ نقطةَ القراءة الواحدة لمن يتتبّعه.
export { validate, warningFor };

type Body = {
  actor_type?: "user" | "customer";
  window_seconds?: number;
  max_failures?: number;
  lock_seconds?: number;
  enabled?: boolean;
};

/**
 * سياساتُ إقفالِ الحساب — وصفحةُ الفشلِ الأخير معها.
 *
 * ── ولماذا يُعاد الدفترُ مع السياسة ─────────────────────────────
 *
 * لأن الرقمَ وحدَه لا يُضبط بلا بيانات: من يرى «٣٤٠ فشلاً على أربعة
 * حساباتٍ من ٢٩٠ عنواناً» يعرف أنه هجومٌ موزَّع فيشدّ، ومن يرى «أربعةً
 * على حسابٍ واحدٍ من عنوانٍ واحد» يعرف أنه عميلٌ نسي كلمتَه فيُرخي.
 * وفصلُ الاثنين في شاشتين يجعل الضبطَ تخميناً.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const access = req.scope.resolve(ACCESS_MODULE) as AccessModuleService;
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const policies = await access.listLockoutPolicies({});

  // آخرُ أربعٍ وعشرين ساعة، مجموعةً بالهويّة — **ولا كلمةَ مرورٍ في
  // الدفتر أصلاً**، فما يُعرض هويّةٌ وعددٌ ومصادر.
  const recent = await knex.raw(
    `select "identity_key", "actor_type",
            count(*)::int as failures,
            count(distinct "ip")::int as sources,
            max("created_at") as last_at
       from "zadim_login_failure"
      where "created_at" > now() - interval '24 hours'
      group by "identity_key", "actor_type"
      order by failures desc
      limit 50`
  );

  res.json({ policies, recent_failures: recent?.rows ?? [] });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const access = req.scope.resolve(ACCESS_MODULE) as AccessModuleService;
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const invalid = validate(body);
  if (invalid) {
    return res.status(400).json({ error: { code: "INVALID_POLICY", message_ar: invalid } });
  }

  const [existing] = (await access.listLockoutPolicies({
    actor_type: body.actor_type,
  })) as any[];

  const fields = {
    actor_type: body.actor_type as "user" | "customer",
    window_seconds: Number(body.window_seconds),
    max_failures: Number(body.max_failures),
    lock_seconds: Number(body.lock_seconds),
    enabled: body.enabled ?? true,
  };

  const policy = existing
    ? await access.updateLockoutPolicies({ id: existing.id, ...fields })
    : (await access.createLockoutPolicies([fields]))[0];

  res.status(existing ? 200 : 201).json({ policy, warning_ar: warningFor(fields) });
}
