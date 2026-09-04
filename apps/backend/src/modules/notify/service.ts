import { pathToFileURL } from "url";
import { MedusaService } from "@medusajs/framework/utils";
import { NotificationOptout, NotifyPolicy } from "./models";
import { discoverNotifyProviders } from "./discover";
import type { NotifyProvider, SendOutcome } from "./contract";
import type { SendPlan } from "../marketing/dispatcher";

/**
 * خدمةُ الإشعارات (بند ٤٣) — **المزوّدُ وحارسُ الإلغاء**.
 *
 * وهي الطرفُ الذي يُطلق الطابورَ الذي بنته دفعةُ المفضّلة: صار للأحداث
 * مستقبِلون، وصار لهم الآن مَن يُسلِّم — ومَن يُسكِت.
 */
class NotifyModuleService extends MedusaService({ NotificationOptout, NotifyPolicy }) {
  private providers: NotifyProvider[] = [];
  private loading: Promise<void> | null = null;
  /** ما تعذّر تحميلُه ولماذا — يُقرأ ولا يُبتلع. */
  private loadErrors: string[] = [];

  /**
   * 🔴 **التحميلُ كسولٌ لا في مُحمِّل الوحدة** — وهذا أُمسك بالقياس.
   *
   * كُتب أوّلاً كـ`loaders: [registerNotifyProviders]`، فسقط الإقلاعُ
   * كلُّه بـ«Could not resolve 'notify'»: مُحمِّلُ الوحدة يعمل **قبل**
   * أن تُسجَّل خدمتُها في الحاوية، فلا سبيلَ إلى `this` من هناك.
   *
   * والتحميلُ الكسولُ يتجنّب الترتيبَ كلَّه: أوّلُ من يسأل عن مزوّدٍ
   * يُشغّله. و`loading` وعدٌ واحدٌ محفوظ، فنداءان متزامنان لا يقرآن
   * المجلَّدَ مرّتين ولا يسجّلان المزوّدَ مرّتين.
   */
  private async ensureProviders(): Promise<void> {
    if (this.providers.length || this.loading) {
      if (this.loading) await this.loading;
      return;
    }
    if (!this.loading) this.loading = this.loadProviders();
    await this.loading;
  }

  private async loadProviders(): Promise<void> {
    for (const entry of discoverNotifyProviders()) {
      try {
        // مسارُ ملفٍّ لا معرّفُ وحدة: `import()` لمسارٍ مطلقٍ يحتاج
        // `file://` وامتداداً (مقيس — انظر `discover.ts`).
        const mod = await import(pathToFileURL(entry.entry).href);
        const provider = (mod?.default ?? mod) as NotifyProvider;
        if (!provider?.id || typeof provider.send !== "function") {
          this.loadErrors.push(`${entry.id}: عقدٌ غيرُ صالح`);
          continue;
        }
        this.register(provider);
      } catch (e) {
        // ⚠️ **مزوّدٌ يسقط استيرادُه لا يُسقط البقيّة** — ولو أسقطها
        // لصار خطأٌ مطبعيٌّ في مجلَّدِ مزوّدٍ ثانويٍّ يُسكِت الرسائلَ
        // كلَّها.
        //
        // 🔴 **لكنه يُسجَّل لا يُبتلع.** أوّلُ كتابةٍ لهذه الدالّة
        // ابتلعته، فأعطت `registered() === []` بلا سببٍ ظاهر —
        // والبوّابةُ قالت «لم يُسجَّل مزوّد» ولم تقل لماذا. وهو نفسُ
        // صنفِ العطب الذي تعالجه هذه الدفعةُ كلُّها.
        this.loadErrors.push(`${entry.id}: ${(e as Error).message}`);
      }
    }
  }

  /** أخطاءُ التحميل — تقرؤها البوّابةُ والتشخيص. */
  async problems(): Promise<string[]> {
    await this.ensureProviders();
    return [...this.loadErrors];
  }

