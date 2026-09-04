import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { COD_PROVIDER_ID } from "../modules/checkout/orchestrate";

/**
 * بوّابةُ الوصل — **هل يناديه أحدٌ غيرُ البوّابة؟**
 *
 * ── الفجوةُ التي وُلدت منها هذه البوّابة ─────────────────────────
 *
 * فحصٌ شاملٌ للمستودع (2026-09-03) وجد ثلاثَ وحداتٍ مكتملةً مُختبَرةً
 * **لا يناديها مسارُ إنتاجٍ واحد**:
 *
 * | الوحدة | من كان يناديها |
 * |---|---|
 * | `zatca.issue()` — إصدارُ الفاتورة | `verify-payments.ts` وحدَه |
 * | `codEligibility()` — أهليّةُ COD | `verify-payments.ts` وحدَه |
 * | `marketing.dispatch()` — تصريفُ الصندوق | `verify-marketing.ts` وحدَه |
 *
 * وكلُّ بوّاباتها **خضراء** — لأنها تنادي الدالّةَ بيدها. فالمتجرُ كان
 * يبيع بصفرِ فاتورة، وبحدِّ COD حبراً، وبصندوقِ أحداثٍ يمتلئ ولا يُقرأ.
 *
 * وهذا هو بعينه الدرسُ المكتوب في رأس `api/middlewares.ts`: «مُطابِقٌ
 * صامتٌ لا يُطابِق يترك البوّابةَ خضراءَ والبابَ مفتوحاً». وقد تكرّر —
 * لأن الدرسَ كان **مكتوباً ولا يحرسه فاحص**. وهذه هي الفاحص.
 *
 * ── والقاعدةُ التي تفرضها ───────────────────────────────────────
 *
 * كلُّ قدرةٍ في هذه القائمة يجب أن يناديها **ملفٌّ خارج `src/scripts/`**:
 * مسارٌ، أو مشترِك، أو مهمّةٌ مجدولة، أو وحدةٌ أخرى. ونداءٌ من سكربتِ
 * فحصٍ لا يُحتسب — فذاك مصدرُ الوهم لا دليلُ العمل.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-wiring.ts
 */

/** ما لا يُحتسب مُنادياً: البوّاباتُ والاستقصاءاتُ والبذور. */
const NOT_PRODUCTION = ["/scripts/", "/node_modules/", "/.medusa/", "/migrations/"];

const SRC = join(process.cwd(), "src");

type Wire = {
  /** ماذا تفعل هذه القدرة بكلامٍ يفهمه من يقرأ العطل. */
  what: string;
  /** نصٌّ يُبحث عنه حرفياً في الكود الحيّ. */
  needle: string;
  /** ما الذي ينكسر في الإنتاج إن لم يناديها أحد. */
  breaks: string;
};

const WIRES: Wire[] = [
  {
    what: "إصدارُ فاتورة ZATCA",
    needle: "zatca.issue(",
    breaks:
      "المتجرُ يبيع بصفرِ فاتورة — والفواتيرُ الفائتة **لا تدخل السلسلةَ بأثرٍ رجعيّ**.",
  },
  {
    what: "أهليّةُ الدفع عند الاستلام",
    needle: "codDecision(",
    breaks: "حدُّ COD الذي يضبطه المالك ورفضاتُ العملاء بلا أثرٍ على أيّ طلب.",
  },
  {
    what: "تصريفُ صندوق أحداث التسويق",
    needle: "marketing.dispatch(",
    breaks: "الصندوقُ يمتلئ بلا سقفٍ ولا رسالةَ تصل عميلاً.",
  },
  {
    what: "قراءةُ الأحداث المستحقّة من الصندوق",
    needle: "pendingEvents(",
    breaks: "لا شيءَ يقرأ ما كتبته المُطلِقات — والصندوقُ سجلٌّ لا يُقرأ.",
  },
  {
    what: "استلامُ أمرِ شراءٍ (يزيد المخزون ويكتب التكلفة)",
    needle: "receivePurchaseLine(",
    breaks:
      "جداولُ المشتريات تمتلئ **ولا حبّةَ تصل الرفّ**، ويبقى " +
      "`zadim_variant_cost` فارغاً — فكلُّ يومِ بيعٍ يومٌ لا يُعرف ربحُه أبداً.",
  },
  {
    what: "وضعُ كوبونٍ على السلّة",
    needle: "applyCoupon(",
    breaks:
      "الكوبوناتُ تُنشأ في اللوحة **ولا مسارَ يضعها على سلّة** — " +
      "فمحرّكُ العروض حيٌّ ولا رمزَ يصل عميلاً.",
  },
  {
    what: "تسجيلُ استهلاك الكوبون على الطلب",
    needle: "recordRedemptions(",
    breaks:
      "الحدُّ لكل عميلٍ **حبرٌ**: لا صفَّ يُكتب، فالعدُّ صفرٌ أبداً " +
      "ويُعاد استعمالُ الكوبون بلا نهاية.",
  },
  {
    what: "إرسالُ أمرِ الشراء (يحجز القادم)",
    needle: "placePurchaseOrder(",
    breaks:
      "`incoming` يبقى صفراً — فمديرُ المخزون يرى «صفرٌ متاح» ولا يرى " +
      "«مئةٌ قادمة»، فيُصدر أمراً ثانياً بنفس البضاعة.",
  },
];

