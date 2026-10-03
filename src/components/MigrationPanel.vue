<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLinkageStore } from '../stores/linkage'
import { useMigrationStore, SAMPLE_BACKUP, type MigrationBatch, type MigrationDeviceItem, type MigrationRuleItem } from '../stores/migration'

const props = defineProps<{ scope: 'devices' | 'matrix' | 'review' }>()

const store = useLinkageStore()
const migration = useMigrationStore()

const backupText = ref('')
const parseMsg = ref<{ type: 'error' | 'success' | 'warning'; text: string } | null>(null)

const batch = computed<MigrationBatch | null>(() => migration.activeBatch)
const deviceItems = computed<MigrationDeviceItem[]>(() => batch.value?.deviceItems ?? [])
const ruleItems = computed<MigrationRuleItem[]>(() => batch.value?.ruleItems ?? [])
const directDevices = computed(() => deviceItems.value.filter((item) => item.match === 'direct'))
const pendingDevices = computed(() => deviceItems.value.filter((item) => item.match === 'pending'))
const directRules = computed(() => ruleItems.value.filter((item) => item.match === 'direct'))
const pendingRules = computed(() => ruleItems.value.filter((item) => item.match === 'pending'))

const statusMeta: Record<MigrationBatch['status'], { label: string; color: string }> = {
  parsed: { label: '已解析待确认', color: 'info' },
  trial: { label: '试运行修订中', color: 'warning' },
  switched: { label: '已切换正式基线', color: 'success' },
  failed: { label: '迁移失败已恢复', color: 'error' },
}

function fillSample() {
  backupText.value = SAMPLE_BACKUP
  parseMsg.value = null
}

function doParse() {
  const result = migration.parseBackup(backupText.value)
  if (result.ok) {
    parseMsg.value = { type: 'success', text: `已解析备份 ${result.batch!.id}：直接对应 ${directDevices.value.length + directRules.value.length} 项，待确认 ${pendingDevices.value.length + pendingRules.value.length} 项。` }
    backupText.value = ''
  } else if (result.duplicate) {
    parseMsg.value = { type: 'warning', text: `该备份已提交过（批次 ${result.batch!.id}），重复提交只保留第一次结果，已为你定位到该批次。` }
  } else {
    parseMsg.value = { type: 'error', text: result.error ?? '解析失败。' }
  }
}

function doConfirm() {
  if (!batch.value) return
  migration.confirmBatch(batch.value.id)
  parseMsg.value = { type: 'success', text: `已生成试运行修订 R${batch.value.trialRevision}。试运行期间新改动不写正式基线，旧规则编号与签字记录继续可查。` }
}

function doSwitchOver() {
  if (!batch.value) return
  migration.switchOver(batch.value.id)
  const reconfirm = batch.value.reconfirmRuleIds.length
  const returned = batch.value.returnedReviewItemIds.length
  parseMsg.value = { type: 'success', text: `已切换为正式基线。${reconfirm} 条规则需重新确认引用，${returned} 项审阅件已退回，其余继续使用。` }
}

function doFailRestore() {
  if (!batch.value) return
  migration.failAndRestore(batch.value.id, '调试组确认切换失败，按原批次号恢复到切换前基线。')
  parseMsg.value = { type: 'warning', text: `迁移失败，已按批次号 ${batch.value.id} 恢复到切换前正式基线。` }
}

function reviewTitle(id: string): string {
  return store.reviewItems.find((item) => item.id === id)?.title ?? id
}

function deviceName(item: MigrationDeviceItem): string {
  return item.matchedDeviceId ? store.devices.find((d) => d.id === item.matchedDeviceId)?.name ?? '' : ''
}
</script>

