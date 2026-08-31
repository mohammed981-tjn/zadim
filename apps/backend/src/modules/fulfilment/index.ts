import { Module } from "@medusajs/framework/utils";
import FulfilmentModuleService from "./service";

export const FULFILMENT_MODULE = "fulfilment";

export default Module(FULFILMENT_MODULE, {
  service: FulfilmentModuleService,
});
