<script setup lang="ts">
// 页面装配层：只负责布局，数据与动作来自 Pinia，判定来自 domain/rules。
import { computed, ref } from "vue";
import PriceBoard from "./components/PriceBoard.vue";
import DispatchPanel from "./components/DispatchPanel.vue";
import ReviewDesk from "./components/ReviewDesk.vue";
import ConflictPanel from "./components/ConflictPanel.vue";
import { useVerificationStore } from "./stores/verification";

const store = useVerificationStore();

const tabs = ["调价下发", "复核回执台", "冲突清单"] as const;
const activeTab = ref<(typeof tabs)[number]>("复核回执台");

const stack = ["Vue3", "Vite", "TypeScript", "Pinia"];

const banner = computed(() =>
  store.metrics.pending > 0
    ? `有 ${store.metrics.pending} 批调价待复核：${store.metrics.pendingReceipts} 条回执未收回、${store.metrics.conflicts} 条规则冲突未消除，新挂牌价暂不启用，原价继续生效。`
    : "所有批次均已复核冻结，当前挂牌价为最新。"
);
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 调价后计量核验闭环</p>
          <h1>油枪示值复核与短溢回执台</h1>
          <p class="subtitle">
            每批调价下发后按油枪生成核验项，登记枪号、班组、示值、计量罐读数和检定期；
            班组回填补差量、责任类型与说明。冲突或回执未齐时整批停在待复核，新挂牌价不启用，原价继续生效；
            复核完成后批次、枪项与回执全部冻结，更正另建带原因版本。
          </p>
        </div>
        <div class="stack">
          <span v-for="item in stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article class="metric"><span>调价批次</span><strong>{{ store.metrics.batchTotal }}</strong></article>
        <article class="metric"><span>待复核</span><strong>{{ store.metrics.pending }}</strong></article>
        <article class="metric"><span>规则冲突</span><strong :class="{ 'num-bad': store.metrics.conflicts > 0 }">{{ store.metrics.conflicts }}</strong></article>
        <article class="metric"><span>未收回执</span><strong :class="{ 'num-bad': store.metrics.pendingReceipts > 0 }">{{ store.metrics.pendingReceipts }}</strong></article>
      </section>

      <div class="banner" :class="{ alert: store.metrics.pending > 0 }">{{ banner }}</div>

      <PriceBoard />

      <nav class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab"
          type="button"
          class="tab"
          :class="{ active: activeTab === tab }"
          @click="activeTab = tab"
        >
          {{ tab }}
          <i v-if="tab === '复核回执台' && store.metrics.pending > 0">{{ store.metrics.pending }}</i>
          <i v-else-if="tab === '冲突清单' && store.metrics.conflicts > 0" class="bad">{{ store.metrics.conflicts }}</i>
        </button>
      </nav>

      <DispatchPanel v-show="activeTab === '调价下发'" />
      <ReviewDesk v-show="activeTab === '复核回执台'" />
      <ConflictPanel v-show="activeTab === '冲突清单'" />
    </div>
  </main>
</template>
