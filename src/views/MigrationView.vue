<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLinkageStore, type DeviceType } from '../stores/linkage'
import { useMigrationStore, KNOWN_TYPES, type BatchStatus, type MigrationBatch, type MigrationDeviceItem, type MigrationRuleItem } from '../stores/migration'

const store = useLinkageStore()
const migration = useMigrationStore()

const source = ref('GST-200 旧主机')
const backupText = ref('')
const feedback = ref<{ type: 'success' | 'info' | 'warning'; text: string } | null>(null)
const legacyQuery = ref('')

const sampleBackup = `# 旧主机 GST-200 配置备份 2026-09-28
# 设备行: 旧编号,名称,类型,楼层,分区,回路地址
L101,一层西侧感烟 03,感烟探测器,1F,A 区,1-A-01-03
L102,一层西侧感烟 04,感烟探测器,1F,A 区,1-A-01-04
L103,一层走廊手报 02,手动报警按钮,1F,A 区,1-A-02-02
L104,二层配电间感温 02,感温探测器,2F,B 区,2-B-01-03
L105,中庭卷帘控制模块,输入输出模块,1F,中庭,1-R-02-01
L106,一层备用广播,消防广播,1F,A 区,1-A-01-01
L107,一层夹层感烟 01,感烟探测器,1F,B 区,1-A-01-05
L201,二层排烟风机 PF-3,排烟风机,2F,B 区,2-F-01-02
# 规则行: 旧规则号,触发点位,动作点位,延时
LG-01,L101,A-01-01,0s
LG-02,L102,A-01-03,5s
LG-03,L103,A-01-03,3000ms
LG-04,L104,A-02-01,8
LG-05,L105,A-01-02,2s
LG-06,L106,A-01-03,10s
LG-07,L107,A-01-03,4s
LG-08,L201,A-02-01,1s
LG-09,L199,A-01-01,1s`

const batch = computed(() => migration.selectedBatch)
const matchedDevices = computed(() => batch.value?.deviceItems.filter((item) => item.confirmed && !item.discarded) ?? [])
const matchedRules = computed(() => batch.value?.ruleItems.filter((item) => item.confirmed && !item.discarded) ?? [])
const pendingDevices = computed(() => (batch.value ? migration.pendingDevices(batch.value) : []))
const pendingRules = computed(() => (batch.value ? migration.pendingRules(batch.value) : []))
const discardedItems = computed(() => {
  if (!batch.value) return []
  return [
    ...batch.value.deviceItems.filter((item) => item.discarded).map((item) => item.oldId),
    ...batch.value.ruleItems.filter((item) => item.discarded).map((item) => item.oldRuleId),
  ]
})
const legacyResult = computed(() => migration.findLegacyRule(legacyQuery.value))

const deviceEdits = ref<Record<string, { type: DeviceType | null; address: string; zone: string }>>({})
const ruleEdits = ref<Record<string, { delayValue: number; delayUnit: 's' | 'ms'; triggerOldId: string; actionOldId: string }>>({})

function deviceEdit(item: MigrationDeviceItem) {
  if (!deviceEdits.value[item.key]) deviceEdits.value[item.key] = { type: item.type, address: item.address, zone: item.zone }
  return deviceEdits.value[item.key]
}

function ruleEdit(item: MigrationRuleItem) {
  if (!ruleEdits.value[item.key]) {
    const numeric = Number(item.rawDelay.replace(/[^\d.]/g, ''))
    ruleEdits.value[item.key] = { delayValue: Number.isFinite(numeric) ? numeric : 0, delayUnit: 's', triggerOldId: item.triggerOldId, actionOldId: item.actionOldId }
  }
  return ruleEdits.value[item.key]
}

function submit() {
  if (!backupText.value.trim()) return
  const result = migration.submitBackup(backupText.value, source.value)
  if (result.duplicated) {
    feedback.value = { type: 'info', text: `重复提交：内容与批次 ${result.batch.id} 一致，已保留第一次解析结果。` }
  } else {
    const pending = migration.pendingDevices(result.batch).length + migration.pendingRules(result.batch).length
    feedback.value = { type: 'success', text: `批次 ${result.batch.id} 解析完成：${pending} 项待确认${result.skipped ? `，${result.skipped} 行无法识别已跳过` : ''}。` }
    backupText.value = ''
  }
}

function confirmDevice(item: MigrationDeviceItem) {
  if (!batch.value) return
  const edit = deviceEdit(item)
  migration.confirmDeviceItem(batch.value.id, item.key, { type: edit.type as DeviceType | null, address: edit.address, zone: edit.zone })
}

