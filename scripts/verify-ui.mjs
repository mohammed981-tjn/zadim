#!/usr/bin/env node
/**
 * بوّابةُ المرحلة ٩ — الشطرُ الذي لا يُقاس إلا في متصفّح.
 *
 * > Lighthouse ≥ ٩٠ على الجوال · **RTL صحيحٌ في كل شاشة**
 *
 * ── لماذا ملفٌّ منفصلٌ عن بوّابات `medusa exec` ─────────────────
 *
 * البوّاباتُ العشرُ الأخرى تفحص القاعدةَ والمنطق، وتعمل بلا متصفّح.
 * وهذه تحتاج متصفّحاً حقيقياً يرسم الصفحة: الاتجاهُ والخطُّ والسرعةُ
 * صفاتُ **ما يُرسم** لا ما يُحسب، ولا تُقاس بقراءة كود.
 *
 * ── و«RTL صحيحٌ في كل شاشة» تُؤخذ حرفياً ────────────────────────
 *
 * لا يكفي `dir="rtl"` على الجذر. الخطأُ الشائعُ أن تُكتب الهوامشُ
 * بـ`ml-`/`mr-` و`left-`/`right-`، فتظهر الصفحةُ معكوسةً في مواضعَ
 * بعينها: أيقونةٌ في الجهة الخطأ، وسهمٌ يشير إلى غير جهته. **فيُفحص
 * كلُّ عنصرٍ مرسومٍ في الصفحة** عن صفوفٍ اتجاهيّة، لا الجذرُ وحدَه.
 *
 * ── والسرعةُ: رقمٌ لا انطباع ───────────────────────────────────
 *
 * يُقاس **LCP** و**CLS** من المتصفّح مباشرةً على شاشةِ جوّالٍ محاكاة.
 * ومع `--lighthouse` يُشغَّل Lighthouse إن كان مثبَّتاً فيُعطي الرقمَ
 * الذي تسمّيه البوّابة. وبدونه تُعطى القياساتُ الخام — **ويُقال
 * صراحةً إنها ليست درجةَ Lighthouse**، لا يُدَّعى العكس.
 *
 * التشغيل:
 *   node scripts/verify-ui.mjs http://localhost:3000
 *   node scripts/verify-ui.mjs http://localhost:3000 --lighthouse
 */

import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const WANT_LH = process.argv.includes("--lighthouse");

/** المسارُ الذي يُفحص (بلا بادئةِ لغة)، واسمُه العربيّ في التقرير. */
const PAGES = [
  ["/", "الرئيسية"],
  ["/search?q=سماعة", "البحث"],
  ["/cart", "السلة"],
  ["/p/zadim-headphones", "صفحة منتج"],
];

/**
 * اللغتان — **وكلُّ صفحةٍ تُفحص بهما** (المرحلة ١١ب).
 *
 * ── ولماذا لا تُفحص العربيةُ وحدَها ثم «يُفترَض» أن الإنجليزيةَ مثلُها ──
 *
 * لأنهما ليستا صفحةً واحدةً بترجمتَين: الاتجاهُ ينقلب، والخطُّ يتغيّر،
 * والنصُّ يطول فينكسر تخطيطٌ كان سليماً بالعربية. وأكثرُ من ذلك:
 * محتوى المتجر **عربيٌّ في القاعدة**، فصفحةٌ إنجليزيةُ الأزرارِ عربيةُ
 * المنتجات تمرّ في كل فحصٍ لا يقرأ نصَّها.
 */
const LOCALES = [
  {
    code: "ar",
    dir: "rtl",
    label: "عربي",
    // العربيةُ تُطلب: نصٌّ عربيٌّ يجب أن يظهر.
    wantArabic: true,
  },
  {
    code: "en",
    dir: "ltr",
    label: "إنجليزي",
    wantArabic: false,
  },
];

/** حرفٌ عربيّ. */
const ARABIC = /[؀-ۿ]/;

/**
 * مفتاحُ ترجمةٍ ظهر خاماً على الشاشة: `nav.cart` · `totals.grand`.
 *
 * 🔴 وهذا أسوأُ من نصٍّ غيرِ مترجَم: النصُّ العربيُّ في صفحةٍ إنجليزية
 * نقصٌ يفهمه الزائر، و`product.addToCart` **عطلٌ يراه**. ودالّةُ `t`
 * تُعيد المفتاحَ عند الضياع عمداً — كي يُرى هنا لا كي يُشحن.
 */
const RAW_KEY = /(?:^|\s)[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)*(?:\s|$)/;

/** ما يُستثنى من فحص المفاتيح الخام: نصٌّ يشبه المفتاحَ وليس مفتاحاً. */
const NOT_A_KEY = /@|\/|https?:|\.(com|sa|co|net|org|svg|png|jpg|webp)\b/i;

/**
 * صفوفُ Tailwind الاتجاهيّة — **ما يجب ألّا يظهر في صفحةٍ عربية**.
 *
 * والمنطقيّةُ (`ms-` · `me-` · `ps-` · `pe-` · `start-` · `end-`) تنقلب
 * مع الاتجاه، والفيزيائيةُ لا تنقلب. فوجودُ الثانية في شاشةٍ عربيةٍ
 * عطلٌ ينتظر أن يُرى.
 */
const PHYSICAL = /(^|\s)(-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)(-|$))/;

/** استثناءٌ معلَن: بعضُ الصفوف اتجاهيّةٌ بحقّ (سهمٌ يدور مثلاً). */
const ALLOWED_PHYSICAL = new Set(["text-left", "text-right"]);

let failures = 0;
const pass = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => {
  console.error(`  ⛔ ${m}`);
  failures++;
};

