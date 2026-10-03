"use client";

import { useState } from "react";
import { Badge } from "@boran/ui";
import { Icon } from "./icon";

export function SettingsContent() {
  const [tab, setTab] = useState<"connections" | "rules">("connections");
  return <div className="settings-content">
    <p className="setting-intro">先接通身份与业务平台，再批准执行范围。当前为隔离演练，真实操作始终关闭。</p>
    <div className="segmented settings-tabs" role="group" aria-label="设置分类">
      <button type="button" aria-pressed={tab === "connections"} className={tab === "connections" ? "selected" : ""} onClick={() => setTab("connections")}>平台连接</button>
      <button type="button" aria-pressed={tab === "rules"} className={tab === "rules" ? "selected" : ""} onClick={() => setTab("rules")}>执行规则</button>
    </div>
    {tab === "connections" ? <>
      <div className="settings-group"><h3>系统身份</h3><div className="setting-row"><div className="setting-icon"><Icon name="lock" /></div><div><strong>企业身份 / OIDC</strong><p>当前使用本地模拟身份</p></div><Badge tone="amber">待接入</Badge></div></div>
      <div className="settings-group"><h3>业务平台</h3>{[
        ["资料来源", "采集来源与可访问范围待配置"],
        ["内容发布", "平台账号与发布权限待配置"],
        ["广告投放", "账户、预算与操作范围待批准"],
        ["线索接待", "业务账号与回收规则待配置"],
      ].map(([name, description]) => <div className="setting-row" key={name}><div className="setting-icon"><Icon name="link" /></div><div><strong>{name}</strong><p>{description}</p></div><Badge>未配置</Badge></div>)}</div>
      <div className="note-block"><Icon name="alert" size={18} /><p>界面预览阶段不收集平台凭据。连接配置将在身份接入与业务实现后开放。</p></div>
    </> : <>
      <div className="settings-group"><h3>执行边界</h3><div className="setting-row"><div className="setting-icon"><Icon name="lock" /></div><div><strong>真实写入</strong><p>发布、广告与业务数据写入</p></div><Badge>已关闭</Badge></div><div className="setting-row"><div className="setting-icon"><Icon name="chart" /></div><div><strong>投放预算</strong><p>没有有效的预算批准记录</p></div><Badge tone="amber">未批准</Badge></div></div>
      <div className="settings-group"><h3>审批原则</h3><ul className="rule-list"><li><Icon name="check" size={18} /><span>批准范围内的规则执行将在业务接入后启用</span></li><li><Icon name="check" size={18} /><span>新事实、预算增加与超范围操作进入人工待办</span></li><li><Icon name="check" size={18} /><span>发布成功需要平台回读核验</span></li></ul></div>
      <div className="note-block"><Icon name="lock" size={18} /><p>当前没有可批准或执行的真实任务。设置展示仅用于确认界面与操作边界。</p></div>
    </>}
  </div>;
}
