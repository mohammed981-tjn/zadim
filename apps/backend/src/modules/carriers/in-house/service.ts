import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils";
import { randomBytes } from "crypto";

/**
 * **مندوبو المتجر** — توصيلٌ داخليّ.
 *
 * ولا مفتاحَ لأحد: الشحنةُ تخرج مع مندوبٍ من عندنا، والتتبّعُ أحداثٌ
 * يكتبها التطبيقُ لا webhook من ناقل. وهو ما يبدأ به أكثرُ المتاجر في
 * حيٍّ واحدٍ قبل أن تتّسع الرقعة.
 *
 * ⚠️ **ورقمُ التتبّع يُولَّد هنا** لأن لا ناقلَ يعطيه. وصيغتُه واضحةُ
 * الأصل (`ZDM-`) كي لا يُخلط برقمِ ناقلٍ حقيقيّ في تقريرٍ أو شكوى.
 */
class InHouseFulfillmentService extends AbstractFulfillmentProviderService {
  static identifier = "in-house";

  // مُنشئٌ صريحٌ بلا وسائط: الصنفُ المجرَّد للتنفيذ يعلن مُنشئاً بلا
  // معاملات — بخلاف مزوّد الدفع. وبلا هذا لا يُرى النوعُ قابلاً للبناء.
  constructor() {
    super();
  }

  async getFulfillmentOptions(): Promise<any[]> {
    return [
      { id: "in-house-standard", name: "توصيلٌ بمندوبي المتجر" },
      { id: "in-house-return", name: "استرجاعٌ بمندوبي المتجر", is_return: true },
    ];
  }

  async validateFulfillmentData(_optionData: any, data: any): Promise<any> {
    return data;
  }

  async validateOption(): Promise<boolean> {
    return true;
  }

  async canCalculate(): Promise<boolean> {
    return false;
  }

  async createFulfillment(_data: any, _items: any, order: any): Promise<any> {
    const tracking = `ZDM-${randomBytes(5).toString("hex").toUpperCase()}`;
    return {
      data: { channel: "in_house", tracking_number: tracking },
      labels: [
        {
          tracking_number: tracking,
          tracking_url: `/orders/${order?.id ?? ""}/tracking`,
          label_url: "",
        },
      ],
    };
  }

  async cancelFulfillment(): Promise<any> {
    return {};
  }
}

export default InHouseFulfillmentService;
