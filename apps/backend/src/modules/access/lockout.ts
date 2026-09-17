import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { clientIp, trustedHops } from "./rate-limit";
import {
  lockVerdict,
  loginTarget,
  type LockoutPolicyRow,
  type LoginTarget,
} from "./lockout-rules";

export * from "./lockout-rules";

/**
 * إقفالُ الحساب بعد فشلٍ متكرّر — **الهويّةُ لا العنوان**.
 *
 * ── الثغرةُ بالأرقام ────────────────────────────────────────────
 *
 * `zadim_rate_limit_policy` يحدّ `/auth` بعشرٍ في الدقيقة **بالعنوان**.
 * فمن يجرّب من حاسوبه يُوقَف. وشبكةٌ بعشرة آلاف عنوان تجرّب حساباً
 * واحداً تُنتج **مئةَ ألفِ محاولةٍ في الدقيقة**، وكلُّ عنوانٍ فيها
 * تحت الحدّ. فالحدُّ بالعنوان لا يرى الهجومَ أصلاً.
 *
 * ── وما يُعدّ: الفشلُ لا المحاولة ───────────────────────────────
 *
 * عدُّ كلِّ المحاولات يقفل حسابَ من فتح التطبيقَ في لسانَين. والإشارةُ
 * الدالّةُ على التخمين **الفشلُ المتكرّر**.
 *
 * ── ⚠️ والمقايضةُ تُقال لا تُخفى ────────────────────────────────
 *
 * من عرف بريدَ عميلٍ يقفل حسابَه مؤقّتاً بإفشالِ الدخول. وهي مقايضةٌ
 * مقبولةٌ بشرطَيها: **الإقفالُ مؤقّت** بمدّةٍ يضبطها المدير، **والدفترُ
 * يحمل العناوين** فيُميَّز «عميلٌ نسي» من «هجومٍ موزَّع».
 *
 * ── والفشلُ مفتوحٌ بقصدٍ حين لا سياسة ───────────────────────────
 *
 * لا صفَّ ⇒ لا إقفال. ونفسُ حجّة `rate-limit.ts`: جدولٌ مفقودٌ يجب
 * ألّا يمنع الناسَ من الدخول إلى متجرهم. والحارسُ ضدّ نسيانِ الصفّ
 * **بذرةٌ تُنشئه وبوّابةٌ تقيسه**، لا شرطٌ يفشل مغلقاً.
 */

async function loadPolicy(
  knex: any,
  actorType: string
): Promise<LockoutPolicyRow | null> {
  const r = await knex.raw(
    `select "actor_type", "window_seconds", "max_failures", "lock_seconds"
       from "zadim_lockout_policy"
      where "actor_type" = ? and "enabled" = true and "deleted_at" is null
      limit 1`,
    [actorType]
  );
  const row = r?.rows?.[0];
  if (!row) return null;
  return {
    actor_type: row.actor_type,
    window_seconds: Number(row.window_seconds),
    max_failures: Number(row.max_failures),
    lock_seconds: Number(row.lock_seconds),
  };
}

/** العدُّ من الصفوف — **لا عدّادَ مخزَّن**، ولا رقمَ يفسده التزاحم. */
async function failuresIn(
  knex: any,
  target: LoginTarget,
  windowSeconds: number
): Promise<{ count: number; last_at: Date | null }> {
  const r = await knex.raw(
    `select count(*)::int as n, max("created_at") as last_at
       from "zadim_login_failure"
      where "identity_key" = ?
        and "actor_type" = ?
        and "created_at" > now() - (? || ' seconds')::interval`,
    [target.identity_key, target.actor_type, String(windowSeconds)]
  );
  const row = r?.rows?.[0];
  return {
    count: Number(row?.n ?? 0),
    last_at: row?.last_at ? new Date(row.last_at) : null,
  };
}

async function appendFailure(
  knex: any,
  target: LoginTarget,
  ip: string | null,
  userAgent: string | null
): Promise<void> {
  await knex.raw(
    `insert into "zadim_login_failure"
       ("id", "identity_key", "actor_type", "ip", "user_agent")
     values (?, ?, ?, ?, ?)`,
    [
      `lgf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      target.identity_key,
      target.actor_type,
      ip,
      userAgent ? userAgent.slice(0, 255) : null,
    ]
  );
}

/**
 * الوسيطُ: يمنع قبل المحاولة، ويُقيّد بعد الفشل.
 *
 * ── ولماذا الشقّان في وسيطٍ واحد ────────────────────────────────
 *
 * لأن القرارَ يحتاج **حالةَ الردّ** (٤٠١ فشلٌ وغيرُه ليس فشلاً)، وهي
 * لا تُعرف إلا بعد أن يعمل مُعالِجُ Medusa. فالمنعُ قبلَه والتقييدُ
 * في `finish` — وفصلُهما في ملفّين يجعل أحدَهما يُنسى.
 */
export async function guardLogin(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  if (req.method !== "POST") return next();

  const pathname = (req.originalUrl ?? req.url ?? "").split("?")[0];
  const target = loginTarget(pathname, req.body);
  if (!target) return next();

  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  let policy: LockoutPolicyRow | null = null;
  try {
    policy = await loadPolicy(knex, target.actor_type);
    if (policy) {
      const failures = await failuresIn(knex, target, policy.window_seconds);
      const verdict = lockVerdict(policy, failures, new Date());
      if (verdict.locked) {
        res.setHeader("Retry-After", String(verdict.retry_after_seconds));
        return res.status(429).json({
          error: {
            code: "ACCOUNT_LOCKED",
            message_ar:
              "أُقفل الحسابُ مؤقّتاً بعد محاولاتِ دخولٍ فاشلةٍ متكرّرة. " +
              `حاولْ بعد ${Math.ceil(verdict.retry_after_seconds / 60)} دقيقة.`,
            retry_after_seconds: verdict.retry_after_seconds,
          },
        });
      }
    }
  } catch (e) {
    // فشلٌ مفتوح: جدولٌ مفقودٌ أو قاعدةٌ متعثّرةٌ لا تمنع الناسَ من
    // الدخول إلى متجرهم. ويُقال في السجلّ فلا يمرّ صامتاً.
    logger.warn(`[zadim] تعذّر فحصُ إقفال الحساب: ${(e as Error)?.message}`);
  }

  if (policy) {
    const ip = clientIp(req, trustedHops());
    const ua = (req.headers["user-agent"] as string) ?? null;
    res.on("finish", () => {
      // 🔴 و٤٠١ وحدَها فشلُ اعتماد. و٤٢٩ حدُّ معدّلٍ — وعدُّها يجعل
      // الحارسَ يُغذّي نفسَه: موجةٌ تُحدّ فتُقيَّد فتُقفل، فيصير
      // حدُّ المعدّل سبباً لإقفال حساباتٍ لم يُخطئ أصحابُها.
      if (res.statusCode !== 401) return;
      void appendFailure(knex, target, ip, ua).catch((e: Error) =>
        logger.warn(`[zadim] تعذّر تقييدُ فشلِ دخول: ${e.message}`)
      );
    });
  }

  return next();
}
