import type {
  AuthenticatedMedusaRequest,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

/**
 * تحديدُ معدّل النداءات (المرحلة ١٥).
 *
 * ── ما الذي يحرسه فعلاً ─────────────────────────────────────────
 *
 * ليس «الحملَ» — ذاك عملُ المنصّة. بل ثلاثةَ أبوابٍ يفتحها غيابُه:
 *
 * ١. **حشوُ بيانات الاعتماد** على `/auth`: قائمةٌ مسرّبةٌ من موقعٍ آخر
 *    تُجرَّب هنا بعشرات الآلاف. ولا يلزم أن ينجح إلا واحد.
 * ٢. **حصدُ الكتالوج**: منافسٌ يسحب المنيو والأسعار كاملةً كل ساعة.
 * ٣. **استنزافُ حصّة**: كلُّ نداءٍ قراءةٌ من القاعدة، وقاعدةٌ مجانيةٌ
 *    لها سقف. فالإسقاطُ لا يحتاج هجوماً، يكفيه سكربتٌ في حلقة.
 *
 * ── ولماذا وسيطٌ واحدٌ لا فحصٌ في كل مسار ─────────────────────────
 *
 * نفسُ حجّة حارس الصلاحيات في `api/middlewares.ts`: الفحصُ داخل
 * المُعالِج يجعل **النسيانَ يفتح باباً**. ومسارُ تسجيلِ دخولٍ جديدٌ
 * يُكتب بعد سنةٍ بلا حدّ، ولا يُكتشف حتى يُستغلّ.
 */

/** ما يُقرأ من صفّ السياسة. */
export type Policy = {
  name: string;
  path_prefix: string;
  methods: string;
  window_seconds: number;
  max_requests: number;
  scope_by: "ip" | "actor" | "ip_actor";
};

/**
 * 🔴 عنوانُ الزائر خلف وكيل — وهو أخطرُ سطرٍ في الملف.
 *
 * على Railway (وأيِّ منصّةٍ ذاتِ موازن) لا يصل الاتصالُ من الزائر بل
 * من الوكيل. فـ`req.ip` عنوانُ الوكيل — **واحدٌ لكل زوّار العالم**.
 * وحارسٌ يحدّ بالعنوان في هذه الحال لا يحدّ زائراً: يحدّ **المتجرَ
 * كلَّه**، فيرفع 429 لكل الناس بعد أوّل خمس محاولات. عطلٌ يُسقط
 * البيع، ويبدو في السجلّ حارساً يعمل.
 *
 * والعلاجُ `x-forwarded-for`، وفيه فخُّه: العميلُ يستطيع أن يزوّر
 * أوّلَ عنوانٍ فيها. فالقاعدةُ أن يُعدّ **من اليمين**: آخرُ عنوانٍ
 * كتبه وكيلُنا هو الوحيد الذي لم يمرّ بيدِ العميل. و`TRUSTED_PROXY_HOPS`
 * يقول كم وكيلاً بيننا وبين الزائر (Railway = ١).
 *
 * وبصفرِ قفزاتٍ يُتجاهل الترويسُ كلُّه ويُؤخذ `req.ip` — وهو الصواب
 * في التطوير المحلّي وخلفَ لا شيء.
 */
export function clientIp(req: MedusaRequest, hops: number): string {
  if (hops <= 0) return req.ip ?? "unknown";

  const raw = req.headers["x-forwarded-for"];
  const chain = (Array.isArray(raw) ? raw.join(",") : raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!chain.length) return req.ip ?? "unknown";

  // العدُّ من اليمين: القفزةُ الأولى هي آخرُ ما أضافه وكيلُنا.
  //
  // ⚠️ **والسلسلةُ أقصرُ من القفزات حالٌ لا يُتساهل فيها**: كان
  // `chain[idx]` بمؤشّرٍ سالبٍ يُعيد `undefined` فيسقط إلى `chain[0]` —
  // **وهو أوّلُ عنوانٍ في الترويس، أي ما يكتبه العميلُ بيده**. فمن أراد
  // الإفلاتَ من الحدّ أرسل ترويساً أقصرَ من المتوقَّع وكتب فيه عنواناً
  // جديداً كلَّ مرّة. والسقوطُ الصحيحُ إلى `req.ip`: عنوانُ الوكيل —
  // يحدّ أكثرَ ممّا يجب حين يُساء الإعداد، ولا يفتح الباب.
  const idx = chain.length - hops;
  if (idx < 0) return req.ip ?? "unknown";
  return chain[idx] ?? req.ip ?? "unknown";
}

/** بدايةُ النافذة، مُحاذاةً على مضاعفات الطول — فتتفق كلُّ النسخ عليها. */
export function windowStartMs(nowMs: number, windowSeconds: number): number {
  const w = windowSeconds * 1000;
  return Math.floor(nowMs / w) * w;
}

/**
 * أوّلُ سياسةٍ تُطابق — والترتيبُ **الأطولُ سابقةً أولاً**.
 *
 * وبدون هذا الترتيب تبتلع `/store` سياسةَ `/store/carts`: الأعمُّ
 * يُطابق أوّلاً فلا يصل الأخصُّ أبداً، ويبقى حدُّ الشراء الضيّق مكتوباً
 * في اللوحة بلا أثر — وهو بالضبط صنفُ العطب الذي يمرّ في المراجعة.
 */
export function matchPolicy(
  policies: Policy[],
  path: string,
  method: string
): Policy | null {
  const sorted = [...policies].sort(
    (a, b) => b.path_prefix.length - a.path_prefix.length
  );
  for (const p of sorted) {
    if (!path.startsWith(p.path_prefix)) continue;
    if (p.methods.trim() === "*") return p;
    const allowed = p.methods
      .split(",")
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean);
    if (allowed.includes(method.toUpperCase())) return p;
  }
  return null;
}

