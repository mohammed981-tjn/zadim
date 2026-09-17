/**
 * السجلُّ المهيكل — البند ٥٫٣ من الخارطة.
 *
 * ── ما المشكلةُ التي يحلّها ─────────────────────────────────────
 *
 * سطرُ سجلٍّ حرٌّ (`logger.info("فشل الطلب")`) **لا يُسأل**: لا يُعرف
 * منه أيُّ طلبٍ ولا كم استغرق ولا من فعله. وحين يشتكي عميلٌ أن
 * «الدفعَ لم يكتمل الساعةَ الثالثة» لا يوجد ما يُربط به: عشراتُ أسطرٍ
 * من عشرات الطلبات متداخلةٌ بلا خيطٍ يجمع سطورَ طلبٍ واحد.
 *
 * فالمخرَجُ هنا **سطرُ JSON واحدٌ لكل طلب** بمفاتيحَ ثابتةٍ ومعرّفٍ
 * يُعاد إلى العميل في `x-request-id` — فيقول العميلُ رقماً، ويُقرأ به
 * الطلبُ كلُّه.
 *
 * ── 🔴 وما لا يُسجَّل — وهو أهمُّ ما في الملف ────────────────────
 *
 * **لا تُسجَّل أجسامُ الطلبات إطلاقاً.** ولم يُختَر ذلك كسلاً بل لأن
 * البديلَ «نُسجّل الجسمَ ونحذف الحسّاس» **يفشل مفتوحاً**: حقلٌ جديدٌ
 * باسمٍ لم يخطر على بال من كتب قائمةَ المنع يمرّ إلى السجلّ. وكلمةُ
 * مرورٍ في سجلٍّ لا تُستدرَك: السجلاتُ تُنسخ وتُشحن إلى مزوّدٍ ثالثٍ
 * وتُحفظ شهوراً.
 *
 * فالقاعدةُ مقلوبة: **يُسجَّل ما في القائمة البيضاء ولا شيءَ سواه** —
 * الطريقةُ والمسارُ والحالةُ والمدّةُ وهويةُ الفاعل. والجسمُ لا يُمسّ.
 *
 * و`redact` موجودةٌ لما لا نملك شكلَه: نصُّ خطأٍ من مكتبةٍ قد يحمل
 * رمزاً أو ترويسة. وهي **شبكةٌ ثانية** لا الأولى.
 */

/** المفاتيحُ التي لا تُسجَّل قيمتُها أبداً — تُطابَق كجزءٍ من الاسم. */
const FORBIDDEN_KEY_PARTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "session",
  "api_key",
  "apikey",
  "publishable",
  "jwt",
  "otp",
  "cvv",
  "cvc",
  "pan",
  "card",
  "iban",
  "signature",
];

/** الأشكالُ التي تُخفى أينما وقعت، ولو كان اسمُ الحقل بريئاً. */
const FORBIDDEN_VALUE_SHAPES: Array<[RegExp, string]> = [
  // `Bearer …` — يصل كثيراً داخل نصوص الأخطاء لا كحقلٍ باسمه.
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer ***"],
  // رمزُ JWT بثلاثة أقسام — يُميَّز بشكله لا باسم حقله.
  [/\beyJ[A-Za-z0-9._-]{10,}/g, "***jwt***"],
  // سلسلةُ ١٤–١٩ رقماً: بطاقةٌ محتملة. ولا يُخاطَر بـ«محتملة».
  //
  // ⚠️ و**١٤ لا ١٣** عمداً: طولُ البطاقات ١٣–١٩، لكنّ ١٣ رقماً هو
  // بعينه طولُ الطابع الزمنيّ بالمِلّي (`1789605228199`) — وهو في كل
  // معرّفٍ وسطرِ خطأٍ في هذا المستودع. فإخفاؤه يُعمي السجلَّ عن نفسه،
  // ولا يستر إلا بطاقاتِ Visa ذاتَ الثلاثةَ عشرَ رقماً وقد انقرضت.
  [/\b\d{14,19}\b/g, "***"],
];

export const REDACTED = "***";

