import sharp from "sharp";

/**
 * معالجةُ صور المنتجات (بند ٥٥).
 *
 * ── لماذا لا تُرفع الصورةُ كما هي ─────────────────────────────────
 *
 * صورةُ منتجٍ من كاميرا هاتفٍ اليوم تتجاوز أربعةَ ميجابايت. وصفحةُ
 * تصنيفٍ فيها عشرون منتجاً تصير **ثمانين ميجابايت** — على شبكة جوال،
 * لعميلٍ يدفع من باقته. وهو لا يشتكي، بل يغلق الصفحة.
 *
 * وWebP يوفّر ٢٥-٣٥٪ من JPEG بنفس الجودة المدرَكة، ويدعمه كلُّ متصفّحٍ
 * حيّ اليوم.
 *
 * ── والأحجام الثلاثة ليست ترفاً ───────────────────────────────────
 *
 * بطاقةُ المنتج في الشبكة عرضُها ~٣٠٠ بكسل. وإرسالُ صورةٍ بعرض ٢٠٠٠
 * إليها هدرٌ بعشرين ضعفاً — والمتصفّحُ يُصغّرها بعد أن يحمّلها كاملة.
 */

/** الأحجامُ الثلاثة — وكلٌّ له استعمالٌ محدَّد لا تخمين. */
export const IMAGE_SIZES = [
  { name: "thumb", width: 300 },  // بطاقةُ المنتج في الشبكة
  { name: "medium", width: 800 },  // صفحةُ المنتج على الجوال
  { name: "large", width: 1600 }, // التكبير وسطحُ المكتب
] as const;

export type ProcessedImage = {
  name: string;
  width: number;
  height: number;
  bytes: number;
  buffer: Buffer;
  mime: "image/webp";
};

/** أنواعُ المدخلات المقبولة — قائمةٌ مغلقة لا فحصُ امتداد. */
const ACCEPTED = new Set(["jpeg", "jpg", "png", "webp", "gif", "avif", "tiff"]);

/**
 * حدُّ أبعادٍ يمنع «قنبلةَ الضغط»: صورةٌ صغيرةُ الحجم على القرص
 * وأبعادُها عشراتُ الآلاف تستهلك ذاكرةَ الخادم عند فكّها وتُسقطه.
 * الحدُّ يقطعها قبل المعالجة لا بعدها.
 */
const MAX_INPUT_PIXELS = 50_000_000; // ~٥٠ ميجابكسل

/**
 * يحوّل صورةً واحدة إلى ثلاث نسخِ WebP.
 *
 * ولا يُكبّر أبداً (`withoutEnlargement`): صورةٌ أصلُها ٤٠٠ بكسل لا
 * تصير ١٦٠٠ بالتمديد — تلك ضبابيةٌ أكبرُ حجماً، لا جودةٌ أعلى.
 */
export async function processProductImage(input: Buffer): Promise<ProcessedImage[]> {
  const meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();

  if (!meta.format || !ACCEPTED.has(meta.format)) {
    throw new Error(
      `[zadim] نوعُ صورةٍ غير مقبول: «${meta.format ?? "مجهول"}». المقبول: ${[...ACCEPTED].join("، ")}`
    );
  }
  if (!meta.width || !meta.height) {
    throw new Error("[zadim] تعذّرت قراءةُ أبعاد الصورة — الملفُّ تالفٌ أو ليس صورة.");
  }

  const out: ProcessedImage[] = [];

  for (const size of IMAGE_SIZES) {
    const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      // `rotate()` بلا وسيط يطبّق دورانَ EXIF: صورُ الهواتف تُخزَّن
      // أفقيةً بعلَمِ دوران، ومن يُسقط العلَم يعرض المنتجَ مقلوباً.
      .rotate()
      .resize({ width: size.width, withoutEnlargement: true })
      .webp({ quality: 82 });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    out.push({
      name: size.name,
      width: info.width,
      height: info.height,
      bytes: data.byteLength,
      buffer: data,
      mime: "image/webp",
    });
  }

  return out;
}

/** اسمُ ملفٍ متوقَّع لكل حجم — يبقى ثابتاً كي يُبنى الرابطُ بلا استعلام. */
export function fileNameFor(base: string, size: string): string {
  return `${base}-${size}.webp`;
}
