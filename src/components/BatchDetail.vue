<script setup lang="ts">
// 页面层：批次详情——调价单、冲突清单、油枪核验项与短溢回执回填、核验冻结/更正入口
import { computed, reactive, ref } from "vue";
import { useVerificationStore } from "../verification/store";
import { deviationPerMille, MAX_DEVIATION_PER_MILLE } from "../verification/rules";
import { RESPONSIBILITY_TYPES, type ResponsibilityType } from "../verification/types";

const emit = defineEmits<{ (e: "correct", batchId: string): void }>();

const store = useVerificationStore();
const batch = computed(() => store.selectedBatch);
const items = computed(() => store.selectedItems);
const evaluation = computed(() => store.selectedEvaluation);

// 各枪项回执的本地编辑内容（刷新后以已回填内容预填，未收回的保持空白）
const drafts = reactive<Record<string, { diff: string; responsibility: ResponsibilityType | ""; explanation: string }>>({});
const rowError = ref<Record<string, string>>({});
const freezeError = ref("");
const freezeOk = ref("");

function ensureDraft(itemId: string) {
  if (!drafts[itemId]) {
    const saved = store.receiptsByItem.get(itemId);
    drafts[itemId] = {
      diff: saved && saved.diffVolume !== null ? String(saved.diffVolume) : "",
      responsibility: saved?.responsibility ?? "",
      explanation: saved?.explanation ?? ""
    };
  }
  return drafts[itemId];
}

function deviationText(item: { indicated: number; measureRead: number }): string {
  const value = deviationPerMille(item.indicated, item.measureRead);
  return value === null ? "—" : `${value.toFixed(2)}‰`;
}

function isOverLimit(item: { indicated: number; measureRead: number }): boolean {
  const value = deviationPerMille(item.indicated, item.measureRead);
  return value !== null && value > MAX_DEVIATION_PER_MILLE;
}

function isExpired(date: string): boolean {
  if (!date) return false;
  const due = new Date(`${date}T00:00:00`);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due.getTime() < startOfToday.getTime();
}

function isReceiptFilled(itemId: string): boolean {
  const receipt = store.receiptsByItem.get(itemId);
  return Boolean(receipt && receipt.diffVolume !== null && receipt.responsibility && receipt.explanation);
}

function submitReceipt(itemId: string) {
  if (!batch.value || batch.value.status !== "待复核") return;
  const draft = ensureDraft(itemId);
  rowError.value[itemId] = "";
  try {
    store.fillReceipt(itemId, {
      diffVolume: draft.diff.trim() === "" ? null : Number(draft.diff),
      responsibility: draft.responsibility,
      explanation: draft.explanation
    });
  } catch (error) {
    rowError.value[itemId] = (error as Error).message;
  }
}

function doFreeze() {
  if (!batch.value) return;
  freezeError.value = "";
  freezeOk.value = "";
  try {
    store.freezeBatch(batch.value.id);
    freezeOk.value = "核验完成，批次、枪项与回执已冻结，新挂牌价已启用。";
  } catch (error) {
    freezeError.value = (error as Error).message;
  }
}
</script>

