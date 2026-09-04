import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { NOTIFY_MODULE } from "../notify";
import type NotifyModuleService from "../notify/service";
import { isRetriable, nextState, DEFAULT_RETRY_POLICY, type RetryPolicy } from "./retry";
import type { SendPlan } from "./dispatcher";

/**
 * إعادةُ تسليم ما لم يصل — **الطرفُ الذي كان ناقصاً في طبقة الإشعارات**.
 *
 * ── ما كان يقع قبل هذا الملفّ ────────────────────────────────────
 *
 * `dispatch` يحجز المفتاحَ ثم يُسلّم مرّةً واحدة. فمزوّدٌ ساقطٌ عشرَ
 * دقائق يعني رسائلَ تلك العشرِ **ضاعت إلى الأبد**: صفٌّ حالتُه
 * `failed` لا يقرؤه أحد، وحدثُ الصندوق وُسم مُسلَّماً فلا يُعاد. ولا
 * شيءَ يشكو — والعدّاداتُ خضراء.
 *
 * ── والحجزُ ثلاثةُ أطراف، لا واحد ───────────────────────────────
 *
 * ١. **عقدُ إيجارٍ لا قفلُ معاملة**: الجملةُ الواحدة تدفع
 *    `next_attempt_at` إلى الأمام وتُعيد الصفوف، فمُعيدٌ آخرُ لا يراها
 *    أصلاً. ولا يُمسك قفلُ قاعدةٍ عبر نداءِ شبكةٍ إلى مزوّد — وذلك
 *    يقتل القاعدةَ يومَ يبطئ المزوّد.
 * ٢. `for update skip locked`: مُعيدان في نفس الجزء من الثانية لا
 *    يقتسمان صفّاً.
 * ٣. **والمُطلِقُ خلفهما**: القاعدةُ ترفض تسجيلَ محاولةٍ على رسالةٍ
 *    حالتُها نهائية. فالإرسالُ المكرّرُ بعد نجاحٍ **مستحيلُ التسجيل**
 *    — ومن لا يسجّل لا يُرسل، لأن التسجيلَ يسبق قراءةَ النتيجة.
 *
 * ── وما لا يَعِد به هذا الملفّ ──────────────────────────────────
 *
 * ⚠️ سقوطٌ **بين قبولِ المزوّد وكتابةِ المحاولة** يعني إعادةً بعد
 * انتهاء الإيجار — أي نسخةً ثانيةً عند العميل. ولا يُغلق هذا البابُ
 * من هنا: يُغلق بمفتاحِ تعاملٍ يُمرَّر إلى المزوّد ويرفض هو التكرار.
 * **والمفتاحُ مبنيٌّ أصلاً** (`SendPlan.send_key`) وينتظر مزوّداً
 * حقيقياً يقبله. ويُقال هنا ولا يُدَّعى خلافُه.
 */

export type RedeliverResult = {
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
  suppressed: number;
};

/** السياسةُ من صفّها — ولا رقمَ في الكود (بند ٤٨). */
export async function loadRetryPolicy(pg: any): Promise<RetryPolicy> {
  const res = await pg.raw(
    `select "max_attempts", "retry_after_seconds", "is_enabled"
       from "zadim_notify_policy"
      where "deleted_at" is null
      limit 1`
  );
  const row = (res?.rows ?? [])[0];
  // ⚠️ ولا سياسةَ ⇒ الافتراضيّةُ **لا تعطيلُ الإعادة**: جدولٌ فارغٌ
  // بسبب هجرةٍ لم تُشغَّل يجب ألّا يُسكِت الطابورَ صامتاً.
  if (!row) return { ...DEFAULT_RETRY_POLICY };
  return {
    max_attempts: Number(row.max_attempts),
    retry_after_seconds: Number(row.retry_after_seconds),
    is_enabled: row.is_enabled !== false,
  };
}

/**
 * حجزُ المستحقّ بإيجار — **جملةٌ واحدةٌ ذرّيّة**.
 *
 * 🔴 والشرطُ هنا يطابق `isRetriable` حرفاً بحرف. ولو انحرفا لصار
 * الحاجزُ يحجز ما لا يُعاد، أو يترك ما يستحقّ — وهو انحرافٌ لا يظهر في
 * أيّ اختبارٍ لأن كلّاً منهما صحيحٌ وحدَه. فالدالّةُ الخالصةُ تُفحص
 * على ما حجزته القاعدةُ فعلاً (انظر البوّابة).
 */
async function claimDue(pg: any, policy: RetryPolicy, limit: number): Promise<any[]> {
  const lease = Math.max(policy.retry_after_seconds, 30);
  const res = await pg.raw(
    `update "zadim_notification_send" s
        set "next_attempt_at" = now() + (? * interval '1 second'),
            "updated_at" = now()
      where s."id" in (
        select "id" from "zadim_notification_send"
         where "deleted_at" is null
           and ("next_attempt_at" is null or "next_attempt_at" <= now())
           and (
                 ("status" = 'failed' and "attempts" < ?)
              or ("status" = 'queued' and "attempts" = 0)
           )
         order by "next_attempt_at" asc nulls first
         limit ?
         for update skip locked
      )
      returning s."id", s."status", s."attempts", s."next_attempt_at",
                s."event_id", s."channel", s."recipient", s."subject", s."body"`,
    [lease, policy.max_attempts, limit]
  );
  return res?.rows ?? [];
}

