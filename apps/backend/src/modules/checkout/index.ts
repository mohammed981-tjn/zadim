import { Module } from "@medusajs/framework/utils";
import CheckoutModuleService from "./service";

export const CHECKOUT_MODULE = "checkout";

export default Module(CHECKOUT_MODULE, {
  service: CheckoutModuleService,
});
