import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CATALOG_MODULE } from "../../../../modules/catalog";
import type CatalogModuleService from "../../../../modules/catalog/service";

type Body = {
  code?: string;
  name_ar?: string;
  name_en?: string;
  data_type?: "text" | "number" | "boolean" | "select";
  is_filterable?: boolean;
};

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const attributes = await catalog.listAttributes({}, { order: { sort_order: "ASC" } });
  res.json({ attributes });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  if (!body.code || !body.name_ar) {
    return res.status(400).json({
      error: { code: "INVALID_BODY", message_ar: "code و name_ar إلزاميّان" },
    });
  }

  const [existing] = await catalog.listAttributes({ code: body.code });
  if (existing) {
    return res.status(409).json({
      error: { code: "ALREADY_EXISTS", message_ar: `الخاصية «${body.code}» موجودةٌ أصلاً` },
    });
  }

  const attribute = await catalog.createAttributes({
    code: body.code,
    name_ar: body.name_ar,
    name_en: body.name_en ?? null,
    data_type: body.data_type ?? "text",
    is_filterable: body.is_filterable ?? true,
  });
  res.status(201).json({ attribute });
}
