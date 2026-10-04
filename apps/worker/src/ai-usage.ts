import { randomUUID } from 'node:crypto';
import type { Database } from '@boran/db';
import { AiProviderError, type AiLimitLedger, type AiLimitReceipt, type AiLimitReservation, type AiUsage } from '@boran/ai';

const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeCount = (value: unknown) => value === null || Number.isSafeInteger(value) && Number(value) >= 0;
function checkedUsage(usage: AiUsage): AiUsage {
  const fields = ['input_tokens', 'output_tokens', 'total_tokens', 'cache_hit_tokens'] as const;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage) || Object.keys(usage).some(key => !fields.includes(key as typeof fields[number])) || fields.some(key => !safeCount(usage[key]))) throw new AiProviderError('AI_LIMIT_RECEIPT_INVALID', '模型用量回执无效');
  return { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, total_tokens: usage.total_tokens, cache_hit_tokens: usage.cache_hit_tokens };
}
function calendarValid(day: string, minute: string) {
  if (typeof day !== 'string' || typeof minute !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(minute) || minute.slice(0, 10) !== day) return false;
  const date = Date.parse(`${minute}:00.000Z`);
  return Number.isFinite(date) && new Date(date).toISOString().slice(0, 16) === minute;
}

/** All DeepSeek routes share one persistent org quota; switching models cannot reset it. */
export class DatabaseAiLimitLedger implements AiLimitLedger {
  constructor(private readonly db: Database, private readonly orgId: string) {}
  async reserve(input: AiLimitReservation): Promise<AiLimitReceipt> {
    if (!identifier.test(this.orgId) || input.scope !== `${this.orgId}:deepseek` || !calendarValid(input.day, input.minute) || !Number.isSafeInteger(input.max_calls_per_day) || input.max_calls_per_day < 1 || !Number.isSafeInteger(input.max_calls_per_minute) || input.max_calls_per_minute < 1 || !safeCount(input.reserved_cost_micro) || input.currency !== null && (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) || input.pricing_version !== null && (typeof input.pricing_version !== 'string' || !input.pricing_version.trim() || input.pricing_version.length > 200 || /[\x00-\x1f\x7f]/.test(input.pricing_version)) || input.reserved_cost_micro !== null && (!input.currency || !input.pricing_version)) throw new AiProviderError('AI_LIMIT_INPUT_INVALID', '模型配额请求无效');
    return this.db.transaction(async tx => {
      if (!(await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [this.orgId])).rows.length) throw new AiProviderError('AI_LIMIT_INPUT_INVALID', '模型组织配置不存在');
      const totals = (await tx.query("SELECT count(*) AS day_calls,count(*) FILTER(WHERE minute_key=$3) AS minute_calls,COALESCE(sum(CASE WHEN state='rejected' THEN 0 ELSE COALESCE(actual_cost_micro,reserved_cost_micro,0) END),0) AS cost,count(*) FILTER(WHERE state<>'rejected' AND actual_cost_micro IS NULL AND (reserved_cost_micro IS NULL OR state='received')) AS unknown_cost,count(DISTINCT currency) FILTER(WHERE state<>'rejected') AS currencies,min(currency) FILTER(WHERE state<>'rejected') AS currency FROM ai_usage_reservations WHERE org_id=$1 AND provider='deepseek' AND day_key=$2", [this.orgId, input.day, input.minute])).rows[0]!;
      if (Number(totals.day_calls) >= input.max_calls_per_day || Number(totals.minute_calls) >= input.max_calls_per_minute) {
        const limit_kind=Number(totals.day_calls)>=input.max_calls_per_day?'day':'minute';
        const retry_after=new Date(limit_kind==='day'?Date.parse(`${input.day}T00:00:00+08:00`)+86400000:Date.parse(`${input.minute}:00+08:00`)+60000).toISOString();
        throw new AiProviderError('AI_CALL_LIMIT', '模型调用次数或速率已达到配置限额',{limit_kind,retry_after});
      }
      if (input.max_cost_micro_per_day !== null) {
        if (!Number.isSafeInteger(input.max_cost_micro_per_day) || input.max_cost_micro_per_day < 1 || input.reserved_cost_micro === null || !input.currency || !input.pricing_version || Number(totals.unknown_cost) || Number(totals.currencies) > 1 || totals.currency && totals.currency !== input.currency || BigInt(String(totals.cost)) + BigInt(input.reserved_cost_micro) > BigInt(input.max_cost_micro_per_day)) throw new AiProviderError('AI_COST_LIMIT', '模型费用上限已达或当日计价依据不完整');
      }
      const id = randomUUID();
      await tx.query("INSERT INTO ai_usage_reservations(id,org_id,provider,day_key,minute_key,state,reserved_cost_micro,currency,pricing_version) VALUES($1,$2,'deepseek',$3,$4,'reserved',$5,$6,$7)", [id, this.orgId, input.day, input.minute, input.reserved_cost_micro, input.currency, input.pricing_version]);
      return { id, scope: 'persistent' };
    });
  }
  async settle(receipt: AiLimitReceipt, outcome: { status: 'received' | 'rejected' | 'unknown'; actual_cost_micro: number | null; usage: AiUsage }): Promise<void> {
    if (!identifier.test(this.orgId) || receipt.scope !== 'persistent' || !identifier.test(receipt.id) || !['received', 'rejected', 'unknown'].includes(outcome.status) || !safeCount(outcome.actual_cost_micro)) throw new AiProviderError('AI_LIMIT_RECEIPT_INVALID', '模型配额结算无效');
    const usage = checkedUsage(outcome.usage);
    await this.db.transaction(async tx => {
      // Cost settlement and reservation share the same lock across all worker processes and model routes.
      if (!(await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [this.orgId])).rows.length) throw new AiProviderError('AI_LIMIT_RECEIPT_INVALID', '模型组织配置不存在');
      const reservation = (await tx.query("SELECT currency,pricing_version FROM ai_usage_reservations WHERE org_id=$1 AND id=$2 AND state='reserved' FOR UPDATE", [this.orgId, receipt.id])).rows[0];
      if (!reservation || outcome.status === 'received' && outcome.actual_cost_micro !== null && (!reservation.currency || !reservation.pricing_version)) throw new AiProviderError('AI_LIMIT_RECEIPT_INVALID', '模型配额回执不存在或费用缺少币种和计价版本');
      const result = await tx.query("UPDATE ai_usage_reservations SET state=$3,actual_cost_micro=$4,usage_json=$5,settled_at=now() WHERE org_id=$1 AND id=$2 AND state='reserved'", [this.orgId, receipt.id, outcome.status, outcome.status === 'received' ? outcome.actual_cost_micro : outcome.status === 'rejected' ? 0 : null, JSON.stringify(usage)]);
      if (result.rowCount !== 1) throw new AiProviderError('AI_LIMIT_RECEIPT_INVALID', '模型配额回执不存在、已结算或属于其他组织');
    });
  }
}
