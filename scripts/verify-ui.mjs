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
  console.log("\n== الرئيسيةُ تتبع القاعدة ==");
  try {
    const res = await fetch(`${api}/store/home`, {
      headers: pk ? { "x-publishable-api-key": pk } : {},
    });
    if (!res.ok) {
      fail(
        `‏/store/home أعاد ${res.status}` +
          (res.status === 400 && !pk
            ? " — مفتاحُ النشر مفقود: صدّر `MEDUSA_PK`"
            : "")
      );
    } else {
      const { blocks } = await res.json();
      if (blocks.length < 2) {
        fail(`القاعدةُ فيها ${blocks.length} كتلة — والمقارنةُ تحتاج اثنتين فأكثر`);
      } else {
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
            ? pass(`الترتيبُ المرسوم يطابق القاعدة (${blocks.length} كتلة): ${actual}`)
            : fail(`القاعدة: ${expected} · المرسوم: ${actual}`);
        }
      }
    }
  } catch (e) {
    fail(`تعذّر الوصولُ إلى ${api}/store/home (${String(e.message).slice(0, 60)})`);
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

      const result = await lighthouse(BASE, {
        port: chrome.port,
        output: "json",
        formFactor: "mobile",
        screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 3 },
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      });
      for (const [, cat] of Object.entries(result.lhr.categories)) {
        const score = Math.round(cat.score * 100);
        score >= 90
          ? pass(`${cat.title}: ${score}`)
          : fail(`${cat.title}: ${score} — الحدُّ ٩٠`);
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
} finally {
  await browser.close();
}

if (failures) {
  console.error(`\n⛔ سقط ${failures} فحصاً من فحوص الواجهة.`);
  process.exit(1);
}
console.log("\n✅ فحوصُ الواجهة اجتازت.");
