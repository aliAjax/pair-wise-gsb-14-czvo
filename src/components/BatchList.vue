<script setup lang="ts">
// 页面层：批次列表（状态、版本、回执进度、冲突数）
import { computed } from "vue";
import { useVerificationStore } from "../verification/store";

const store = useVerificationStore();

const rows = computed(() =>
  store.state.batches.map((batch) => {
    const evaluation = store.evaluations.get(batch.id);
    return {
      batch,
      filled: evaluation?.filledCount ?? 0,
      total: evaluation?.totalItems ?? 0,
      blocked: evaluation?.blockedItems.length ?? 0
    };
  })
);
</script>

<template>
  <aside class="panel batch-list">
    <h2>调价批次</h2>
    <div class="batch-items">
      <button
        v-for="row in rows"
        :key="row.batch.id"
        type="button"
        class="batch-item"
        :class="{ active: row.batch.id === store.selectedBatchId }"
        @click="store.selectBatch(row.batch.id)"
      >
        <div class="batch-item-head">
          <strong>{{ row.batch.batchNo }}</strong>
          <span class="status" :class="row.batch.status === '已核验' ? 'ok' : 'warn'">
            {{ row.batch.status }}
          </span>
        </div>
        <div class="batch-item-meta">
          <span>v{{ row.batch.version }}</span>
          <span v-if="row.batch.correctedFromId" class="correction-tag">更正版</span>
          <span>回执 {{ row.filled }}/{{ row.total }}</span>
          <span v-if="row.blocked > 0" class="conflict-flag">阻断 {{ row.blocked }}</span>
        </div>
      </button>
      <div v-if="rows.length === 0" class="empty">暂无批次</div>
    </div>
  </aside>
</template>