<template>
  <section v-if="batch" class="panel batch-detail">
    <header class="detail-head">
      <div>
        <h2>{{ batch.batchNo }} <span class="version-tag">v{{ batch.version }}</span></h2>
        <p class="detail-sub">
          操作员 {{ batch.operator }} ｜ 下发 {{ batch.issuedAt.slice(0, 16).replace("T", " ") }}
          ｜ 拟生效 {{ batch.effectiveDate }}
        </p>
        <p v-if="batch.correctedFromId" class="correction-line">
          更正版本，原因：{{ batch.correctionReason }}
        </p>
      </div>
      <div class="detail-actions">
        <span class="status" :class="batch.status === '已核验' ? 'ok' : 'warn'">{{ batch.status }}</span>
        <button
          v-if="batch.status === '已核验'"
          class="secondary"
          type="button"
          @click="emit('correct', batch.id)"
        >
          更正（另建版本）
        </button>
      </div>
    </header>

    <!-- 调价单：冻结前原价继续生效 -->
    <section class="block">
      <h3>挂牌价 {{ batch.status === "待复核" ? "（待复核，原价继续生效）" : "（已启用新价）" }}</h3>
      <table class="price-table">
        <thead>
          <tr><th>油品</th><th>原价（元/升）</th><th>新挂牌价（元/升）</th><th>调价说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="price in batch.prices" :key="price.fuel">
            <td>{{ price.fuel }}</td>
            <td>{{ price.oldPrice.toFixed(2) }}</td>
            <td :class="{ pricePending: batch.status === '待复核' }">{{ price.newPrice.toFixed(2) }}</td>
            <td>{{ batch.reason }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 冲突清单：批次、枪号、偏差和规则 -->
    <section v-if="evaluation && evaluation.conflicts.length > 0" class="block conflict-block">
      <h3>规则冲突（{{ evaluation.conflicts.length }}）——整批停在待复核并保留输入</h3>
      <ul>
        <li v-for="(conflict, index) in evaluation.conflicts" :key="index" class="conflict-row">
          <span class="conflict-gun">{{ conflict.gunNo }}</span>
          <span class="conflict-team">{{ conflict.team }}</span>
          <span class="conflict-badge" :class="conflict.level">
            {{ conflict.code === "DUP_GUN_TEAM" ? "拒收" : "阻断" }}
          </span>
          <span class="conflict-rule">{{ conflict.rule }}</span>
          <span v-if="conflict.deviation !== null" class="conflict-deviation">偏差 {{ conflict.deviation }}‰</span>
          <span class="conflict-detail">{{ conflict.detail }}</span>
        </li>
      </ul>
    </section>

    <!-- 油枪核验项 + 回执 -->
    <section class="block">
      <div class="block-head">
        <h3>油枪核验项与短溢回执（{{ evaluation?.filledCount ?? 0 }}/{{ items.length }} 已收回）</h3>
      </div>
      <div v-if="items.length === 0" class="empty">本批没有核验项</div>
      <article v-for="item in items" :key="item.id" class="gun-card" :class="{ blocked: evaluation?.blockedItems.some((i) => i.id === item.id) }">
        <header class="gun-head">
          <strong>{{ item.gunNo }}</strong>
          <span>{{ item.team }}</span>
          <span>{{ item.fuel }}</span>
          <span
            class="verify-tag"
            :class="{ bad: isExpired(item.verifyUntil) }"
            :title="'检定到期日'"
          >检定期 {{ item.verifyUntil }}</span>
        </header>
        <div class="gun-readings">
          <div><span>示值</span><strong>{{ item.indicated }} L</strong></div>
          <div><span>计量罐读数</span><strong>{{ item.measureRead }} L</strong></div>
          <div>
            <span>相对偏差</span>
            <strong :class="{ bad: isOverLimit(item) }">{{ deviationText(item) }}</strong>
          </div>
        </div>

        <div class="receipt" :class="{ locked: batch.status === '已核验' }">
          <p class="receipt-title">
            班组短溢回执
            <span v-if="isReceiptFilled(item.id)" class="receipt-state done">已收回</span>
            <span v-else class="receipt-state pending">未收回</span>
          </p>
          <div class="receipt-grid">
            <label>
              补差量（升，正溢/负短）
              <input
                v-model="ensureDraft(item.id).diff"
                type="number"
                step="0.01"
                :disabled="batch.status === '已核验'"
                placeholder="如 0.1 或 -0.2"
              />
            </label>
            <label>
              责任类型
              <select v-model="ensureDraft(item.id).responsibility" :disabled="batch.status === '已核验'">
                <option value="">请选择</option>
                <option v-for="option in RESPONSIBILITY_TYPES" :key="option" :value="option">{{ option }}</option>
              </select>
            </label>
            <label class="wide">
              说明
              <input
                v-model="ensureDraft(item.id).explanation"
                type="text"
                :disabled="batch.status === '已核验'"
                placeholder="短溢原因与处理说明"
              />
            </label>
          </div>
          <p v-if="rowError[item.id]" class="row-error">{{ rowError[item.id] }}</p>
          <button
            v-if="batch.status === '待复核'"
            type="button"
            @click="submitReceipt(item.id)"
          >提交回执</button>
        </div>
      </article>
    </section>

    <!-- 核验操作 -->
    <footer v-if="batch.status === '待复核'" class="freeze-bar">
      <p class="freeze-hint">
        无检定期过期、无偏差超 3‰ 且全部回执收回后方可核验；
        在此之前新挂牌价不启用，原价继续生效。
      </p>
      <button type="button" :disabled="!evaluation?.canFreeze" @click="doFreeze">核验完成并冻结批次</button>
      <p v-if="freezeError" class="row-error">{{ freezeError }}</p>
      <p v-if="freezeOk" class="row-ok">{{ freezeOk }}</p>
    </footer>
    <footer v-else class="freeze-bar frozen-note">
      已冻结于 {{ batch.frozenAt.slice(0, 16).replace("T", " ") }}，批次、枪项与回执不可修改；更正请另建带原因版本。
    </footer>
  </section>

  <section v-else class="panel empty-panel">
    <div class="empty">请选择左侧批次</div>
  </section>
</template>