  /**
   * سياسةُ الإعادة — **من صفّها لا من الكود** (بند ٤٨).
   *
   * ⚠️ وجدولٌ فارغٌ يُعيد الافتراضيّةَ **لا تعطيلاً**: هجرةٌ لم تُشغَّل
   * يجب ألّا تُسكِت الطابورَ صامتاً — وهو أسوأُ أنواع العطل، لأن
   * العدّاداتِ تبقى خضراء.
   */
  async retryPolicy(): Promise<{
    max_attempts: number;
    retry_after_seconds: number;
    is_enabled: boolean;
  }> {
    const [row] = (await this.listNotifyPolicies({}, { take: 1 })) as any[];
    if (!row) return { max_attempts: 3, retry_after_seconds: 300, is_enabled: true };
    return {
      max_attempts: Number(row.max_attempts),
      retry_after_seconds: Number(row.retry_after_seconds),
      is_enabled: row.is_enabled !== false,
    };
  }

  register(provider: NotifyProvider): void {
    this.providers = [...this.providers.filter((p) => p.id !== provider.id), provider];
  }

  async providerFor(channel: SendPlan["channel"]): Promise<NotifyProvider | null> {
    await this.ensureProviders();
    // آخرُ مزوّدٍ سُجِّل للقناة يفوز: المجلَّداتُ تُقرأ مرتّبةً أبجدياً،
    // و`log` يسبق أيَّ مزوّدٍ حقيقيّ لغةً — فيُزاح من نفسه يومَ يصل.
    const able = this.providers.filter((p) => p.channels.includes(channel));
    return able.length ? able[able.length - 1] : null;
  }

  /** كم مزوّداً سُجّل — تقرؤه البوّابةُ ولا يُخمَّن. */
  async registered(): Promise<string[]> {
    await this.ensureProviders();
    return this.providers.map((p) => p.id);
  }

  /**
   * 🔴 **هل أُلغي اشتراكُ هذا المستقبِل؟** — يُسأل قبل الحجز لا بعده.
   *
   * ولو سُئل بعد الحجز لصار الصفُّ محجوزاً بحالة `queued` ثم مهملاً،
   * فيبدو في التقارير رسالةً «تنتظر الإرسال» إلى الأبد.
   */
  async isSuppressed(channel: string, recipient: string): Promise<boolean> {
    if (!recipient) return false;
    const [row] = await this.listNotificationOptouts(
      { channel, recipient: recipient.trim().toLowerCase() },
      { take: 1 }
    );
    return Boolean(row);
  }

  /** إلغاءٌ **متماثلٌ عند الإعادة**: ضغطتان على الرابط لا تُنشئان صفّين. */
  async optOut(channel: string, recipient: string, reason = "requested") {
    const key = recipient.trim().toLowerCase();
    try {
      const created = await this.createNotificationOptouts({
        channel,
        recipient: key,
        reason,
      } as any);
      return { created: true, id: (created as any)?.id };
    } catch {
      const [existing] = await this.listNotificationOptouts(
        { channel, recipient: key },
        { take: 1 }
      );
      // ⚠️ ونجاحٌ لا خطأ: المطلوبُ ألّا تصله رسائل، وهو كذلك.
      if (existing) return { created: false, id: (existing as any).id };
      throw new Error("تعذّر تسجيلُ إلغاء الاشتراك");
    }
  }

  async optIn(channel: string, recipient: string): Promise<boolean> {
    const key = recipient.trim().toLowerCase();
    const [row] = await this.listNotificationOptouts(
      { channel, recipient: key },
      { take: 1 }
    );
    if (!row) return false;
    await this.deleteNotificationOptouts((row as any).id);
    return true;
  }

  /**
   * التسليمُ الفعليّ — أو `suppressed` إن أُلغي الاشتراك.
   *
   * ⚠️ **ولا يُترجَم عن المزوّد**: حالتُه هي التي تُسجَّل. ومزوّدٌ يقول
   * `queued` لا يصير `sent` لأن النداءَ لم يرمِ.
   */
  async deliver(plan: SendPlan): Promise<SendOutcome & { suppressed?: boolean }> {
    if (await this.isSuppressed(plan.channel, plan.recipient)) {
      return { status: "failed", provider: "suppressed", error: "opted_out", suppressed: true };
    }

    const provider = await this.providerFor(plan.channel);
    if (!provider) {
      // قناةٌ بلا مزوّد: تُقال ولا تُدَّعى. و`queued` لأن الرسالةَ
      // مبنيّةٌ وتنتظر مزوّداً، لا لأنها فشلت.
      return { status: "queued", provider: "none", error: "no_provider_for_channel" };
    }

    try {
      return await provider.send(plan);
    } catch (e) {
      return { status: "failed", provider: provider.id, error: String((e as Error).message) };
    }
  }
}

export default NotifyModuleService;
