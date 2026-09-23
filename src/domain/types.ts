// 数据层：调价批次、油枪核验项、短溢回执与挂牌价的类型定义
// 只描述数据结构，不包含判定规则、存储和页面逻辑。

export type FuelCode = "92" | "95" | "98" | "0";

export interface FuelOption {
  code: FuelCode;
  name: string;
}

export const FUELS: readonly FuelOption[] = [
  { code: "92", name: "92号汽油" },
  { code: "95", name: "95号汽油" },
  { code: "98", name: "98号汽油" },
  { code: "0", name: "0号柴油" }
];

export function fuelName(code: FuelCode): string {
  return FUELS.find((fuel) => fuel.code === code)?.name ?? code;
}

export const SHIFTS = ["早班", "中班", "晚班"] as const;
export type Shift = (typeof SHIFTS)[number];

export const RESPONSIBILITY_TYPES = [
  "加油站承担",
  "承运方承担",
  "计量误差",
  "操作差错",
  "其他"
] as const;
export type ResponsibilityType = (typeof RESPONSIBILITY_TYPES)[number];

/** 调价单条油品价格：记录下发时的原价与拟启用的新挂牌价 */
export interface PriceChange {
  fuel: FuelCode;
  oldPrice: number;
  newPrice: number;
}

/** 班组回填的短溢回执 */
export interface Receipt {
  /** 补差量（升），可正负：正为短量补收，负为溢余退回 */
  diffQty: number | null;
  responsibility: ResponsibilityType | "";
  note: string;
  filledAt: string | null;
}

export function emptyReceipt(): Receipt {
  return { diffQty: null, responsibility: "", note: "", filledAt: null };
}

/**
 * 按油枪生成的核验项。
 * 批次在待复核期间允许继续登记与回填；冻结后只读。
 */
export interface NozzleItem {
  id: string;
  nozzleNo: string;
  shift: Shift | "";
  /** 油枪示值（升） */
  indication: number | null;
  /** 计量罐标准读数（升） */
  measureTank: number | null;
  /** 检定有效期至，YYYY-MM-DD */
  verifiedUntil: string;
  receipt: Receipt;
}

/** 下发表单里一行尚未入批的油枪登记 */
export interface NozzleDraft {
  nozzleNo: string;
  shift: Shift | "";
  indication: number | null;
  measureTank: number | null;
  verifiedUntil: string;
}

export function emptyDraft(): NozzleDraft {
  return { nozzleNo: "", shift: "", indication: null, measureTank: null, verifiedUntil: "" };
}

export type BatchStatus = "待复核" | "已冻结" | "已更正";

/** 一批调价下发单及其全部油枪核验项 */
export interface AdjustmentBatch {
  id: string;
  batchNo: string;
  /** 同一业务的更正版本号，首发为 1 */
  version: number;
  /** 更正自哪个冻结批次 */
  sourceBatchId: string | null;
  /** 本版本的更正原因（首发为空） */
  correctionReason: string;
  /** 被哪个更新版本更正 */
  revisedByBatchId: string | null;
  issuedAt: string;
  issuedBy: string;
  effectiveDate: string;
  changes: PriceChange[];
  items: NozzleItem[];
  status: BatchStatus;
  frozenAt: string | null;
}

export interface CurrentPrice {
  fuel: FuelCode;
  price: number;
  /** 最近一次启用该价的冻结批次；初始价为 null */
  batchId: string | null;
  updatedAt: string | null;
}

export type PriceMap = Record<FuelCode, CurrentPrice>;

export interface PersistShape {
  schemaVersion: 1;
  prices: PriceMap;
  batches: AdjustmentBatch[];
}
