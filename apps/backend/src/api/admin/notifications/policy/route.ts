import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { NOTIFY_MODULE } from "../../../../modules/notify";
import type NotifyModuleService from "../../../../modules/notify/service";

type Body = {
  max_attempts?: number;
  retry_after_seconds?: number;
  is_enabled?: boolean;
  note?: string | null;
};

/**
 * سياسةُ إعادة المحاولة — **يضبطها المالك لا الكود** (بند ٤٨).
 *
 * و`is_enabled = false` ليس زرَّ تعطيل: هو **صمّامٌ ليومِ سقوط المزوّد**.
 * فيومَ يسقط ساعةً، المطلوبُ إيقافُ الطرقِ على بابه حتى يتعافى —
 * والتصريفُ يستمرّ فيملأ السجلَّ بما يُعاد بعدُ. ولولاه لكان الخيارُ
 * بين إغراقِ مزوّدٍ ساقطٍ وبين إيقاف الإشعارات كلِّها.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const notify = req.scope.resolve<NotifyModuleService>(NOTIFY_MODULE);
  const [row] = (await notify.listNotifyPolicies({}, { take: 1 })) as any[];
  res.json({ policy: row ?? null, effective: await notify.retryPolicy() });
}

export async function PATCH(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const notify = req.scope.resolve<NotifyModuleService>(NOTIFY_MODULE);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const [row] = (await notify.listNotifyPolicies({}, { take: 1 })) as any[];
  if (!row) {
    return res.status(404).json({
      error: {
        code: "POLICY_MISSING",
        message_ar: "لا صفَّ سياسةٍ — شغّلْ هجراتِ القاعدة.",
      },
    });
  }

  const patch: Record<string, unknown> = { id: row.id };

  if (body.max_attempts !== undefined) {
    const n = Number(body.max_attempts);
    // ⚠️ ويُردّ برسالةٍ لا يُقصّ بصمت: مديرٌ كتب صفراً يقصد «لا إعادة»،
    // وقصُّه إلى واحدٍ يعطيه سلوكاً لم يطلبه ولا يعرف أنه وقع.
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      return res.status(400).json({
        error: {
          code: "MAX_ATTEMPTS_RANGE",
          message_ar: "حدُّ المحاولات عددٌ صحيحٌ بين ١ و٢٠. ولإيقاف الإعادة استعملْ is_enabled.",
        },
      });
    }
    patch.max_attempts = n;
  }

  if (body.retry_after_seconds !== undefined) {
    const n = Number(body.retry_after_seconds);
    if (!Number.isInteger(n) || n < 0 || n > 86400) {
      return res.status(400).json({
        error: {
          code: "RETRY_DELAY_RANGE",
          message_ar: "المهلةُ بالثواني بين ٠ و٨٦٤٠٠.",
        },
      });
    }
    patch.retry_after_seconds = n;
  }

  if (body.is_enabled !== undefined) patch.is_enabled = Boolean(body.is_enabled);
  if (body.note !== undefined) patch.note = body.note ?? null;

  await notify.updateNotifyPolicies(patch as any);
  const [updated] = (await notify.listNotifyPolicies({ id: row.id }, { take: 1 })) as any[];
  res.json({ policy: updated });
}
