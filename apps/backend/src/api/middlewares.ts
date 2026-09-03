import multer from "multer";
import { defineMiddlewares } from "@medusajs/framework/http";
import type {
  AuthenticatedMedusaRequest,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ACCESS_MODULE } from "../modules/access";
import type AccessModuleService from "../modules/access/service";
import { isExempt, readCount, readField, ruleFor } from "../modules/access/permission-map";
import { rateLimit } from "../modules/access/rate-limit";
import { overlayTranslations } from "../modules/catalog/overlay";

/**
 * حارسُ الصلاحيات وسجلُّ التدقيق — طبقةٌ واحدة على كل `/admin`.
 *
 * ── لماذا هنا لا داخل كل مُعالِج ──────────────────────────────────
 *
 * لأن الفحصَ داخل المُعالِج يجعل **النسيانَ يفتح باباً**: مسارٌ جديد
 * يُكتب بلا فحص فيمرّ أيُّ مديرٍ إلى أيّ شيء، ولا يُكتشف حتى يُستغلّ.
 * وهنا يُقلب السؤال: ما لا تجد له قاعدةً في `permission-map.ts`
 * **يُرفض** — فالنسيانُ يُغلق الباب.
 *
 * وسجلُّ التدقيق (بند ٤٦) يُكتب من هذه الطبقة وحدها للسبب نفسه: لا
 * يعتمد على تذكّر كلِّ مبرمجٍ أن يسجّل.
 */

/**
 * المسارُ الكامل بعد `/admin`.
 *
 * ⚠️ **لا تستعمل `req.path` هنا**: الوسيطُ يعمل داخل موجِّهٍ فرعيّ،
 * فـ`req.path` نسبيٌّ له ويعطي `/` لكل طلب — فيسقط **كلُّ** مسارٍ في
 * الرفض الافتراضي، ويصير النظام مقفلاً على الجميع. كشفه فحصٌ حيٌّ
 * بـcurl؛ والاختبارُ الوحدويّ مرّ لأنه يستدعي الخريطة مباشرةً بلا
 * طلبٍ حقيقيّ. و`originalUrl` وحده يحمل المسار كما وصل.
 */
function adminPath(req: MedusaRequest): string {
  const raw = (req.originalUrl ?? req.url ?? "").split("?")[0];
  return raw.replace(/^\/admin/, "") || "/";
}

/** يقرأ الجسم بأمان: قد يصل قبل محلِّل الجسم أو بعده. */
function bodyOf(req: AuthenticatedMedusaRequest): unknown {
  return (req as any).validatedBody ?? req.body ?? undefined;
}

