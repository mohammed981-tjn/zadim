/**
 * العنوانُ الوطنيّ السعوديّ — **دالّةٌ خالصة**.
 *
 * ── لماذا حقولٌ لا يعرفها أيُّ محرّك تجارةٍ أجنبيّ ────────────────
 *
 * `06-saudi-layer.md` §٣: العنوانُ المعتمد من البريد السعودي ستّةُ
 * حقولٍ إلزامية، و**الرقمُ الإضافيّ لا مقابلَ له في أيّ نموذجٍ عالميّ**.
 * ونموذجُ Medusa يحمل `address_1` و`address_2` و`city` و`postal_code`
 * ولا يعرف رقمَ مبنىً ولا حيّاً ولا رقماً إضافياً.
 *
 * فالحقولُ تُخزَّن **مهيكلةً في `metadata`** ويُركَّب منها
 * `address_1`/`address_2` لملصق الشحن. والسببُ ليس تنظيماً:
 *
 * ١. **المندوبُ يعتمد على الحيّ أكثرَ من الشارع** (§٣). ونصٌّ مُدمَجٌ
 *    في سطرٍ واحد يجعل استخراجَه لاحقاً تخميناً.
 * ٢. **وفاتورةُ ZATCA تطلبها مفصولة**: اسمُ الشارع، ورقمُ المبنى،
 *    والرقمُ الإضافيّ (plot identification)، والحيّ (city subdivision).
 *    فعنوانٌ مُدمَجٌ يعني فاتورةً ناقصةَ حقول.
 *
 * ── ولماذا تُفحص هنا لا في الواجهة وحدَها ────────────────────────
 *
 * فحصُ الواجهة تجربةُ استعمالٍ لا حراسة: `POST /store/carts/:id` مسارٌ
 * عامٌّ من Medusa، ومن ينادِيه مباشرةً يكتب ما شاء. فالحارسُ الحقيقيُّ
 * في `orchestrate.ts` قبل إنشاء الطلب، وهذه الدالّةُ هي الحكم.
 *
 * وتُعيد **كلَّ** الأخطاء لا أوّلَها: نموذجٌ يكشف خطأً واحداً في كل
 * محاولةٍ يجعل العميلَ يُرسل خمسَ مرّات.
 */

/** الأرقامُ الهندية والفارسية ⇒ العربية. */
const INDIC = /[٠-٩۰-۹]/g;

export const toAsciiDigits = (s: string): string =>
  s.replace(INDIC, (d) => String(d.charCodeAt(0) & 0xf));

const clean = (v: unknown): string =>
  toAsciiDigits(String(v ?? "")).replace(/\s+/g, " ").trim();

export type NationalAddressInput = {
  first_name?: unknown;
  last_name?: unknown;
  phone?: unknown;
  /** أربعةُ أرقام */
  building_number?: unknown;
  street?: unknown;
  district?: unknown;
  city?: unknown;
  /** خمسةُ أرقام */
  postal_code?: unknown;
  /** أربعةُ أرقام — يحدّد المدخل بدقّة */
  additional_number?: unknown;
  /** الرمزُ المختصر `RRRD2929` — اختياريّ */
  short_address?: unknown;
  /** دبّوسُ الخريطة — اختياريّ، وأدقُّ من النصّ حين يكون العنوانُ وصفياً */
  latitude?: unknown;
  longitude?: unknown;
  email?: unknown;
};

export type NationalAddress = {
  first_name: string;
  last_name: string;
  phone: string;
  building_number: string;
  street: string;
  district: string;
  city: string;
  postal_code: string;
  additional_number: string;
  short_address: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type FieldError = { field: string; code: string; message_ar: string };

export type AddressCheck =
  | { valid: true; value: NationalAddress }
  | { valid: false; errors: FieldError[] };

/**
 * جوّالٌ سعوديٌّ مطبَّع ⇒ `05XXXXXXXX`.
 *
 * ويقبل `+9665…` و`009665…` و`5…` و`05…` — الناسُ يكتبونها كلَّها،
 * ورفضُ صيغةٍ صحيحةٍ لأنها كُتبت بشكلٍ آخر خسارةُ بيعٍ لا حماية.
 * (ونفسُ منطق `payments/cod.ts` — وهناك يُبنى المفتاح، وهنا يُخزَّن.)
 */
export function normalizeSaudiMobile(raw: unknown): string | null {
  const digits = toAsciiDigits(String(raw ?? "")).replace(/\D/g, "");
  if (!digits) return null;
  // آخرُ تسعةٍ تُسقط 966 و00966 والصفرَ المحلّي معاً
  const nine = digits.slice(-9);
  if (nine.length !== 9 || !nine.startsWith("5")) return null;
  return `0${nine}`;
}

const DIGITS = (n: number) => new RegExp(`^\\d{${n}}$`);
const SHORT_ADDRESS = /^[A-Za-z]{4}\d{4}$/;

/** أطولُ ما يُقبل لحقلٍ نصّيّ — يمنع حشوَ حقلٍ بصفحةٍ كاملة. */
const MAX_TEXT = 100;

function coord(v: unknown, max: number): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(toAsciiDigits(String(v)));
  if (!Number.isFinite(n) || Math.abs(n) > max) return undefined; // undefined = خطأ
  return n;
}

