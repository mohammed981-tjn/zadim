import { Module } from "@medusajs/framework/utils";
import PaymentsModuleService from "./service";

export const PAYMENTS_MODULE = "payments";

export default Module(PAYMENTS_MODULE, {
  service: PaymentsModuleService,
});
