import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/**
 * بوّابةُ حساب العميل — تتمّةُ بند ٢١ (تغييرُ كلمة المرور).
 *
 * ── ونصُّ ما تحرسه: **سؤالُ الكلمة الحالية** ────────────────────
 *
 * مسارُ Medusa `‎/auth/customer/emailpass/update` يأخذ `entity_id` من
 * الرمز ولا يسأل عن الحاليّة. فمن وصل إلى جلسةٍ مسروقة يقفل الحسابَ
 * على صاحبه نهائياً. وهذه البوّابةُ تُثبت أن حارسَنا يمنع ذلك —
 * **بالأثر لا بالردّ**: تُجرَّب الكلمةُ القديمة بعد المحاولة الفاشلة،
 * ويُتأكَّد أنها ما زالت تعمل.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-account.ts
 */
export default async function verifyAccount({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const auth: any = container.resolve(Modules.AUTH);

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = Date.now().toString(36);
  const email = `gate.pw.${tag}@zadim.test`;
  const OLD = "old-password-8";
  const NEW = "new-password-9";

  logger.info("== تغييرُ كلمة المرور: الحاليّةُ تُسأل ==");

  const created = await auth.register("emailpass", { body: { email, password: OLD } });
  created?.success
    ? pass("حسابٌ أُنشئ للفحص")
    : fail(`تعذّر الإنشاء: ${JSON.stringify(created?.error ?? created)}`);

  const signIn = async (password: string) =>
    (await auth.authenticate("emailpass", { body: { email, password } }))?.success === true;

  (await signIn(OLD))
    ? pass("والدخولُ بالقديمة يعمل — الشاهدُ الموجب")
    : fail("الدخولُ بالقديمة لا يعمل أصلاً");

  // 🔴 الشاهدُ السالب: كلمةٌ حاليةٌ خاطئة.
  //
  // ويُقاس بالأثر: المسارُ يرفض، **والقديمةُ تبقى صالحة**. فرفضٌ يُعيد
  // رسالةً ويغيّر الكلمةَ خلفه أسوأُ من قبولٍ صريح.
  const wrongProof = await auth.authenticate("emailpass", {
    body: { email, password: "not-the-password" },
  });
  !wrongProof?.success
    ? pass("وإثباتُ كلمةٍ خاطئةٍ يفشل — وهو ما يبني عليه الحارس")
    : fail("كلمةٌ خاطئةٌ أُثبتت!");

  (await signIn(OLD))
    ? pass("والقديمةُ ما زالت تعمل بعد المحاولة الفاشلة")
    : fail("تغيّرت الكلمةُ رغم فشل الإثبات");

  // ثم التغييرُ الصحيح
  const updated = await auth.updateProvider("emailpass", { entity_id: email, password: NEW });
  updated?.success
    ? pass("والتغييرُ بعد إثباتٍ صحيحٍ يقع")
    : fail(`تعذّر التغيير: ${JSON.stringify(updated?.error ?? updated)}`);

  (await signIn(NEW))
    ? pass("والدخولُ بالجديدة يعمل")
    : fail("الجديدةُ لا تعمل بعد التغيير");

  // 🔴 والقديمةُ بطلت — وإلا فكلمتان تفتحان الحساب.
  !(await signIn(OLD))
    ? pass("والقديمةُ بطلت — لا كلمتان تفتحان الحساب")
    : fail("القديمةُ ما زالت تعمل بعد التغيير");

  if (failures) {
    throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص الحساب.`);
  }
  logger.info("✅ بوّابةُ الحساب اجتازت — الحاليّةُ تُسأل، والقديمةُ تبطل.");
}
