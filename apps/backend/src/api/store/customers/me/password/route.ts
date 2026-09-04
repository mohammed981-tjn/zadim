import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { identityFromToken } from "../../../../../modules/checkout/identity";
import { ACCESS_MODULE } from "../../../../../modules/access";
import type AccessModuleService from "../../../../../modules/access/service";

type Body = { current_password?: string; new_password?: string };

/**
 * تغييرُ كلمة مرور العميل (تتمّةُ بند ٢١).
 *
 * ── 🔴 ولماذا مسارٌ عندنا ومسارُ Medusa قائم ────────────────────
 *
 * `POST /auth/customer/emailpass/update` يعمل فعلاً — لكنه يأخذ
 * `entity_id` من **الرمز وحدَه** ولا يسأل عن كلمة المرور الحالية.
 * قُرئ في `medusa/dist/api/auth/[actor_type]/[auth_provider]/update`:
 *
 *     const updateData = { ...req.body, entity_id: req.auth_context.actor_id }
 *
 * فمن وصل إلى جلسةٍ مسروقة — حاسوبٌ مفتوحٌ أو رمزٌ مسرَّب — **يغيّر
 * كلمةَ المرور ويقفل الحسابَ على صاحبه نهائياً**. ولا يستعيده صاحبُه
 * إلا بمسار الاستعادة، وهو معطَّلٌ عندنا حتى يصل مزوّدُ رسائل.
 *
 * وهذا هو الفرقُ بين «تغييرِ كلمة المرور» و«الاستيلاءِ على الحساب»:
 * سؤالُ الحاليّة. فيُسأل هنا، **ولا يُنادى مسارُ Medusa إلا بعد
 * إثباتها**.
 *
 * ⚠️ **وما لا يفعله هذا المسار — ويُقال ولا يُخفى**: الجلساتُ الأخرى
 * لا تُبطَل. رموزُ Medusa موقَّعةٌ بلا حالةٍ في القاعدة، فلا سجلَّ
 * جلساتٍ يُمسح. فمن سرق رمزاً قبل التغيير يبقى داخلاً حتى تنتهي
 * صلاحيتُه. و«إنهاءُ كلّ الجلسات» بندٌ مفتوحٌ في `audit/gap-analysis.md`.
 */
export async function POST(req: MedusaRequest<Body>, res: MedusaResponse) {
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;
  const current = String(body.current_password ?? "");
  const next = String(body.new_password ?? "");

  const identity = await identityFromToken(req);
  if (!identity?.email) {
    return res.status(401).json({
      error: { code: "UNAUTHENTICATED", message_ar: "سجّلِ الدخولَ أوّلاً." },
    });
  }

  // ثمانيةٌ حدٌّ أدنى — وهو حدُّ Medusa نفسِه. ولا يُشدَّد هنا بلا
  // تشديدِه في التسجيل: حسابٌ يُنشأ بستّة أحرفٍ ولا يُغيَّر إليها
  // يُربك صاحبَه بلا أن يزيد أماناً.
  if (next.length < 8) {
    return res.status(400).json({
      error: { code: "PASSWORD_TOO_SHORT", message_ar: "كلمةُ المرور ثمانيةُ أحرفٍ فأكثر." },
    });
  }
  if (next === current) {
    return res.status(400).json({
      error: { code: "PASSWORD_UNCHANGED", message_ar: "الكلمةُ الجديدة مطابقةٌ للحالية." },
    });
  }

  const auth: any = req.scope.resolve(Modules.AUTH);

  // 🔴 إثباتُ الحاليّة — وهي كلُّ الفرق.
  const proof = await auth.authenticate("emailpass", {
    body: { email: identity.email, password: current },
  });
  if (!proof?.success) {
    // ⚠️ ولا يُفرَّق في الرسالة بين «الحاليّةُ خاطئة» و«الحسابُ غيرُ
    // موجود»: الفرقُ يُخبر المهاجمَ أيَّ بريدٍ مسجَّلٌ عندنا.
    return res.status(401).json({
      error: { code: "CURRENT_PASSWORD_WRONG", message_ar: "كلمةُ المرور الحالية غيرُ صحيحة." },
    });
  }

  const out = await auth.updateProvider("emailpass", {
    entity_id: identity.email,
    password: next,
  });
  if (!out?.success) {
    return res.status(400).json({
      error: { code: "PASSWORD_UPDATE_FAILED", message_ar: out?.error || "تعذّر تغييرُ كلمة المرور." },
    });
  }

  // حدثٌ أمنيٌّ يُقيَّد — **بلا أيّ كلمةِ مرور**: سجلٌّ يحمل كلمةَ مرورٍ
  // ولو خاطئةً يجعل تسريبَ السجلّ تسريبَ حسابات.
  const access = req.scope.resolve<AccessModuleService>(ACCESS_MODULE);
  await access
    .record({
      actor_id: identity.customer_id,
      actor_label: identity.email,
      action: "password.changed",
      entity: "customer",
      entity_id: identity.customer_id,
      ip: String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || null,
      user_agent: String(req.headers["user-agent"] ?? "") || null,
    })
    .catch(() => {
      // قيدُ التدقيق لا يمنع تغييراً وقع فعلاً — والعكسُ يترك الحسابَ
      // بكلمةٍ جديدةٍ ورسالةِ فشلٍ يقرؤها صاحبُه.
    });

  return res.json({ changed: true });
}