function confirmRule(item: MigrationRuleItem) {
  if (!batch.value) return
  const edit = ruleEdit(item)
  const delay = edit.delayUnit === 'ms' ? edit.delayValue / 1000 : edit.delayValue
  migration.confirmRuleItem(batch.value.id, item.key, { delay, triggerOldId: edit.triggerOldId, actionOldId: edit.actionOldId })
}

function generateTrial() {
  if (!batch.value) return
  migration.generateTrialRevision(batch.value.id)
  feedback.value = { type: 'success', text: `已生成试运行修订 ${batch.value.trialRevision}，试运行期间新改动不写入正式基线。` }
}

function cutover() {
  if (!batch.value) return
  migration.cutover(batch.value.id)
  const flags = batch.value.cutoverFlags.length
  feedback.value = flags
    ? { type: 'warning', text: `已切换：${flags} 个点位出现地址重复占用或跨区变化，引用它们的规则需重新确认。` }
    : { type: 'success', text: '已切换：未发现地址重复占用或跨区变化。' }
}

function rollback() {
  if (!batch.value) return
  const id = batch.value.id
  migration.rollbackBatch(id)
  feedback.value = { type: 'warning', text: `迁移失败：已按批次号 ${id} 恢复旧基线。` }
}

function statusColor(status: BatchStatus) {
  return { 待确认: 'warning', 试运行: 'info', 已切换: 'success', 已回滚: 'error' }[status] as string
}

function deviceName(id: string) {
  return store.devices.find((device) => device.id === id)?.name ?? id
}

function pointName(oldId: string) {
  const item = batch.value?.deviceItems.find((entry) => entry.oldId === oldId)
  if (item) return item.name
  return deviceName(oldId)
}

function matchedCount(item: MigrationBatch) {
  return [...item.deviceItems, ...item.ruleItems].filter((entry) => entry.confirmed && !entry.discarded).length
}
</script>

