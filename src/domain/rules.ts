// 判定层：所有业务规则集中在这里，纯函数、不接触 localStorage 和 Vue。
// - 同枪同班只能一条
// - 检定期已过 → 冲突
// - 示值相对偏差超过千分之三 → 冲突
// - 回执未全部收回 → 不允许冻结（新挂牌价不启用，原价继续生效）

import type {
  AdjustmentBatch,
  NozzleDraft,
  NozzleItem,
  Receipt,
  Shift
} from "./types";

/** 千分之三 */
export const DEVIATION_LIMIT = 0.003;

export type ConflictRule = "登记不完整" | "同枪同班重复" | "检定期已过" | "偏差超限";

export interface NozzleConflict {
  rule: ConflictRule;
  /** 规则阈值或现场值的说明 */
  message: string;
}

export interface FlatConflict {
  batchId: string;
  batchNo: string;
  version: number;
  itemId: string;
  nozzleNo: string;
  shift: Shift | "";
  /** 相对偏差，万分比已换算为百分比的小数；无法计算时为 null */
  deviation: number | null;
  rule: ConflictRule;
  message: string;
}

export interface FreezeCheck {
  ok: boolean;
  conflictCount: number;
  pendingReceipts: number;
  reasons: string[];
}

/** 相对偏差 = (示值 - 计量罐读数) / 计量罐读数；以计量罐标准量为基准 */
export function relativeDeviation(indication: number | null, measureTank: number | null): number | null {
  if (indication == null || measureTank == null || measureTank === 0) return null;
  return (indication - measureTank) / measureTank;
}

/** 偏差文字，如 +1.82‰ / -4.10‰ / — */
export function formatPermille(value: number | null): string {
  if (value == null) return "—";
  const permille = value * 1000;
  const sign = permille > 0 ? "+" : "";
  return `${sign}${permille.toFixed(2)}‰`;
}

export function isReceiptComplete(receipt: Receipt): boolean {
  return (
    receipt.diffQty != null &&
    receipt.responsibility !== "" &&
    receipt.note.trim() !== "" &&
    receipt.filledAt != null
  );
}

function isDateExpired(date: string, today: string): boolean {
  return date !== "" && date < today;
}

/**
 * 单条油枪项的冲突判定。
 * @param siblings 同批内除自身外的其他枪项，用于同枪同班判重
 */
export function evaluateItem(
  item: Pick<NozzleItem, "nozzleNo" | "shift" | "indication" | "measureTank" | "verifiedUntil">,
  siblings: Array<Pick<NozzleItem, "nozzleNo" | "shift">>,
  today: string
): NozzleConflict[] {
  const conflicts: NozzleConflict[] = [];

  const incomplete =
    item.nozzleNo.trim() === "" ||
    item.shift === "" ||
    item.indication == null ||
    item.measureTank == null ||
    item.verifiedUntil === "";
  if (incomplete) {
    conflicts.push({ rule: "登记不完整", message: "枪号、班组、示值、计量罐读数或检定期未填全" });
  }

  if (
    item.nozzleNo.trim() !== "" &&
    item.shift !== "" &&
    siblings.some((other) => other.nozzleNo === item.nozzleNo && other.shift === item.shift)
  ) {
    conflicts.push({
      rule: "同枪同班重复",
      message: `枪号 ${item.nozzleNo} 在 ${item.shift} 已存在一条核验项（同枪同班只能一条）`
    });
  }

  if (item.verifiedUntil !== "" && isDateExpired(item.verifiedUntil, today)) {
    conflicts.push({
      rule: "检定期已过",
      message: `检定有效期 ${item.verifiedUntil} 已早于今日 ${today}`
    });
  }

  const deviation = relativeDeviation(item.indication, item.measureTank);
  if (deviation != null && Math.abs(deviation) > DEVIATION_LIMIT) {
    conflicts.push({
      rule: "偏差超限",
      message: `相对偏差 ${formatPermille(deviation)}，超过 ±3.00‰ 红线`
    });
  }

  return conflicts;
}

/** 一批内逐枪判重、判期、判偏差，重复对双方都标记 */
export function evaluateBatch(batch: AdjustmentBatch, today: string): Map<string, NozzleConflict[]> {
  const result = new Map<string, NozzleConflict[]>();
  batch.items.forEach((item, index) => {
    const siblings = batch.items
      .filter((_, otherIndex) => otherIndex !== index)
      .map((other) => ({ nozzleNo: other.nozzleNo, shift: other.shift }));
    result.set(item.id, evaluateItem(item, siblings, today));
  });
  return result;
}

/** 全局冲突清单：仅待复核批次参与；跨批次摊平，供页面按批次、枪号、偏差、规则列出 */
export function collectConflicts(batches: AdjustmentBatch[], today: string): FlatConflict[] {
  const flat: FlatConflict[] = [];
  for (const batch of batches) {
    if (batch.status !== "待复核") continue;
    const map = evaluateBatch(batch, today);
    for (const item of batch.items) {
      for (const conflict of map.get(item.id) ?? []) {
        flat.push({
          batchId: batch.id,
          batchNo: batch.batchNo,
          version: batch.version,
          itemId: item.id,
          nozzleNo: item.nozzleNo || "（未填枪号）",
          shift: item.shift,
          deviation: relativeDeviation(item.indication, item.measureTank),
          rule: conflict.rule,
          message: conflict.message
        });
      }
    }
  }
  return flat;
}

/** 冻结前总检查：有冲突或缺任一回执都不通过 */
export function checkFreezable(
  batch: AdjustmentBatch,
  today: string
): FreezeCheck {
  const reasons: string[] = [];
  const map = evaluateBatch(batch, today);
  let conflictCount = 0;
  for (const conflicts of map.values()) conflictCount += conflicts.length;
  if (conflictCount > 0) {
    reasons.push(`存在 ${conflictCount} 条规则冲突，批次停在待复核`);
  }
  const pendingReceipts = batch.items.filter((item) => !isReceiptComplete(item.receipt)).length;
  if (pendingReceipts > 0) {
    reasons.push(`尚有 ${pendingReceipts} 条油枪回执未收回，新挂牌价不得启用，原价继续生效`);
  }
  return { ok: reasons.length === 0, conflictCount, pendingReceipts, reasons };
}

/** 下发表单内的即时预检（数据尚未入批，按草稿顺序判重；完全空白行忽略） */
export function evaluateDrafts(drafts: NozzleDraft[], today: string): Map<number, NozzleConflict[]> {
  const result = new Map<number, NozzleConflict[]>();
  drafts.forEach((draft, index) => {
    const isBlank =
      draft.nozzleNo.trim() === "" &&
      draft.shift === "" &&
      draft.indication == null &&
      draft.measureTank == null &&
      draft.verifiedUntil === "";
    if (isBlank) {
      result.set(index, []);
      return;
    }
    const siblings = drafts
      .map((other) => ({ nozzleNo: other.nozzleNo, shift: other.shift }))
      .filter((_, otherIndex) => otherIndex !== index);
    result.set(index, evaluateItem(draft, siblings, today));
  });
  return result;
}