/** هل هذا الاسمُ ممنوعٌ تسجيلُ قيمته؟ */
export function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase();
  return FORBIDDEN_KEY_PARTS.some((part) => k.includes(part));
}

/** إخفاءُ الأشكال داخل نصّ — الشبكةُ التي تمسك ما لا اسمَ له. */
export function scrubText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of FORBIDDEN_VALUE_SHAPES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * تنظيفُ قيمةٍ لا نملك شكلَها — للأخطاء والترويسات لا للأجسام.
 *
 * ⚠️ وعمقٌ محدود (٤): بنيةٌ دوريّةٌ أو عميقةٌ تُوقف الخادمَ في دالّةِ
 * تسجيل — وسقوطُ الخادم في **سطرِ سجلّ** أسوأُ من سطرٍ ناقص.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isForbiddenKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  // دالّةٌ أو رمزٌ أو غيرُهما: لا يُسجَّل شكلُها.
  return REDACTED;
}

/**
 * معرّفُ الطلب — ويُقبل الواردُ **بشرطه**.
 *
 * 🔴 وترويسةٌ يكتبها العميلُ تدخل السجلَّ: بلا فحصٍ يُرسل فيها سطرٌ
 * كامل (`abc\n{"level":"info","msg":"payment ok"}`) فيُزرع في السجلّ
 * سطرٌ مُلفَّقٌ لا يُميَّز من الحقيقيّ — **حقنُ سجلّ**. فيُقبل الحرفُ
 * والرقمُ والشرطةُ وحدَها، وما عداه يُولَّد جديداً.
 */
export function requestId(raw: unknown, generate: () => string): string {
  const one = Array.isArray(raw) ? raw[0] : raw;
  if (typeof one === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(one)) return one;
  return generate();
}

/**
 * المسارُ بلا مُعرِّفات — وإلا صار لكلِّ طلبٍ «مسارٌ» فريد.
 *
 * بلا هذا التطبيع لا يُقال «كم مرّةً سقط `/admin/orders/:id`» لأن كلَّ
 * سطرٍ يحمل معرّفاً مختلفاً. والتجميعُ هو الفائدةُ كلُّها.
 */
export function routeOf(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      // معرّفاتُ Medusa (`order_01J…`) ومعرّفاتُنا (`zadim_…`) وULID/UUID
      if (/^[a-z_]+_[0-9A-Za-z]{10,}$/.test(seg)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return ":id";
      if (/^\d+$/.test(seg)) return ":n";
      return seg;
    })
    .join("/");
}

/** مفاتيحُ الاستعلام المسموحُ تسجيلُ **أسمائها** — والقيمُ لا تُسجَّل. */
export function queryKeys(search: string): string[] {
  if (!search) return [];
  const qs = search.startsWith("?") ? search.slice(1) : search;
  return qs
    .split("&")
    .map((pair) => decodeURIComponent(pair.split("=")[0] ?? ""))
    .filter(Boolean)
    .map((k) => (isForbiddenKey(k) ? REDACTED : k))
    .slice(0, 20);
}

/** حقولُ سطرِ الطلب — قائمةٌ بيضاءُ صريحة، لا `...req`. */
export type RequestLogFields = {
  request_id: string;
  method: string;
  route: string;
  status: number;
  duration_ms: number;
  actor_id: string | null;
  actor_type: string | null;
  ip: string | null;
  query_keys: string[];
  error_code?: string;
};

/**
 * سطرٌ واحدٌ بترتيبِ مفاتيحَ ثابت.
 *
 * والثباتُ ليس زينة: أدواتُ القراءة تُوازن السطورَ نصّياً، وترتيبٌ
 * يتبع ترتيبَ الإدخال يجعل سطرَين متطابقَين يبدوان مختلفَين.
 */
export function requestLine(f: RequestLogFields): string {
  const ordered: Record<string, unknown> = {
    evt: "http",
    request_id: f.request_id,
    method: f.method,
    route: f.route,
    status: f.status,
    duration_ms: f.duration_ms,
    actor_type: f.actor_type,
    actor_id: f.actor_id,
    ip: f.ip,
    query_keys: f.query_keys,
  };
  if (f.error_code) ordered.error_code = f.error_code;
  return JSON.stringify(ordered);
}
