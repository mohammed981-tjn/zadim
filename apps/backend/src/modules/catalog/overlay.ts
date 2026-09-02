import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CATALOG_MODULE } from "./index";
import type CatalogModuleService from "./service";

/**
 * مُلبِسُ الترجمة: يقرأ `?locale=` ويُلبس ترجماتِ الجدول فوق ردّ
 * مسارات القراءة في المتجر (المرحلة ١١ب).
 *
 * ── لماذا وسيطٌ لا تعديلٌ في كل مسار ──────────────────────────────
 *
 * لأن المنتجاتِ والتصنيفاتِ تخدمها **مساراتُ Medusa نفسِها** لا
 * مساراتُنا: لا مكانَ فيها نضيف إليه سطراً. والبديلُ نسخُ تلك المسارات
 * إلى مساراتٍ عندنا — أي تبنّي شيفرةٍ نصونها في كل ترقية، لأجل حقلَي
 * عنوانٍ ووصف.
 *
 * وطبقةٌ واحدةٌ تعني أيضاً أن مساراً جديداً يقرأ منتجاً **يُترجَم بلا
 * أن يتذكّر كاتبُه شيئاً** — نفسُ منطقِ حارس الصلاحيات في
 * `src/api/middlewares.ts`.
 *
 * ── ولماذا لا يعرف شكلَ الردّ ─────────────────────────────────────
 *
 * ردُّ `/store/products` منتجاتٌ فيها متغيّراتٌ فيها تصنيفات، وردُّ
 * `/store/search` قائمةٌ مسطّحة، وردُّ `/store/home` كتلٌ فيها حمولات.
 * فبدل أن يعرف الوسيطُ الأشكالَ الثلاثة، يمشي على الشجرة ويسأل عن
 * **كلِّ كائنٍ له `id`**. ومعرّفاتُ Medusa فريدةٌ عبر الجداول، فلا
 * يلتبس منتجٌ بمتغيّر.
 *
 * وثمنُه أنه يقرأ الردَّ كاملاً مرّتين (جمعُ المعرّفات ثم الإلباس).
 * وهو ثمنُ ذاكرةٍ على ردٍّ محدودِ الحجم أصلاً بـ`limit`.
 *
 * ── 🔴 وأهمُّ قرارٍ فيه: الفشلُ يعرض العربية ولا يُسقِط الطلب ──────
 *
 * الوسيطُ يلفّ `res.json` بدالّةٍ **غيرُ متزامنة**، وexpress لا ينتظر
 * ما تُعيده. فخطأٌ غيرُ ملتقَطٍ فيها لا يصير ٥٠٠ بل **طلباً معلّقاً
 * إلى أن ينقطع** — أسوأُ عطلٍ ممكن: صفحةٌ تدور بلا نهاية ولا رسالة.
 *
 * فكلُّ ما بعد اللفّ داخل `try`، والمخرجُ الوحيد عند أي خطأ هو إرسالُ
 * الردّ **كما جاء**. وترجمةٌ ناقصةٌ نقصٌ في الشكل؛ وردٌّ لا يصل عطلٌ
 * في المتجر.
 */

/** لغةُ المحتوى الأصليّ: لا إلباسَ لها ولا استعلامَ أصلاً. */
const SOURCE_LOCALE = "ar";

/**
 * مساراتُ **العرض** — وهي وحدَها تُلبَس.
 *
 * ── 🔴 ولماذا القائمةُ هنا لا في `matcher` ────────────────────────
 *
 * قِيس على خادمٍ يعمل: `matcher: "/store/products"` **لا يُطابِق شيئاً
 * أبداً** — لا الوسيطُ يُنادى ولا خطأَ يُرفع. وحدَه `"/store/*"` يمرّ.
 * فمُطابقٌ لا يُطابِق يترك البوّابةَ خضراءَ والمتجرَ عربياً، وهو أسوأُ
 * من عطلٍ صريح.
 *
 * فالتركيبُ على `"/store/*"` — وهو ما يعمل — والحصرُ هنا، في شرطٍ
 * يُقرأ ويُختبَر.
 *
 * ── والحصرُ نفسُه ليس تحسيناً ─────────────────────────────────────
 *
 * السلّةُ والطلبُ **سجلٌّ لا عرض**: سطرُ الطلب يحمل عنوانَ المنتج كما
 * كان يومَ الشراء، وترجمتُه اليومَ تُعيد كتابةَ ما وقع. ولا تُترجَم
 * فاتورةٌ صدرت.
 */
const READ_PATHS = [
  /^\/store\/products(\/|$)/,
  /^\/store\/product-categories(\/|$)/,
  /^\/store\/collections(\/|$)/,
  /^\/store\/search(\/|$)/,
  /^\/store\/home(\/|$)/,
];

/**
 * المسارُ واللغةُ من `originalUrl` — **لا من `req.query`**.
 *
 * ⚠️ قِيس: `?locale=en` يصل الخادمَ ولا يصل هذا الوسيط. فـMedusa
 * يتحقّق من الاستعلام بمخطَّطٍ ويستبدل `req.query` بالمُتحقَّق منه —
 * **ومفتاحٌ لا يعرفه المخطَّطُ يُحذف بلا شكوى**. فيقرأ الوسيطُ
 * `undefined` ويمضي، ويعود المتجرُ عربياً في `/en` بلا رسالةِ خطأٍ
 * واحدة.
 *
 * ونفسُ الدرس في `adminPath` بالضبط: ما يحمل الطلبَ كما وصل هو
 * `originalUrl` وحده.
 */
