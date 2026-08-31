import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CATALOG_MODULE } from "../../../../modules/catalog";
import type CatalogModuleService from "../../../../modules/catalog/service";

type Body = {
  entity?: "product" | "category" | "brand" | "page";
  entity_id?: string;
  locale?: string;
  title?: string | null;
  description?: string | null;
  canonical_url?: string | null;
  og_image?: string | null;
  no_index?: boolean;
};

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const filter: Record<string, unknown> = {};
  for (const k of ["entity", "entity_id", "locale"]) if (req.query[k]) filter[k] = String(req.query[k]);
  res.json({ seo_meta: await catalog.listSeoMetas(filter) });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  if (!body.entity || !body.entity_id) {
    return res.status(400).json({
      error: { code: "INVALID_BODY", message_ar: "entity و entity_id إلزاميّان" },
    });
  }
  res.status(201).json({ seo: await catalog.setSeo(body as any) });
}
