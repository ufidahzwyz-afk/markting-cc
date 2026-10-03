"use client";

import { useState } from "react";
import { Icon } from "./icon";

const sources = [
  ["公开市场信息", "已批准的市场网站与查询范围", "每日"],
  ["竞品公开推广", "指定竞品网站、文章与公开活动", "每日"],
  ["Mac / Google Drive", "指定资料目录的增量变化", "15 分钟"],
  ["ChatGPT 指定会话", "授权会话的消息与确认结论", "30 分钟"],
];
const accounts = ["微信公众号", "视频号 · 企业AI提效官", "百度营销", "今日头条", "知乎", "小红书", "爱番番"];

export function SettingsContent() {
  const [tab, setTab] = useState("sources");
  return <div className="settings-content">
    <div className="ui-tabs" role="group" aria-label="设置分类">{[["sources", "资料来源"], ["accounts", "平台账号"], ["rules", "执行规则"]].map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key!)}>{label}</button>)}</div>
    {tab === "sources" ? <><div className="ui-section-heading"><h3>四类信息来源</h3><span className="ui-status" data-tone="neutral">0 / 4 已接通</span></div><div className="ui-settings-list">{sources.map(([name, detail, frequency]) => <div className="ui-setting-row" key={name}><Icon name="link" size={18} /><div><strong>{name}</strong><p>{detail}</p><small>采集周期：{frequency}</small></div><span className="ui-status" data-tone="amber">未配置</span></div>)}</div><p className="ui-field-hint">周期来自开发基线，实际读取须完成账号与范围验证。</p></>
    : tab === "accounts" ? <><div className="ui-section-heading"><h3>首批账号接入</h3><span className="ui-muted">待配置</span></div><div className="ui-settings-list">{accounts.map(name => <div className="ui-setting-row" key={name}><Icon name="layers" size={18} /><div><strong>{name}</strong><p>账号、权限与能力待实测</p></div><span className="ui-status" data-tone="neutral">未连接</span></div>)}</div><p className="ui-field-hint">首批 16 个分发渠道在后续任务中逐项接入与验收。</p></>
    : <><div className="ui-section-heading"><h3>执行开关</h3><span className="ui-status" data-tone="neutral">只读预览</span></div><div className="ui-settings-list">{[["外部内容发布", "平台发布与官网更新"], ["百度广告写入", "创建、更新、启停与出价"], ["真实个人信息处理", "表单与接待留资"]].map(([name, detail]) => <div className="ui-setting-row" key={name}><Icon name="lock" size={18} /><div><strong>{name}</strong><p>{detail}</p></div><button type="button" className="ui-switch" role="switch" aria-checked="false" disabled aria-label={`${name}已关闭`} /></div>)}</div><div className="ui-section-heading"><h3>授权范围</h3></div><dl className="ui-definition-list"><div><dt>付费地域</dt><dd>上海、江苏、浙江、安徽</dd></div><div><dt>投放预算</dt><dd>待负责人批准</dd></div><div><dt>发布频次</dt><dd>待配置</dd></div><div><dt>持续规则</dt><dd>尚未启用</dd></div></dl><p className="ui-field-hint">规则内持续执行；超范围事项进入例外待办。</p></>}
  </div>;
}
