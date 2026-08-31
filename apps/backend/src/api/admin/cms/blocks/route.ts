import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { CMS_MODULE } from "../../../../modules/cms";
import type CmsModuleService from "../../../../modules/cms/service";

type Body = {
  page?: string;
  type?: string;
  name_ar?: string | null;
  position?: number;
  is_active?: boolean;
  payload?: Record<string, unknown> | null;
};

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const cms = req.scope.resolve(CMS_MODULE) as CmsModuleService;
  const page = String((req.query as any).page ?? "home");

  // اللوحةُ ترى **المخفيَّ أيضاً**: كتلةٌ أُطفئت يجب أن تُرى لتُشعل،
  // وإلا اختفت من نظر المدير كما اختفت من نظر العميل.
  const blocks = await cms.listPageBlocks(
    { page },
    { order: { position: "ASC", id: "ASC" } }
  );
  res.json({ page, blocks });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const cms = req.scope.resolve(CMS_MODULE) as CmsModuleService;
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  if (!body.type) {
    return res.status(400).json({
      error: { code: "INVALID_BODY", message_ar: "نوعُ الكتلة إلزاميّ." },
    });
  }

  const page = body.page ?? "home";
  const existing = await cms.listPageBlocks({ page });
  const last = (existing as any[]).reduce((m, b) => Math.max(m, Number(b.position)), 0);

  const [block] = await cms.createPageBlocks([
    {
      page,
      type: body.type,
      name_ar: body.name_ar ?? null,
      // الجديدةُ تنزل آخرَ الصفحة: إقحامُها في الأعلى يغيّر رئيسيةَ
      // متجرٍ حيٍّ بمجرّد الإضافة، قبل أن يراها من أضافها.
      position: body.position ?? last + 10,
      is_active: body.is_active ?? true,
      payload: (body.payload ?? {}) as Record<string, unknown>,
    },
  ]);

  res.status(201).json({ block });
}
