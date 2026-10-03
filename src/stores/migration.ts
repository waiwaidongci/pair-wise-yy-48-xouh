import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useLinkageStore, type BaselineSnapshot, type DeviceType } from './linkage'

export type MigrationStatus = 'parsed' | 'trial' | 'switched' | 'failed'
export type MigrationIssue = '地址重复' | '类型未知' | '延时单位不明' | '引用点位待确认'
export type MigrationMatch = 'direct' | 'pending'

export type LegacyDevice = Record<string, unknown> & {
  编号?: string
  名称?: string
  类型?: string
  楼层?: string
  分区?: string
  地址?: string
}
export type LegacyRule = Record<string, unknown> & {
  规则编号?: string
  触发?: string
  动作?: string
  延时?: string | number
  互锁?: string
  优先级?: string | number
  抑制?: string
  启用?: boolean
}
export type LegacySignature = { 编号?: string; 签字人?: string; 时间?: string; 内容?: string }

export type MigrationDeviceItem = {
  key: string
  legacy: LegacyDevice
  match: MigrationMatch
  relation: 'match' | 'new'
  issues: MigrationIssue[]
  matchedDeviceId?: string
}
export type MigrationRuleItem = {
  key: string
  legacy: LegacyRule
  match: MigrationMatch
  relation: 'match' | 'new'
  issues: MigrationIssue[]
  matchedRuleId?: string
  oldNumber: string
  delaySeconds: number | null
  delayUnit: string
}

export type MigrationBatch = {
  id: string
  createdAt: number
  status: MigrationStatus
  backupHash: string
  rawBackup: string
  project: string
  deviceItems: MigrationDeviceItem[]
  ruleItems: MigrationRuleItem[]
  signatures: LegacySignature[]
  baselineSnapshot: BaselineSnapshot | null
  trialRevision: number | null
  reconfirmRuleIds: string[]
  returnedReviewItemIds: string[]
  failureReason: string
  switchedAt: number | null
}

const KNOWN_TYPES: DeviceType[] = ['感烟探测器', '感温探测器', '手动报警按钮', '输入模块', '输出模块', '排烟风机', '防火卷帘', '消防广播', '电梯']