/** مفتاحُ العدّاد بحسب نطاق السياسة. */
export function scopeKeyFor(
  policy: Policy,
  ip: string,
  actorId: string | null
): string {
  const actor = actorId ?? "anon";
  if (policy.scope_by === "ip") return `ip:${ip}`;
  if (policy.scope_by === "actor") return `actor:${actor}`;
  return `ip:${ip}|actor:${actor}`;
}

/** المسارُ كما وصل — بلا استعلام. (نفسُ درسِ `adminPath`: `req.path` نسبيّ.) */
export function requestPath(req: MedusaRequest): string {
  const raw = (req as any).originalUrl ?? req.url ?? "";
  return String(raw).split("?")[0] || "/";
}

// ── ذاكرةُ السياسات ────────────────────────────────────────────────
//
// السياساتُ صفوفٌ تتغيّر مرّاتٍ في العمر، والنداءاتُ آلاف. فقراءتُها مع
// كل نداءٍ استعلامٌ لا يشتري شيئاً. وثمنُ الذاكرة تأخّرُ ضبطِ المدير
// ثلاثين ثانية — وهو ثمنٌ مقبولٌ ومكتوبٌ في الدليل، لا مفاجأة.
let policyCache: { at: number; rows: Policy[] } | null = null;
const POLICY_TTL_MS = 30_000;

/** تُستدعى من الاختبارات ومن مسارِ تعديلِ السياسات. */
export function invalidatePolicyCache(): void {
  policyCache = null;
}

async function loadPolicies(knex: any, nowMs: number): Promise<Policy[]> {
  if (policyCache && nowMs - policyCache.at < POLICY_TTL_MS) {
    return policyCache.rows;
  }
  const res = await knex.raw(
    `select "name", "path_prefix", "methods", "window_seconds", "max_requests", "scope_by"
       from "zadim_rate_limit_policy"
      where "enabled" = true and "deleted_at" is null`
  );
  const rows: Policy[] = res?.rows ?? [];
  policyCache = { at: nowMs, rows };
  return rows;
}

// كنسُ العدّادات المنتهية — مرّةً في الدقيقة لكل عملية، لا مع كل نداء.
let lastSweepMs = 0;
const SWEEP_EVERY_MS = 60_000;

/**
 * الزيادةُ الذرّية: **كتابةٌ واحدة** تُنشئ أو تزيد وتُعيد العدّ.
 *
 * ولماذا لا قراءةٌ ثم كتابة: بينهما يمرّ الطلبُ الثاني فيقرأ العدّ
 * نفسَه، فيُكتب واحدٌ حيث يجب اثنان. والحملُ الذي يُبطل الحدَّ هو
 * الحملُ الذي وُضع الحدُّ له أصلاً — فالسباقُ ليس حالةً نادرةً هنا،
 * هو الحالةُ المقصودة.
 */