<template>
  <section class="page">
    <div class="page-head">
      <div><p class="eyebrow">LEGACY MIGRATION / 旧数据迁移</p><h1>旧主机备份迁移批次</h1><p class="muted">粘贴旧机备份后先确认可对应内容，再生成试运行修订；切换异常可按批次号恢复。</p></div>
      <v-chip variant="tonal" :color="migration.activeTrialBatch ? 'info' : 'success'" prepend-icon="mdi-database-sync-outline">
        {{ migration.activeTrialBatch ? `试运行中 ${migration.activeTrialBatch.trialRevision}` : '无进行中的试运行' }}
      </v-chip>
    </div>

    <v-alert v-if="feedback" :type="feedback.type" variant="tonal" density="compact" class="mb-3" closable @click:close="feedback = null">{{ feedback.text }}</v-alert>

    <section class="panel submit-panel">
      <div class="panel-head"><h3>提交旧机备份</h3><span class="muted">重复提交同一备份只保留第一次解析结果</span></div>
      <div class="submit-body">
        <v-text-field v-model="source" label="旧主机标识" density="compact" hide-details style="max-width:220px" />
        <v-textarea v-model="backupText" label="粘贴旧机备份文本（设备行：编号,名称,类型,楼层,分区,地址；规则行：旧规则号,触发,动作,延时）" rows="5" density="compact" hide-details auto-grow />
        <div class="submit-actions">
          <v-btn variant="outlined" prepend-icon="mdi-file-document-outline" @click="backupText = sampleBackup">载入示例备份</v-btn>
          <v-btn color="primary" prepend-icon="mdi-database-import-outline" :disabled="!backupText.trim()" @click="submit">解析提交</v-btn>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>迁移批次</h3><v-chip size="small" variant="tonal">{{ migration.batches.length }} 个批次</v-chip></div>
      <v-table hover density="compact">
        <thead><tr><th>批次号</th><th>来源</th><th>提交时间</th><th>状态</th><th>直接对应</th><th>待确认</th><th>试运行修订</th><th></th></tr></thead>
        <tbody>
          <tr v-for="item in migration.batches" :key="item.id" :class="{ 'active-row': item.id === migration.selectedBatchId }">
            <td class="mono">{{ item.id }}</td>
            <td>{{ item.source }}</td>
            <td class="muted">{{ item.createdAt }}</td>
            <td><v-chip size="small" :color="statusColor(item.status)" variant="tonal">{{ item.status }}</v-chip></td>
            <td>{{ matchedCount(item) }} 项</td>
            <td>{{ migration.pendingDevices(item).length + migration.pendingRules(item).length }} 项</td>
            <td class="mono">{{ item.trialRevision ?? '—' }}</td>
            <td><v-btn size="small" variant="text" @click="migration.selectedBatchId = item.id">查看</v-btn></td>
          </tr>
          <tr v-if="migration.batches.length === 0"><td colspan="8" class="empty-cell">暂无迁移批次，请先提交旧机备份。</td></tr>
        </tbody>
      </v-table>
    </section>

    <template v-if="batch">
      <section class="panel detail-panel">
        <div class="panel-head">
          <h3>批次 {{ batch.id }} · {{ batch.source }}</h3>
          <div class="head-actions">
            <v-chip size="small" :color="statusColor(batch.status)" variant="tonal">{{ batch.status }}</v-chip>
            <v-btn v-if="batch.status === '待确认'" color="primary" size="small" prepend-icon="mdi-rocket-launch-outline" :disabled="!migration.allResolved(batch) || !!migration.activeTrialBatch" @click="generateTrial">生成试运行修订</v-btn>
            <template v-if="batch.status === '试运行'">
              <v-btn color="success" size="small" prepend-icon="mdi-swap-horizontal" @click="cutover">切换上线</v-btn>
              <v-btn color="error" variant="outlined" size="small" prepend-icon="mdi-backup-restore" @click="rollback">迁移失败 · 按批次号恢复</v-btn>
            </template>
            <v-btn v-if="batch.status === '已切换'" color="error" variant="outlined" size="small" prepend-icon="mdi-backup-restore" @click="rollback">按批次号恢复</v-btn>
          </div>
        </div>

        <v-alert v-if="batch.status === '待确认' && !migration.allResolved(batch)" type="warning" variant="tonal" density="compact" class="ma-3">
          还有 {{ pendingDevices.length + pendingRules.length }} 项待确认：地址重复、类型未知或延时单位不明的记录已按原样保留，确认或丢弃后才能生成试运行修订。
        </v-alert>
        <v-alert v-else-if="batch.status === '待确认' && migration.activeTrialBatch" type="info" variant="tonal" density="compact" class="ma-3">
          批次 {{ migration.activeTrialBatch.id }} 正在试运行，需先切换或恢复后才能生成新的试运行修订。
        </v-alert>
        <v-alert v-else-if="batch.status === '试运行'" type="info" variant="tonal" density="compact" class="ma-3">
          试运行修订 {{ batch.trialRevision }} 进行中：台账与矩阵中的新改动只写入试运行草稿，不进入正式基线；旧规则编号和签字记录继续可查。
        </v-alert>
        <v-alert v-else-if="batch.status === '已回滚'" type="error" variant="tonal" density="compact" class="ma-3">
          该批次已按批次号恢复旧基线，导入的点位与规则已移除，记录保留备查。
        </v-alert>

        <div class="detail-grid">
          <div class="detail-block">
            <h4><v-icon icon="mdi-check-circle-outline" color="success" size="18" /> 能直接对应（{{ matchedDevices.length + matchedRules.length }}）</h4>
            <v-table density="compact">
              <thead><tr><th>旧编号</th><th>名称 / 规则</th><th>对应结果</th><th>新编号</th></tr></thead>
              <tbody>
                <tr v-for="item in matchedDevices" :key="item.key">
                  <td class="mono">{{ item.oldId }}</td>
                  <td>{{ item.name }}<br /><small class="muted">{{ item.type }} · {{ item.floor }} / {{ item.zone }} · {{ item.address }}</small></td>
                  <td><v-chip size="x-small" color="success" variant="tonal">直接对应</v-chip></td>
                  <td class="mono">{{ item.newId ?? '待导入' }}</td>
                </tr>
                <tr v-for="item in matchedRules" :key="item.key">
                  <td class="mono">{{ item.oldRuleId }}</td>
                  <td>{{ pointName(item.triggerOldId) }} → {{ pointName(item.actionOldId) }}<br /><small class="muted">延时 {{ item.delay }}s（原始 {{ item.rawDelay }}）</small></td>
                  <td><v-chip size="x-small" color="success" variant="tonal">直接对应</v-chip></td>
                  <td class="mono">{{ item.newId ?? '待导入' }}</td>
                </tr>
                <tr v-if="matchedDevices.length + matchedRules.length === 0"><td colspan="4" class="empty-cell">暂无可直接对应的内容。</td></tr>
              </tbody>
            </v-table>
          </div>

          <div class="detail-block">
            <h4><v-icon icon="mdi-progress-question" color="warning" size="18" /> 待确认 · 原样保留（{{ pendingDevices.length + pendingRules.length }}）</h4>
            <article v-for="item in pendingDevices" :key="item.key" class="pending-item">
              <div class="pending-head">
                <strong class="mono">{{ item.oldId }}</strong><span>{{ item.name }}</span>
                <v-chip v-for="issue in item.issues" :key="issue" size="x-small" color="warning" variant="tonal">{{ issue }}</v-chip>
              </div>
              <p class="raw">原始记录：{{ item.rawType }} · {{ item.floor }} / {{ item.zone }} · {{ item.address }}</p>
              <div class="fix-row">
                <v-select v-model="deviceEdit(item).type" :items="KNOWN_TYPES" label="设备类型" density="compact" hide-details :error="!deviceEdit(item).type" />
                <v-text-field v-model="deviceEdit(item).address" label="回路地址" density="compact" hide-details />
                <v-text-field v-model="deviceEdit(item).zone" label="防火分区" density="compact" hide-details />
                <v-btn size="small" color="primary" variant="tonal" :disabled="!deviceEdit(item).type" @click="confirmDevice(item)">确认</v-btn>
                <v-btn size="small" variant="text" @click="migration.discardItem(batch.id, item.key)">丢弃</v-btn>
              </div>
            </article>
            <article v-for="item in pendingRules" :key="item.key" class="pending-item">
              <div class="pending-head">
                <strong class="mono">{{ item.oldRuleId }}</strong><span>{{ item.triggerOldId }} → {{ item.actionOldId }}</span>
                <v-chip v-for="issue in item.issues" :key="issue" size="x-small" color="warning" variant="tonal">{{ issue }}</v-chip>
              </div>
              <p class="raw">原始记录：延时「{{ item.rawDelay }}」</p>
              <div class="fix-row">
                <v-text-field v-model.number="ruleEdit(item).delayValue" type="number" label="延时值" density="compact" hide-details style="max-width:96px" />
                <v-select v-model="ruleEdit(item).delayUnit" :items="[{ title: '秒 (s)', value: 's' }, { title: '毫秒 (ms)', value: 'ms' }]" label="单位" density="compact" hide-details style="max-width:110px" />
                <v-text-field v-model="ruleEdit(item).triggerOldId" label="触发点位" density="compact" hide-details />
                <v-text-field v-model="ruleEdit(item).actionOldId" label="动作点位" density="compact" hide-details />
                <v-btn size="small" color="primary" variant="tonal" @click="confirmRule(item)">确认</v-btn>
                <v-btn size="small" variant="text" @click="migration.discardItem(batch.id, item.key)">丢弃</v-btn>
              </div>
            </article>
            <p v-if="pendingDevices.length + pendingRules.length === 0" class="empty-cell">无待确认项。</p>
            <p v-if="discardedItems.length" class="muted discarded">已丢弃（保留在批次记录中）：{{ discardedItems.join('、') }}</p>
          </div>
        </div>

        <div v-if="batch.cutoverFlags.length" class="reconfirm-block">
          <h4><v-icon icon="mdi-alert-decagram-outline" color="error" size="18" /> 切换后点位异常与规则重新确认</h4>
          <div class="flag-list">
            <v-chip v-for="flag in batch.cutoverFlags" :key="flag.deviceId" size="small" color="error" variant="tonal" prepend-icon="mdi-map-marker-alert-outline">
              {{ flag.deviceName }}（{{ flag.deviceId }}）：{{ flag.issues.join('、') }}
            </v-chip>
          </div>
          <v-table density="compact">
            <thead><tr><th>规则</th><th>旧规则编号</th><th>触发 → 动作</th><th>状态</th><th></th></tr></thead>
            <tbody>
              <tr v-for="ruleId in batch.reconfirmRuleIds" :key="ruleId">
                <td class="mono">{{ ruleId }}</td>
                <td class="mono">{{ store.rules.find((rule) => rule.id === ruleId)?.legacyId ?? '—' }}</td>
                <td>{{ deviceName(store.rules.find((rule) => rule.id === ruleId)?.triggerId ?? '') }} → {{ deviceName(store.rules.find((rule) => rule.id === ruleId)?.actionId ?? '') }}</td>
                <td><v-chip size="x-small" color="warning" variant="tonal">需重新确认</v-chip></td>
                <td><v-btn size="small" color="primary" variant="tonal" @click="migration.reconfirmRule(batch.id, ruleId)">确认</v-btn></td>
              </tr>
              <tr v-if="batch.reconfirmRuleIds.length === 0"><td colspan="5" class="empty-cell">引用异常点位的规则均已重新确认。</td></tr>
            </tbody>
          </v-table>
        </div>

        <div v-if="batch.reviewItems.length" class="reconfirm-block">
          <h4><v-icon icon="mdi-clipboard-check-outline" size="18" /> 迁移审阅项</h4>
          <div class="review-items">
            <div v-for="item in batch.reviewItems" :key="item.id" class="review-item" :class="item.status === '退回' ? 'returned' : ''">
              <span>{{ item.title }}</span>
              <small v-if="item.reason" class="muted">{{ item.reason }}</small>
              <v-chip size="x-small" :color="item.status === '退回' ? 'error' : 'success'" variant="tonal">{{ item.status === '退回' ? '退回' : '继续使用' }}</v-chip>
            </div>
          </div>
        </div>

        <div class="detail-grid bottom-grid">
          <div class="detail-block">
            <h4><v-icon icon="mdi-draw-pen" size="18" /> 签字记录</h4>
            <div class="sign-list">
              <div v-for="(sign, index) in batch.signatures" :key="index">
                <strong>{{ sign.user }}</strong><span>{{ sign.action }}</span><small class="muted">{{ sign.at }}</small>
              </div>
            </div>
          </div>
          <div class="detail-block">
            <h4><v-icon icon="mdi-tag-search-outline" size="18" /> 旧规则编号查询</h4>
            <div class="legacy-query">
              <v-text-field v-model="legacyQuery" label="输入旧规则编号，如 LG-01" density="compact" hide-details prepend-inner-icon="mdi-magnify" />
              <div v-if="legacyResult" class="legacy-result">
                <p><strong>{{ legacyResult.item.oldRuleId }}</strong>（批次 {{ legacyResult.batch.id }}）
                  <v-chip size="x-small" :color="statusColor(legacyResult.batch.status)" variant="tonal">{{ legacyResult.batch.status }}</v-chip>
                </p>
                <p v-if="legacyResult.rule">现行规则 <span class="mono">{{ legacyResult.rule.id }}</span> · 延时 {{ legacyResult.rule.delay }}s · {{ legacyResult.rule.enabled ? '启用' : '停用' }}<v-chip v-if="legacyResult.rule.needsReconfirm" size="x-small" color="warning" variant="tonal" class="ml-1">需重新确认</v-chip></p>
                <p v-else-if="legacyResult.item.discarded" class="muted">该规则在确认阶段被丢弃，未导入。</p>
                <p v-else class="muted">尚未生成对应规则。</p>
              </div>
              <p v-else-if="legacyQuery.trim()" class="muted no-hit">未找到该旧规则编号。</p>
            </div>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.submit-panel { margin-bottom: 14px; }