export const SAMPLE_BACKUP = `{
  "项目": "滨江研发中心消防主机旧机备份",
  "备份时间": "2026-09-28 02:00:00",
  "设备": [
    { "编号": "D-01-01", "名称": "一层大厅感烟 01", "类型": "感烟探测器", "楼层": "1F", "分区": "A 区", "地址": "1-A-01-01" },
    { "编号": "D-01-02", "名称": "一层大厅感烟 02", "类型": "感烟探测器", "楼层": "1F", "分区": "A 区", "地址": "1-A-01-02" },
    { "编号": "D-01-11", "名称": "一层东侧手报", "类型": "手动报警按钮", "楼层": "1F", "分区": "A 区", "地址": "1-A-02-01" },
    { "编号": "A-01-01", "名称": "一层排烟风机 PF-1", "类型": "排烟风机", "楼层": "1F", "分区": "A 区", "地址": "1-F-01-01" },
    { "编号": "A-01-02", "名称": "中庭防火卷帘 01", "类型": "防火卷帘", "楼层": "1F", "分区": "中庭", "地址": "1-R-01-01" },
    { "编号": "A-01-03", "名称": "一层消防广播", "类型": "消防广播", "楼层": "1F", "分区": "A 区", "地址": "1-B-01-01" },
    { "编号": "D-02-01", "名称": "二层机房感温 01", "类型": "感温探测器", "楼层": "2F", "分区": "B 区", "地址": "2-B-01-01" },
    { "编号": "D-02-02", "名称": "二层机房感烟 01", "类型": "感烟探测器", "楼层": "2F", "分区": "B 区", "地址": "2-B-01-02" },
    { "编号": "A-02-01", "名称": "二层排烟风机 PF-2", "类型": "排烟风机", "楼层": "2F", "分区": "A 区", "地址": "2-F-01-01" },
    { "编号": "A-02-02", "名称": "1 号客梯归位", "类型": "电梯", "楼层": "2F", "分区": "B 区", "地址": "2-L-01-01" },
    { "编号": "D-03-01", "名称": "三层走廊感烟 01", "类型": "感烟探测器", "楼层": "3F", "分区": "C 区", "地址": "3-C-01-01" },
    { "编号": "D-03-02", "名称": "三层走廊感烟 02", "类型": "感烟探测器", "楼层": "3F", "分区": "C 区", "地址": "3-C-01-01" },
    { "编号": "X-01-01", "名称": "一层线型光束感烟", "类型": "线型光束感烟探测器", "楼层": "1F", "分区": "中庭", "地址": "1-A-03-01" }
  ],
  "规则": [
    { "规则编号": "R-001", "触发": "D-01-01", "动作": "A-01-01", "延时": "0s", "互锁": "卷帘全开后启动", "优先级": 1, "抑制": "无", "启用": true },
    { "规则编号": "R-002", "触发": "D-01-01", "动作": "A-01-03", "延时": "5s", "互锁": "无", "优先级": 2, "抑制": "手动广播优先", "启用": true },
    { "规则编号": "R-003", "触发": "D-01-02", "动作": "A-01-02", "延时": "0s", "互锁": "排烟风机运行", "优先级": 1, "抑制": "无", "启用": true },
    { "规则编号": "R-004", "触发": "D-01-11", "动作": "A-01-03", "延时": "3s", "互锁": "无", "优先级": 1, "抑制": "无", "启用": true },
    { "规则编号": "R-005", "触发": "D-02-01", "动作": "A-02-01", "延时": "0s", "互锁": "防火阀开启反馈", "优先级": 1, "抑制": "无", "启用": true },
    { "规则编号": "R-006", "触发": "D-02-01", "动作": "A-02-02", "延时": "10s", "互锁": "轿厢无人确认", "优先级": 2, "抑制": "消防电梯模式", "启用": true },
    { "规则编号": "R-007", "触发": "D-02-02", "动作": "A-01-01", "延时": "0s", "互锁": "无", "优先级": 3, "抑制": "无", "启用": false },
    { "规则编号": "R-008", "触发": "D-01-01", "动作": "A-02-02", "延时": "0s", "互锁": "无", "优先级": 1, "抑制": "无", "启用": true },
    { "规则编号": "R-009", "触发": "D-03-01", "动作": "A-02-01", "延时": "3", "互锁": "无", "优先级": 2, "抑制": "无", "启用": true },
    { "规则编号": "R-010", "触发": "D-03-02", "动作": "A-02-02", "延时": "3000", "互锁": "无", "优先级": 2, "抑制": "无", "启用": true }
  ],
  "签字": [
    { "编号": "S-01", "签字人": "张建国", "时间": "2026-09-20", "内容": "设备地址与竣工图一致" },
    { "编号": "S-02", "签字人": "李伟", "时间": "2026-09-22", "内容": "联动逻辑调试完成" },
    { "编号": "S-03", "签字人": "王芳", "时间": "2026-09-25", "内容": "旧机备份数据核对无误" }
  ]
}`

function hashString(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0
  return `h${hash.toString(16)}`
}

// 解析延时：识别 s / ms 单位；纯数字或无法识别则单位不明
function parseDelay(raw: unknown): { seconds: number | null; unit: string; clear: boolean } {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { seconds: null, unit: '', clear: false }
  const str = String(raw ?? '').trim()
  if (!str) return { seconds: null, unit: '', clear: false }
  const msMatch = str.match(/^(\d+(?:\.\d+)?)\s*ms$/i)
  if (msMatch) return { seconds: parseFloat(msMatch[1]) / 1000, unit: 'ms', clear: true }
  const sMatch = str.match(/^(\d+(?:\.\d+)?)\s*s$/i)
  if (sMatch) return { seconds: parseFloat(sMatch[1]), unit: 's', clear: true }
  if (/^\d+(\.\d+)?$/.test(str)) return { seconds: null, unit: '', clear: false }
  return { seconds: null, unit: str, clear: false }
}

