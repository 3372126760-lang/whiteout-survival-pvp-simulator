import type { ValidationBattleInput, ValidationSideInput, ValidationQueueConfig } from "../pvp/validationUi/types";
import { normalizeIceFireReportLineage } from "../pvp/validationUi/queueReportLineage";
import { isIceFireInput } from "../pvp/validationUi/iceFireContext";
import { getValidationThreeQueues } from "../pvp/validationUi/adapter";

/** Exchange whole queue objects. Side.shared is deliberately retained by reference. */
export function swapIceFireQueues(input: ValidationBattleInput, sideId: "A" | "B", first: number, second: number): ValidationBattleInput {
  if (!isIceFireInput(input) || ![first, second].every((i) => Number.isInteger(i) && i >= 0 && i < 3))
    throw new Error("冰火队列换位参数无效。");
  const key = sideId === "A" ? "sideA" : "sideB", side = input[key];
  const queues = [...(side.threeQueues ?? getValidationThreeQueues(side))];
  const ordered = [...queues];
  const order = [...(side.queueOrder ?? [0, 1, 2])];
  [ordered[first], ordered[second]] = [ordered[second]!, ordered[first]!];
  [order[first], order[second]] = [order[second]!, order[first]!];
  return { ...input, [key]: { ...side, queueOrder: order as [number, number, number], threeQueues: ordered as [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig] } };
}

/** UI-only deep copy so copied sides never share nested troop/composition state. */
export function cloneValidationSideInput(
  side: ValidationSideInput,
): ValidationSideInput {
  return structuredClone(side);
}

export function copySideAToB(
  input: ValidationBattleInput,
): ValidationBattleInput {
  return normalizeIceFireReportLineage({
    ...input,
    sideB: cloneValidationSideInput(input.sideA),
  });
}

export function swapBattleSides(
  input: ValidationBattleInput,
): ValidationBattleInput {
  return normalizeIceFireReportLineage({
    ...input,
    sideA: cloneValidationSideInput(input.sideB),
    sideB: cloneValidationSideInput(input.sideA),
  });
}
