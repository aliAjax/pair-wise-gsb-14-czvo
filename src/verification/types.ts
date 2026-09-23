// 数据层：调价批次、油枪核验项、回执的实体与类型定义。
// 本文件只描述数据结构，不包含判定规则、读写存储或页面逻辑。

/** 油品类型 */
export type FuelType = "92号汽油" | "95号汽油" | "98号汽油" | "柴油";

export const FUEL_TYPES: FuelType[] = ["92号汽油", "95号汽油", "98号汽油", "柴油"];

/** 班组 */
export type TeamName = "甲班" | "乙班" | "丙班";

export const TEAMS: TeamName[] = ["甲班", "乙班", "丙班"];

/** 责任类型（班组回填回执时选择） */
export type ResponsibilityType = "正常发油" | "站点责任" | "设备计量误差" | "承运方责任";

export const RESPONSIBILITY_TYPES: ResponsibilityType[] = [
  "正常发油",
  "站点责任",
  "设备计量误差",
  "承运方责任"
];

/** 批次状态：待复核（原价继续生效）/ 已核验冻结（新挂牌价启用） */
export type BatchStatus = "待复核" | "已核验";

/** 待下发的单油枪核验录入项 */
export interface DraftNozzleItem {
  key: string; // 仅用于前端列表稳定渲染
  gunNo: string;
  team: TeamName | "";
  fuel: FuelType | "";
  indicated: number; // 油枪示值（升）
  measureRead: number; // 计量罐读数（升）
  verifyUntil: string; // 检定期（到期日 YYYY-MM-DD）
}

/** 批次内一条油品的调价 */
export interface BatchPrice {
  fuel: FuelType;
  oldPrice: number;
  newPrice: number;
}

/** 调价批次 */
export interface AdjustBatch {
  id: string;
  batchNo: string; // 批次编号
  status: BatchStatus;
  issuedAt: string; // 下发时间 ISO
  operator: string; // 操作员
  effectiveDate: string; // 拟生效日期
  reason: string; // 调价说明
  prices: BatchPrice[];
  /** 更正来源：填写所更正的已冻结批次 id，首版为空 */
  correctedFromId: string;
  /** 更正原因（correctedFromId 非空时必填） */
  correctionReason: string;
  version: number; // 版本号，首版为 1
  frozenAt: string; // 核验完成时间 ISO，未完成时为空
}

/** 油枪核验项（批次按油枪生成） */
export interface NozzleCheckItem {
  id: string;
  batchId: string;
  gunNo: string;
  team: TeamName;
  fuel: FuelType;
  indicated: number; // 示值（升）
  measureRead: number; // 计量罐读数（升）
  verifyUntil: string; // 检定期 YYYY-MM-DD
  registeredAt: string; // 登记时间 ISO
}

/** 班组短溢回执（与枪项一一对应） */
export interface Receipt {
  id: string;
  itemId: string;
  batchId: string;
  /** 补差量（升）：正为溢余、负为短少、0 为平账，未回填时为 null */
  diffVolume: number | null;
  responsibility: ResponsibilityType | "";
  explanation: string;
  filledAt: string; // 回填时间 ISO，未回填时为空
}

/** 冲突规则编码 */
export type ConflictCode =
  | "DUP_GUN_TEAM" // 同枪同班只能一条
  | "VERIFY_EXPIRED" // 检定期已过
  | "DEVIATION_OVER_3_PER_MILLE"; // 示值相对偏差超过千分之三

/** 冲突是否阻断整批（阻断型规则使批次停在待复核） */
export type BlockingLevel = "blocked" | "rejected";

/** 一条冲突 */
export interface Conflict {
  code: ConflictCode;
  rule: string; // 规则说明
  level: BlockingLevel;
  batchId?: string;
  batchNo?: string;
  itemId?: string;
  gunNo: string;
  team?: TeamName | "";
  deviation: number | null; // 相对偏差（千分比数值，如 4.2 表示 4.2‰）
  detail: string;
}

/** 当前生效挂牌价 */
export interface ActivePrice {
  fuel: FuelType;
  price: number;
  /** 由哪个已核验批次最后启用 */
  sourceBatchId: string;
  since: string; // ISO
}

/** 持久化到 localStorage 的整体状态 */
export interface VerificationState {
  activePrices: ActivePrice[];
  batches: AdjustBatch[];
  items: NozzleCheckItem[];
  receipts: Receipt[];
  seq: number; // 批次编号自增序列
}

/** 存储键 */
export const STORAGE_KEY = "dfwlfront-9-verification";