// التوقيعُ عامٌّ لأن Medusa يمرّر `MedusaRequest`؛ والسياقُ المصادَق
// عليه يُقرأ بعد إسنادٍ صريح — الوسيطُ يعمل خلف مصادقةِ Medusa فالحقل
// موجود، والفحصُ أدناه يحرس الحالةَ التي لا يكون فيها كذلك.
async function requirePermission(
  req_: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const req = req_ as AuthenticatedMedusaRequest;
  const path = adminPath(req);
  if (isExempt(path)) return next();

  const actorId = req.auth_context?.actor_id;
  const actorType = req.auth_context?.actor_type;

  // مفاتيحُ القنوات (`api_key`) تخدم واجهةَ المتجر لا الإدارة. ومفتاحٌ
  // يبلغ `/admin` حالةٌ لا يجوز أن تمرّ صامتة.
  if (!actorId || actorType !== "user") {
    return res.status(401).json({
      error: { code: "UNAUTHENTICATED", message_ar: "لا هويةَ في هذا الطلب" },
    });
  }

  const access = req.scope.resolve<AccessModuleService>(ACCESS_MODULE);

  const rule = ruleFor(path, req.method);
  if (!rule) {
    // 🔴 deny-by-default. مسارٌ جديدٌ بلا قاعدةٍ يُرفض ويُسجَّل.
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
    logger.warn(
      `[zadim] مسارٌ بلا قاعدةِ صلاحية: ${req.method} ${path} — أضفه إلى permission-map.ts`
    );
    // ويُقيَّد في سجلّ التدقيق **وهو أجدرُ ما يُقيَّد**: إمّا مسارٌ جديد
    // نُسي في الخريطة، وإمّا تحسُّسُ مسارٍ لا يعرفه النظام أصلاً. وكان
    // هذا الفرعُ يرفض صامتاً — كشفه فحصُ السجلّ بعد الفحص الحيّ.
    await access.record({
      actor_id: actorId,
      actor_label: actorId,
      action: "access.denied.unmapped",
      entity: "route",
      entity_id: `${req.method} ${path}`,
      new_value: { code: "INSUFFICIENT_PERMISSION", reason: "no_rule" },
      ip: req.ip ?? null,
      user_agent: (req.headers["user-agent"] as string) ?? null,
    });
    return res.status(403).json({
      error: {
        code: "INSUFFICIENT_PERMISSION",
        message_ar: "هذا المسار غير مُصرَّحٍ به: لا قاعدةَ صلاحيةٍ معرّفةٌ له",
      },
    });
  }

  const body = bodyOf(req);

  // ── 🔴 سقفٌ معلَنٌ لا يُقرأ له مبلغٌ = سقفٌ خامل ──────────────────
  //
  // `can()` يتخطّى فحصَ السقف كلَّه حين `amount == null`. فقاعدةٌ تعلن
  // `amountField` ثم لا يُقرأ لها مبلغٌ **تمرّ بلا سقف** — والباب الذي
  // بُنيت المصفوفةُ كلُّها لإغلاقه يبقى مفتوحاً بلا خطأٍ ولا سطرِ سجلّ.
  //
  // وهذا يقع في حالين: جسمٌ لم يُحلَّل بعدُ لحظةَ عمل الوسيط، وحقلٌ
  // بقيمةٍ ليست مبلغاً. والاثنان **يُرفضان**: المالُ يفشل مغلقاً.
  // (وهو عكسُ `rate-limit.ts` عمداً — هناك مخزنُ العدّاد هو القاعدةُ
  // نفسُها فلا شيءَ يُسرق حين تسكت؛ وهنا الرفضُ يمنع تحويلَ مال.)
  //
  // ⚠️ والعدُّ يختلف: ذراعٌ غائبةٌ من دفعةٍ ليست خطأً (دفعةُ إنشاءٍ بلا
  // `update`)، فغيابُ كلِّ الحقول يُقرأ **صفراً** — ولا شيءَ في دفعةٍ
  // فارغةٍ يتجاوز حدّاً. والحمايةُ من «ذراعٍ لا تُعدّ» في `readCount`:
  // تُقرأ الأذرعُ كلُّها ويؤخذ أكبرُها.
  const declaresLimit = Boolean(rule.amountField || rule.countFields?.length);
  if (declaresLimit && (body === null || body === undefined || typeof body !== "object")) {
    return res.status(400).json({
      error: {
        code: "LIMIT_INPUT_UNREADABLE",
        message_ar:
          "هذا المسار محكومٌ بسقفٍ، ولم يصل جسمُ طلبٍ يُقرأ منه. أرسِلْه بصيغة JSON.",
      },
    });
  }

  const amount = readField(body, rule.amountField);
  if (rule.amountField && amount === undefined) {
    return res.status(400).json({
      error: {
        code: "AMOUNT_UNREADABLE",
        message_ar: `هذا المسار محكومٌ بسقفٍ ماليّ، ولم يُقرأ «${rule.amountField}» مبلغاً صحيحاً بالهللات.`,
      },
    });
  }

  const decision = await access.can({
    user_id: actorId,
    permission: rule.permission,
    amount,
    count: rule.countFields?.length ? readCount(body, rule.countFields) ?? 0 : undefined,
    vendor_id: (req.headers["x-vendor-id"] as string) ?? null,
  });

  if (!decision.allowed) {
    // محاولةُ تجاوزٍ تُسجَّل: إمّا عطلٌ في الواجهة تُظهر زرّاً لا يملكه
    // صاحبُه، وإمّا محاولةٌ متعمَّدة. وكلاهما يستحق أن يُرى.
    await access.record({
      actor_id: actorId,
      actor_label: actorId,
      action: "access.denied",
      entity: "route",
      entity_id: `${req.method} ${path}`,
      new_value: { permission: rule.permission, code: decision.code },
      ip: req.ip ?? null,
      user_agent: (req.headers["user-agent"] as string) ?? null,
    });

    return res.status(403).json({
      error: { code: decision.code, message_ar: decision.reason_ar },
    });
  }

  (req as any).zadim_permission = rule.permission;
  return next();
}

/**
 * قيدُ التدقيق للعمليات التي تُغيّر (بند ٤٦).
 *
 * يُكتب **بعد** نجاح العملية لا قبلها — قيدٌ لمحاولةٍ فشلت يكذب على من
 * يقرأ السجلّ. ويُلتقط الردُّ باعتراض `res.json`، فلا يحتاج أي مُعالِجٍ
 * أن يعرف بوجود التدقيق أصلاً.
 */
