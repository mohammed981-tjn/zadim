import { Module } from "@medusajs/framework/utils";
import ReturnsModuleService from "./service";

export const RETURNS_MODULE = "returns";

export default Module(RETURNS_MODULE, {
  service: ReturnsModuleService,
});
