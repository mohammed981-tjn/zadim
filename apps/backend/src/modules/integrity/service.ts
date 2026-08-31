import { MedusaService } from "@medusajs/framework/utils";
import IntegrityCheck from "./models/integrity-check";

class IntegrityModuleService extends MedusaService({ IntegrityCheck }) {}

export default IntegrityModuleService;
