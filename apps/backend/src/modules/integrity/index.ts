import { Module } from "@medusajs/framework/utils";
import IntegrityModuleService from "./service";

export const INTEGRITY_MODULE = "integrity";

export default Module(INTEGRITY_MODULE, {
  service: IntegrityModuleService,
});