async function recordMutation(
  req_: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const req = req_ as AuthenticatedMedusaRequest;
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

  const path = adminPath(req);
  if (isExempt(path)) return next();

  const original = res.json.bind(res);
  (res as any).json = (payload: unknown) => {
    // النجاحُ وحده يُقيَّد. والرفضُ سُجّل في الحارس أعلاه.
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const access = req.scope.resolve<AccessModuleService>(ACCESS_MODULE);
      const actorId = req.auth_context?.actor_id;
      access
        .record({
          actor_id: actorId ?? null,
          actor_label: actorId ?? "غير معروف",
          action: (req as any).zadim_permission ?? `${req.method} ${path}`,
          entity: path.split("/")[1] ?? "unknown",
          entity_id: (payload as any)?.id ?? path,
          new_value: (bodyOf(req) as Record<string, unknown>) ?? null,
          ip: req.ip ?? null,
          user_agent: (req.headers["user-agent"] as string) ?? null,
        })
        // فشلُ التدقيق لا يُسقط عمليةً نجحت — لكنه **لا يُبتلع**:
        // سجلٌّ ناقصٌ صامتاً أسوأ من عمليةٍ فاشلة صاخبة.
        .catch((e: Error) => {
          req.scope
            .resolve(ContainerRegistrationKeys.LOGGER)
            .error(`[zadim] تعذّر قيدُ التدقيق لـ${req.method} ${path}: ${e.message}`);
        });
    }
    return original(payload);
  };

  return next();
}

// رفعُ الصور في الذاكرة لا على القرص: المعالجةُ فورية والنتيجةُ وحدها
// تُخزَّن، فلا ملفَّ خامٌ يبقى ولا مجلدٌ مؤقّتٌ يُنظَّف.
const upload = multer({
  storage: multer.memoryStorage(),
  // حدُّ حجمٍ صريح: بلا حدٍّ يستطيع طلبٌ واحد أن يستهلك ذاكرةَ الخادم
  // كلَّها. و٢٠ ميجا تسع أعلى ما تُخرجه كاميرا هاتفٍ اليوم.
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

export default defineMiddlewares({
  routes: [
    // ── تحديدُ المعدّل أوّلاً — قبل أيّ عملٍ يُكلّف ────────────────────
    //
    // 🔴 و`/auth/*` **قبل غيره** في الأهمية: هناك تُجرَّب كلمات المرور،
    // وهو المسارُ الوحيد الذي لا يحرسه شيءٌ آخر — حارسُ الصلاحيات أدناه
    // يعمل **بعد** المصادقة، فمن لم يدخل بعدُ لا يمرّ به أصلاً.
    //
    // ⚠️ وثلاثةُ مُطابِقاتٍ بصيغة `/x/*` لا أسماءٌ صريحة: قِيس في
    // المرحلة ١١ب أن `matcher: "/store/products"` لا يُطابق شيئاً —
    // لا نداءَ ولا خطأ. والحصرُ يقع داخل الوسيط بسوابق السياسات.
    { matcher: "/auth/*", middlewares: [rateLimit] },
    { matcher: "/store/*", middlewares: [rateLimit] },
    {
      matcher: "/admin/*",
      // والترتيبُ مقصود: العدُّ قبل الصلاحية. فحصُ الصلاحية يقرأ
      // القاعدةَ مرّتين، وفيضٌ من نداءاتٍ مرفوضةٍ يُغرقها — فيصير
      // الحارسُ نفسُه طريقَ الإسقاط.
      middlewares: [rateLimit, requirePermission, recordMutation],
    },
    {
      matcher: "/admin/catalog/images",
      methods: ["POST"],
      // `bodyParser: false` لازم: محلِّلُ JSON يبتلع تيّارَ multipart
      // فيصل multer إلى جسمٍ مستهلَك ولا يجد ملفاً.
      bodyParser: false,
      middlewares: [upload.array("files")],
    },

    // ── مُلبِسُ الترجمة (المرحلة ١١ب) ───────────────────────────────
    //
    // ⚠️ `"/store/*"` **عمداً** ومسارُ العرض يُحصر داخل الوسيط
    // (`READ_PATHS` في `modules/catalog/overlay.ts`).
    //
    // 🔴 والسبب أن `matcher: "/store/products"` قِيس فلم يُطابِق شيئاً:
    // لا نداءَ ولا خطأ. ومُطابقٌ صامتٌ لا يُطابِق يترك البوّابةَ
    // خضراءَ والمتجرَ عربياً — فلا يُبنى الحصرُ عليه.
    { matcher: "/store/*", methods: ["GET"], middlewares: [overlayTranslations] },
  ],
});
