"use client";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
type ContactChannel = "email" | "phone" | "wechat";
const contactLabels: Record<ContactChannel, string> = { email: "电子邮箱", phone: "手机号", wechat: "微信号" };
export function LeadForm({ pageId, releaseId, noticeVersion, submitLabel, enabled, mock, allowedChannels = ["email"] }: { pageId: string; releaseId: string; noticeVersion: string; submitLabel: string; enabled: boolean; mock: boolean; allowedChannels?: ContactChannel[] }) {
  const submission = useRef<string | null>(null);
  const [pending, setPending] = useState(false); const [received, setReceived] = useState(false); const [message, setMessage] = useState("");
  const channels: ContactChannel[] = mock ? ["email"] : allowedChannels;
  const [channel, setChannel] = useState<ContactChannel>(channels[0] ?? "email");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!enabled || pending || received) return;
    const form = new FormData(event.currentTarget); submission.current ??= crypto.randomUUID(); setPending(true); setMessage("");
    const input = { submission_id: submission.current, page_id: pageId, release_id: releaseId, privacy_notice_version: noticeVersion, consent: true, [channel === "email" ? "contact_email" : channel === "phone" ? "contact_phone" : "contact_wechat"]: form.get("contact"), ...(String(form.get("company") ?? "").trim() ? { company: String(form.get("company")) } : {}), ...(String(form.get("need") ?? "").trim() ? { need: String(form.get("need")) } : {}), honeypot: String(form.get("website") ?? ""), allowed_contact_channels: [channel], marketing_consent: form.get("marketing_consent") === "on" };
    try {
      const response = await fetch("/api/v1/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json() as { data?: { status?: string }; error?: { message?: string } };
      if (!response.ok || result.data?.status !== "received") { setMessage(result.error?.message ?? "咨询暂未保存，请稍后重试。"); return; }
      setReceived(true); setMessage(mock ? "测试咨询已持久化，不会联系真实客户。" : "本次咨询已记录。我们将根据你提供的联系方式跟进。");
    } catch { setMessage("网络暂不可用，请重试；重复提交不会产生重复记录。"); }
    finally { setPending(false); }
  }
  return <form className="public-lead-form" onSubmit={submit}>
    {!enabled && <p className="public-form-note" role="status">咨询处理告知与接收配置尚未启用，当前无法提交。</p>}
    {mock && <p className="public-form-note">本地测试仅允许 example.invalid 测试邮箱，请勿填写真实联系方式。</p>}
    {!mock && channels.length > 1 && <label className="public-field">联系方式<select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)} disabled={!enabled || received}>{channels.map(value => <option key={value} value={value}>{contactLabels[value]}</option>)}</select></label>}
    <label className="public-field">{channel === "email" ? "电子邮箱" : channel === "phone" ? "手机号" : "微信号"}<input name="contact" type={channel === "email" ? "email" : channel === "phone" ? "tel" : "text"} autoComplete={mock ? "off" : channel === "email" ? "email" : channel === "phone" ? "tel" : "off"} required maxLength={channel === "email" ? 320 : channel === "phone" ? 32 : 100} disabled={!enabled || received} defaultValue={mock ? "preview@example.invalid" : ""} /></label>
    <label className="public-field">公司（可选）<input name="company" maxLength={200} disabled={!enabled || received} /></label><label className="public-field">想了解什么（可选）<textarea name="need" rows={3} minLength={5} maxLength={3000} disabled={!enabled || received} /></label>
    <label className="public-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
    <label className="public-consent"><input type="checkbox" name="consent" required disabled={!enabled || received} /><span>我已阅读<a href="/privacy" target="_blank" rel="noreferrer">咨询处理告知</a>，同意处理本次咨询所需信息。</span></label>
    <label className="public-consent"><input type="checkbox" name="marketing_consent" disabled={!enabled || received} /><span>我愿意通过所选联系方式接收后续服务信息（自愿）。</span></label>
    <button className="public-button" type="submit" disabled={!enabled || pending || received}>{pending ? "正在保存…" : received ? "已记录" : submitLabel}</button><p className="public-form-message" role="status">{message}</p>
  </form>;
}
