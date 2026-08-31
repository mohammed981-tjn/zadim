import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CATALOG_MODULE } from "../../../../modules/catalog";
import type CatalogModuleService from "../../../../modules/catalog/service";

type Body = { term?: string; synonyms?: string[] };

/**
 * مرادفاتُ البحث — **بيانات لا كود** (ADR-006).
 *
 * وهذا المسار هو ما يجعل الوعدَ حقيقياً: المديرُ يقرأ تقرير «بحثٌ بلا
 * نتيجة» فيضيف المجموعةَ من اللوحة، بلا نشرةِ كودٍ لكل علامةٍ تجارية
 * تدخل الكتالوج.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const synonyms = await catalog.listSearchSynonyms({});
  res.json({ synonyms });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  if (!body.term || !Array.isArray(body.synonyms) || !body.synonyms.length) {
    return res.status(400).json({
      error: {
        code: "INVALID_BODY",
        message_ar: "term إلزاميّ، و synonyms قائمةٌ غيرُ فارغة",
      },
    });
  }

  const synonym = await catalog.upsertSynonym({
    term: body.term,
    synonyms: body.synonyms,
  });
  res.status(201).json({ synonym });
}