export async function consume(
  knex: any,
  policy: Policy,
  scopeKey: string,
  nowMs: number
): Promise<{ count: number; resetAtMs: number }> {
  const startMs = windowStartMs(nowMs, policy.window_seconds);
  const endMs = startMs + policy.window_seconds * 1000;
  const id = `${policy.name}|${scopeKey}|${startMs}`;

  const res = await knex.raw(
    `insert into "zadim_rate_limit_counter"
       ("id", "policy_name", "scope_key", "window_start", "expires_at", "count")
     values (?, ?, ?, to_timestamp(? / 1000.0), to_timestamp(? / 1000.0), 1)
     on conflict ("id") do update
       set "count" = "zadim_rate_limit_counter"."count" + 1,
           "updated_at" = now()
     returning "count"`,
    [id, policy.name, scopeKey, startMs, endMs]
  );

  return { count: Number(res?.rows?.[0]?.count ?? 1), resetAtMs: endMs };
}

async function sweepIfDue(knex: any, nowMs: number): Promise<void> {
  if (nowMs - lastSweepMs < SWEEP_EVERY_MS) return;
  lastSweepMs = nowMs;
  // ساعةٌ من التسامح: النوافذُ المنتهيةُ توّاً قد تُقرأ في تشخيصٍ،
  // والجدولُ لا يكبر بها. والغرضُ منعُ النموِّ بلا سقفٍ لا التنظيف.
  await knex.raw(
    `delete from "zadim_rate_limit_counter" where "expires_at" < now() - interval '1 hour'`
  );
}

/**
 * الوسيط.
 *
 * ── 🔴 ويفشل **مفتوحاً** — وهذا قرارٌ لا سهو ────────────────────
 *
 * إن تعذّر العدُّ (القاعدةُ لا تجيب) فالنداءُ يمرّ. والسببُ أن مخزنَ
 * العدّاد هو **قاعدةُ المتجر نفسُها**: فحين لا تجيب، لا يوجد ما
 * يُسرَق ولا دخولٌ ينجح — كلُّ طلبٍ فاشلٌ أصلاً. والفشلُ مغلقاً في
 * هذه الحال لا يزيد أمناً بشيء، ويحوّل عطلاً جزئياً إلى انقطاعٍ تامّ.
 *
 * (وهو نفسُ منطق `ordersStopped` في زادجو: بوّابةٌ تفشل مغلقةً تمنع
 * كلَّ طلبٍ عند أوّل انقطاع.)
 *
 * ولا يمرّ صامتاً: يُكتب في السجلّ بمستوى `error`.
 */
export async function rateLimit(
  req_: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const req = req_ as AuthenticatedMedusaRequest;
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  try {
    const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
    const nowMs = Date.now();

    const policies = await loadPolicies(knex, nowMs);
    if (!policies.length) return next();

    const policy = matchPolicy(policies, requestPath(req), req.method);
    if (!policy) return next();

    const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "0", 10) || 0;
    const ip = clientIp(req, hops);
    const actorId = req.auth_context?.actor_id ?? null;
    const scopeKey = scopeKeyFor(policy, ip, actorId);

    const { count, resetAtMs } = await consume(knex, policy, scopeKey, nowMs);
    void sweepIfDue(knex, nowMs).catch((e: Error) =>
      logger.warn(`[zadim] تعذّر كنسُ عدّادات الحدّ: ${e.message}`)
    );

    const remaining = Math.max(0, policy.max_requests - count);
    res.setHeader("X-RateLimit-Limit", String(policy.max_requests));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAtMs / 1000)));

    if (count <= policy.max_requests) return next();

    const retryAfter = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
    res.setHeader("Retry-After", String(retryAfter));

    // يُسجَّل **أوّلُ تجاوزٍ في النافذة وحده**. وبدون هذا الشرط يصير
    // السجلُّ نسخةً من الهجوم: عشرةُ آلافِ سطرٍ تُخفي ما بينها، ويصير
    // أثرُ الحارس أثقلَ من أثر المهاجم.
    if (count === policy.max_requests + 1) {
      logger.warn(
        `[zadim] تجاوزُ حدٍّ: سياسة «${policy.name}» · ${scopeKey} · ${count}/${policy.max_requests}`
      );
    }

    return res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message_ar: `تجاوزتَ الحدَّ المسموح. أعِد المحاولة بعد ${retryAfter} ثانية.`,
        retry_after_seconds: retryAfter,
      },
    });
  } catch (e) {
    logger.error(
      `[zadim] تعذّر تحديدُ المعدّل — النداءُ يمرّ (فشلٌ مفتوح): ${(e as Error).message}`
    );
    return next();
  }
}
