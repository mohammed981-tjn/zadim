import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import InHouseFulfillmentService from "./service";

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [InHouseFulfillmentService],
});
