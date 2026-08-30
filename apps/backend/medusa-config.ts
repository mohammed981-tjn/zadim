import { loadEnv, defineConfig, Modules } from "@medusajs/framework/utils";

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
    disable: false,
  },

  modules: [
    // ── وحداتُنا نحن ────────────────────────────────────────────────
    // ما لا يقدّمه Medusa ولا مفرّ من كتابته (00-decisions.md §ADR-001):
    // access (RBAC + سجلّ التدقيق) · wms · purchasing · loyalty · cms ·
    // finance/ZATCA · marketplace.
    //
    // المرحلة ١ تبدأ بـ access وحدها — بند ٤٥ وبند ٤٦.
    { resolve: "./src/modules/access" },
  ],
});
