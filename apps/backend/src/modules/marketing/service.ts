import { MedusaService } from "@medusajs/framework/utils";
import { CustomerSegment, NotificationTemplate, NotificationSend } from "./models";
import { matchesSegment, type CustomerFacts, type SegmentDefinition } from "./segments";
import { planSends, sendKey, type DueEvent, type SendPlan, type TemplateRow } from "./dispatcher";

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
    send?: (plan: SendPlan) => Promise<{ ok: boolean; provider?: string; error?: string }>
  ): Promise<{ planned: number; claimed: number; sent: number }> {
    const templates = (await this.listNotificationTemplates({})) as unknown as TemplateRow[];
    const plans = planSends(event, templates, recipient);

    let claimed = 0;
    let sent = 0;

    for (const plan of plans) {
      const { fresh, row } = await this.claimSend(plan);
      if (!fresh) continue;
      claimed++;

      if (!send) continue;
      const result = await send(plan);
      await this.updateNotificationSends({
        id: row.id,
        status: result.ok ? "sent" : "failed",
        provider: result.provider ?? null,
        error: result.error ?? null,
      } as any);
      if (result.ok) sent++;
    }

    return { planned: plans.length, claimed, sent };
  }

  key(eventId: string, channel: string, recipient: string): string {
    return sendKey(eventId, channel, recipient);
  }
}

export default MarketingModuleService;
