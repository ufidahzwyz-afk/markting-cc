import React from "react";
import type { ReactNode } from "react";
import { validatePageModules } from "@boran/contracts";
import type { PageModules } from "@boran/contracts";

export interface PageRendererProps {
  modules: PageModules;
  availableMediaIds?: readonly string[];
  renderLeadForm?: (data: Extract<PageModules[number], { type: "lead_form" }>["data"]) => ReactNode;
}
/** Shared by authenticated preview and released SSR pages. Never accepts raw HTML. */
export function PageRenderer({ modules, availableMediaIds = [], renderLeadForm }: PageRendererProps) {
  const safeModules = validatePageModules(modules);
  return <div className="public-modules">{safeModules.map((module, index) => {
    const key = `${module.type}-${index}`;
    switch (module.type) {
      case "hero": return <section className="public-hero public-section" key={key}><div><p className="public-kicker">泊冉 · 企业数字化服务</p><h1>{module.data.headline}</h1><p>{module.data.description}</p><a className="public-button" href={module.data.cta.href}>{module.data.cta.label}</a></div>{module.data.media && availableMediaIds.includes(module.data.media.asset_id) && <img className="public-hero-media" src={`/media/${module.data.media.asset_id}`} alt={module.data.media.alt} loading="eager" />}</section>;
      case "problem": return <section className="public-section" key={key}><h2>{module.data.heading}</h2><ul className="public-problem-list">{module.data.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul></section>;
      case "solution": return <section className="public-section" key={key}><h2>{module.data.heading}</h2><div className="public-rich-text">{module.data.body.map((block, blockIndex) => block.type === "heading" ? <h3 key={blockIndex}>{block.text}</h3> : block.type === "bullet" ? <ul key={blockIndex}><li>{block.text}</li></ul> : <p key={blockIndex}>{block.text}</p>)}</div></section>;
      case "scope": return <section className="public-section" key={key}><h2>{module.data.heading}</h2><div className="public-scope"><div><h3>服务范围</h3><ul>{module.data.included.map((text, itemIndex) => <li key={itemIndex}>{text}</li>)}</ul></div><div><h3>需要共同准备</h3><ul>{module.data.dependencies.map((text, itemIndex) => <li key={itemIndex}>{text}</li>)}</ul></div></div></section>;
      case "process": return <section className="public-section" key={key}><h2>{module.data.heading}</h2><ol className="public-process">{module.data.steps.map((step, itemIndex) => <li key={itemIndex}><span>{String(itemIndex + 1).padStart(2, "0")}</span><div><h3>{step.title}</h3><p>{step.description}</p></div></li>)}</ol></section>;
      case "proof": return <section className="public-section" key={key}><h2>{module.data.heading}</h2><ul className="public-proof-list">{module.data.claims.map((claim) => <li key={claim.claim_id}>{claim.display_text}</li>)}</ul></section>;
      case "case": return <section className="public-section public-case" key={key}><h2>{module.data.heading}</h2><h3>{module.data.customer_display}</h3><dl><div><dt>业务问题</dt><dd>{module.data.problem}</dd></div><div><dt>泊冉服务范围</dt><dd>{module.data.boran_scope}</dd></div><div><dt>公开记录</dt><dd>{module.data.result}</dd></div></dl></section>;
      case "faq": return <section className="public-section" key={key}><h2>{module.data.heading}</h2><div className="public-faq">{module.data.items.map((item, itemIndex) => <details key={itemIndex}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div></section>;
      case "cta": return <section className="public-section public-cta" key={key}><div><h2>{module.data.heading}</h2>{module.data.description && <p>{module.data.description}</p>}</div><a className="public-button" href={module.data.button.href}>{module.data.button.label}</a></section>;
      case "lead_form": return <section className="public-section public-lead-section" key={key} id="lead-form"><h2>{module.data.heading}</h2>{renderLeadForm ? renderLeadForm(module.data) : <p>咨询入口尚未配置。</p>}</section>;
    }
  })}</div>;
}