/**
 * 🔴 شاهدان قبل الحكم — فاحصٌ لا يُختبر لا يُعرف أعمى هو أم لا.
 *
 * الموجب: نداءٌ نعلم أنه موصولٌ (حارسُ الصلاحيات في `middlewares.ts`)
 * **يجب أن يُوجد**. فإن لم يوجد فالماسحُ لا يقرأ شيئاً، و«كلُّها موصولة»
 * منه كذبة.
 *
 * والسالب: نداءٌ لا وجودَ له **يجب ألّا يُوجد**. فإن وُجد فالمطابقةُ
 * تُصيب كلَّ شيء، و«موصولة» تعني «بحثتُ فوجدتُ أيَّ شيء».
 */
const POSITIVE_WITNESS = "access.can(";
const NEGATIVE_WITNESS = "zadimNothingCallsThisEver(";

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (NOT_PRODUCTION.some((s) => `${full}/`.includes(s))) continue;
    if (statSync(full).isDirectory()) {
      productionFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** التعليقاتُ تُنزع: شرحٌ يذكر نداءً ليس نداءً. */
function liveSource(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

export default async function verifyWiring({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const files = productionFiles(SRC);
  const sources = new Map(files.map((f) => [f, liveSource(f)]));
  const rel = (f: string) => f.split("/src/")[1] ?? f;

  const callersOf = (needle: string): string[] =>
    [...sources.entries()].filter(([, src]) => src.includes(needle)).map(([f]) => rel(f));

  // ── ٠) الشاهدان ────────────────────────────────────────────────
  logger.info("== شاهدا الفاحص ==");

  files.length > 20
    ? pass(`الماسحُ قرأ ${files.length} ملفَّ إنتاجٍ خارج البوّابات`)
    : fail(`قرأ ${files.length} ملفّاً فقط — الماسحُ لا يرى الشجرة`);

  const positive = callersOf(POSITIVE_WITNESS);
  positive.length
    ? pass(`الشاهدُ الموجب: «${POSITIVE_WITNESS}» موجودٌ في ${positive.join(" · ")}`)
    : fail(
        `الشاهدُ الموجب سقط: لم يُوجد «${POSITIVE_WITNESS}» وهو موصولٌ قطعاً — ` +
          `فالماسحُ أعمى، وكلُّ نتيجةٍ بعده بلا قيمة.`
      );

  const negative = callersOf(NEGATIVE_WITNESS);
  negative.length === 0
    ? pass("والشاهدُ السالب: نداءٌ وهميٌّ لم يُوجد")
    : fail(`الشاهدُ السالب سقط: «${NEGATIVE_WITNESS}» وُجد في ${negative.join(" · ")}`);

  // ── ١) كلُّ قدرةٍ حرجةٍ يناديها كودُ إنتاج ─────────────────────
  logger.info("== كلُّ قدرةٍ حرجةٍ موصولةٌ بمسارِ إنتاج ==");

  for (const w of WIRES) {
    const callers = callersOf(w.needle);
    if (callers.length) {
      pass(`${w.what} ⇐ ${callers.join(" · ")}`);
    } else {
      fail(
        `${w.what}: **لا يناديها إلا البوّابة**. ${w.breaks} ` +
          `(ابحث عن «${w.needle}» — لا وجودَ له خارج src/scripts/)`
      );
    }
  }

  // ── ٢) مزوّدُ الدفع الذي يستعمله الإتمام **مسجَّلٌ فعلاً** ──────
  //
  // 🔴 `COD_PROVIDER_ID` نصٌّ شكلُه `pp_<identifier>_<id>` من موضعين
  // مختلفين (`cod-payment/service.ts` و`medusa-config.ts`). فحرفٌ يتغيّر
  // في أحدهما يجعل كلَّ إتمامٍ يسقط — **ولا يكشفه أيُّ فحصٍ للنوع**:
  // النصُّ نصٌّ صحيحٌ دائماً. ولا يكشفه إلا سؤالُ الحاوية.
  logger.info("== مزوّدُ الدفع الذي ينادِيه الإتمام مسجَّل ==");

  try {
    const payment = container.resolve(Modules.PAYMENT) as any;
    const providers = (await payment.listPaymentProviders({})) as any[];
    const ids = providers.map((p) => p.id);
    ids.includes(COD_PROVIDER_ID)
      ? pass(`«${COD_PROVIDER_ID}» مسجَّلٌ — والإتمامُ ينادِيه`)
      : fail(
          `الإتمامُ ينادي «${COD_PROVIDER_ID}» ولا وجودَ له. المسجَّل: ${ids.join(" · ") || "لا شيء"}`
        );
  } catch (e) {
    fail(`تعذّر سؤالُ وحدة الدفع عن مزوّديها: ${(e as Error).message}`);
  }

  // ── ٢ب) لا اسمَ مخطَّطٍ مكتوبٌ حرفياً في كود الإنتاج ────────────
  //
  // 🔴 `medusa-config.ts` يقرأ المخطَّط من `DATABASE_SCHEMA`، وكانت
  // `zatca/service.ts` تكتب `"zadim."` حرفياً في أربعة مواضع. فمن يضبط
  // المتغيّر بغير `zadim` يجد **الفوترةَ وحدَها تسقط** وكلَّ شيءٍ آخر
  // يعمل — وأسوأُ ما فيه أن السقوطَ في إصدار الفاتورة، والفجوةُ لا
  // تُسدّ بأثرٍ رجعيّ.
  //
  // وهذا يقع كلَّما احتاج مبرمجٌ SQL خاماً عبر حدود الوحدات. فالفاحصُ
  // هنا لا يعتمد على تذكّره.
  //
  // ⚠️ و`src/scripts/` مستثنىً (كبقيّة هذا الملفّ): البوّاباتُ تكتب
  // `zadim.` صراحةً لأنها تفحص جداولَ Medusa نفسَها، ولا تعمل في
  // الإنتاج. والاستثناءُ معلَنٌ لا مطويّ.
  logger.info("== لا اسمَ مخطَّطٍ مكتوبٌ حرفياً في كود الإنتاج ==");

  // متغيّراتُ الجلسة (`current_setting('zadim.movement_reason')`) ليست
  // أسماءَ مخطَّطات بل فضاءَ أسماءٍ في Postgres — ولا تُحسب.
  const SCHEMA_LITERAL = /["'`]zadim\.(?!movement_|actor_|return_|cart_)/;

  const hardcoded = [...sources.entries()]
    .filter(([, src]) => SCHEMA_LITERAL.test(src))
    .map(([f]) => rel(f));

  // شاهدٌ موجب: النمطُ يُمسك سطراً مصطنَعاً — وإلا فصفرُه لا يعني شيئاً.
  SCHEMA_LITERAL.test('await trx("zadim.zadim_zatca_invoice")')
    ? pass("النمطُ يُمسك اسمَ مخطَّطٍ مكتوباً حرفياً")
    : fail("الشاهدُ الموجب سقط: النمطُ أعمى، وصفرُه بلا قيمة");

  // وشاهدٌ سالب: متغيّرُ الجلسة ليس مخطَّطاً ولا يجب أن يُشتكى منه.
  !SCHEMA_LITERAL.test("current_setting('zadim.movement_reason', true)")
    ? pass("ولا يشتكي من متغيّرات الجلسة — فهي فضاءُ أسماءٍ لا مخطَّط")
    : fail("الشاهدُ السالب سقط: النمطُ يشتكي من `current_setting`");

  hardcoded.length === 0
    ? pass("كودُ الإنتاج يقرأ المخطَّطَ من الإعداد لا يكتبه")
    : fail(
        `اسمُ المخطَّط مكتوبٌ حرفياً في: ${hardcoded.join(" · ")} — ` +
          `اقرأه من DATABASE_SCHEMA، وإلا سقط هذا الملفُّ وحدَه عند تغييره.`
      );

  // ── ٣) سياسةُ COD مبذورةٌ — وإلا لم يبعِ المتجرُ شيئاً ─────────
  //
  // غيابُ الصفّ يعني `COD_DISABLED` بتعريف `payments/cod.ts`، وCOD وسيلةُ
  // الدفع الوحيدة. فقاعدةٌ بلا سياسةٍ متجرٌ **لا يقبل طلباً واحداً** —
  // وهو عطلٌ يبدو عطلَ سلّةٍ ويظهر عند أوّل عميل.
  logger.info("== سياسةُ الدفع عند الاستلام مبذورة ==");

  const payments = container.resolve("payments") as any;
  const [policy] = await payments.listCodPolicies({}, { take: 1 });
  policy
    ? pass(`سياسةٌ نافذة (مفعَّلة: ${policy.is_enabled ? "نعم" : "لا"})`)
    : fail("لا سياسةَ COD في القاعدة — كلُّ إتمامٍ سيُرفض بـCOD_DISABLED.");

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص الوصل.`);
  logger.info("✅ بوّابةُ الوصل: كلُّ قدرةٍ حرجةٍ يناديها كودُ إنتاج.");
}
