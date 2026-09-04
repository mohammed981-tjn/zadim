import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { redeliverPending } from "../modules/marketing/redeliver";

/**
 * إعادةُ تسليم ما لم يصل — **المسارُ الإنتاجيّ لطبقة الإعادة**.
 *
 * ── ولماذا مهمّةٌ ثانيةٌ لا سطرٌ في `dispatch-marketing` ─────────
 *
 * لأنهما يقرآن مصدرين مختلفين ويفشلان لأسبابٍ مختلفة. المُصرِّفُ يقرأ
 * **صندوقَ الأحداث** (ما وقع ولم يُصرَّف بعد)، وهذا يقرأ **سجلَّ
 * الإرسال** (ما صُرِّف ولم يصل). وخلطُهما يعني أن حدثاً واحداً عالقاً
 * يوقف إعادةَ ألفِ رسالةٍ لا علاقةَ لها به.
 *
 * وأوضحُ من ذلك: يومَ يسقط مزوّدُ الرسائل ساعةً، المطلوبُ **إيقافُ
 * هذه وحدَها** حتى يتعافى (`is_enabled = false` في السياسة) — والتصريفُ
 * يستمرّ فيملأ السجلَّ بما يُعاد لاحقاً. ومهمّةٌ واحدةٌ لا تُطفأ نصفُها.
 *
 * ⚠️ **وأبطأُ من التصريف عمداً**: الإعادةُ تُخاطب مزوّداً يُرجَّح أنه
 * ساقط، ودورةٌ كلَّ خمسِ دقائقَ تعني الطرقَ على بابٍ مغلقٍ اثنتي عشرةَ
 * مرّةً في الساعة. والمهلةُ داخلَ الصفّ تتّسع مع كل محاولة، فالدورةُ
 * البطيئةُ تكفي.
 */
export default async function retryNotifications(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  const out = await redeliverPending(container, { limit: 200 });
  if (!out.claimed) return;

  logger.info(
    `[zadim] إعادةُ الإشعارات: ${out.claimed} محاولةً · ${out.sent} وصلت · ` +
      `${out.failed} تُعاد · ${out.dead} شُطبت · ${out.suppressed} مكتومة.`
  );

  // 🔴 والمشطوبُ يُقال بصوتٍ مرتفع: رسالةٌ استسلمنا عنها هي عميلٌ لم
  // يصله ما وعدناه به، ولا شيءَ بعد هذا السطر يذكّر بها.
  if (out.dead > 0) {
    logger.warn(
      `[zadim] ⚠️ شُطبت ${out.dead} رسالةً بعد بلوغ حدّ المحاولات — ` +
        `اقرأ zadim_notification_attempt لأسبابها قبل رفع الحدّ.`
    );
  }
}

export const config = {
  name: "retry-notifications",
  // كلَّ ربع ساعة: الإعادةُ تُخاطب مزوّداً يُرجَّح أنه ساقط، والمهلةُ
  // داخلَ الصفّ تتّسع مع كل محاولة — فدورةٌ أسرعُ لا تشتري شيئاً.
  schedule: "*/15 * * * *",
};
