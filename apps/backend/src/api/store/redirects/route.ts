import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CATALOG_MODULE } from "../../../modules/catalog";
import type CatalogModuleService from "../../../modules/catalog/service";

/**
 * حلُّ تحويلِ مسار — تسأله الواجهةُ قبل أن تعرض 404.
 *
 * ولا يُعيد 301 بنفسه: الواجهةُ هي من يملك الردَّ على الزائر، وهذا
 * يخبرها **بماذا تردّ**. فلو ردّ هنا لتاه المسارُ بين خادمين.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const path = String(req.query.path ?? "").trim();
  if (!path) {
    return res.status(400).json({
      error: { code: "INVALID_QUERY", message_ar: "المعامل «path» إلزاميّ" },
    });
  }

  const catalog = req.scope.resolve<CatalogModuleService>(CATALOG_MODULE);
  const redirect = await catalog.resolveRedirect(path);

  if (!redirect) return res.json({ redirect: null });
  res.json({ redirect });
}