function classifyDevices(legacyDevices: LegacyDevice[], currentDevices: { id: string; address: string }[]): MigrationDeviceItem[] {
  const addressCount = new Map<string, number>()
  legacyDevices.forEach((d) => {
    const addr = String(d.地址 ?? '').trim()
    if (addr) addressCount.set(addr, (addressCount.get(addr) ?? 0) + 1)
  })
  return legacyDevices.map((legacy, index) => {
    const issues: MigrationIssue[] = []
    const addr = String(legacy.地址 ?? '').trim()
    const type = String(legacy.类型 ?? '').trim()
    if (addr && (addressCount.get(addr) ?? 0) > 1) issues.push('地址重复')
    if (!KNOWN_TYPES.includes(type as DeviceType)) issues.push('类型未知')
    const matched = currentDevices.find((d) => d.address === addr)
    return {
      key: `dev-${index}-${addr || index}`,
      legacy,
      match: issues.length === 0 ? 'direct' : 'pending',
      relation: matched ? 'match' : 'new',
      issues,
      matchedDeviceId: matched?.id,
    }
  })
}

function classifyRules(legacyRules: LegacyRule[], deviceItems: MigrationDeviceItem[], currentRules: { id: string }[]): MigrationRuleItem[] {
  return legacyRules.map((legacy, index) => {
    const issues: MigrationIssue[] = []
    const oldNumber = String(legacy.规则编号 ?? '').trim()
    const delay = parseDelay(legacy.延时)
    if (!delay.clear) issues.push('延时单位不明')
    const triggerRef = String(legacy.触发 ?? '').trim()
    const actionRef = String(legacy.动作 ?? '').trim()
    const triggerItem = deviceItems.find((item) => String(item.legacy.编号 ?? '').trim() === triggerRef)
    const actionItem = deviceItems.find((item) => String(item.legacy.编号 ?? '').trim() === actionRef)
    if (triggerItem?.match === 'pending' || actionItem?.match === 'pending') issues.push('引用点位待确认')
    const matchedRule = currentRules.find((r) => r.id === oldNumber)
    return {
      key: `rule-${index}-${oldNumber || index}`,
      legacy,
      match: issues.length === 0 ? 'direct' : 'pending',
      relation: matchedRule ? 'match' : 'new',
      issues,
      matchedRuleId: matchedRule?.id,
      oldNumber,
      delaySeconds: delay.seconds,
      delayUnit: delay.unit,
    }
  })
}

function normalizeZone(zone: string): string {
  return zone.replace(/\s/g, '')
}

