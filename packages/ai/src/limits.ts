import {randomUUID} from 'node:crypto';
import {AiProviderError, type AiUsage} from './types';
export interface AiLimitReservation {
  scope: string; day: string; minute: string;
  max_calls_per_day: number; max_calls_per_minute: number;
  reserved_cost_micro: number | null; max_cost_micro_per_day: number | null;
  currency: string | null; pricing_version: string | null;
}
export interface AiLimitReceipt {id: string; scope: 'process' | 'persistent'}
/** Reserve atomically before every paid HTTP attempt. Unknown calls retain their worst-case reservation. */
export interface AiLimitLedger {
  reserve(reservation: AiLimitReservation): Promise<AiLimitReceipt>;
  settle(receipt: AiLimitReceipt, outcome: {status: 'received' | 'rejected' | 'unknown'; actual_cost_micro: number | null; usage: AiUsage}): Promise<void>;
}
export class ProcessAiLimitLedger implements AiLimitLedger {
  private readonly days = new Map<string, {calls: number; cost: number; unpriced: boolean}>();
  private readonly minutes = new Map<string, number>();
  private readonly receipts = new Map<string, {day: string; reserved: number | null}>();
  async reserve(input: AiLimitReservation): Promise<AiLimitReceipt> {
    const day = `${input.scope}:${input.day}`; const minute = `${input.scope}:${input.minute}`;
    const totals = this.days.get(day) ?? {calls: 0, cost: 0, unpriced: false}; const count = this.minutes.get(minute) ?? 0;
    if (totals.calls >= input.max_calls_per_day || count >= input.max_calls_per_minute) throw new AiProviderError('AI_CALL_LIMIT', '模型调用次数或速率已达到配置限额');
    if (input.max_cost_micro_per_day !== null && (totals.unpriced || input.reserved_cost_micro === null || totals.cost + input.reserved_cost_micro > input.max_cost_micro_per_day)) throw new AiProviderError('AI_COST_LIMIT', '模型费用已达到配置限额或计价依据不可用');
    totals.calls++; totals.cost += input.reserved_cost_micro ?? 0;
    this.days.set(day, totals); this.minutes.set(minute, count + 1);
    const id = randomUUID(); this.receipts.set(id, {day, reserved: input.reserved_cost_micro});
    return {id, scope: 'process'};
  }
  async settle(receipt: AiLimitReceipt, outcome: {status: 'received' | 'rejected' | 'unknown'; actual_cost_micro: number | null; usage: AiUsage}): Promise<void> {
    const reservation = this.receipts.get(receipt.id); if (!reservation) throw new AiProviderError('AI_LIMIT_RECEIPT_INVALID', '模型配额回执不存在或已结算');
    this.receipts.delete(receipt.id);
    const totals = this.days.get(reservation.day)!;
    if (outcome.status === 'received' && outcome.actual_cost_micro === null || outcome.status === 'unknown' && reservation.reserved === null) totals.unpriced = true;
    if (outcome.status === 'unknown' || outcome.status === 'received' && outcome.actual_cost_micro === null) return;
    totals.cost += (outcome.status === 'rejected' ? 0 : outcome.actual_cost_micro ?? 0) - (reservation.reserved ?? 0);
  }
}
export interface AiPricing {
  input_micro_per_million_tokens: number; output_micro_per_million_tokens: number;
  currency: string; version: string; model: string; aliases?: readonly string[];
}
export const AI_QUOTA_TIMEZONE = 'Asia/Shanghai' as const;
/** Daily budgets follow the same Shanghai business calendar as plans and reports. */
export function aiQuotaKeys(milliseconds: number): {day: string; minute: string; timezone: typeof AI_QUOTA_TIMEZONE} {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: AI_QUOTA_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(milliseconds));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  const day = `${get('year')}-${get('month')}-${get('day')}`;
  return {day, minute: `${day}T${get('hour')}:${get('minute')}`, timezone: AI_QUOTA_TIMEZONE};
}
export function calculateAiCost(inputTokens: number, outputTokens: number, pricing: AiPricing): number {
  const numerator = BigInt(inputTokens) * BigInt(pricing.input_micro_per_million_tokens) + BigInt(outputTokens) * BigInt(pricing.output_micro_per_million_tokens);
  const rounded = (numerator + 999_999n) / 1_000_000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new AiProviderError('AI_COST_OVERFLOW', '模型费用超过可准确记录范围');
  return Number(rounded);
}
