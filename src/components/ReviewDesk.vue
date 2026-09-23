<script setup lang="ts">
// 复核台：待复核批次在最前（可逐枪登记、回填回执、冻结），其后是已冻结与已更正留档。
import { computed } from "vue";
import { useVerificationStore } from "../stores/verification";
import BatchCard from "./BatchCard.vue";

const store = useVerificationStore();

const pending = computed(() => store.pendingBatches);
const history = computed(() =>
  store.frozenBatches
    .slice()
    .sort((a, b) => (b.frozenAt ?? b.issuedAt).localeCompare(a.frozenAt ?? a.issuedAt))
);
</script>

<template>
  <section class="review">
    <div class="review-head">
      <h2>油枪示值复核 · 短溢回执台</h2>
      <div class="review-summary">
        <span class="sum-chip">待复核 <strong>{{ store.metrics.pending }}</strong></span>
        <span class="sum-chip">已冻结 <strong>{{ store.metrics.frozen }}</strong></span>
        <span class="sum-chip">已更正 <strong>{{ store.metrics.revised }}</strong></span>
        <span class="sum-chip" :class="{ bad: store.metrics.conflicts > 0 }">
          冲突 <strong>{{ store.metrics.conflicts }}</strong>
        </span>
        <span class="sum-chip" :class="{ bad: store.metrics.pendingReceipts > 0 }">
          未收回执 <strong>{{ store.metrics.pendingReceipts }}</strong>
        </span>
      </div>
    </div>

    <h3 class="section-label">待复核批次</h3>
    <div v-if="pending.length === 0" class="panel empty-block">
      暂无待复核批次，可在上方下发新的调价批次。
    </div>
    <BatchCard v-for="batch in pending" :key="batch.id" :batch="batch" />

    <h3 class="section-label">冻结留档（含更正版本链）</h3>
    <BatchCard v-for="batch in history" :key="batch.id" :batch="batch" />
  </section>
</template>
