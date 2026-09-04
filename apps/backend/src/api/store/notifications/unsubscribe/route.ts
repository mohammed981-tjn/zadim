import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { NOTIFY_MODULE } from "../../../../modules/notify";
import type NotifyModuleService from "../../../../modules/notify/service";

/**
 * إلغاءُ الاشتراك — `POST /store/notifications/unsubscribe`.
 *
 * ── ولماذا بلا حساب ولا رمزِ جلسة ───────────────────────────────
 *
 * 🔴 لأن **من يريد الخروجَ يجب أن يخرج**. واشتراطُ تسجيلِ دخولٍ لإلغاء
 * رسائلَ يجعل المخرجَ أصعبَ من الدخول — وأكثرُ من تصله رسالةُ «سلّتُك
 * تنتظرك» **ضيفٌ بلا حساب أصلاً**. فمن لا يجد زرَّ الإلغاء يضغط
 * «إبلاغ عن مزعج»، وذلك يُحرق نطاقَ المتجر عند مزوّدي البريد.
 *
 * ⚠️ **والردُّ واحدٌ دائماً** سواءٌ أُلغي الآن أو كان مُلغىً من قبل أو
 * لم يكن مشترِكاً أصلاً: ردٌّ يفرّق بينها يجعل هذا المسارَ **أداةَ
 * فحصٍ يعرف بها الغريبُ من عندنا بريدُه**.
 *
 * ⚠️ **ولا يُلغى بريدُ غيرِك بأثرٍ يُقاس**: الردُّ الموحّدُ يمنع أن
 * يُعرف شيء، والضررُ الباقي أن يُلغي عابثٌ بريداً يعرفه — وهو ما
 * يعالجه رابطٌ موقَّعٌ في الرسالة نفسِها **يوم يصل مزوّدٌ حقيقيّ
 * يُرسلها**. ومكتوبٌ في `16-behavior-map.md` أنه لم يُبنَ بعد.
 */
const CHANNELS = ["email", "sms", "push"];

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Record<string, unknown>;
  const channel = String(body.channel ?? "email").trim();
  const recipient = String(body.recipient ?? "").trim();

  const done = () =>
    res.json({
      // نصٌّ واحدٌ لكل الحالات — انظر أعلاه.
      message_ar: "لن تصلك رسائلُ تسويقٍ بعد الآن على هذا العنوان.",
    });

  if (!recipient || !CHANNELS.includes(channel)) {
    // حتى المدخلُ الفاسد يُردّ بنفس النصّ: تفريقُ الردود يكشف.
    return done();
  }

  const notify = req.scope.resolve<NotifyModuleService>(NOTIFY_MODULE);
  await notify.optOut(channel, recipient, "requested");
  return done();
}