function requestParts(req: MedusaRequest): { path: string; locale: string } {
  const raw = (req as any).originalUrl ?? req.url ?? "";
  const [path, queryString = ""] = String(raw).split("?");
  const locale = new URLSearchParams(queryString).get("locale") ?? "";
  return { path, locale: locale.trim().toLowerCase() };
}

/** يُصدَّر ليقيسه `verify-i18n.ts`: العرضُ يُلبَس، والسجلُّ لا. */
export function isReadPath(path: string): boolean {
  return READ_PATHS.some((re) => re.test(path));
}

/** حدُّ العمق — حارسُ حلقةٍ لا حدُّ بنية: أعمقُ ردٍّ عندنا دون العشرة. */
const MAX_DEPTH = 12;

function collectIds(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) collectIds(item, out, depth + 1);
    return;
  }

  const obj = node as Record<string, unknown>;
  if (typeof obj.id === "string") out.add(obj.id);
  for (const key of Object.keys(obj)) collectIds(obj[key], out, depth + 1);
}

function applyTranslations(
  node: unknown,
  byEntity: Record<string, Record<string, string>>,
  depth = 0
): void {
  if (depth > MAX_DEPTH || node === null || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) applyTranslations(item, byEntity, depth + 1);
    return;
  }

  const obj = node as Record<string, unknown>;
  if (typeof obj.id === "string") {
    const fields = byEntity[obj.id];
    if (fields) {
      for (const [field, value] of Object.entries(fields)) setField(obj, field, value);
    }
  }
  for (const key of Object.keys(obj)) applyTranslations(obj[key], byEntity, depth + 1);
}

/**
 * يكتب حقلاً — ويقبل مساراً بنقطةٍ واحدة (`payload.title`).
 *
 * ── لماذا المسار أصلاً ────────────────────────────────────────────
 *
 * نصُّ كتلِ الرئيسية يسكن `payload` (jsonb) لا عموداً: عنوانُ الواجهة
 * ونصُّ الزرّ. ولا سبيلَ إلى تسميته إلا بموضعه.
 *
 * ── 🔴 ولماذا نقطةٌ واحدةٌ لا مسارٌ عامّ ───────────────────────────
 *
 * لأن المسارَ العامّ يفتح ما لا نريد فتحه: `a.b.c.d` يبلغ أيَّ شيءٍ في
 * الردّ، ومصفوفاتٍ بفهارس، وسلسلةَ نماذجٍ متداخلة. وقيدُ القاعدة يحصر
 * الأسماءَ المسموحة، لكن الحصرَ الثاني — في الكود — يجعل الخطأ
 * **مستحيلاً لا مستبعَداً**.
 *
 * ولا يُنشَأ ما ليس موجوداً: مفتاحٌ غائبٌ في `payload` يُترك غائباً،
 * لنفس سببِ `field in obj` — الترجمةُ تُبدّل ولا تُضيف.
 */
function setField(obj: Record<string, unknown>, field: string, value: string): void {
  const dot = field.indexOf(".");
  if (dot === -1) {
    // 🔴 `field in obj` شرطٌ لا احتياط: الطالبُ قد يكون حصر الحقولَ
    // بـ`fields=`، فإضافةُ حقلٍ لم يُطلَب تُغيّر شكلَ الردّ — ومستهلِكٌ
    // يعتمد على غيابه يتعطّل بترجمةٍ أضافها المديرُ بعد شهر. ولا
    // يُلبَس إلا ما هو موجودٌ أصلاً.
    if (field in obj) obj[field] = value;
    return;
  }

  const parentKey = field.slice(0, dot);
  const leaf = field.slice(dot + 1);
  if (leaf.includes(".")) return;

  const parent = obj[parentKey];
  if (parent === null || typeof parent !== "object" || Array.isArray(parent)) return;
  if (leaf in (parent as Record<string, unknown>)) {
    (parent as Record<string, unknown>)[leaf] = value;
  }
}

export async function overlayTranslations(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const { path, locale } = requestParts(req);

  // لا لغةَ أو اللغةُ الأصل ⇒ لا لفَّ ولا استعلام. والمسارُ الافتراضيّ
  // (وهو الأغلبُ: جمهورُنا سعوديّ) يمرّ بلا تكلفةٍ إطلاقاً.
  if (!locale || locale === SOURCE_LOCALE) return next();
  if (!isReadPath(path)) return next();

  const original = res.json.bind(res);

  (res as any).json = (body: unknown) => {
    // نعيد `res` فوراً كما يفعل express، ونُكمل الإلباسَ بعدها.
    // (المُنادي لا ينتظر القيمة، والردُّ يُكتب داخل `finish`.)
    void finish(body);
    return res;
  };

  async function finish(body: unknown) {
    try {
      const ids = new Set<string>();
      collectIds(body, ids);
      if (!ids.size) return original(body as any);

      const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
      const byEntity = await catalog.translationsFor([...ids], locale);
      if (Object.keys(byEntity).length) applyTranslations(body, byEntity);

      return original(body as any);
    } catch (err) {
      // العربيةُ تُعرض، والعطلُ يُسجَّل. ولا يُترك الطلبُ معلّقاً.
      try {
        req.scope
          .resolve(ContainerRegistrationKeys.LOGGER)
          .error(`[zadim] فشل إلباسُ الترجمة (${locale}): ${(err as Error)?.message}`);
      } catch {
        /* المسجّلُ نفسُه ليس سبباً لإسقاط ردٍّ جاهز. */
      }
      return original(body as any);
    }
  }

  return next();
}