/**
 * إعادةُ التسليم. و`deliver` يُمرَّر لا يُستورَد — فتُفحص الدورةُ
 * كلُّها بمزوّدٍ يفشل عمداً، بلا شبكةٍ ولا انتظار.
 */
export async function redeliverPending(
  scope: any,
  options: {
    limit?: number;
    deliver?: (plan: SendPlan) => Promise<{
      status: "sent" | "queued" | "failed";
      provider?: string;
      error?: string;
      suppressed?: boolean;
    }>;
  } = {}
): Promise<RedeliverResult> {
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const notify = scope.resolve(NOTIFY_MODULE) as NotifyModuleService;
  const deliver = options.deliver ?? ((plan: SendPlan) => notify.deliver(plan));

  const policy = await loadRetryPolicy(pg);
  const out: RedeliverResult = { claimed: 0, sent: 0, failed: 0, dead: 0, suppressed: 0 };
  if (!policy.is_enabled) return out;

  const rows = await claimDue(pg, policy, options.limit ?? 100);

  for (const row of rows) {
    // الفحصُ الخالصُ على ما حُجز فعلاً: الشرطُ في SQL يقرأ الصفَّ قبل
    // دفعِ الإيجار، وهذا يقرؤه بعده — فيُمسك انحرافُ الاثنين لو وقع.
    if (!isRetriable({ status: row.status, attempts: Number(row.attempts), next_attempt_at: null }, policy)) {
      continue;
    }
    out.claimed++;

    // 🔴 الرسالةُ **لا تُعاد بناءً من القالب**: نصُّها لحظةَ الحدث هو
    // نصُّها، وقالبٌ عُدِّل بعد الواقعة يُرسل نصّاً ثالثاً — لا هو
    // الأوّلُ ولا الجديد. فيُقرأ المحفوظُ في الصفّ.
    //
    // ⚠️ وهذا **عطبٌ أُمسك قبل الشحن**: أوّلُ كتابةٍ مرّرت
    // `body: ""` لأن الصفَّ لم يكن يحمل نصّاً أصلاً. والمزوّدُ
    // المسجِّلُ كان سيُخفيه إلى الأبد (لا يقرأ النصَّ ولا يرسل)، ثم
    // يصل مزوّدٌ حقيقيٌّ فيُرسل **رسائلَ فارغةً** لكلّ ما أُعيد.
    const plan: SendPlan = {
      event_id: row.event_id,
      channel: row.channel,
      recipient: row.recipient,
      subject: row.subject ?? null,
      body: row.body ?? "",
      send_key: `${row.event_id}:${row.channel}:${row.recipient}`,
    };

    let outcome: Awaited<ReturnType<typeof deliver>>;
    try {
      outcome = await deliver(plan);
    } catch (e) {
      // مزوّدٌ يرمي ⇒ محاولةٌ فاشلة تُسجَّل. ولا يُبتلع الخطأ: نصُّه
      // في الدفتر هو الفرقُ بين «عنوانٌ مرفوض» و«المزوّدُ ساقط».
      outcome = { status: "failed", provider: null as any, error: String((e as Error).message) };
    }

    // 🔴 والمحاولةُ تُسجَّل **قبل** تحديث الحالة: لو سقطنا بينهما بقي
    // الدفترُ صادقاً والحالةُ متأخّرة — والعكسُ يُنتج حالةً لا يقابلها
    // شيءٌ في الدفتر، وهي التي يُبنى عليها الشطب.
    let attemptNo = Number(row.attempts) + 1;
    try {
      const ins = await pg.raw(
        `insert into "zadim_notification_attempt"
           ("id","send_id","attempt_no","status","provider","error")
         values (?, ?, 0, ?, ?, ?)
         returning "attempt_no"`,
        [
          `natt_${row.id}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
          row.id,
          outcome.suppressed ? "suppressed" : outcome.status,
          outcome.provider ?? null,
          outcome.error ?? null,
        ]
      );
      attemptNo = Number((ins?.rows ?? [])[0]?.attempt_no) || attemptNo;
    } catch (e) {
      // القاعدةُ رفضت التسجيل ⇒ الرسالةُ صارت نهائيّةً بين الحجز
      // والآن (مُعيدٌ آخرُ سبقنا، أو مدير كتم المستقبِل). ولا تُحدَّث
      // حالتُها: المُطلِقُ سيرفض ذلك أيضاً، والرفضُ صحيح.
      out.claimed--;
      continue;
    }

    const decision = nextState(outcome, attemptNo, policy);

    await pg.raw(
      `update "zadim_notification_send"
          set "status" = ?, "provider" = ?, "error" = ?,
              "next_attempt_at" = ?, "updated_at" = now()
        where "id" = ?`,
      [
        decision.status,
        outcome.provider ?? null,
        outcome.error ?? null,
        decision.next_attempt_at,
        row.id,
      ]
    );

    if (decision.status === "sent") out.sent++;
    else if (decision.status === "dead") out.dead++;
    else if (decision.status === "suppressed") out.suppressed++;
    else if (decision.status === "failed") out.failed++;
  }

  return out;
}
