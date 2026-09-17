import { randomUUID } from "crypto";
import type {
  AuthenticatedMedusaRequest,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { clientIp, trustedHops } from "../access/rate-limit";
import { queryKeys, requestId, requestLine, routeOf } from "./log";

/**
 * وسيطُ المراقبة — سطرٌ واحدٌ لكلّ طلبٍ عند **انتهائه**.
 *
 * ── لماذا عند الانتهاء لا عند الوصول ────────────────────────────
 *
 * لأن المفيدَ هو الحالةُ والمدّة، ولا يُعرفان قبل الردّ. وسطرٌ عند
 * الوصول وآخرُ عند الانتهاء يُضاعف حجمَ السجلّ ويُبعثر الخيط.
 *
 * و`res.on("finish")` لا `res.end` المُغلَّف: التغليفُ يكسر ردوداً
 * تُرسل تيّاراً (تنزيلُ ملفّ)، والحدثُ يقع في الحالين.
 *
 * ── ولماذا الوسيطُ أوّلَ السلسلة ────────────────────────────────
 *
 * ليُسجَّل **ما يرفضه حارسُ المعدّل والصلاحيات أيضاً**. وسجلٌّ لا يرى
 * إلا ما نجح يُخفي بالضبط ما يُبحث عنه: موجةَ ٤٢٩ وموجةَ ٤٠٣.
 */
export function observe(
  req_: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const req = req_ as AuthenticatedMedusaRequest;
  const started = Date.now();

  const id = requestId(req.headers["x-request-id"], randomUUID);
  // ويُعاد إلى العميل: بلا ذلك لا يملك المشتكي رقماً يقوله، ويبقى
  // المعرّفُ حِلْيةً داخليّةً لا تُوصل شكوى بسطر.
  res.setHeader("x-request-id", id);
  (req as any).zadim_request_id = id;

  const raw = (req.originalUrl ?? req.url ?? "").split("?");
  const route = routeOf(raw[0] ?? "/");
  const keys = queryKeys(raw[1] ?? "");

  res.on("finish", () => {
    try {
      const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
      logger.info(
        requestLine({
          request_id: id,
          method: req.method,
          route,
          status: res.statusCode,
          duration_ms: Date.now() - started,
          // هويةُ الفاعل للإدارة وحدَها. وزائرُ المتجر **لا يُعرَّف**:
          // ربطُ سلوكِ تصفّحٍ بشخصٍ في سجلٍّ يُشحن إلى مزوّدٍ ثالثٍ
          // ويُحفظ شهوراً هو بيانٌ خاصٌّ لا حاجةَ تشغيليّةَ له.
          actor_type: req.auth_context?.actor_type ?? null,
          actor_id:
            req.auth_context?.actor_type === "user"
              ? req.auth_context?.actor_id ?? null
              : null,
          ip: clientIp(req, trustedHops()),
          query_keys: keys,
        })
      );
    } catch {
      // سطرُ سجلٍّ لا يُسقط طلباً نجح. والبديلُ — رميٌ داخل `finish` —
      // يقتل العمليةَ في Node لأن لا أحدَ يلتقط.
    }
  });

  next();
}
