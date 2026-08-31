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

const BASE = process.argv[2] ?? "http://localhost:3000";
const WANT_LH = process.argv.includes("--lighthouse");

/** المسارُ الذي يُفحص، واسمُه العربيّ في التقرير. */
const PAGES = [
  ["/", "الرئيسية"],
  ["/search?q=سماعة", "البحث"],
  ["/cart", "السلة"],
];

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

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

// شاشةُ جوّالٍ حقيقية: البوّابة تقول «على الجوال»، وقياسُ سطحِ مكتبٍ
// عريضٍ يُعطي رقماً أجمل لا أصدق.
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: "ar-SA",
});

try {
  for (const [path, label] of PAGES) {
    console.log(`\n== ${label} (${path}) ==`);
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

    root.dir === "rtl" && root.computedDir === "rtl"
      ? pass("الاتجاه rtl على الجذر وعلى الجسم المحسوب")
      : fail(`الاتجاه: dir=${root.dir} computed=${root.computedDir}`);

    String(root.lang ?? "").startsWith("ar")
      ? pass(`اللغة ${root.lang}`)
      : fail(`اللغة ${root.lang} — والقارئُ الآليّ يقرؤها إنجليزيةً`);

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

    // ── نصٌّ عربيٌّ فعلاً ────────────────────────────────────────
    const text = (await page.innerText("body")).trim();
    /[؀-ۿ]/.test(text)
      ? pass("والصفحةُ تحمل نصّاً عربياً")
      : fail("لا حرفَ عربيٍّ في الصفحة — الواجهةُ ليست معرَّبة");

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
  const api = process.env.MEDUSA_URL ?? "http://localhost:9000";
  try {
    const res = await fetch(`${api}/store/home`);
    if (res.ok) {
      const { blocks } = await res.json();
      console.log(`\n== الرئيسيةُ تتبع القاعدة (${blocks.length} كتلة) ==`);
      if (blocks.length >= 2) {
        const page = await ctx.newPage();
        await page.goto(BASE + "/", { waitUntil: "networkidle" });
        const rendered = await page.$$eval("[data-block-type]", (els) =>
          els.map((e) => e.getAttribute("data-block-type"))
        );
        await page.close();

        if (rendered.length === 0) {
          fail(
            "لا عنصرَ يحمل `data-block-type` — أضِفه في مُصيِّر الكتل كي يُفحص الترتيب"
          );
        } else {
          const expected = blocks.map((b) => b.type).join(" ⇐ ");
          const actual = rendered.join(" ⇐ ");
          expected === actual
            ? pass(`الترتيبُ المرسوم يطابق القاعدة: ${actual}`)
            : fail(`القاعدة: ${expected} · المرسوم: ${actual}`);
        }
      } else {
        console.log("  ⏭️  كتلتان فأقلّ — لا معنى لفحص الترتيب");
      }
    }
  } catch {
    console.log("\n  ⏭️  تعذّر الوصولُ إلى /store/home — يُفحص الترتيبُ حين يعمل الخادم");
  }

  // ── Lighthouse إن طُلب وكان مثبَّتاً ───────────────────────────
  if (WANT_LH) {
    console.log("\n== Lighthouse ==");
    try {
      const { default: lighthouse } = await import("lighthouse");
      const result = await lighthouse(BASE, {
        port: undefined,
        output: "json",
        formFactor: "mobile",
        screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 3 },
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      });
      for (const [key, cat] of Object.entries(result.lhr.categories)) {
        const score = Math.round(cat.score * 100);
        score >= 90
          ? pass(`${cat.title}: ${score}`)
          : fail(`${cat.title}: ${score} — الحدُّ ٩٠`);
      }
    } catch (e) {
      // ولا يُدَّعى نجاحٌ لم يقع: غيابُ الأداة يُقال، ولا يُعدّ مروراً.
      fail(
        `Lighthouse غيرُ مثبَّت (${String(e.message).slice(0, 60)}) — ` +
          `ثبّته بـ\`npm i -D lighthouse\`. والقياساتُ أعلاه **ليست درجةَ Lighthouse**.`
      );
    }
  } else {
    console.log(
      "\n  ℹ️  القياساتُ أعلاه LCP/CLS خام — **وليست درجةَ Lighthouse**. " +
        "للدرجة: أضِف `--lighthouse`."
    );
  }
} finally {
  await browser.close();
}

if (failures) {
  console.error(`\n⛔ سقط ${failures} فحصاً من فحوص الواجهة.`);
  process.exit(1);
}
console.log("\n✅ فحوصُ الواجهة اجتازت.");