.submit-body { display: grid; gap: 12px; padding: 14px 16px 16px; }
.submit-actions { display: flex; justify-content: flex-end; gap: 8px; }
.panel { margin-bottom: 14px; }
.mono { color: #267078; font-family: ui-monospace,monospace; font-weight: 700; }
.muted { color: #849096; }
.active-row { background: #f4f8f8; }
.empty-cell { padding: 18px; color: #849096; text-align: center; }
.head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 4px 16px 16px; }
.detail-block h4, .reconfirm-block h4 { display: flex; align-items: center; gap: 6px; margin: 12px 0 8px; font-size: 13px; }
.detail-block :deep(table) { min-width: 0; }
.pending-item { margin-bottom: 10px; padding: 10px 12px; border: 1px solid #eadfc8; border-radius: 8px; background: #fdf9f1; }
.pending-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.raw { margin: 6px 0; color: #8a7a52; font-size: 12px; }
.fix-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.discarded { margin-top: 8px; font-size: 12px; }
.reconfirm-block { padding: 4px 16px 16px; }
.flag-list { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.review-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
.review-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 12px; border: 1px solid #e3e9e9; border-radius: 8px; font-size: 12px; }
.review-item.returned { border-color: #ecc9c2; background: #fdf3f1; }
.review-item small { display: block; color: #9a7b72; }
.sign-list { display: grid; gap: 8px; padding-bottom: 8px; }
.sign-list > div { display: grid; grid-template-columns: 86px 1fr auto; gap: 10px; align-items: baseline; padding: 8px 10px; border-left: 3px solid #265e66; background: #f6f9f9; border-radius: 0 8px 8px 0; font-size: 12px; }
.legacy-query { display: grid; gap: 10px; }
.legacy-result { padding: 10px 12px; border: 1px solid #dfe7e7; border-radius: 8px; font-size: 12px; }
.legacy-result p { margin: 4px 0; }
.no-hit { font-size: 12px; }
.bottom-grid { padding-bottom: 18px; }
@media (max-width: 1000px) { .detail-grid { grid-template-columns: 1fr; } }
</style>