/**
 * 🔴 **شاهدُ فاحص المفاتيح الخام** — قبل أن يُقاس به شيء.
 *
 * `RAW_KEY` تعبيرٌ نمطيّ، وتعبيرٌ نمطيٌّ لا يُطابِق شيئاً يُعطي «ولا
 * مفتاحَ خام» على **كل** صفحة — وهو جوابُ فاحصٍ سليمٍ وجوابُ فاحصٍ
 * أعمى سواءً بسواء. (وقد وقع هذا حرفياً في فاحص المَسح بالمرحلة ١١:
 * أمسك واحداً من أربعةٍ لأن الشكلَ الذي توقّعتُه ليس الشكلَ الواقع.)
 *
 * فطُعمٌ يجب أن يُمسَك، وبريءٌ يجب ألّا يُمسَك — ويسقط الفحصُ كلُّه
 * قبل أن يفتح متصفّحاً إن أخطأ في أيٍّ منهما.
 */
{
  const bait = ["nav.cart", "totals.grand", "product.addToCart", "  search.resultsFor  "];
  const innocent = [
    "زادم",
    "Zadim Wireless Headphones",
    "٣٩٩٫٠٠ ر.س",
    "hello@zadim.sa",
    "zadim.sa",
    "Shipped from the nearest warehouse, cash on delivery.",
  ];
  const missed = bait.filter((s) => !(RAW_KEY.test(s) && !NOT_A_KEY.test(s)));
  const falseAlarms = innocent.filter((s) => RAW_KEY.test(s) && !NOT_A_KEY.test(s));

  if (missed.length || falseAlarms.length) {
    console.error("  ⛔ فاحصُ المفاتيح الخام لا يعمل — ولا يُبنى عليه شيء:");
    if (missed.length) console.error(`     أفلت: ${missed.join(" · ")}`);
    if (falseAlarms.length) console.error(`     أنذر باطلاً: ${falseAlarms.join(" · ")}`);
    process.exit(1);
  }
  console.log("  ✅ شاهدُ فاحص المفاتيح: أمسك الأربعةَ ولم يُنذر على البريء");
}

/**
 * أين المتصفّح — و**لا مسارَ مبرمَجٌ افتراضياً**.
 *
 * كان الافتراضُ مسارَ حاويةِ التطوير (`/opt/pw-browsers/...`) — يعمل هنا،
 * **ويُسقِط CI** حيث يضعه `playwright install` في `~/.cache/ms-playwright`
 * («executable doesn't exist»). ومسارٌ مبرمَجٌ لبيئةٍ واحدةٍ يبطل عملَ
 * Playwright نفسِه في إيجاد متصفّحه.
 *
 * فالترتيب: ما يُصرّح به المُشغّل · ثم مسارُ الحاوية **إن كان موجوداً
 * فعلاً** · ثم `undefined` فيتولّاها Playwright.
 */
const DEV_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const chromiumPath =
  process.env.CHROMIUM_PATH ?? (existsSync(DEV_CHROMIUM) ? DEV_CHROMIUM : undefined);

const browser = await chromium.launch({ executablePath: chromiumPath });

// شاشةُ جوّالٍ حقيقية: البوّابة تقول «على الجوال»، وقياسُ سطحِ مكتبٍ
// عريضٍ يُعطي رقماً أجمل لا أصدق.
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: "ar-SA",
});


// ════════════════════════════════════════════════════════════════
// 🔴 شراءٌ كاملٌ من المتصفّح — البوّابةُ التي لم تكن
// ════════════════════════════════════════════════════════════════
//
// ── لماذا أُضيفت ────────────────────────────────────────────────
//
// فحصٌ في 2026-09-03 وجد أن شاشةَ الإتمام كانت **تجمع العنوانَ وتتركه
// في المتصفّح**: لا دالّةَ تُحدّث السلّة أصلاً. فكلُّ طلبٍ يُنشأ بلا
// عنوانِ شحن — ولا أحدَ يعرف أين يُرسَل.
//
// ولم تكشفه بوّابةٌ واحدة، لسببٍ واحد: **لا بوّابةَ كانت تشتري**.
// `verify-checkout.ts` يبني السلّةَ بسيرِ العمل ومعها العنوانُ فيفحص
// الخادمَ لا الواجهة، وهذه البوّابةُ كانت تزور أربعَ صفحاتٍ ولا تفتح
// `/checkout` قطّ.
//
// فالدرسُ أن **كلَّ ما لا يُسلك لا يُفحص**. وهذه تسلك الطريقَ كما
// يسلكه العميل: منتجٌ ⇐ سلّة ⇐ عنوانٌ وطنيّ ⇐ شحنٌ ⇐ تسعيرٌ ⇐ تأكيد.
//
// ⚠️ **وتُشغَّل بالعربية وحدَها**: الشراءُ يقيس السلكَ لا الترجمة،
// واللغتان مفحوصتان في كل صفحةٍ أعلاه. وشراءان يضاعفان زمنَ البوّابة
// ولا يشتريان يقيناً جديداً.
/**
 * 🔴 التصفيةُ بالخصائص **من المتصفّح** (بند ٣).
 *
 * وبوّابةُ الكتالوج تفحص المنطقَ بنداءٍ مباشر — وهي خضراءُ حتى لو لم
 * تُرسَم لوحةٌ على الشاشة أصلاً. وهذه تفحص ما لا تفحصه: أن اللوحَ
 * **يُرسَم**، وأن الضغطةَ **تُغيّر العنوانَ والنتائج**.
 *
 * ⚠️ **وصفحةُ التصنيف نفسُها لم تكن تُفتح**: قِيس أن كلَّ معرّفٍ عربيٍّ
 * يُعيد «القسم غير موجود» — لأن Next يسلّم المقطعَ مرمَّزاً ثم كنّا
 * نرمّزه ثانية. ولم تمسكه بوّابةٌ لأن **لا بوّابةَ كانت تزور تصنيفاً**.
 */
