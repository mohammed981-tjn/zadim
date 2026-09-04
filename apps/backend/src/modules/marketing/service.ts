import { MedusaService } from "@medusajs/framework/utils";
import {
  CustomerSegment,
  NotificationTemplate,
  NotificationSend,
  NotificationAttempt,
} from "./models";
import { matchesSegment, type CustomerFacts, type SegmentDefinition } from "./segments";
import { planSends, sendKey, type DueEvent, type SendPlan, type TemplateRow } from "./dispatcher";
import { nextState, DEFAULT_RETRY_POLICY, type RetryPolicy, type AttemptOutcome } from "./retry";

/**
 * خدمةُ التسويق: الشرائحُ والقوالبُ وسجلُّ الإرسال.
 *
 * ── ولا تقرأ صندوقَ الأحداث بنفسها ──────────────────────────────
 *
 * الصندوقُ جدولُ وحدة `orders`، وقراءتُه من هنا تربط الوحدتين برباطٍ لا
 * يظهر في أيّ إعلان. فالمُنادي يجلب المستحقَّ من هناك ويُمرّره — كما
 * تأخذ `warehouse` مستوياتِ المخزون معطىً.
 */
class MarketingModuleService extends MedusaService({
  CustomerSegment,
  NotificationTemplate,
  NotificationSend,
  NotificationAttempt,
}) {
  /** هل ينطبق تعريفُ شريحةٍ على عميل؟ — منطقٌ خالصٌ يُمرَّر إليه. */
  matches(def: SegmentDefinition | null, facts: CustomerFacts): boolean {
    return matchesSegment(def, facts);
  }

  /** أعضاءُ شريحةٍ من صفوفٍ يجلبها المُنادي. */
  async membersOf(segmentId: string, population: Array<{ id: string } & CustomerFacts>) {
    const [seg] = (await this.listCustomerSegments({ id: segmentId })) as any[];
    if (!seg || seg.is_active === false) return [];
    return population.filter((c) => matchesSegment(seg.definition, c));
  }

  /**
   * 🔴 **يُحجز المفتاحُ قبل الإرسال لا بعده** (ADR-014).
   *
   * فالمُرسِلُ الذي يسقط بعد الإرسال وقبل التسجيل يُعيد المحاولةَ —
   * وبلا حجزٍ مسبقٍ تصل الرسالةُ مرّتين. والقيدُ الفريدُ في القاعدة هو
   * الحكم، لا فحصٌ قبل كتابة.
   */
  async claimSend(plan: SendPlan): Promise<{ fresh: boolean; row: any }> {
    const existing = await this.listNotificationSends({ send_key: plan.send_key });
    if (existing.length) return { fresh: false, row: (existing as any[])[0] };

    try {
      const [row] = await this.createNotificationSends([
        {
          send_key: plan.send_key,
          event_id: plan.event_id,
          channel: plan.channel,
          recipient: plan.recipient,
          // 🔴 والنصُّ يُحفظ مع الحجز: بلا هذا تُعاد رسالةٌ فارغة.
          subject: plan.subject ?? null,
          body: plan.body ?? "",
          status: "queued",
        } as any,
      ]);
      return { fresh: true, row };
    } catch {
      // اصطدم بالقيد ⇒ سبقنا أحدٌ بجزءٍ من الثانية.
      const [row] = (await this.listNotificationSends({ send_key: plan.send_key })) as any[];
      return { fresh: false, row };
    }
  }

  /**
   * تنفيذُ حدثٍ مستحقّ: يُخطَّط ثم يُحجز ثم «يُرسَل».
   *
   * ⚠️ **ولا مزوّدَ رسائل حقيقيّ بعد** (ينتظر حساب SMS/بريد). فالمزوّدُ
   * الافتراضيّ **يسجّل ولا يرسل**، والحالةُ `queued` لا `sent` — لأن
   * ادّعاءَ إرسالٍ لم يقع أسوأُ من الصمت: يُبنى عليه تقريرٌ ثم قرار.
   */
  async dispatch(
    event: DueEvent,
    recipient: { email?: string | null; phone?: string | null; locale?: string } | null,
    /**
     * 🔴 **يُعيد حالةً لا `ok`** — وهذا تغييرُ عقدٍ مقصود.
     *
     * كان `ok:true` يُترجَم إلى `sent`، فأيُّ مزوّدٍ يقول «تلقّيتُ
     * طلبَك» يُسجَّل «أُرسلت» — ثم يُبنى تقريرٌ يقول إن ٩٩٪ وصلت، ثم
     * قرارٌ على التقرير. **والمزوّدُ وحدَه يعرف**، فحالتُه تُسجَّل كما
     * هي (`modules/notify/contract.ts`).
     */
    send?: (
      plan: SendPlan
    ) => Promise<{
      status: "sent" | "queued" | "failed";
      provider?: string;
      error?: string;
      suppressed?: boolean;
    }>,
    /** سياسةُ الإعادة — تُمرَّر لأن صفَّها في وحدةٍ أخرى (`notify`). */
    policy: RetryPolicy = DEFAULT_RETRY_POLICY
  ): Promise<{ planned: number; claimed: number; sent: number; suppressed: number }> {
    const templates = (await this.listNotificationTemplates({})) as unknown as TemplateRow[];
    const plans = planSends(event, templates, recipient);

    let claimed = 0;
    let sent = 0;
    let suppressed = 0;

    for (const plan of plans) {
      const { fresh, row } = await this.claimSend(plan);
      if (!fresh) continue;
      claimed++;

      if (!send) continue;
      const result = await send(plan);

      // 🔴 **والمحاولةُ تُسجَّل هنا أيضاً — لا في المُعيد وحدَه.**
      //
      // وهذا ليس تنميقَ سجلّات: لو لم تُسجَّل، بقي الصفُّ
      // `attempts = 0` بعد محاولةٍ وقعت فعلاً — وذلك **بالضبط** شرطُ
      // «حُجز ولم يُحاوَل قطّ» عند المُعيد. فيلتقطه المُعيدُ بعد
      // دقائق ويُسلّمه ثانيةً: نسخةٌ ثانيةٌ عند العميل من مزوّدٍ
      // حقيقيّ. والمزوّدُ المسجِّلُ كان سيُخفي ذلك (لا يُرسل شيئاً).
      const attemptNo = await this.logAttempt(row.id, result);

      // ⚠️ **والمُلغي اشتراكَه يُوسَم `suppressed` لا `failed`.**
      // والفرقُ ليس تجميلياً: `failed` تدخل تقاريرَ الأعطال فتُقرأ
      // مشكلةً تقنيةً تُطارَد، و`suppressed` قرارُ عميلٍ يُحترم.
      //
      // والقرارُ من **نفس الدالّة** التي يستعملها المُعيد: مسارانِ
      // يقرّران الحالةَ بمنطقين ينحرفان يوماً، وينحرف معهما الشطب.
      const decision = nextState(result as AttemptOutcome, attemptNo, policy);

      await this.updateNotificationSends({
        id: row.id,
        status: decision.status,
        provider: result.provider ?? null,
        error: result.error ?? null,
        next_attempt_at: decision.next_attempt_at,
      } as any);

      if (decision.status === "sent") sent++;
      if (decision.status === "suppressed") suppressed++;
    }

    return { planned: plans.length, claimed, sent, suppressed };
  }

  /**
   * تسجيلُ محاولةٍ في الدفتر — و**رقمُها تحسبه القاعدة** تحت قفلِ صفّ
   * الأب (`Migration20260904000041`). ولو حسبه التطبيقُ لكتب مُرسِلان
   * متزامنان نفسَ الرقم.
   *
   * ⚠️ ويرمي إن كانت الرسالةُ نهائيّة — وهو الرفضُ الذي يجعل الإرسالَ
   * مرّتين مستحيلَ التسجيل. فلا يُبتلع هنا: المُنادي يقرّر.
   */
  async logAttempt(sendId: string, outcome: AttemptOutcome): Promise<number> {
    const [row] = (await this.createNotificationAttempts([
      {
        send_id: sendId,
        status: outcome.suppressed ? "suppressed" : outcome.status,
        provider: outcome.provider ?? null,
        error: outcome.error ?? null,
      } as any,
    ])) as any[];
    return Number(row?.attempt_no) || 1;
  }

  key(eventId: string, channel: string, recipient: string): string {
    return sendKey(eventId, channel, recipient);
  }
}

export default MarketingModuleService;
