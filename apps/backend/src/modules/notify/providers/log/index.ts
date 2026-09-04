import type { NotifyProvider, SendOutcome } from "../../contract";
import type { SendPlan } from "../../../marketing/dispatcher";

/**
 * المزوّدُ المسجِّل — **يسجّل ولا يرسل، ويقول ذلك**.
 *
 * ── ولماذا هو المزوّدُ الافتراضيّ ───────────────────────────────
 *
 * لأنه **لا حسابَ رسائلٍ بعد** (بند ٤٨: «لا يُبنى بمفتاحٍ وهميّ»).
 * والبديلان كلاهما أسوأ:
 *
 * | | لماذا رُفض |
 * |---|---|
 * | لا مزوّدَ إطلاقاً | الطابورُ يمتلئ ولا شيءَ يقرؤه — وهو ما كان |
 * | مزوّدٌ يدّعي الإرسال | تقريرٌ يقول «وصلت ٩٩٪» ثم قرارٌ عليه |
 *
 * فيُعيد **`queued` لا `sent`**: الرسالةُ مبنيّةٌ ومحجوزةٌ وجاهزة، ولم
 * تُسلَّم. ويوم يصل مزوّدٌ حقيقيٌّ يُضاف مجلَّدُه ولا يتغيّر سطرٌ آخر.
 */
export class LogProvider implements NotifyProvider {
  readonly id = "log";
  readonly channels = ["email", "sms", "push"] as const;

  async send(plan: SendPlan): Promise<SendOutcome> {
    // ⚠️ **ولا يُطبع نصُّ الرسالة ولا المستقبِل.** السجلاتُ تُجمع
    // وتُقرأ، وبريدُ عميلٍ فيها تسريبٌ بطيء. فيُطبع ما يكفي للتشخيص:
    // أيُّ حدثٍ وأيُّ قناة.
    void plan;
    return { status: "queued", provider: this.id };
  }
}

export default new LogProvider();
