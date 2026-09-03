import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { WISHLIST_MODULE } from "../../../../../modules/wishlist";
import type WishlistModuleService from "../../../../../modules/wishlist/service";
import { identityFromToken } from "../../../../../modules/checkout/identity";

/**
 * مفضّلةُ العميل — `GET` و`POST /store/customers/me/wishlist`.
 *
 * 🔴 **والقائمةُ من رمز الجلسة لا من مُعامل**: مفضّلةُ شخصٍ تكشف ما
 * يريده ومتى تردّد، ومن يمرّر معرّفَ عميلٍ يقرؤها.
 *
 * ⚠️ **وتُصفّى المنتجاتُ المحذوفة عند القراءة** ولا تُحذف صفوفُها:
 * لا مفتاحَ أجنبيَّ إلى جدولِ منتجاتٍ ليس لنا (`wishlist-item.ts`)،
 * فمنتجٌ حُذف يبقى صفُّه ولا يُعرض. وحذفُ الصفوف عند كلّ قراءةٍ يجعل
 * القراءةَ كتابةً، ومنتجاً أُخفي مؤقّتاً يمحو مفضّلةَ ألفِ عميل.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const identity = await identityFromToken(req);
  if (!identity) {
    return res.status(401).json({
      error: { code: "UNAUTHENTICATED", message_ar: "سجّلِ الدخولَ أوّلاً." },
    });
  }

  const wishlist = req.scope.resolve<WishlistModuleService>(WISHLIST_MODULE);
  const rows = (await wishlist.listFor(identity.customer_id)) as any[];
  if (!rows.length) return res.json({ items: [] });

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "thumbnail"],
    filters: { id: rows.map((r) => r.product_id) },
  });
  const byId = new Map((products as any[]).map((p) => [p.id, p]));

  const items = rows
    .map((r) => {
      const product = byId.get(r.product_id);
      return product
        ? {
            id: r.id,
            product_id: r.product_id,
            variant_id: r.variant_id ?? null,
            title: product.title,
            handle: product.handle,
            thumbnail: product.thumbnail ?? null,
            created_at: r.created_at,
          }
        : null;
    })
    .filter(Boolean);

  res.json({ items });
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const identity = await identityFromToken(req);
  if (!identity) {
    return res.status(401).json({
      error: { code: "UNAUTHENTICATED", message_ar: "سجّلِ الدخولَ لحفظ المفضّلة." },
    });
  }

  const body = ((req as any).validatedBody ?? req.body ?? {}) as Record<string, unknown>;
  const productId = String(body.product_id ?? "").trim();
  const variantId = body.variant_id ? String(body.variant_id).trim() : null;

  if (!productId) {
    return res.status(400).json({
      error: { code: "PRODUCT_REQUIRED", message_ar: "أيُّ منتج؟" },
    });
  }

  // 🔴 **ويُتحقّق أن المنتجَ موجود.** ولولاه لامتلأ الجدولُ بمعرّفاتٍ
  // مخترَعةٍ من أيّ نداءٍ عابث — صفوفٌ لا تُعرض أبداً (تُصفّى عند
  // القراءة) وتُسقط العميلَ في سقفٍ لا يفهمه، وتُثقل فهرسَ «من ينتظر
  // رخصَ هذا المنتج» بلا فائدة.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { id: productId },
  });
  if (!(products as any[]).length) {
    return res.status(404).json({
      error: { code: "PRODUCT_NOT_FOUND", message_ar: "لا منتجَ بهذا المعرّف." },
    });
  }

  const wishlist = req.scope.resolve<WishlistModuleService>(WISHLIST_MODULE);
  const { item, created } = await wishlist.add({
    customer_id: identity.customer_id,
    product_id: productId,
    variant_id: variantId,
  });

  // ٢٠٠ للقائم و٢٠١ للجديد — والاثنان نجاح: من ضغط مرّتين يريده في
  // مفضّلته، وهو فيها.
  res.status(created ? 201 : 200).json({ item: { id: (item as any)?.id }, created });
}
