import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils";

/**
 * **الاستلامُ من الفرع** — ناقلٌ بلا نقل.
 *
 * وليس حالةً هامشية: كثيرٌ من العملاء يفضّلون الاستلامَ بأنفسهم — أسرعُ
 * وبلا أجرةِ شحن، والمتجرُ يوفّر شحنةً كاملة. وهو **خيارُ تنفيذٍ كامل**
 * لا استثناء: له شحنةٌ وحالةٌ وباركود، ويمرّ باللقط والتغليف كغيره.
 *
 * ولا يحتاج مفتاحاً من أحد — ولذلك يُبنى اليوم.
 */
class PickupFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "pickup";

  // مُنشئٌ صريحٌ بلا وسائط: الصنفُ المجرَّد للتنفيذ يعلن مُنشئاً بلا
  // معاملات — بخلاف مزوّد الدفع. وبلا هذا لا يُرى النوعُ قابلاً للبناء.
  constructor() {
    super();
  }

  async getFulfillmentOptions(): Promise<any[]> {
    return [
      { id: "pickup-branch", name: "استلامٌ من الفرع" },
      { id: "pickup-branch-return", name: "إرجاعٌ إلى الفرع", is_return: true },
    ];
  }

  async validateFulfillmentData(_optionData: any, data: any): Promise<any> {
    return data;
  }

  async validateOption(): Promise<boolean> {
    return true;
  }

  /**
   * **لا يحسب سعراً.** والأجرةُ — إن وُجدت — صفٌّ في `shipping_option`
   * يضبطه المدير. ومحوّلٌ يحسب رقماً من عنده يُخفي قاعدةَ عملٍ في كود.
   */
  async canCalculate(): Promise<boolean> {
    return false;
  }

  async createFulfillment(): Promise<any> {
    // لا بوليصةَ ولا رقمَ تتبّع: البضاعةُ لا تغادر الفرع. والعميلُ
    // يُخطَر بالجاهزية، ورقمُ الطلب هو ما يبرزه عند الاستلام.
    return { data: { channel: "pickup" }, labels: [] };
  }

  async cancelFulfillment(): Promise<any> {
    return {};
  }
}

export default PickupFulfillmentService;
