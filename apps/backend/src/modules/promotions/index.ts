import { Module } from "@medusajs/framework/utils";
import PromotionsPolicyService from "./service";

export const COUPON_POLICY_MODULE = "coupon_policy";

export default Module(COUPON_POLICY_MODULE, {
  service: PromotionsPolicyService,
});
