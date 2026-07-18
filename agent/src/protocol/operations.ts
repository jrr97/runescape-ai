import type { JsonValue } from "./types.js";

interface OperationContract { description: string; required?: string[]; oneOf?: string[][] }

export const operationContracts: Record<string, OperationContract> = {
  observe: { description: "Read selected live-state components." },
  get_quest_state: { description: "Read exact quest completion state without taking the gameplay lease." },
  get_market_item: { description: "Read current Grand Exchange guide data for an exact item ID.", required: ["id"] },
  find_nearest: {
    description: "Find a loaded target or supported world landmark. Returns { found: false } when nothing matches.",
    required: ["query"],
  },
  find_inventory: { description: "Find an exact inventory item.", oneOf: [["name"], ["id"]] },
  find_ground_item: { description: "Find an exact loaded ground item.", oneOf: [["ref"], ["id"], ["name"]] },
  interact_npc: { description: "Use an observed action on an exact NPC.", required: ["action", "expectedRevision"], oneOf: [["ref"], ["id"], ["name"]] },
  interact_object: { description: "Use an observed action on an exact object.", required: ["action", "expectedRevision"], oneOf: [["ref"], ["id"], ["name"]] },
  interact_ground_item: { description: "Use an observed action on an exact ground item.", required: ["action", "expectedRevision"], oneOf: [["ref"], ["id"], ["name"]] },
  interact_inventory: { description: "Use an observed action on an inventory item.", required: ["action", "expectedRevision"], oneOf: [["index"], ["id"], ["name"]] },
  interact_equipment: { description: "Use an observed action on an exact equipped item.", required: ["action", "expectedRevision"], oneOf: [["index"], ["id"], ["name"]] },
  use_inventory_on_npc: { description: "Atomically select an inventory item and use it on an exact NPC.", required: ["item", "target", "expectedRevision"] },
  use_inventory_on_object: { description: "Atomically select an inventory item and use it on an exact object.", required: ["item", "target", "expectedRevision"] },
  use_inventory_on_inventory: { description: "Atomically use one exact inventory item on another.", required: ["item", "target", "expectedRevision"] },
  interact_interface: { description: "Click or use an action on an exact observed interface component.", required: ["expectedRevision"], oneOf: [["ref"], ["container", "index"]] },
  walk: {
    description: "Walk to an OSRS coordinate, or along waypoints (intermediate legs hand off within approach tiles).",
    required: ["expectedRevision"],
    oneOf: [["x", "y"], ["waypoints"]],
  },
  set_run: { description: "Enable or disable run mode.", required: ["enabled", "expectedRevision"] },
  dialogue_continue: { description: "Continue the current dialogue.", required: ["expectedRevision"] },
  dialogue_select: { description: "Select an exact observed dialogue option.", required: ["number", "text", "expectedRevision"] },
  bank_open: { description: "Open a nearby bank.", required: ["expectedRevision"] },
  bank_close: { description: "Close the bank.", required: ["expectedRevision"] },
  bank_deposit_inventory: { description: "Deposit the complete inventory.", required: ["expectedRevision"] },
  bank_deposit_item: { description: "Deposit an exact inventory item quantity.", required: ["index", "id", "quantity", "expectedRevision"] },
  bank_withdraw: { description: "Withdraw an exact bank item quantity.", required: ["quantity", "expectedRevision"], oneOf: [["id"], ["name"]] },
  shop_buy: { description: "Buy a bounded exact quantity from an open shop.", required: ["quantity", "expectedRevision"], oneOf: [["id"], ["name"]] },
  shop_sell: { description: "Sell a bounded exact quantity to an open shop.", required: ["quantity", "expectedRevision"], oneOf: [["id"], ["name"]] },
  shop_close: { description: "Close the open shop.", required: ["expectedRevision"] },
  grand_exchange_open: { description: "Open the nearby Grand Exchange interface.", required: ["expectedRevision"] },
  grand_exchange_buy: { description: "Place a bounded exact Grand Exchange buy offer.", required: ["name", "quantity", "price", "expectedRevision"] },
  grand_exchange_sell: { description: "Place a bounded exact Grand Exchange sell offer.", required: ["name", "quantity", "price", "expectedRevision"] },
  grand_exchange_collect: { description: "Collect completed Grand Exchange offers to inventory or bank.", required: ["destination", "expectedRevision"] },
  grand_exchange_abort: { description: "Abort an exact active Grand Exchange slot.", required: ["slot", "expectedRevision"] },
  grand_exchange_close: { description: "Close the Grand Exchange interface.", required: ["expectedRevision"] },
};

export function operationProblems(operation: string, parameters: Record<string, JsonValue> | undefined): string[] {
  const contract = operationContracts[operation];
  if (!contract) return [`unsupported operation '${operation}'`];
  const values = parameters ?? {};
  const problems = (contract.required ?? []).filter((name) => !(name in values)).map((name) => `operation '${operation}' requires '${name}'`);
  if (contract.oneOf && !contract.oneOf.some((group) => group.every((name) => name in values))) {
    problems.push(`operation '${operation}' requires one of: ${contract.oneOf.map((group) => group.join(" + ")).join(", ")}`);
  }
  return problems;
}
