/**
 * رمزُ QR لفاتورة ZATCA — **ترميزُ TLV**، دالّةٌ خالصة.
 *
 * ── ما هو ────────────────────────────────────────────────────────
 *
 * المرحلةُ الأولى من الفوترة الإلكترونية تشترط رمزَ QR على الفاتورة
 * يحمل خمسةَ حقول، مرمَّزةً **Tag-Length-Value** ثم Base64:
 *
 * | الوسم | الحقل |
 * |---|---|
 * | ١ | اسمُ البائع |
 * | ٢ | الرقمُ الضريبيّ |
 * | ٣ | الطابعُ الزمنيّ (ISO 8601) |
 * | ٤ | إجماليُّ الفاتورة **شاملَ الضريبة** |
 * | ٥ | إجماليُّ الضريبة |
 *
 * وكلُّ حقلٍ ثلاثةُ أجزاء: بايتُ الوسم، ثم **بايتُ الطول**، ثم القيمةُ
 * بترميز UTF-8.
 *
 * ── 🔴 وبايتُ الطول واحدٌ لا أكثر ───────────────────────────────
 *
 * فالقيمةُ التي تتجاوز ٢٥٥ بايتاً **لا تُرمَّز**. واسمُ بائعٍ عربيٍّ طويل
 * يبلغها بسرعة: الحرفُ العربيّ بايتان في UTF-8، فمئةٌ وثمانيةٌ وعشرون
 * حرفاً تكفي. والقصُّ الصامتُ هنا يُنتج رمزاً **يُقرأ ولا يُطابق
 * الفاتورة** — فيُرفع الخطأ ولا يُقصّ.
 *
 * ⚠️ **ولا يُبنى الرمزُ إلا من بياناتٍ حقيقية**: رقمٌ ضريبيٌّ وهميّ في
 * رمزٍ يُطبع على فاتورةٍ يصل إلى الهيئة. فمن لم يضبط الإعدادات لا
 * تُصدَر له فاتورةٌ أصلاً (`service.ts`).
 */

const MAX_VALUE_BYTES = 255;

export type QrFields = {
  seller_name: string;
  vat_number: string;
  /** ISO 8601 بتوقيت زولو. */
  timestamp: string;
  /** إجماليُّ الفاتورة شاملَ الضريبة، بالهللات. */
  total_halalas: number;
  /** إجماليُّ الضريبة، بالهللات. */
  vat_halalas: number;
};

/**
 * الهللاتُ ⇒ نصٌّ عشريٌّ بمنزلتين، **بحسابٍ صحيحٍ لا عائم**.
 *
 * `(h / 100).toFixed(2)` يمرّ بعائمٍ ثنائيّ لا يمثّل العُشر تمثيلاً
 * دقيقاً. والفرقُ يظهر عند مبالغَ بعينها، وفي الفواتير لا يُقبل «يظهر
 * أحياناً» (ADR-008).
 */
export function halalasToDecimal(halalas: number): string {
  const n = Math.trunc(Number(halalas) || 0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function tlv(tag: number, value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > MAX_VALUE_BYTES) {
    throw new Error(
      `[zadim] قيمةُ الوسم ${tag} تتجاوز ${MAX_VALUE_BYTES} بايتاً (${bytes.length}) — ` +
        `ترميزُ TLV لا يحتملها، ولا تُقصّ لأن الرمزَ حينها لا يطابق الفاتورة.`
    );
  }
  return Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
}

export function buildQrTlv(fields: QrFields): string {
  const parts = [
    tlv(1, fields.seller_name),
    tlv(2, fields.vat_number),
    tlv(3, fields.timestamp),
    tlv(4, halalasToDecimal(fields.total_halalas)),
    tlv(5, halalasToDecimal(fields.vat_halalas)),
  ];
  return Buffer.concat(parts).toString("base64");
}

/**
 * فكُّ الترميز — **للفحص لا للإنتاج**.
 *
 * ووجودُه ليس ترفاً: بلا فكٍّ يُفحص الرمزُ بمقارنته بسلسلةٍ محفوظةٍ في
 * الاختبار، وتلك تُثبت أن الكود لم يتغيّر — **لا أن الترميز صحيح**.
 * وبالفكّ يُثبت أن ما بُني يُقرأ حقلاً حقلاً كما تقرؤه أجهزةُ الهيئة.
 */
export function parseQrTlv(base64: string): Record<number, string> {
  const buf = Buffer.from(base64, "base64");
  const out: Record<number, string> = {};
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i];
    const len = buf[i + 1];
    if (len === undefined || i + 2 + len > buf.length) {
      throw new Error("[zadim] رمزٌ مقطوع: الطولُ المعلن يتجاوز البايتات الموجودة.");
    }
    out[tag] = buf.subarray(i + 2, i + 2 + len).toString("utf8");
    i += 2 + len;
  }
  return out;
}