export function validateNationalAddress(input: NationalAddressInput): AddressCheck {
  const errors: FieldError[] = [];
  const add = (field: string, code: string, message_ar: string) =>
    errors.push({ field, code, message_ar });

  const text = (key: keyof NationalAddressInput, label: string): string => {
    const v = clean(input[key]);
    if (!v) add(String(key), "REQUIRED", `${label} مطلوب.`);
    else if (v.length > MAX_TEXT) add(String(key), "TOO_LONG", `${label} أطولُ من ${MAX_TEXT} حرفاً.`);
    return v;
  };

  const digits = (
    key: keyof NationalAddressInput,
    len: number,
    label: string
  ): string => {
    const v = clean(input[key]).replace(/\s/g, "");
    if (!v) add(String(key), "REQUIRED", `${label} مطلوب.`);
    else if (!DIGITS(len).test(v))
      add(String(key), "FORMAT", `${label} ${len} أرقامٍ بالضبط، ووصل «${v}».`);
    return v;
  };

  const first_name = text("first_name", "الاسم الأول");
  const last_name = text("last_name", "اسم العائلة");

  const phone = normalizeSaudiMobile(input.phone);
  if (!phone) {
    add(
      "phone",
      "FORMAT",
      "رقمُ الجوّال سعوديٌّ يبدأ بـ05 (ويُقبل +966). وهو الوسيلةُ الوحيدة لتواصل المندوب."
    );
  }

  const building_number = digits("building_number", 4, "رقمُ المبنى");
  const street = text("street", "اسمُ الشارع");
  const district = text("district", "الحيّ");
  const city = text("city", "المدينة");
  const postal_code = digits("postal_code", 5, "الرمزُ البريدي");
  const additional_number = digits("additional_number", 4, "الرقمُ الإضافي");

  const shortRaw = clean(input.short_address).replace(/\s/g, "");
  let short_address: string | null = null;
  if (shortRaw) {
    if (!SHORT_ADDRESS.test(shortRaw)) {
      add("short_address", "FORMAT", "الرمزُ المختصر أربعةُ أحرفٍ ثم أربعةُ أرقام (مثال: RRRD2929).");
    } else {
      short_address = shortRaw.toUpperCase();
    }
  }

  const lat = coord(input.latitude, 90);
  const lng = coord(input.longitude, 180);
  if (lat === undefined) add("latitude", "FORMAT", "خطُّ العرض غيرُ صالح.");
  if (lng === undefined) add("longitude", "FORMAT", "خطُّ الطول غيرُ صالح.");

  // ⚠️ إحداثيٌّ واحدٌ بلا الآخر نصفُ دبّوس — ولا يُرسم على خريطة.
  if (lat != null && lng == null) add("longitude", "REQUIRED", "خطُّ الطول مطلوبٌ مع خطّ العرض.");
  if (lng != null && lat == null) add("latitude", "REQUIRED", "خطُّ العرض مطلوبٌ مع خطّ الطول.");

  if (errors.length) return { valid: false, errors };

  return {
    valid: true,
    value: {
      first_name,
      last_name,
      phone: phone as string,
      building_number,
      street,
      district,
      city,
      postal_code,
      additional_number,
      short_address,
      latitude: (lat ?? null) as number | null,
      longitude: (lng ?? null) as number | null,
    },
  };
}

/**
 * يُركّب عنوانَ Medusa من العنوان الوطنيّ.
 *
 * `address_1` = «رقمُ المبنى، الشارع» و`address_2` = «الحيّ، الرقمُ
 * الإضافي» — بالترتيب الذي يقرؤه المندوبُ على الملصق. والحقولُ
 * المهيكلةُ تبقى في `metadata` **هي المصدر**، وهذان للعرض والطباعة.
 *
 * ولا يُشتقّ المهيكلُ من النصّ أبداً — الاتجاهُ واحد.
 */
export function toMedusaAddress(a: NationalAddress) {
  return {
    first_name: a.first_name,
    last_name: a.last_name,
    phone: a.phone,
    address_1: `${a.building_number} ${a.street}`,
    address_2: `${a.district} — ${a.additional_number}`,
    city: a.city,
    postal_code: a.postal_code,
    country_code: "sa",
    metadata: { national_address: a as unknown as Record<string, unknown> },
  };
}

/**
 * يقرأ العنوانَ الوطنيَّ من عنوان Medusa — أو `null` إن لم يكن مهيكلاً.
 *
 * 🔴 ويفحص **اكتمالَه** لا وجودَه: عنوانٌ كُتب قبل هذه الدفعة قد يحمل
 * `metadata` بلا الحقول. وحضورُ المفتاح لا يعني حضورَ ما فيه.
 */
export function readNationalAddress(address: unknown): NationalAddress | null {
  const meta = (address as any)?.metadata?.national_address;
  if (!meta || typeof meta !== "object") return null;
  const check = validateNationalAddress(meta);
  return check.valid ? check.value : null;
}
