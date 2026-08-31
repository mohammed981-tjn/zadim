import { loadEnv, defineConfig, Modules } from "@medusajs/framework/utils";
import { discoverCarriers } from "./src/modules/carriers/discover";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

/**
 * إعداد خادم التجارة (ADR-001: Medusa v2 أساساً، ووحداتُنا فوقه).
 *
 * القاعدة هنا: **لا سرَّ في هذا الملف**. كلُّ مفتاحٍ يُقرأ من البيئة،
 * والملفّ يُدفع إلى مستودعٍ عامّ. وما لا قيمةَ افتراضيةَ آمنةً له
 * (JWT_SECRET · COOKIE_SECRET) **يُسقط الإقلاع في الإنتاج** بدل أن
 * يعمل بقيمةٍ معروفةٍ للجميع — الفشلُ الصاخب أأمنُ من التشغيل الصامت.
 */

const isProduction = process.env.NODE_ENV === "production";

function requiredInProduction(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) {
    throw new Error(
      `[zadim] ${name} غير مضبوط. لا يُقلع الخادم في الإنتاج بسرٍّ افتراضي.`
    );
  }
  return devFallback;
}

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,

    // 🔴 مخطَّطٌ خاصٌّ بنا لا `public` — وهذا القرار **لا يُؤجَّل**
    // (ADR-009). نحن نسكن مشروع Supabase مشتركاً مع AdCraft لأن الخطة
    // المجانية تسمح بمشروعين اثنين. والمخطَّطُ المنفصل هو الفرقُ بين
    // «نقلٌ بأمرٍ واحد» يوم الترقية و«فرزُ جداولَ متداخلة» في قاعدةٍ حيّة.
    databaseSchema: process.env.DATABASE_SCHEMA || "zadim",
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS || "http://localhost:8000",
      adminCors: process.env.ADMIN_CORS || "http://localhost:9000",
      authCors: process.env.AUTH_CORS || "http://localhost:9000",
      jwtSecret: requiredInProduction("JWT_SECRET", "dev-only-jwt-secret"),
      cookieSecret: requiredInProduction("COOKIE_SECRET", "dev-only-cookie-secret"),
    },
  },

  admin: {
    // لوحة Medusa الإدارية. مركزُ القيادة الكامل (بند ٢٩) يُبنى في
    // المرحلة ٨؛ وهذه تكفي لإدارة الكتالوج والطلبات حتى ذلك الحين.
    //
    // ويُعطَّل عرضُها بمفتاحِ بيئة لأن **نُسَخ العامل** (التي تشغّل
    // الطوابير والمهامّ المجدولة) لا تخدم واجهةً أصلاً، ومحاولتُها
    // تحميلَ حزمةِ اللوحة تُسقط إقلاعَها. والافتراضُ مفعَّل.
    disable: process.env.MEDUSA_ADMIN_DISABLED === "true",
  },

  modules: [
    // ── وحداتُنا نحن ────────────────────────────────────────────────
    // ما لا يقدّمه Medusa ولا مفرّ من كتابته (00-decisions.md §ADR-001):
    // access (RBAC + سجلّ التدقيق) · wms · purchasing · loyalty · cms ·
    // finance/ZATCA · marketplace.
    //
    // المرحلة ١ تبدأ بـ access وحدها — بند ٤٥ وبند ٤٦.
    { resolve: "./src/modules/access" },

    // المرحلة ٢: الخصائص والفلاتر المتولّدة وتطبيعُ العربية ومرادفاتُ
    // البحث — ما لا تقدّمه وحدةُ منتجات Medusa.
    { resolve: "./src/modules/catalog" },

    // ثوابتُ القاعدة التي تعبر حدود الوحدات — أهمُّها منعُ البيع الزائد
    // بقيدٍ على `inventory_level` (جدولُ Medusa، وفيه صفرُ قيودِ فحصٍ
    // أصلاً). انظر migrations/Migration20260901000001.ts.
    { resolve: "./src/modules/integrity" },

    // المرحلة ٣: ما لا تحفظه وحدةُ مخزون Medusa — ملفُّ المستودع الذي
    // يقرّر «من أين يُشحن»، ودفترُ الحركات الذي يجيب «من أين نقصت»،
    // وحدُّ تنبيه النفاد بياناتٍ لا رقماً في الكود.
    { resolve: "./src/modules/warehouse" },

    // المرحلة ٤: ما تفتقده سلّةُ Medusa — لحظةُ العرض التي يُقاس منها
    // «تغيّر السعر»، وحارسُ التكرار الذي يمنع طلبين من ضغطتين.
    { resolve: "./src/modules/checkout" },

    // المرحلة ٥: آلةُ حالات الطلب جدولَ بياناتٍ يقرؤه مُطلِقٌ في القاعدة،
    // وصندوقُ أحداثٍ يُكتب في نفس معاملة التغيّر، وحرمةُ الفاتورة.
    { resolve: "./src/modules/orders" },

    // ── الشحن ───────────────────────────────────────────────────────
    // 🔴 **لا اسمَ ناقلٍ هنا.** المحوّلاتُ تُقرأ من مجلَّدها
    // (`src/modules/carriers/`)، فإضافةُ ناقلٍ ثانٍ **لا تعدّل هذا
    // الملفّ ولا غيرَه** — وهو نصُّ بوّابة المرحلة ٧. وسطرٌ واحدٌ باسمٍ
    // هنا يكفي ليصير الوعدُ كذبةً صغيرة، ثم تكبر.
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          // `manual_manual` يبقى: تستعمله البذرةُ والبوّابات، وهو
          // مزوّدُ Medusa الافتراضيّ لا ناقلٌ من عندنا.
          { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
          ...discoverCarriers(),
        ],
      },
    },

    // ── الدفع ───────────────────────────────────────────────────────
    // **الدفعُ عند الاستلام مزوّدٌ كامل الحقوق** لا استثناء
    // (`06-saudi-layer.md` §٢). وهو الوحيدُ الذي يمكن بناؤه اليوم:
    // مدى وApple Pay وتابي وتمارا كلُّها تحتاج حسابَ تاجرٍ ومفاتيحَ
    // إنتاج، **ولا تُبنى بمفتاحٍ وهميّ** (بند ٤٨).
    //
    // ⚠️ ومزوّدُ النظام (`pp_system_default`) يبقى: تستعمله بوّاباتُ
    // الفحص، وهو **ليس وسيلةَ دفعٍ للعملاء** — يُنزع يوم يصل أوّلُ
    // مزوّدٍ حقيقيّ.
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [{ resolve: "./src/modules/cod-payment", id: "cod" }],
      },
    },

    // المرحلة ٦: سياسةُ COD ورفضاتُه، وحارسُ تكرار العمليات المالية.
    { resolve: "./src/modules/payments" },

    // المرحلة ٩: الرئيسيةُ كتلاً في القاعدة — ترتيبُها يتغيّر من اللوحة
    // بلا نشرِ كود، وهو نصُّ البوّابة.
    { resolve: "./src/modules/cms" },

    // المرحلة ٨: الدفعاتُ وتراجعُها — والقيمُ القديمة تُحفظ قبل الكتابة
    // لا بعدها، وإلا صار «التراجع» كتابةَ ما هو مكتوب.
    { resolve: "./src/modules/bulk" },

    // 🔴 المرحلة ١٠: **الراجعُ يدخل الحجرَ لا الرفّ.** والحرّاسُ في
    // القاعدة على `return` و`return_item` و`inventory_level` — جداولٌ لا
    // نملكها، والطرقُ إليها كثيرة.
    { resolve: "./src/modules/returns" },

    // المرحلة ٧: اللقطُ والتغليفُ والتتبّع — ما لا تعرفه وحدةُ تنفيذ
    // Medusa: من يلقط، وبأيّ ترتيبٍ يمشي، وماذا مسح.
    { resolve: "./src/modules/fulfilment" },

    // 🔴 الفوترةُ الإلكترونية — **تُصمَّم اليوم لأن تأجيلها إعادةُ بناء**
    // (`06-saudi-layer.md` §١): سلسلةُ الفواتير لا تُضاف بأثرٍ رجعيّ.
    { resolve: "./src/modules/zatca" },

    // ── البحث ───────────────────────────────────────────────────────
    // مزوّدٌ محليّ على Orama (يدعم `arabic`). و**واجهةُ المزوّد هي
    // العَتَبة** (ADR-006 المُعدَّل): الانتقالُ إلى Meilisearch يوم يضيق
    // المحليُّ يكون مزوّداً جديداً لا إعادةَ بناء.
    {
      resolve: "@medusajs/medusa/search",
      options: {
        providers: [
          { resolve: "@medusajs/medusa/search-local", id: "local" },
        ],
      },
    },
  ],
});
