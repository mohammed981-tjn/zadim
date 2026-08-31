import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import CodPaymentProvider from "./service";

/**
 * مزوّدُ دفعٍ **لوحدة الدفع**، لا وحدةٌ مستقلّة.
 *
 * ولذلك يسكن مجلَّده الخاصّ لا داخل `modules/payments`: مُحمِّلُ Medusa
 * يفتح مسارَ المزوّد ويتوقّع فيه `index` يُصدّر `ModuleProvider` —
 * ووضعُه داخل وحدةٍ أخرى يجعل المُحمِّلَ يحاول تحميلَ تلك الوحدة مزوّداً
 * فيسقط بخطأٍ لا يشرح نفسه.
 */
export default ModuleProvider(Modules.PAYMENT, {
  services: [CodPaymentProvider],
});