export const useMigrationStore = defineStore('migration', () => {
  const linkage = useLinkageStore()
  const batches = ref<MigrationBatch[]>(loadBatches())
  const activeBatchId = ref<string | null>(null)

  // 刷新后若仍有试运行批次，恢复沙箱标志，期间改动不写正式基线
  if (batches.value.some((b) => b.status === 'trial')) linkage.isTrial = true

  const activeBatch = computed(() => batches.value.find((b) => b.id === activeBatchId.value) ?? null)
  const hasTrial = computed(() => batches.value.some((b) => b.status === 'trial'))

  function loadBatches(): MigrationBatch[] {
    try {
      const raw = localStorage.getItem('fire-linkage-migration-v1')
      return raw ? (JSON.parse(raw) as MigrationBatch[]) : []
    } catch {
      return []
    }
  }

  function persist() {
    localStorage.setItem('fire-linkage-migration-v1', JSON.stringify(batches.value))
  }

  function nextBatchId(): string {
    const now = new Date()
    const prefix = `MIG-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const seq = batches.value.filter((b) => b.id.startsWith(prefix)).length + 1
    return `${prefix}-${String(seq).padStart(3, '0')}`
  }

  // 粘贴备份并解析分类；重复提交只保留第一次结果
  function parseBackup(raw: string): { ok: boolean; duplicate?: boolean; batch?: MigrationBatch; error?: string } {
    const text = raw.trim()
    if (!text) return { ok: false, error: '请先粘贴旧机备份内容。' }
    const hash = hashString(text)
    const existing = batches.value.find((b) => b.backupHash === hash)
    if (existing) {
      activeBatchId.value = existing.id
      return { ok: false, duplicate: true, batch: existing }
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, error: '备份不是有效的 JSON，请检查后重新粘贴。' }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, error: '备份格式不正确，缺少设备或规则清单。' }
    const legacyDevices: LegacyDevice[] = Array.isArray(parsed.设备) ? (parsed.设备 as LegacyDevice[]) : []
    const legacyRules: LegacyRule[] = Array.isArray(parsed.规则) ? (parsed.规则 as LegacyRule[]) : []
    const signatures: LegacySignature[] = Array.isArray(parsed.签字) ? (parsed.签字 as LegacySignature[]) : []
    if (legacyDevices.length === 0 && legacyRules.length === 0) return { ok: false, error: '备份中未找到设备或规则数据。' }

    const deviceItems = classifyDevices(legacyDevices, linkage.devices)
    const ruleItems = classifyRules(legacyRules, deviceItems, linkage.rules)

    const batch: MigrationBatch = {
      id: nextBatchId(),
      createdAt: Date.now(),
      status: 'parsed',
      backupHash: hash,
      rawBackup: text,
      project: String(parsed.项目 ?? '旧机备份'),
      deviceItems,
      ruleItems,
      signatures,
      baselineSnapshot: null,
      trialRevision: null,
      reconfirmRuleIds: [],
      returnedReviewItemIds: [],
      failureReason: '',
      switchedAt: null,
    }
    batches.value.push(batch)
    activeBatchId.value = batch.id
    persist()
    return { ok: true, batch }
  }

  // 确认直接对应内容，生成试运行修订；待确认项原样保留
  function confirmBatch(id: string) {
    const batch = batches.value.find((b) => b.id === id)
    if (!batch || batch.status !== 'parsed') return
    batch.baselineSnapshot = linkage.snapshotBaseline()

    for (const item of batch.deviceItems) {
      if (item.match !== 'direct') continue
      const legacy = item.legacy
      const name = String(legacy.名称 ?? '')
      const type = String(legacy.类型 ?? '') as DeviceType
      const address = String(legacy.地址 ?? '')
      if (item.relation === 'match' && item.matchedDeviceId) {
        const device = linkage.devices.find((d) => d.id === item.matchedDeviceId)
        // 楼层/分区以新平台为准，切换时再比对跨区变化
        if (device) Object.assign(device, { name, type, address })
      } else {
        linkage.addDevice({
          id: String(legacy.编号 ?? `D-NEW-${linkage.devices.length + 1}`),
          name,
          type,
          floor: String(legacy.楼层 ?? '1F'),
          zone: String(legacy.分区 ?? ''),
          address,
        })
      }
    }

    for (const item of batch.ruleItems) {
      if (item.match !== 'direct') continue
      const legacy = item.legacy
      const triggerRef = String(legacy.触发 ?? '')
      const actionRef = String(legacy.动作 ?? '')
      const triggerItem = batch.deviceItems.find((d) => String(d.legacy.编号 ?? '') === triggerRef)
      const actionItem = batch.deviceItems.find((d) => String(d.legacy.编号 ?? '') === actionRef)
      const triggerId = triggerItem?.matchedDeviceId ?? String(triggerItem?.legacy.编号 ?? '')
      const actionId = actionItem?.matchedDeviceId ?? String(actionItem?.legacy.编号 ?? '')
      const delay = item.delaySeconds ?? 0
      const interlock = String(legacy.互锁 ?? '无')
      const priority = (Number(legacy.优先级) || 2) as 1 | 2 | 3
      const suppression = String(legacy.抑制 ?? '无')
      const enabled = legacy.启用 !== false
      if (item.relation === 'match' && item.matchedRuleId) {
        const rule = linkage.rules.find((r) => r.id === item.matchedRuleId)
        if (rule) Object.assign(rule, { triggerId, actionId, delay, interlock, priority, suppression, enabled })
      } else {
        linkage.rules.push({
          id: item.oldNumber || `R-${String(linkage.rules.length + 1).padStart(3, '0')}`,
          triggerId,
          actionId,
          delay,
          interlock,
          priority,
          suppression,
          enabled,
        })
      }
    }

    batch.status = 'trial'
    linkage.isTrial = true
    linkage.revision += 1
    batch.trialRevision = linkage.revision
    persist()
  }

  // 切换为正式基线：检测地址重复占用与跨区变化，重新确认引用规则，退回点位失效的审阅项
  function switchOver(id: string) {
    const batch = batches.value.find((b) => b.id === id)
    if (!batch || batch.status !== 'trial') return

    const addressCount = new Map<string, number>()
    linkage.devices.forEach((d) => {
      if (d.address) addressCount.set(d.address, (addressCount.get(d.address) ?? 0) + 1)
    })
    const problemDeviceIds = new Set<string>()
    linkage.devices.forEach((d) => {
      if ((addressCount.get(d.address) ?? 0) > 1) problemDeviceIds.add(d.id)
      const legacyItem = batch.deviceItems.find((item) => item.matchedDeviceId === d.id || String(item.legacy.编号 ?? '') === d.id)
      if (legacyItem) {
        const legacyZone = normalizeZone(String(legacyItem.legacy.分区 ?? ''))
        if (legacyZone && legacyZone !== normalizeZone(d.zone)) problemDeviceIds.add(d.id)
      }
    })

    batch.reconfirmRuleIds = linkage.rules
      .filter((r) => problemDeviceIds.has(r.triggerId) || problemDeviceIds.has(r.actionId))
      .map((r) => r.id)
    batch.returnedReviewItemIds = linkage.reviewItems
      .filter((item) => item.relatedDeviceId && problemDeviceIds.has(item.relatedDeviceId))
      .map((item) => item.id)

    batch.status = 'switched'
    batch.switchedAt = Date.now()
    batch.baselineSnapshot = null
    linkage.isTrial = false
    linkage.revision += 1
    persist()
  }

  // 迁移失败：按原批次号恢复到切换前正式基线
  function failAndRestore(id: string, reason: string) {
    const batch = batches.value.find((b) => b.id === id)
    if (!batch || batch.status !== 'trial') return
    if (batch.baselineSnapshot) linkage.restoreBaseline(batch.baselineSnapshot)
    batch.status = 'failed'
    batch.failureReason = reason
    batch.baselineSnapshot = null
    linkage.isTrial = false
    persist()
  }

  function reconfirmRule(id: string, ruleId: string) {
    const batch = batches.value.find((b) => b.id === id)
    if (!batch) return
    batch.reconfirmRuleIds = batch.reconfirmRuleIds.filter((rid) => rid !== ruleId)
    persist()
  }

  function selectBatch(id: string) {
    activeBatchId.value = id
  }

  function oldRuleNumber(batchId: string, ruleId: string): string | null {
    const batch = batches.value.find((b) => b.id === batchId)
    return batch?.ruleItems.find((r) => r.matchedRuleId === ruleId)?.oldNumber ?? null
  }

  function deviceItemByLegacyRef(batchId: string, ref: string): MigrationDeviceItem | undefined {
    const batch = batches.value.find((b) => b.id === batchId)
    return batch?.deviceItems.find((d) => String(d.legacy.编号 ?? '') === ref)
  }

  return {
    batches,
    activeBatchId,
    activeBatch,
    hasTrial,
    parseBackup,
    confirmBatch,
    switchOver,
    failAndRestore,
    reconfirmRule,
    selectBatch,
    oldRuleNumber,
    deviceItemByLegacyRef,
  }
})
