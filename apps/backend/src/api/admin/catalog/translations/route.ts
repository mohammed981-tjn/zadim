import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CATALOG_MODULE } from "../../../../modules/catalog";
import type CatalogModuleService from "../../../../modules/catalog/service";

type EntityType = "product" | "product_variant" | "product_category" | "product_collection";

type Body = {
  entity_type?: EntityType;
  entity_id?: string;
  field?: string;
  locale?: string;
  value?: string;
};

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const filter: Record<string, unknown> = {};
  for (const k of ["entity_type", "entity_id", "field", "locale"]) {
    if (req.query[k]) filter[k] = String(req.query[k]);
  }
  res.json({ translations: await catalog.listTranslations(filter) });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const missing = (["entity_type", "entity_id", "field", "locale", "value"] as const).filter(
    (k) => !String(body[k] ?? "").trim()
  );
  if (missing.length) {
    return res.status(400).json({
      error: {
        code: "INVALID_BODY",
        message_ar: `حقولٌ إلزاميةٌ ناقصة: ${missing.join("، ")}`,
      },
    });
  }

  // ⚠️ ولا قائمةَ حقولٍ مسموحةٍ هنا عمداً: تحرسها القاعدة
  // (`zadim_translation_field_check`). ونسخةٌ ثانيةٌ منها في هذا
  // المسار تفترقان يومَ يُعدَّل أحدُهما — وتصير القائمةُ المكتوبةُ هنا
  // وثيقةً كاذبة. فالخطأُ يصعد من القاعدة كما هو.
  try {
    const translation = await catalog.setTranslation({
      entity_type: body.entity_type!,
      entity_id: body.entity_id!.trim(),
      field: body.field!.trim(),
      locale: body.locale!.trim().toLowerCase(),
      value: body.value!,
    });
    res.status(201).json({ translation });
  } catch (err) {
    const message = (err as Error)?.message ?? "";
    if (/zadim_translation_.*_check/.test(message)) {
      return res.status(400).json({
        error: {
          code: "TRANSLATION_NOT_ALLOWED",
          message_ar:
            "حقلٌ غيرُ قابلٍ للترجمة، أو لغةٌ بصيغةٍ خاطئة، أو قيمةٌ فارغة",
          detail: message,
        },
      });
    }
    throw err;
  }
}
