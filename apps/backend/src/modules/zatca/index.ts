import { Module } from "@medusajs/framework/utils";
import ZatcaModuleService from "./service";

export const ZATCA_MODULE = "zatca";

export default Module(ZATCA_MODULE, {
  service: ZatcaModuleService,
});
