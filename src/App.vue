<script setup lang="ts">
// 页面层：复核回执台总装。只负责组合与视图切换，规则与存储均在 verification/ 内。
import { computed, ref } from "vue";
import { useVerificationStore } from "./verification/store";
import BatchList from "./components/BatchList.vue";
import BatchDetail from "./components/BatchDetail.vue";
import IssueBatchForm from "./components/IssueBatchForm.vue";

const store = useVerificationStore();

type View = "workspace" | "issue" | "correct";
const view = ref<View>("workspace");
const correctSourceId = ref<string>("");

function startCorrect(batchId: string) {
  correctSourceId.value = batchId;
  view.value = "correct";
}

const pendingBatches = computed(() => store.state.batches.filter((b) => b.status === "待复核"));
const frozenBatches = computed(() => store.state.batches.filter((b) => b.status === "已核验"));
const pendingReceipts = computed(() => {
  let filled = 0;
  let total = 0;
  for (const batch of pendingBatches.value) {
    const evaluation = store.evaluations.get(batch.id);
    total += evaluation?.totalItems ?? 0;
    filled += evaluation?.filledCount ?? 0;
  }
  return { filled, total, missing: total - filled };
});
const blockedGunCount = computed(
  () => new Set(store.allConflicts.filter((c) => c.level === "blocked").map((c) => c.itemId)).size
);

const conflictRows = computed(() =>
  store.allConflicts.map((conflict) => ({
    ...conflict
  }))
);
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 调价闭环</p>
          <h1>调价后油枪示值复核与短溢回执台</h1>
          <p class="subtitle">
            每批调价下发后按油枪生成核验项；检定期过期或示值偏差超千分之三时整批停在待复核，
            全部短溢回执收回前新挂牌价不启用、原价继续生效；核验完成后冻结，更正另建带原因版本。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
          <span class="tag">数据/判定/存储/页面分层</span>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>待复核批次</span>
          <strong>{{ pendingBatches.length }}</strong>
        </article>
        <article class="metric">
          <span>未收回回执</span>
          <strong>{{ pendingReceipts.missing }}<small> / {{ pendingReceipts.total }}</small></strong>
        </article>
        <article class="metric">
          <span>阻断枪项</span>
          <strong>{{ blockedGunCount }}</strong>
        </article>
        <article class="metric">
          <span>已冻结批次</span>
          <strong>{{ frozenBatches.length }}</strong>
        </article>
      </section>

      <section class="panel active-prices">
        <div class="active-head">
          <h2>当前生效挂牌价（原价继续生效中）</h2>
          <button v-if="view === 'workspace'" type="button" @click="view = 'issue'">下发新调价批次</button>
        </div>
        <div class="price-cards">
          <div v-for="active in store.state.activePrices" :key="active.fuel" class="price-card">
            <span>{{ active.fuel }}</span>
            <strong>¥{{ active.price.toFixed(2) }}</strong>
            <small>
              启用于 {{ active.since.slice(0, 10) }}
              <template v-if="active.sourceBatchId">
                （{{ store.state.batches.find((b) => b.id === active.sourceBatchId)?.batchNo }}）
              </template>
            </small>
          </div>
        </div>
      </section>

      <IssueBatchForm
        v-if="view === 'issue'"
        mode="issue"
        @done="view = 'workspace'"
        @cancel="view = 'workspace'"
      />
      <IssueBatchForm
        v-else-if="view === 'correct'"
        mode="correct"
        :source-batch-id="correctSourceId"
        @done="view = 'workspace'"
        @cancel="view = 'workspace'"
      />
      <section v-else class="workspace">
        <BatchList />
        <BatchDetail @correct="startCorrect" />
      </section>

      <section class="panel conflict-summary">
        <h2>全部规则冲突</h2>
        <p v-if="conflictRows.length === 0" class="empty">当前没有冲突</p>
        <table v-else>
          <thead>
            <tr>
              <th>批次</th><th>枪号</th><th>班组</th><th>偏差</th><th>级别</th><th>规则</th><th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in conflictRows" :key="index">
              <td>{{ row.batchNo }}</td>
              <td>{{ row.gunNo }}</td>
              <td>{{ row.team }}</td>
              <td>{{ row.deviation === null ? "—" : `${row.deviation}‰` }}</td>
              <td>
                <span class="conflict-badge" :class="row.level">
                  {{ row.code === "DUP_GUN_TEAM" ? "拒收" : "阻断" }}
                </span>
              </td>
              <td>{{ row.rule }}</td>
              <td>{{ row.detail }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </main>
</template>