async function filterChecks(ctx) {
  console.log("\n== 🔎 التصفيةُ بالخصائص (من المتصفّح) ==");
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));

  /** عدَدُ بطاقات المنتجات المرسومة في منطقة النتائج. */
  const productCount = () =>
    page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return 0;
      const hrefs = [...main.querySelectorAll('a[href*="/p/"]')].map((a) => a.getAttribute("href"));
      return new Set(hrefs).size;
    });

  try {
    const url = `${BASE}/ar/c/${encodeURIComponent("إلكترونيات")}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });

    const notFound = await page.getByText("القسم غير موجود").count();
    notFound === 0
      ? pass("صفحةُ تصنيفٍ بمعرّفٍ عربيٍّ تُفتح — والترميزُ المزدوج كان يُعيد «القسم غير موجود»")
      : fail("صفحةُ التصنيف تُعيد «القسم غير موجود» — الترميزُ المزدوج عاد");

    const before = await productCount();
    before > 0
      ? pass(`والتصنيفُ يعرض منتجاتِه (${before}) — وبلا وصلةِ قناةِ بيعٍ كانت صفراً`)
      : fail("التصنيفُ فارغٌ — راجعْ ربطَ منتجات seed-catalog بقناة البيع");

    // بالعنوان لا بالدور: `aside` قد يفقد دورَ `complementary` بحسب
    // ما يحويه، والعنوانُ المربوط بـ`aria-labelledby` لا يتغيّر.
    const panel = page.locator('aside[aria-labelledby="filters-heading"]');
    (await panel.count()) > 0
      ? pass("ولوحُ التصفية مرسومٌ على الشاشة")
      : fail("لا لوحَ تصفيةٍ — الخصائصُ تُحسب ولا تُعرض");

    // أوّلُ خانةٍ في اللوح — بالدور لا بالمحدِّد.
    const boxes = panel.getByRole("checkbox");
    const n = await boxes.count();
    if (n === 0) {
      fail("لوحُ التصفية بلا خانات");
    } else {
      await boxes.first().check({ timeout: 15000 });
      await page.waitForTimeout(2500);

      decodeURIComponent(page.url()).includes("attr[")
        ? pass("والضغطةُ تكتب الاختيارَ في العنوان — فالتصفيةُ تُشارَك وتُحفظ ويعمل زرُّ الرجوع")
        : fail(`الاختيارُ لم يصل العنوان: ${page.url()}`);

      const after = await productCount();
      after < before
        ? pass(`والنتائجُ ضاقت فعلاً (${before} ⇐ ${after}) — لا زرٌّ يُضاء ولا يصفّي`)
        : fail(`النتائجُ لم تتغيّر (${before} ⇐ ${after}) — وزرٌّ لا يفعل شيئاً أسوأُ من غيابه`);

      // وشاهدٌ عكسيّ: «مسح الكل» يُعيد الجميع.
      await page.getByRole("button", { name: /مسح الكل/ }).first().click({ timeout: 15000 });
      await page.waitForTimeout(2500);
      (await productCount()) === before
        ? pass("و«مسح الكل» يُعيد التصنيفَ كاملاً — الطريقُ ذو اتجاهين")
        : fail("«مسح الكل» لم يُعِد كلَّ المنتجات");
    }

    errors.length === 0
      ? pass("ولا خطأَ جافاسكربت في المسار كلِّه")
      : fail(`أخطاءُ جافاسكربت: ${errors.join(" · ")}`);
  } catch (e) {
    fail(`سقطت فحوصُ التصفية: ${String(e.message).slice(0, 200)}`);
  } finally {
    await page.close();
  }
}

async function buyOnce(ctx) {
  console.log("\n== 🛒 شراءٌ كاملٌ من المتصفّح (عربي) ==");
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));

  try {
    await page.goto(`${BASE}/ar/p/zadim-headphones`, { waitUntil: "networkidle", timeout: 45000 });

    // «أضف إلى السلة» — بالدور لا بالمحدِّد: زرٌّ يُعاد تصميمُه لا
    // يكسر البوّابة، وزرٌّ يختفي يكسرها. وهذا هو المطلوب.
    await page.getByRole("button", { name: /أضف|السلة/ }).first().click({ timeout: 20000 });
    await page.waitForTimeout(2000);

    await page.goto(`${BASE}/ar/checkout`, { waitUntil: "networkidle", timeout: 45000 });

    const fill = async (label, value) => {
      await page.getByLabel(label, { exact: false }).first().fill(value, { timeout: 10000 });
    };

    await fill("الاسم الأول", "بوّابة");
    await fill("اسم العائلة", "زادم");
    await fill("رقم الجوال", "0555000111");
    await fill("رقم المبنى", "2743");
    await fill("اسم الشارع", "طريق الملك فهد");
    await fill("الحي", "العليا");
    await fill("المدينة", "الرياض");
    await fill("الرمز البريدي", "12211");
    await fill("الرقم الإضافي", "6889");

    pass("حقولُ العنوان الوطنيّ التسعة موجودةٌ وتُملأ");

    await page.getByRole("button", { name: /متابعة إلى الشحن/ }).click({ timeout: 20000 });

    const review = page.getByRole("button", { name: /مراجعة الطلب/ });
    await review.waitFor({ timeout: 25000 });
    pass("الشاشةُ انتقلت إلى الشحن");

    // 🔴 والشرطُ الحاسم **يُسأل عنه الخادمُ لا الشاشة**.
    //
    // انتقالُ الخطوة لا يُثبت شيئاً: الشاشةُ القديمة كانت تنتقل
    // `onClick={() => setStep("shipping")}` بلا نداءٍ أصلاً، فتبدو
    // عاملةً والسلّةُ بلا عنوان. فيُقرأ معرّفُ السلّة من الكعكة، وتُسأل
    // الخلفيّةُ: **هل عندها العنوانُ الوطنيُّ مهيكلاً؟**
    const cartCookie = (await ctx.cookies()).find((c) => c.name === "zadim_cart_id");
    if (!cartCookie?.value) {
      fail("لا كعكةَ سلّة — تعذّر التحقّق من العنوان على الخادم");
    } else {
      const api = process.env.MEDUSA_URL ?? "http://localhost:9000";
      const pk = process.env.MEDUSA_PK ?? process.env.NEXT_PUBLIC_MEDUSA_PK ?? "";
      // ⚠️ `fields=+shipping_address.metadata` لازم: مسارُ المتجر
      // **لا يُعيد `metadata` العنوان افتراضاً** (قِيس — والحقلُ مخزَّنٌ
      // في القاعدة كاملاً). وفاحصٌ يسأل عمّا لا يُعاد يسقط على نظامٍ
      // سليم، وهو أسوأُ من فاحصٍ لا يسأل.
      const r = await fetch(
        `${api}/store/carts/${cartCookie.value}?fields=%2Bshipping_address.metadata`,
        { headers: { "x-publishable-api-key": pk } }
      );
      const body = await r.json().catch(() => ({}));
      const sa = body?.cart?.shipping_address ?? {};
      const national = sa?.metadata?.national_address;
      national?.district === "العليا" &&
      national?.additional_number === "6889" &&
      sa?.address_1 === "2743 طريق الملك فهد"
        ? pass("والخادمُ يحمل العنوانَ مهيكلاً (الحيُّ والرقمُ الإضافيّ) ومركَّباً في الملصق")
        : fail(
            "الشاشةُ انتقلت والسلّةُ بلا عنوانٍ وطنيٍّ على الخادم — " +
              "وهذا بعينه العطبُ الذي وُجد في 2026-09-03."
          );
    }

    await review.click({ timeout: 20000 });

    const confirm = page.getByRole("button", { name: /تأكيد الطلب/ });
    await confirm.waitFor({ timeout: 30000 });
    pass("التسعيرُ تمّ وظهرت شاشةُ التأكيد");

    await confirm.click({ timeout: 20000 });

    // الوصولُ إلى صفحة التأكيد هو الدليل: العنوانُ الصحيح وحدَه يعبر
    // حارسَ `ADDRESS_REQUIRED` في `orchestrate.ts`.
    await page.waitForURL(/\/orders\/[^/]+\/confirmation/, { timeout: 60000 });
    pass(`الطلبُ تمّ — ${new URL(page.url()).pathname}`);

    errors.length === 0
      ? pass("ولا خطأَ جافاسكربت في المسار كلِّه")
      : fail(`أخطاءُ جافاسكربت أثناء الشراء: ${errors.join(" · ")}`);
  } catch (e) {
    fail(`سقط الشراءُ من المتصفّح: ${String(e.message).slice(0, 200)}`);
  } finally {
    await page.close();
  }
}


/**
 * حسابُ العميل — التسجيلُ والربطُ وحارسُ البريد (بند ٢١).
 *
 * ── ولماذا بـ`fetch` لا بمتصفّح ─────────────────────────────────
 *
 * الثلاثةُ التي تُفحص هنا **قراراتُ خادمٍ لا شاشات**: من يُربط بأيّ
 * حساب. والمتصفّحُ يُثبت أن الشاشةَ تعمل، ولا يُثبت أن سلّةَ ضيفٍ لم
 * تُربط بحساب غيره — وذاك ما يُخشى.
 */
async function accountChecks() {
  console.log("\n== 👤 حسابُ العميل ==");
  const api = process.env.MEDUSA_URL ?? "http://localhost:9000";
  const pk = process.env.MEDUSA_PK ?? process.env.NEXT_PUBLIC_MEDUSA_PK ?? "";
  const H = { "content-type": "application/json", "x-publishable-api-key": pk };

  const post = (path, body, token) =>
    fetch(`${api}${path}`, {
      method: "POST",
      headers: token ? { ...H, authorization: `Bearer ${token}` } : H,
      body: JSON.stringify(body ?? {}),
    });

  try {
    const email = `gate${Date.now()}@zadim.test`;
    const password = "Zadim#Gate12345";

    // ── التسجيل: ثلاث خطواتٍ لا واحدة ──────────────────────────
    const reg = await post("/auth/customer/emailpass/register", { email, password });
    const { token: regToken } = await reg.json();
    regToken ? pass("التسجيل أعاد رمزاً") : fail(`التسجيل أخفق (${reg.status})`);

    await post("/store/customers", { email, first_name: "بوّابة", last_name: "حساب" }, regToken);

    // 🔴 رمزُ التسجيل **لا يصلح** لقراءة الحساب قبل التجديد — قِيس 401.
    const before = await fetch(`${api}/store/customers/me`, {
      headers: { ...H, authorization: `Bearer ${regToken}` },
    });
    before.status === 401
      ? pass("ورمزُ التسجيل وحدَه لا يقرأ الحساب (401) — فالتجديدُ لازم")
      : fail(`المنتظَر 401 قبل التجديد ووصل ${before.status} — إن تغيّر فراجعْ register()`);

    const refreshed = await (await post("/auth/token/refresh", {}, regToken)).json();
    const token = refreshed.token;
    const me = await fetch(`${api}/store/customers/me`, {
      headers: { ...H, authorization: `Bearer ${token}` },
    });
    // ⚠️ جسمُ `Response` يُقرأ **مرّةً واحدة** — فيُحفظ لا يُعاد نداؤه.
    const meBody = await me.json().catch(() => ({}));
    const customerId = meBody?.customer?.id ?? null;
    me.status === 200 && customerId
      ? pass("وبعد التجديد يُقرأ الحساب (200)")
      : fail(`الحسابُ لا يُقرأ بعد التجديد (${me.status})`);

    // ── حارسُ البريد: ضيفٌ ببريد حسابٍ مسجَّل ⇒ يُرفض ───────────
    const regionRes = await fetch(`${api}/store/regions`, { headers: H });
    const regionId = (await regionRes.json()).regions?.[0]?.id;
    const newCart = async () =>
      (await (await post("/store/carts", { region_id: regionId })).json()).cart?.id;

    const ADDR = {
      first_name: "ضيف",
      last_name: "مجهول",
      phone: "0555888777",
      building_number: "1111",
      street: "شارع",
      district: "حيّ",
      city: "الرياض",
      postal_code: "11111",
      additional_number: "2222",
    };

    const cartGuest = await newCart();
    const hijack = await post(`/store/carts/${cartGuest}/address`, { ...ADDR, email });
    const hijackBody = await hijack.json().catch(() => ({}));
    hijack.status === 409 && hijackBody?.error?.code === "EMAIL_HAS_ACCOUNT"
      ? pass("ضيفٌ ببريد حسابٍ مسجَّل ⇒ EMAIL_HAS_ACCOUNT")
      : fail(
          `ضيفٌ ببريد حسابٍ مسجَّل مرّ (${hijack.status}) — ` +
            "وأثرُه أن طلبَه يدخل «طلباتي» عند صاحب الحساب، ويُفسد سجلَّ COD له."
        );

    // وشاهدٌ موجب: بريدٌ جديدٌ يمرّ — وإلا فالحارسُ يمنع الجميع
    const cartFresh = await newCart();
    const fresh = await post(`/store/carts/${cartFresh}/address`, {
      ...ADDR,
      email: `guest${Date.now()}@zadim.test`,
    });
    fresh.status === 200
      ? pass("وبريدٌ جديدٌ يمرّ — الحارسُ يمنع الحالةَ وحدَها لا الجميع")
      : fail(`ضيفٌ ببريدٍ جديدٍ رُفض (${fresh.status})`);

    // ── ولا يُقبل `customer_id` من الجسم ────────────────────────
    const cartSpoof = await newCart();
    await post(`/store/carts/${cartSpoof}/address`, {
      ...ADDR,
      email: `spoof${Date.now()}@zadim.test`,
      customer_id: customerId,
    });
    const spoofed = await (
      await fetch(`${api}/store/carts/${cartSpoof}?fields=%2Bcustomer_id`, { headers: H })
    ).json();
    // العميلُ الضيفُ يُنشأ من البريد، والمهمُّ ألّا يكون **حسابَ غيره**
    spoofed?.cart?.customer_id !== customerId
      ? pass("و`customer_id` في الجسم لا يربط سلّةً بحساب غيرِ صاحبها")
      : fail("سلّةٌ ارتبطت بحسابٍ عبر `customer_id` في الجسم");

    // ── 📒 دفترُ العناوين ────────────────────────────────────────
    console.log("\n== 📒 دفترُ العناوين ==");
    const BOOK = "/store/customers/me/national-addresses";
    const MINE = {
      first_name: "صاحب",
      last_name: "الحساب",
      phone: "0501234567",
      building_number: "2743",
      street: "طريق الملك فهد",
      district: "العليا",
      city: "الرياض",
      postal_code: "12212",
      additional_number: "6889",
    };

    // 🔴 بلا رمزٍ: لا تُقرأ القائمةُ أصلاً — وإلا قرأ الغريبُ عناوينَ
    // العملاء وهواتفَهم بنداءٍ واحد.
    const anon = await fetch(`${api}${BOOK}`, { headers: H });
    anon.status === 401
      ? pass("بلا رمزِ جلسة: القائمةُ لا تُقرأ (401)")
      : fail(`قائمةُ العناوين قُرئت بلا رمز (${anon.status}) — عناوينُ العملاء وهواتفُهم مكشوفة`);

    const emptyRes = await fetch(`${api}${BOOK}`, {
      headers: { ...H, authorization: `Bearer ${token}` },
    });
    const emptyBody = await emptyRes.json().catch(() => ({}));
    (emptyBody?.addresses ?? []).length === 0
      ? pass("وحسابٌ جديدٌ يبدأ بلا عناوين")
      : fail("حسابٌ جديدٌ وُجد له عنوان");

    const made = await post(BOOK, MINE, token);
    const madeBody = await made.json().catch(() => ({}));
    made.status === 201 && madeBody?.created === true && madeBody?.address?.id
      ? pass("وحفظُ عنوانٍ ينجح (201)")
      : fail(`حفظُ العنوان أخفق (${made.status})`);
    const addressId = madeBody?.address?.id;

    // أوّلُ عنوانٍ يصير الافتراضيَّ من نفسه.
    const listed = await (
      await fetch(`${api}${BOOK}`, { headers: { ...H, authorization: `Bearer ${token}` } })
    ).json();
    const one = (listed?.addresses ?? [])[0];
    one?.district === "العليا" && one?.additional_number === "6889"
      ? pass("ويُعاد **مهيكلاً** — الحيُّ والرقمُ الإضافيّ لا سطراً مركَّباً")
      : fail(`العنوانُ لا يُعاد مهيكلاً: ${JSON.stringify(one ?? null).slice(0, 120)}`);
    one?.is_default === true
      ? pass("وأوّلُ عنوانٍ افتراضيٌّ من نفسه")
      : fail("أوّلُ عنوانٍ لم يصر افتراضياً");

    // 🔴 والتكرارُ الصامت لا يُنشأ: كلُّ إتمامٍ يمرّ بنفس النموذج.
    const again = await post(BOOK, MINE, token);
    const againBody = await again.json().catch(() => ({}));
    againBody?.created === false && againBody?.address?.id === addressId
      ? pass("وعنوانٌ مطابقٌ لا يُنشأ مرّتين — ولا يُردّ بخطأ")
      : fail(`تكرارٌ صامتٌ أُنشئ: ${JSON.stringify(againBody?.created)}`);

    // وشاهدٌ سالب: عنوانٌ ناقصٌ يُرفض — فالمحفوظُ الناقصُ أسوأُ من
    // غياب الحفظ: يُختار من قائمةٍ ثم يُرفض الطلبُ عند آخر خطوة.
    const bad = await post(BOOK, { ...MINE, postal_code: "123" }, token);
    bad.status === 400
      ? pass("وشاهدُه السالب: رمزٌ بريديٌّ من ثلاثة أرقام يُرفض")
      : fail(`عنوانٌ ناقصٌ حُفظ (${bad.status})`);

    // 🔴 وعنوانُ غيره لا يُحذف — ويُردّ ٤٠٤ لا ٤٠٣ كي لا يُخبَر
    // المخمّنُ أن المعرّفَ صحيح.
    const other = await post("/auth/customer/emailpass/register", {
      email: `other${Date.now()}@zadim.test`,
      password,
    });
    const otherReg = (await other.json())?.token;
    await post("/store/customers", { email: `other${Date.now()}@zadim.test` }, otherReg);
    const otherToken = (await (await post("/auth/token/refresh", {}, otherReg)).json())?.token;

    const steal = await fetch(`${api}${BOOK}/${addressId}`, {
      method: "DELETE",
      headers: { ...H, authorization: `Bearer ${otherToken}` },
    });
    steal.status === 404
      ? pass("وعنوانُ غيره لا يُحذف — و٤٠٤ لا ٤٠٣، فلا يُخبَر المخمّنُ أن المعرّفَ صحيح")
      : fail(`عميلٌ آخرُ حذف عنوانَ غيره (${steal.status})`);

    const stillThere = await (
      await fetch(`${api}${BOOK}`, { headers: { ...H, authorization: `Bearer ${token}` } })
    ).json();
    (stillThere?.addresses ?? []).length === 1
      ? pass("والعنوانُ باقٍ فعلاً بعد المحاولة — لا رفضٌ في الرد وحذفٌ في القاعدة")
      : fail("العنوانُ اختفى رغم ردّ ٤٠٤");

    // وصاحبُه يحذفه.
    const gone = await fetch(`${api}${BOOK}/${addressId}`, {
      method: "DELETE",
      headers: { ...H, authorization: `Bearer ${token}` },
    });
    gone.status === 200
      ? pass("وصاحبُه يحذفه (200) — الحارسُ يمنع الغريبَ لا المالك")
      : fail(`صاحبُ العنوان لم يستطع حذفَه (${gone.status})`);
  } catch (e) {
    fail(`سقطت فحوصُ الحساب: ${String(e.message).slice(0, 160)}`);
  }
}

try {
  for (const loc of LOCALES)
  for (const [rawPath, label] of PAGES) {
    const path = `/${loc.code}${rawPath}`;
    console.log(`\n== ${label} — ${loc.label} (${path}) ==`);
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 140)));

    let response;
    try {
      response = await page.goto(BASE + path, {
        waitUntil: "networkidle",
        timeout: 45000,
      });
    } catch (e) {
      fail(`تعذّر فتحُ الصفحة: ${String(e.message).slice(0, 120)}`);
      await page.close();
      continue;
    }

    (response?.status() ?? 0) < 400
      ? pass(`فتحت (${response.status()})`)
      : fail(`الحالة ${response?.status()}`);

    // ── الاتجاه واللغة ───────────────────────────────────────────
    const root = await page.evaluate(() => ({
      dir: document.documentElement.getAttribute("dir"),
      lang: document.documentElement.getAttribute("lang"),
      computedDir: getComputedStyle(document.body).direction,
    }));

    root.dir === loc.dir && root.computedDir === loc.dir
      ? pass(`الاتجاه ${loc.dir} على الجذر وعلى الجسم المحسوب`)
      : fail(`الاتجاه: dir=${root.dir} computed=${root.computedDir} — المنتظَر ${loc.dir}`);

    // 🔴 و`lang` ليست زينةً ولا تُقاس بـ«يبدأ بـ»: قارئُ الشاشة يختار
    // صوتَه منها، ومحرّكُ البحث يفهرس بها. و`lang="ar"` على صفحةٍ
    // إنجليزيةٍ يُنطَق الإنجليزيُّ بلكنةٍ عربيةٍ حرفاً حرفاً.
    root.lang === loc.code
      ? pass(`اللغة ${root.lang}`)
      : fail(`اللغة ${root.lang} — المنتظَر ${loc.code}`);

    // ── الصفوفُ الفيزيائية في كل عنصرٍ مرسوم ────────────────────
    const offenders = await page.evaluate((re) => {
      const rx = new RegExp(re);
      const out = [];
      for (const el of document.querySelectorAll("*")) {
        const cls = typeof el.className === "string" ? el.className : "";
        if (!cls) continue;
        for (const c of cls.split(/\s+/)) {
          if (rx.test(" " + c)) out.push({ tag: el.tagName.toLowerCase(), cls: c });
        }
      }
      return out.slice(0, 40);
    }, PHYSICAL.source);

    const real = offenders.filter((o) => !ALLOWED_PHYSICAL.has(o.cls));
    real.length === 0
      ? pass("ولا صفَّ اتجاهيّاً فيزيائياً (ml/mr/left/right) في أيّ عنصرٍ مرسوم")
      : fail(
          `${real.length} صفّاً فيزيائياً — أوّلُها: ${real
            .slice(0, 5)
            .map((o) => `${o.tag}.${o.cls}`)
            .join(" · ")}`
        );

    // ── لغةُ النصّ المرسوم ──────────────────────────────────────
    const text = (await page.innerText("body")).trim();

    if (loc.wantArabic) {
      ARABIC.test(text)
        ? pass("والصفحةُ تحمل نصّاً عربياً")
        : fail("لا حرفَ عربيٍّ في الصفحة — الواجهةُ ليست معرَّبة");
    } else {
      // 🔴 **هنا يُفصل «واجهةٌ مترجَمة» عن «متجرٌ بلغتين».**
      //
      // ترجمةُ الأزرار سهلةٌ ولا تُثبت شيئاً: عناوينُ المنتجات وكتلُ
      // الرئيسية في القاعدة **بالعربية**. فصفحةٌ إنجليزيةُ الهيكل
      // عربيةُ المحتوى تمرّ في كل فحصٍ لا يقرأ نصَّها المرسوم.
      //
      // والمقياسُ لا يقبل التجزئة: **ولا حرفَ عربيٍّ في الصفحة كلِّها**
      // — لا في الترويسة ولا في اسم المنتج ولا في نصّ الكتلة.
      //
      // ── واستثناءان **معلَنان في الصفحة نفسها** لا في هذا الملفّ ──
      //
      // ١) `lang="ar"` — نصٌّ يُصرّح أنه عربيّ، كاسم اللغة في
      //    المبدّل. وهو صحّةُ HTML قبل أن يكون استثناء.
      // ٢) `data-user-content` — ما كتبه الزائرُ نفسُه (استعلامُ
      //    البحث). وترجمتُه أو إخفاؤه عطلٌ لا إصلاح.
      //
      // 🔴 وأن يكون الاستثناءُ **في الصفحة** لا في الفاحص مقصود: قائمةٌ
      // بيضاءُ هنا تُسكِت عطلاً حقيقياً بسطرٍ واحدٍ لا يراه أحد. أمّا
      // `lang="ar"` فقرارٌ مكتوبٌ في الشيفرة، يُراجَع في `git diff`،
      // ويحمل معناه للقارئ الآليّ أيضاً — فثمنُ إساءة استعماله ظاهر.
      const arabicNodes = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const out = [];
        const rx = /[؀-ۿ]/;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const value = (n.nodeValue ?? "").trim();
          if (!value || !rx.test(value)) continue;
          // `script`/`style`/`template` نصوصٌ لا تُعرض: بيانات Next
          // المتسلسلة تحمل نصَّ الصفحة العربيَّ داخل `<script>`،
          // وليست شيئاً يقرؤه الزائر.
          if (n.parentElement?.closest("script, style, template, noscript")) continue;

          let declared = false;
          for (let el = n.parentElement; el; el = el.parentElement) {
            if (el.hasAttribute("data-user-content")) { declared = true; break; }
            const lang = el.getAttribute("lang");
            if (lang) { declared = lang.startsWith("ar"); break; }
          }
          if (!declared) out.push(value.slice(0, 60));
        }
        return out;
      });

      arabicNodes.length === 0
        ? pass("ولا حرفَ عربيٍّ غيرَ معلَنٍ في الصفحة — الهيكلُ والمحتوى كلاهما إنجليزيّ")
        : fail(
            `${arabicNodes.length} نصّاً عربياً في صفحةٍ إنجليزية — ` +
              `أوّلُها: ${arabicNodes.slice(0, 3).map((l) => `«${l}»`).join(" · ")}`
          );

      // 🔴 **شاهدٌ موجبٌ على الصفحة الحقيقية.**
      //
      // «صفرُ مخالفات» جوابُ فاحصٍ سليمٍ وجوابُ فاحصٍ لا يرى — وقد
      // وقع هذا مرّتين في هذا المشروع. فيُدسّ نصٌّ عربيٌّ بلا `lang`
      // في الصفحة المرسومة نفسِها: إن لم يُمسَك فالخضرةُ أعلاه لا
      // تعني شيئاً، ويسقط الفحص.
      const caught = await page.evaluate(() => {
        const bait = document.createElement("span");
        bait.textContent = "طُعمُ البوّابة";
        document.body.appendChild(bait);
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const rx = /[؀-ۿ]/;
        let seen = false;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!rx.test(n.nodeValue ?? "")) continue;
          if (n.parentElement?.closest("script, style, template, noscript")) continue;
          let declared = false;
          for (let el = n.parentElement; el; el = el.parentElement) {
            if (el.hasAttribute("data-user-content")) { declared = true; break; }
            const lang = el.getAttribute("lang");
            if (lang) { declared = lang.startsWith("ar"); break; }
          }
          if (!declared && n.nodeValue.includes("طُعم")) seen = true;
        }
        bait.remove();
        return seen;
      });

      caught
        ? pass("وشاهدُه الموجب: طُعمٌ عربيٌّ بلا `lang` أُمسِك — فالفاحصُ يرى")
        : fail("الطُّعمُ العربيُّ لم يُمسَك — فحصُ العربية أعمى، وخضرتُه لا تعني شيئاً");
    }

    // ── 🔴 ولا مفتاحَ ترجمةٍ خامٍ مرئيّ ─────────────────────────
    const rawKeys = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && RAW_KEY.test(l) && !NOT_A_KEY.test(l));

    rawKeys.length === 0
      ? pass("ولا مفتاحَ ترجمةٍ خامٍ على الشاشة")
      : fail(
          `مفاتيحُ خامٌ مرئية: ${rawKeys.slice(0, 3).map((l) => `«${l.slice(0, 40)}»`).join(" · ")}`
        );

    // شاشةٌ فارغةٌ ليست نجاحاً: صفحةٌ تُفتح ولا تعرض شيئاً عطلٌ صامت.
    text.length > 40
      ? pass(`ومحتوىً ظاهر (${text.length} حرفاً)`)
      : fail(`الصفحةُ شبهُ فارغة (${text.length} حرفاً)`);

    pageErrors.length === 0
      ? pass("ولا خطأَ في وحدة التحكّم")
      : fail(`أخطاءُ متصفّح: ${pageErrors.slice(0, 2).join(" | ")}`);

    // ── قياسُ الرسم ─────────────────────────────────────────────
    const vitals = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const out = { lcp: 0, cls: 0, fcp: 0 };
          const fcpEntry = performance
            .getEntriesByType("paint")
            .find((e) => e.name === "first-contentful-paint");
          out.fcp = Math.round(fcpEntry?.startTime ?? 0);

          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) out.lcp = Math.round(e.startTime);
          }).observe({ type: "largest-contentful-paint", buffered: true });

          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) if (!e.hadRecentInput) out.cls += e.value;
          }).observe({ type: "layout-shift", buffered: true });

          setTimeout(() => resolve(out), 1500);
        })
    );

    console.log(
      `     FCP ${vitals.fcp}ms · LCP ${vitals.lcp}ms · CLS ${vitals.cls.toFixed(3)}`
    );

    // العتباتُ عتباتُ Google للويب الحيويّ — وهي **ليست درجةَ
    // Lighthouse**، ويُقال ذلك صراحةً بدل أن يُوهم رقمٌ بآخر.
    vitals.lcp > 0 && vitals.lcp <= 2500
      ? pass(`LCP ضمن الحدّ (${vitals.lcp}ms ≤ 2500)`)
      : fail(`LCP ${vitals.lcp}ms — الحدُّ ٢٥٠٠`);

    vitals.cls <= 0.1
      ? pass(`CLS ضمن الحدّ (${vitals.cls.toFixed(3)} ≤ 0.1)`)
      : fail(`CLS ${vitals.cls.toFixed(3)} — الحدُّ 0.1`);

    await page.close();
  }

  // ── الرئيسيةُ تتبع ترتيبَ القاعدة لا ترتيبَ الكود ──────────────
  //
  // هذا هو الوجهُ الآخرُ لبوّابة «الترتيب يتغيّر من اللوحة»: الخلفيّةُ
  // تُعيد ترتيباً، **والواجهةُ يجب أن تعرضه كما جاء**. وواجهةٌ ترتّب
  // بنفسها تجعل البوّابةَ خضراءَ في الخلفية وكاذبةً على الشاشة.
  // ⚠️ **ومفتاحُ النشر ليس تفصيلاً.** كان هذا النداءُ بلا ترويسة
  // `x-publishable-api-key`، فيردّ Medusa بـ٤٠٠ «Publishable API key
  // required» — و`res.ok` كاذبةٌ فيمرّ الشرطُ كلُّه **بلا سطرٍ واحدٍ
  // في التقرير**. فكانت أهمُّ مقارنةٍ في هذه البوّابة تُتخطّى صامتةً،
  // والتقريرُ يُختم بـ«اجتازت». وفحصٌ لا يعمل ولا يقول إنه لم يعمل
  // أخطرُ من غياب الفحص.
  //
  // فصار: المفتاحُ يُرسَل · وردٌّ غيرُ سليمٍ **سقوطٌ** لا صمت · وتعذّرُ
  // الوصول **سقوطٌ** أيضاً، لأن هذه البوّابةَ لا معنى لها بلا خلفيّة.
  const api = process.env.MEDUSA_URL ?? "http://localhost:9000";
  const pk = process.env.MEDUSA_PK ?? process.env.NEXT_PUBLIC_MEDUSA_PK ?? "";

  for (const loc of LOCALES) {
    console.log(`\n== الرئيسيةُ تتبع القاعدة — ${loc.label} ==`);
    try {
      const suffix = loc.code === "ar" ? "" : `?locale=${loc.code}`;
      const res = await fetch(`${api}/store/home${suffix}`, {
        headers: pk ? { "x-publishable-api-key": pk } : {},
      });
      if (!res.ok) {
        fail(
          `‏/store/home أعاد ${res.status}` +
            (res.status === 400 && !pk ? " — مفتاحُ النشر مفقود: صدّر `MEDUSA_PK`" : "")
        );
        continue;
      }
      const { blocks } = await res.json();
      if (blocks.length < 2) {
        fail(`القاعدةُ فيها ${blocks.length} كتلة — والمقارنةُ تحتاج اثنتين فأكثر`);
        continue;
      }

      const page = await ctx.newPage();
      await page.goto(`${BASE}/${loc.code}/`, { waitUntil: "networkidle" });
      const rendered = await page.$$eval("[data-block-type]", (els) =>
        els.map((e) => e.getAttribute("data-block-type"))
      );
      await page.close();

      if (rendered.length === 0) {
        fail("لا عنصرَ يحمل `data-block-type` — أضِفه في مُصيِّر الكتل كي يُفحص الترتيب");
        continue;
      }
      const expected = blocks.map((b) => b.type).join(" ⇐ ");
      const actual = rendered.join(" ⇐ ");
      expected === actual
        ? pass(`الترتيبُ المرسوم يطابق القاعدة (${blocks.length} كتلة): ${actual}`)
        : fail(`القاعدة: ${expected} · المرسوم: ${actual}`);

      // 🔴 **والدليلُ القاطع على أن المحتوى بيانات**: نصُّ الكتلة في
      // `/en` هو ما تُعيده القاعدةُ لـ`?locale=en` — لا نصٌّ ثابتٌ في
      // الواجهة ولا ترجمةٌ في الكود.
      if (loc.code === "en") {
        const heroTitle = blocks.find((b) => b.type === "hero")?.payload?.title ?? "";
        heroTitle && !ARABIC.test(heroTitle)
          ? pass(`وعنوانُ الواجهة من القاعدة إنجليزيّ: «${heroTitle}»`)
          : fail(
              `عنوانُ الواجهة في «/store/home?locale=en» «${heroTitle}» — ` +
                `المحتوى لا يُترجَم، والواجهةُ وحدَها هي المترجَمة`
            );
      }
    } catch (e) {
      fail(`تعذّر الوصولُ إلى ${api}/store/home (${String(e.message).slice(0, 60)})`);
    }
  }

  // ── الجذرُ بلا لغةٍ يحوّل، والمبدّلُ يحفظ المسار ────────────────
  //
  // ⚠️ زائرٌ يفتح `/` أو رابطاً قديماً بلا بادئةٍ يجب ألّا يرى ٤٠٤:
  // بادئةُ اللغة تفصيلٌ داخليّ، وروابطُ ما قبل المرحلة ١١ب لا تزال
  // تُشارَك.
  console.log("\n== التحويلُ ومبدّلُ اللغة ==");
  try {
    const page = await ctx.newPage();
    const res = await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const url = new URL(page.url());
    url.pathname.startsWith("/ar")
      ? pass(`«/» يحوّل إلى ${url.pathname} — والعربيةُ الافتراضية`)
      : fail(`«/» انتهى إلى ${url.pathname} (${res?.status()})`);

    // ومبدّلُ اللغة رابطٌ حقيقيّ يحفظ المسار: زائرٌ في صفحة منتجٍ
    // يبدّل اللغة فيبقى في نفس المنتج، لا يُقذف إلى الرئيسية.
    await page.goto(`${BASE}/ar/p/zadim-headphones`, { waitUntil: "networkidle" });
    const href = await page.getAttribute('a[href*="/en/"]', "href").catch(() => null);
    href === "/en/p/zadim-headphones"
      ? pass(`ومبدّلُ اللغة يحفظ المسار: ${href}`)
      : fail(`مبدّلُ اللغة يشير إلى «${href}» لا إلى «/en/p/zadim-headphones»`);
    await page.close();
  } catch (e) {
    fail(`تعذّر فحصُ التحويل (${String(e.message).slice(0, 80)})`);
  }

  // ── Lighthouse إن طُلب وكان مثبَّتاً ───────────────────────────
  if (WANT_LH) {
    console.log("\n== Lighthouse ==");
    // ⚠️ **Lighthouse لا يقود متصفّحَ Playwright.** يحتاج Chrome بمنفذِ
    // تنقيحٍ مفتوح يتّصل به. وكان يُنادى بـ`port: undefined` فيحاول
    // الاتّصال بمنفذٍ لا أحدَ عليه ويسقط بـ«Failed to fetch browser
    // webSocket URL» — وتُقرأ الرسالةُ «غيرُ مثبَّت» وهو مثبَّت. فيُقلَع
    // له متصفّحٌ خاصٌّ به على نفس ثنائيّة Chromium، ويُقتل بعده.
    let chrome = null;
    try {
      const { default: lighthouse } = await import("lighthouse");
      const chromeLauncher = await import("chrome-launcher");

      // ونفسُ ثنائيّة Playwright تُعطى لـLighthouse: `chromium.executablePath()`
      // يُعيد ما أقلعناه فعلاً، فلا يُقاس على متصفّحٍ آخرَ في النظام —
      // ولا يُشترط وجودُ Chrome مثبَّتاً في الجهاز أصلاً.
      chrome = await chromeLauncher.launch({
        chromePath: chromiumPath ?? chromium.executablePath(),
        chromeFlags: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage"],
      });

      // 🔴 **والدرجةُ تُقاس على اللغتين، والعتبةُ ٩٠ لكلٍّ.**
      //
      // ليستا صفحةً واحدة: الاتجاهُ ينقلب فيتغيّر التخطيط، والنصُّ
      // الإنجليزيُّ أطولُ فيزيح ما تحته (CLS)، والخطُّ قد يختلف
      // فيتغيّر LCP. ودرجةٌ عربيةٌ خضراءُ لا تقول شيئاً عن `/en`.
      // 🔴 **درجةُ الأداء وسيطُ ثلاث تشغيلات، لا تشغيلةً واحدة.**
      //
      // قِيس على نفس البناء بلا تغييرِ سطر: `ar 89 · en 97` ثم
      // `ar 93 · en 89`. فالفرقُ ضجيجُ آلةٍ مزدحمة لا فرقٌ بين لغتين
      // — والدليلُ أن الساقطَ تبدّل بينهما.
      //
      // وبوّابةٌ تسقط عشوائياً نصفَ الوقت لا تحرس شيئاً بل **تُعلّم
      // قارئَها تجاهلَ الأحمر**، وهو ما تحذّر منه ورشةُ CI نفسُها في
      // فحص صحّة Postgres. والوسيطُ ما يوصي به Lighthouse لهذا
      // بالضبط — **والعتبةُ تبقى ٩٠**، لا تُخفَّض لتمرّ.
      //
      // وبقيةُ الفئات (الوصول · الممارسات · SEO) حتميّةٌ لا تتذبذب،
      // فتُقاس من التشغيلة الأولى ولا تُكرَّر.
      const RUNS = 3;
      for (const loc of LOCALES) {
        const target = `${BASE}/${loc.code}`;
        const perf = [];
        let first = null;

        for (let i = 0; i < RUNS; i++) {
          const result = await lighthouse(target, {
            port: chrome.port,
            output: "json",
            formFactor: "mobile",
            screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 3 },
            onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
          });
          first ??= result.lhr.categories;
          perf.push(Math.round(result.lhr.categories.performance.score * 100));
        }

        const median = [...perf].sort((a, b) => a - b)[Math.floor(RUNS / 2)];
        console.log(`  — ${loc.label} (${target}) · الأداء: ${perf.join(" · ")}`);

        median >= 90
          ? pass(`Performance (وسيط ${RUNS}): ${median}`)
          : fail(`Performance [${loc.code}] (وسيط ${RUNS}): ${median} — الحدُّ ٩٠`);

        for (const [key, cat] of Object.entries(first)) {
          if (key === "performance") continue;
          const score = Math.round(cat.score * 100);
          score >= 90
            ? pass(`${cat.title}: ${score}`)
            : fail(`${cat.title} [${loc.code}]: ${score} — الحدُّ ٩٠`);
        }
      }
    } catch (e) {
      // ولا يُدَّعى نجاحٌ لم يقع: سقوطُ القياس يُقال بسببه، ولا يُعدّ مروراً.
      fail(
        `تعذّر قياسُ Lighthouse (${String(e.message).slice(0, 90)}) — ` +
          `والقياساتُ أعلاه **ليست درجةَ Lighthouse**.`
      );
    } finally {
      await chrome?.kill();
    }
  } else {
    console.log(
      "\n  ℹ️  القياساتُ أعلاه LCP/CLS خام — **وليست درجةَ Lighthouse**. " +
        "للدرجة: أضِف `--lighthouse`."
    );
  }

  await filterChecks(ctx);
  await buyOnce(ctx);
  await accountChecks();
} finally {
  await browser.close();
}

if (failures) {
  console.error(`\n⛔ سقط ${failures} فحصاً من فحوص الواجهة.`);
  process.exit(1);
}
console.log("\n✅ فحوصُ الواجهة اجتازت.");
