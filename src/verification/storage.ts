// 存储层：只负责 VerificationState 的持久化与读取，不含业务判定。
// 数据保存在浏览器 localStorage，后续可整体替换为接口实现而不动判定与页面。

import { buildSeedState } from "./seed";
import { STORAGE_KEY, type VerificationState } from "./types";

export interface StoragePort {
  load(): VerificationState | null;
  save(state: VerificationState): void;
}

export const localStoragePort: StoragePort = {
  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<VerificationState>;
      // 结构自检：四个集合与序列齐全才视为有效存档
      if (
        !parsed ||
        !Array.isArray(parsed.activePrices) ||
        !Array.isArray(parsed.batches) ||
        !Array.isArray(parsed.items) ||
        !Array.isArray(parsed.receipts) ||
        typeof parsed.seq !== "number"
      ) {
        return null;
      }
      return parsed as VerificationState;
    } catch {
      return null;
    }
  },
  save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
};

/** 读取状态；无存档时返回种子数据（不落盘，首次保存时再写入） */
export function loadInitialState(port: StoragePort = localStoragePort): VerificationState {
  return port.load() ?? buildSeedState();
}