<template>
  <section class="panel migration-panel">
    <div class="panel-head">
      <div class="head-title">
        <h3>旧机数据迁移批次</h3>
        <span v-if="batch" class="muted">{{ batch.id }} · {{ batch.project }}</span>
      </div>
      <div class="head-actions">
        <v-chip v-if="batch" size="small" :color="statusMeta[batch.status].color" variant="tonal">{{ statusMeta[batch.status].label }}</v-chip>
        <v-chip v-if="store.isTrial" size="small" color="warning" variant="outlined" prepend-icon="mdi-flask-outline">试运行沙箱</v-chip>
      </div>
    </div>

    <div class="batch-body">
      <div class="batch-history">
        <span class="muted">批次：</span>
        <v-chip
          v-for="item in migration.batches"
          :key="item.id"
          size="small"
          :color="item.id === batch?.id ? statusMeta[item.status].color : undefined"
          :variant="item.id === batch?.id ? 'tonal' : 'outlined'"
          class="batch-chip"
          @click="migration.selectBatch(item.id)"
        >{{ item.id }}</v-chip>
        <span v-if="migration.batches.length === 0" class="muted">暂无迁移批次</span>
      </div>

      <v-text-field
        v-model="backupText"
        label="粘贴旧机备份（JSON）"
        placeholder='粘贴主机导出的设备 / 规则 / 签字备份，例如 { "设备": [...], "规则": [...] }'
        density="compact"
        hide-details
        class="backup-input"
      />
      <div class="paste-actions">
        <v-btn size="small" variant="tonal" prepend-icon="mdi-clipboard-text-outline" @click="doParse">解析备份</v-btn>
        <v-btn size="small" variant="text" @click="fillSample">填充示例备份</v-btn>
        <span v-if="parseMsg" class="parse-msg" :class="parseMsg.type">{{ parseMsg.text }}</span>
      </div>

      <template v-if="batch">
        <div class="count-row">
          <v-chip size="small" color="success" variant="tonal">直接对应 {{ directDevices.length + directRules.length }} 项</v-chip>
          <v-chip size="small" color="warning" variant="tonal">待确认 {{ pendingDevices.length + pendingRules.length }} 项</v-chip>
          <v-chip v-if="batch.status === 'trial'" size="small" color="info" variant="tonal">试运行修订 R{{ batch.trialRevision }}</v-chip>
        </div>

        <!-- 设备台账 -->
        <div v-if="scope === 'devices' || scope === 'review'" class="section">
          <div class="section-head"><h4>设备对应</h4><span class="muted">按回路地址匹配；地址重复、类型未知的原样保留待确认</span></div>
          <v-table density="compact" class="mig-table">
            <thead><tr><th>旧编号</th><th>旧名称</th><th>旧类型</th><th>旧地址</th><th>对应新平台</th><th>判定</th></tr></thead>
            <tbody>
              <tr v-for="item in deviceItems" :key="item.key" :class="{ 'row-pending': item.match === 'pending' }">
                <td class="mono">{{ item.legacy.编号 }}</td>
                <td>{{ item.legacy.名称 }}</td>
                <td>{{ item.legacy.类型 }}</td>
                <td class="mono">{{ item.legacy.地址 }}</td>
                <td>
                  <template v-if="item.match === 'direct'">
                    <span v-if="item.relation === 'match'">{{ deviceName(item) }} <span class="muted">({{ item.matchedDeviceId }})</span></span>
                    <v-chip v-else size="x-small" color="success" variant="tonal">新增点位</v-chip>
                  </template>
                  <span v-else class="muted">原样保留待确认</span>
                </td>
                <td>
                  <v-chip v-if="item.match === 'direct'" size="x-small" color="success" variant="tonal">直接对应</v-chip>
                  <template v-else>
                    <v-chip v-for="issue in item.issues" :key="issue" size="x-small" color="warning" variant="tonal" class="issue-chip">{{ issue }}</v-chip>
                  </template>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>

        <!-- 因果矩阵 -->
        <div v-if="scope === 'matrix' || scope === 'review'" class="section">
          <div class="section-head"><h4>规则对应</h4><span class="muted">延时单位不明的原样保留；旧规则编号继续可查</span></div>
          <v-table density="compact" class="mig-table">
            <thead><tr><th>旧规则编号</th><th>触发 → 动作</th><th>旧延时</th><th>对应新规则</th><th>判定</th></tr></thead>
            <tbody>
              <tr v-for="item in ruleItems" :key="item.key" :class="{ 'row-pending': item.match === 'pending' }">
                <td class="mono">{{ item.oldNumber || '—' }}</td>
                <td>{{ item.legacy.触发 }} → {{ item.legacy.动作 }}</td>
                <td>
                  <span v-if="item.match === 'direct'" class="mono">{{ item.delaySeconds }}s</span>
                  <span v-else class="muted mono">{{ item.legacy.延时 }}（原样保留）</span>
                </td>
                <td>
                  <template v-if="item.match === 'direct'">
                    <span v-if="item.relation === 'match'" class="mono">{{ item.matchedRuleId }}</span>
                    <v-chip v-else size="x-small" color="success" variant="tonal">新增规则</v-chip>
                  </template>
                  <span v-else class="muted">待确认</span>
                </td>
                <td>
                  <v-chip v-if="item.match === 'direct'" size="x-small" color="success" variant="tonal">直接对应</v-chip>
                  <template v-else>
                    <v-chip v-for="issue in item.issues" :key="issue" size="x-small" color="warning" variant="tonal" class="issue-chip">{{ issue }}</v-chip>
                  </template>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>

        <!-- 签字记录 -->
        <div v-if="scope === 'review'" class="section">
          <div class="section-head"><h4>旧机签字记录</h4><span class="muted">切换后继续可查</span></div>
          <div v-if="batch.signatures.length" class="signature-list">
            <div v-for="sign in batch.signatures" :key="sign.编号" class="signature-item">
              <v-icon icon="mdi-pen-nib" size="small" color="secondary" />
              <div><strong>{{ sign.签字人 }}</strong><span class="muted"> · {{ sign.时间 }}</span><p>{{ sign.内容 }}</p></div>
            </div>
          </div>
          <span v-else class="muted">备份中未包含签字记录。</span>
        </div>

        <!-- 切换后：重新确认规则 -->
        <div v-if="scope === 'review' && batch.status === 'switched'" class="section">
          <div class="section-head"><h4>需重新确认的引用规则</h4><span class="muted">地址重复占用或跨区变化的点位，其引用规则重新确认后继续使用</span></div>
          <div v-if="batch.reconfirmRuleIds.length" class="reconfirm-list">
            <div v-for="ruleId in batch.reconfirmRuleIds" :key="ruleId" class="reconfirm-item">
              <span class="mono">{{ ruleId }}</span>
              <span class="muted">{{ store.rules.find((r) => r.id === ruleId)?.interlock }}</span>
              <v-btn size="x-small" variant="tonal" color="primary" @click="migration.reconfirmRule(batch.id, ruleId)">重新确认</v-btn>
            </div>
          </div>
          <span v-else class="muted">全部引用规则已确认。</span>
        </div>

        <!-- 切换后：退回的审阅项 -->
        <div v-if="scope === 'review' && batch.status === 'switched'" class="section">
          <div class="section-head"><h4>退回的审阅项</h4><span class="muted">点位失效的审阅项一起退回，其余继续使用</span></div>
          <div v-if="batch.returnedReviewItemIds.length" class="return-list">
            <v-chip v-for="id in batch.returnedReviewItemIds" :key="id" size="small" color="error" variant="tonal" prepend-icon="mdi-undo-variant" class="return-chip">{{ id }} · {{ reviewTitle(id) }}</v-chip>
          </div>
          <span v-else class="muted">无退回审阅项。</span>
        </div>

        <!-- 失败原因 -->
        <v-alert v-if="batch.status === 'failed'" type="error" variant="tonal" density="compact" class="mt-3">
          批次 {{ batch.id }} 迁移失败：{{ batch.failureReason }}。已按原批次号恢复到切换前正式基线。
        </v-alert>

        <!-- 操作 -->
        <div class="batch-actions">
          <v-btn
            v-if="batch.status === 'parsed'"
            color="primary"
            prepend-icon="mdi-flask-outline"
            @click="doConfirm"
          >确认并生成试运行修订</v-btn>
          <template v-if="batch.status === 'trial'">
            <v-btn color="success" prepend-icon="mdi-check-decagram-outline" @click="doSwitchOver">切换为正式基线</v-btn>
            <v-btn color="error" variant="outlined" prepend-icon="mdi-undo-variant" @click="doFailRestore">迁移失败并按批次号恢复</v-btn>
          </template>
          <span v-if="batch.status === 'trial'" class="muted">试运行期间新改动不写正式基线。</span>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.migration-panel { margin-bottom: 16px; }
