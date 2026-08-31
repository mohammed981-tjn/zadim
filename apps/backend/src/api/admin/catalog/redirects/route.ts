import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CATALOG_MODULE } from "../../../../modules/catalog";
import type CatalogModuleService from "../../../../modules/catalog/service";

type Body = { from_path?: string; to_path?: string; status?: 301 | 302 };

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  res.json({ redirects: await catalog.listUrlRedirects({}, { order: { hits: "DESC" } }) });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  if (!body.from_path || !body.to_path) {
    return res.status(400).json({
      error: { code: "INVALID_BODY", message_ar: "from_path و to_path إلزاميّان" },
    });
  }

  try {
    res.status(201).json({ redirect: await catalog.addRedirect(body as any) });
  } catch (e) {
    // حلقةٌ أو تحويلٌ إلى النفس: يُردّ صراحةً برسالته العربية بدل خطأِ
    // خادمٍ غامضٍ يترك المديرَ يخمّن.
    res.status(400).json({ error: { code: "INVALID_REDIRECT", message_ar: (e as Error).message } });
  }
}
