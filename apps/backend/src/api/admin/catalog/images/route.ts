import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { fileNameFor, processProductImage } from "../../../../modules/catalog/images";

/**
 * رفعُ صورةِ منتج — ثلاثُ نسخِ WebP من رفعةٍ واحدة (بند ٥٥).
 *
 * ── لماذا مسارٌ خاصٌّ لا `/admin/uploads` ─────────────────────────
 *
 * مسارُ Medusa يخزّن الملفَّ **كما وصل**: أربعةَ ميجا من كاميرا هاتف.
 * وصفحةُ تصنيفٍ بعشرين منتجاً تصير ثمانين ميجا على شبكة جوال — والعميلُ
 * لا يشتكي بل يغلق الصفحة.
 *
 * والمعالجةُ **عند الرفع لا عند العرض**: مرّةً واحدة لكل صورة، لا مرّةً
 * لكل زائر. ومن يؤجّلها إلى وقت العرض يدفع ثمنها ألفَ مرّة يومياً.
 */
export const AUTHENTICATE = true;

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const files = (req as any).files as Array<{
    originalname: string;
    mimetype: string;
    buffer: Buffer;
  }> | undefined;

  if (!files?.length) {
    return res.status(400).json({
      error: { code: "INVALID_BODY", message_ar: "لا ملفَّ في الطلب — أرسله في الحقل «files»" },
    });
  }

  const fileModule = req.scope.resolve(Modules.FILE);
  const uploaded: Array<{
    original: string;
    sizes: Record<string, { url: string; width: number; height: number; bytes: number }>;
  }> = [];

  for (const file of files) {
    let processed;
    try {
      processed = await processProductImage(file.buffer);
    } catch (e) {
      // نوعٌ مرفوض أو ملفٌّ تالف: يُردّ صراحةً ولا يُخزَّن. وتخزينُ ما لا
      // نستطيع معالجته يُنتج صوراً مكسورةً في الكتالوج بلا سبب ظاهر.
      return res.status(400).json({
        error: { code: "INVALID_IMAGE", message_ar: (e as Error).message },
      });
    }

    // اسمٌ أساسٌ يُشتقّ من الأصل بعد تنظيفه — فلا مسارٌ يتسلّل من اسم
    // ملفٍ يرفعه المستخدم (`../../etc/passwd`).
    const base = file.originalname
      .replace(/\.[^.]+$/, "")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "image";

    const stamped = `${base}-${Date.now().toString(36)}`;
    const sizes: Record<string, { url: string; width: number; height: number; bytes: number }> = {};

    for (const image of processed) {
      const [stored] = await fileModule.createFiles([
        {
          filename: fileNameFor(stamped, image.name),
          mimeType: image.mime,
          content: image.buffer.toString("binary"),
          access: "public",
        },
      ]);
      sizes[image.name] = {
        url: stored.url,
        width: image.width,
        height: image.height,
        bytes: image.bytes,
      };
    }

    uploaded.push({ original: file.originalname, sizes });
  }

  res.status(201).json({ images: uploaded });
}