.head-title { display: flex; align-items: baseline; gap: 10px; }
.head-title h3 { margin: 0; font-size: 15px; }
.head-actions { display: flex; gap: 6px; }
.batch-body { padding: 14px 16px 16px; }
.batch-history { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.batch-chip { cursor: pointer; }
.backup-input { margin-bottom: 8px; }
.paste-actions { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.parse-msg { font-size: 12px; }
.parse-msg.error { color: #b53c2a; }
.parse-msg.success { color: #2e755e; }
.parse-msg.warning { color: #b87b22; }
.count-row { display: flex; gap: 8px; margin: 6px 0 14px; }
.section { margin-bottom: 16px; }
.section-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.section-head h4 { margin: 0; font-size: 13px; }
.mig-table :deep(td) { font-size: 12px; }
.row-pending { background: #fdf6ec; }
.issue-chip { margin-right: 4px; }
.signature-list, .reconfirm-list, .return-list { display: flex; flex-direction: column; gap: 8px; }
.signature-item { display: flex; gap: 10px; padding: 8px 10px; border: 1px solid #e7ebeb; border-radius: 8px; }
.signature-item p { margin: 3px 0 0; font-size: 12px; color: #59676d; }
.reconfirm-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid #f0e0c8; border-radius: 8px; background: #fdf8f0; }
.return-chip { align-self: flex-start; }
.batch-actions { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.mono { color: #267078; font-family: ui-monospace, monospace; font-weight: 700; }
</style>
