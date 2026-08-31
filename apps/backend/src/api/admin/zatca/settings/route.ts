import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ZATCA_MODULE } from "../../../../modules/zatca";
import type ZatcaModuleService from "../../../../modules/zatca/service";

type Body = {
  seller_name?: string;
  vat_number?: string;
  address_street?: string | null;
  address_district?: string | null;
  address_city?: string | null;
  address_postal_code?: string | null;
  address_building_number?: string | null;
  commercial_registration?: string | null;
  phase?: "phase_1" | "phase_2";
  provider_id?: string | null;
  is_enabled?: boolean;
};

/**
 * إعداداتُ الفوترة الإلكترونية — **يملؤها المالك**.
 *
 * ولا تُصدَر فاتورةٌ قبل ضبطها: رقمٌ ضريبيٌّ افتراضيٌّ في إعدادٍ يُنسى
 * يُطبع على فاتورةٍ تصل الهيئة (`06-saudi-layer.md` §١).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const zatca = req.scope.resolve(ZATCA_MODULE) as ZatcaModuleService;
  const settings = await zatca.settings();
  res.json({
    settings: settings ?? null,
    state: (await zatca.isConfigured()) ? "configured" : "not_configured",
  });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const zatca = req.scope.resolve(ZATCA_MODULE) as ZatcaModuleService;
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  if (!body.seller_name || !body.vat_number) {
    return res.status(400).json({
      error: {
        code: "INVALID_BODY",
        message_ar: "اسمُ البائع والرقمُ الضريبيّ إلزاميّان — ولا فاتورةَ ببياناتٍ ناقصة.",
      },
    });
  }
  if (!/^[0-9]{15}$/.test(body.vat_number)) {
    return res.status(400).json({
      error: {
        code: "INVALID_VAT_NUMBER",
        message_ar: "الرقمُ الضريبيّ خمسةَ عشرَ رقماً.",
      },
    });
  }

  const fields = {
    seller_name: body.seller_name,
    vat_number: body.vat_number,
    address_street: body.address_street ?? null,
    address_district: body.address_district ?? null,
    address_city: body.address_city ?? null,
    address_postal_code: body.address_postal_code ?? null,
    address_building_number: body.address_building_number ?? null,
    commercial_registration: body.commercial_registration ?? null,
    phase: body.phase ?? "phase_1",
    provider_id: body.provider_id ?? null,
    is_enabled: body.is_enabled ?? false,
  };

  const existing = await zatca.settings();
  const settings = existing
    ? await zatca.updateZatcaSettings({ id: (existing as any).id, ...fields })
    : (await zatca.createZatcaSettings([fields]))[0];

  res.status(existing ? 200 : 201).json({ settings });
}
