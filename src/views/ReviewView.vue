<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLinkageStore } from '../stores/linkage'
import { useMigrationStore, type BatchStatus } from '../stores/migration'

const store = useLinkageStore()
const migration = useMigrationStore()
const legacyQuery = ref('')
const checklist = ref([
  { done: true, title: '设备地址与竣工图一致', owner: '消防电专业' },
  { done: true, title: '所有报警点完成单点调试', owner: '调试组' },
  { done: false, title: '跨区联动完成现场确认', owner: '消防审阅人' },
  { done: false, title: '互锁反馈时长完成测试', owner: '暖通专业' },
  { done: false, title: '签字交付包完成哈希校验', owner: '项目负责人' },
])
const changes = [
  { id: 'CH-01', title: 'PF-2 增加防火阀开启反馈互锁', source: '暖通专业', oldValue: '互锁：无', newValue: '互锁：防火阀开启反馈', risk: '低' },
  { id: 'CH-02', title: '电梯归位延时由 0 秒调整至 10 秒', source: '电梯专业', oldValue: '延时：0s', newValue: '延时：10s', risk: '中' },
  { id: 'CH-03', title: '机房感烟联动 1F 排烟风机', source: '智能化专业', oldValue: '无关系', newValue: 'R-007 / 当前停用', risk: '高' },
]
const canLock = computed(() => store.validations.filter((item) => item.severity === '错误').length === 0 && checklist.value.every((item) => item.done) && !store.activeTrialBatchId && migration.pendingReconfirmCount === 0)
const legacyResult = computed(() => migration.findLegacyRule(legacyQuery.value))

function accept(id: string) {
  if (!store.acceptedChanges.includes(id)) store.acceptedChanges.push(id)
}

function statusColor(status: BatchStatus) {
  return { 待确认: 'warning', 试运行: 'info', 已切换: 'success', 已回滚: 'error' }[status] as string
}

function deviceName(id: string) {
  return store.devices.find((device) => device.id === id)?.name ?? id
}

function exportPackage() {
  const payload = JSON.stringify({ revision: store.revision, devices: store.devices, rules: store.rules, validations: store.validations, acceptedChanges: store.acceptedChanges, migrationBatches: migration.batches }, null, 2)
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `消防联动交付包-R${store.revision}.json`
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">REVIEW & SIGN-OFF / 审阅签字</p><h1>版本差异、联调清单与锁定</h1><p class="muted">多个专业提交后只接受经过审阅的变更，锁定后配置成为只读基线。</p></div>
      <div class="actions"><v-btn variant="outlined" prepend-icon="mdi-download" @click="exportPackage">导出交付包</v-btn><v-btn v-if="!store.locked" color="primary" prepend-icon="mdi-lock-outline" :disabled="!canLock" @click="store.lockBaseline">签字锁定</v-btn><v-btn v-else color="warning" variant="outlined" @click="store.unlock">解锁修订</v-btn></div>
    </div>

    <v-alert v-if="store.activeTrialBatchId" type="info" variant="tonal" class="mb-3">迁移批次 {{ store.activeTrialBatchId }} 试运行中：新改动不写入正式基线，签字锁定暂停，切换或按批次号恢复后解锁。</v-alert>
    <v-alert v-else-if="migration.pendingReconfirmCount > 0" type="warning" variant="tonal" class="mb-3">切换后还有 {{ migration.pendingReconfirmCount }} 条引用异常点位的规则待重新确认，确认前不能签字锁定。</v-alert>
    <v-alert v-if="!canLock && !store.locked && !store.activeTrialBatchId" type="warning" variant="tonal" class="mb-3">签字前需清除所有错误规则并完成联调清单。</v-alert>
    <v-alert v-if="store.locked" type="success" variant="tonal" class="mb-3">当前版本 R{{ store.revision }} 已签字锁定，任何修改都会生成新的修订草稿。</v-alert>

    <div class="review-grid">
      <section class="panel">
        <div class="panel-head"><h3>矩阵校验结果</h3><v-chip size="small" color="error" variant="tonal">{{ store.validations.length }} 项</v-chip></div>
        <div class="validation-list">
          <article v-for="item in store.validations" :key="item.id" :class="item.severity">
            <v-icon :icon="item.severity === '错误' ? 'mdi-close-octagon-outline' : 'mdi-alert-outline'" />
            <div><strong>{{ item.title }}</strong><p>{{ item.detail }}</p><small>建议：{{ item.suggestion }}</small></div>
            <v-btn size="small" variant="text" @click="$router.push('/matrix')">定位</v-btn>
          </article>
          <div v-if="store.validations.length === 0" class="empty-validation"><v-icon icon="mdi-check-decagram" size="38" color="success" /><strong>矩阵校验通过</strong><span>未发现遗漏、重复、矛盾或跨区冲突。</span></div>
        </div>
      </section>

      <aside>
        <section class="panel">
          <div class="panel-head"><h3>联调清单</h3><span class="muted">{{ checklist.filter((item) => item.done).length }}/{{ checklist.length }}</span></div>
          <div class="checklist">
            <v-checkbox v-for="item in checklist" :key="item.title" v-model="item.done" :label="item.title" :hint="item.owner" persistent-hint density="compact" />
          </div>
        </section>
      </aside>
    </div>

    <section class="panel change-panel">
      <div class="panel-head"><h3>专业提交版本差异</h3><span class="muted">可逐项接受</span></div>
      <v-table>
        <thead><tr><th>变更</th><th>来源</th><th>原始值</th><th>提交值</th><th>风险</th><th>决定</th></tr></thead>
        <tbody>
          <tr v-for="change in changes" :key="change.id">
            <td><strong>{{ change.id }}</strong><br />{{ change.title }}</td>
            <td>{{ change.source }}</td>
            <td class="old">{{ change.oldValue }}</td>
            <td class="new">{{ change.newValue }}</td>
            <td><v-chip size="small" :color="change.risk === '高' ? 'error' : change.risk === '中' ? 'warning' : 'success'" variant="tonal">{{ change.risk }}</v-chip></td>
            <td><v-btn v-if="!store.acceptedChanges.includes(change.id)" size="small" color="primary" variant="tonal" @click="accept(change.id)">接受变更</v-btn><v-chip v-else color="success" variant="tonal" prepend-icon="mdi-check">已接受</v-chip></td>
          </tr>
        </tbody>
      </v-table>
    </section>

    <section v-if="migration.batches.length" class="panel migration-panel">
      <div class="panel-head">
        <h3>旧数据迁移批次审阅</h3>
        <v-btn size="small" variant="text" prepend-icon="mdi-database-import-outline" @click="$router.push('/migration')">进入迁移工作台</v-btn>
      </div>
      <div class="legacy-bar">
        <v-text-field v-model="legacyQuery" label="旧规则编号查询（如 LG-01）" density="compact" hide-details prepend-inner-icon="mdi-tag-search-outline" style="max-width:320px" />
        <div v-if="legacyResult" class="legacy-hit">
          <strong>{{ legacyResult.item.oldRuleId }}</strong> → 批次 {{ legacyResult.batch.id }}<v-chip size="x-small" :color="statusColor(legacyResult.batch.status)" variant="tonal" class="mx-1">{{ legacyResult.batch.status }}</v-chip>
          <template v-if="legacyResult.rule">现行规则 <strong>{{ legacyResult.rule.id }}</strong>（{{ legacyResult.rule.enabled ? '启用' : '停用' }}）</template>
          <template v-else>未生成现行规则</template>
        </div>
        <span v-else-if="legacyQuery.trim()" class="muted">未找到该旧规则编号。</span>
      </div>

      <article v-for="batch in migration.batches" :key="batch.id" class="batch-card">
        <div class="batch-head">
          <strong class="mono">{{ batch.id }}</strong>
          <span class="muted">{{ batch.source }} · {{ batch.createdAt }}</span>
          <v-chip size="x-small" :color="statusColor(batch.status)" variant="tonal">{{ batch.status }}</v-chip>
          <v-chip v-if="batch.trialRevision" size="x-small" color="secondary" variant="outlined">试运行修订 {{ batch.trialRevision }}</v-chip>
        </div>

        <div v-if="batch.reconfirmRuleIds.length" class="reconfirm-list">
          <div v-for="ruleId in batch.reconfirmRuleIds" :key="ruleId" class="reconfirm-item">
            <v-icon icon="mdi-alert-outline" color="warning" size="18" />
            <span>规则 <strong class="mono">{{ ruleId }}</strong>（旧 {{ store.rules.find((rule) => rule.id === ruleId)?.legacyId ?? '—' }}）引用了切换后异常的点位：{{ deviceName(store.rules.find((rule) => rule.id === ruleId)?.triggerId ?? '') }} → {{ deviceName(store.rules.find((rule) => rule.id === ruleId)?.actionId ?? '') }}</span>
            <v-btn size="small" color="primary" variant="tonal" @click="migration.reconfirmRule(batch.id, ruleId)">重新确认</v-btn>
          </div>
        </div>

        <div v-if="batch.reviewItems.length" class="review-items">
          <div v-for="item in batch.reviewItems" :key="item.id" class="review-item" :class="{ returned: item.status === '退回' }">
            <span>{{ item.title }}<small v-if="item.reason">（{{ item.reason }}）</small></span>
            <v-chip size="x-small" :color="item.status === '退回' ? 'error' : 'success'" variant="tonal">{{ item.status === '退回' ? '退回' : '继续使用' }}</v-chip>
          </div>
        </div>

        <div class="sign-row">
          <v-icon icon="mdi-draw-pen" size="16" class="mr-1" />
          <span v-for="(sign, index) in batch.signatures" :key="index" class="sign-entry">{{ sign.user }}：{{ sign.action }}（{{ sign.at }}）</span>
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.review-grid { display: grid; grid-template-columns: minmax(0,1fr) 350px; gap: 14px; margin-bottom: 14px; }
.validation-list { padding: 8px 16px 16px; }
.validation-list article { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; padding: 13px 0; border-bottom: 1px solid #edf0f0; }
.validation-list article.error { color: #b13d2c; }
.validation-list article.warning { color: #b87b22; }
.validation-list strong { font-size: 13px; }
.validation-list p { margin: 5px 0; color: #59676d; font-size: 12px; line-height: 1.5; }
.validation-list small { color: #7f8b90; }
.empty-validation { display: grid; justify-items: center; gap: 7px; padding: 42px; color: #3d7b63; }
.empty-validation span { color: #748086; font-size: 12px; }
.checklist { padding: 10px 14px 16px; }
.change-panel { overflow-x: auto; }
.change-panel :deep(table) { min-width: 850px; }
.migration-panel { margin-top: 14px; }
.legacy-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 12px 16px; border-bottom: 1px solid #e7ebeb; }
.legacy-hit { font-size: 12px; }
.batch-card { margin: 12px 16px; padding: 12px 14px; border: 1px solid #e3e9e9; border-radius: 9px; }
.batch-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mono { color: #267078; font-family: ui-monospace,monospace; font-weight: 700; }
.reconfirm-list { display: grid; gap: 8px; margin-top: 10px; }
.reconfirm-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #eadfc8; border-radius: 8px; background: #fdf9f1; font-size: 12px; }
.reconfirm-item span { flex: 1; }
.review-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; margin-top: 10px; }
.review-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border: 1px solid #e3e9e9; border-radius: 8px; font-size: 12px; }
.review-item.returned { border-color: #ecc9c2; background: #fdf3f1; }
.review-item small { color: #9a7b72; }
.sign-row { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-top: 10px; color: #68767d; font-size: 11px; }
.sign-entry { border-left: 2px solid #265e66; padding-left: 8px; }
.old { color: #a54b35; }
.new { color: #2e755e; font-weight: 700; }
@media (max-width: 1000px) { .review-grid { grid-template-columns: 1fr; } }
</style>
