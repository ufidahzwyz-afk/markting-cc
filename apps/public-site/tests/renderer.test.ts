import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageRenderer } from "@boran/ui/page-renderer";
import type { PageModules } from "@boran/contracts";
const modules: PageModules = [
  { type: "hero", schema_version: 1, data: { headline: "流程 & 数据协同", description: "从业务问题出发", cta: { label: "了解服务", href: "/services/integration", action: "navigate" } } },
  { type: "solution", schema_version: 1, data: { heading: "准备事项", body: [{ type: "paragraph", text: "财务 & 业务口径" }, { type: "bullet", text: "先确定来源与边界" }], claim_ids: [] } },
];
test("shared preview and published renderer emits crawlable escaped text without JavaScript", () => {
  const rendered = renderToStaticMarkup(createElement(PageRenderer, { modules }));
  assert.match(rendered, /<h1>流程 &amp; 数据协同<\/h1>/);
  assert.match(rendered, /财务 &amp; 业务口径/);
  assert.match(rendered, /href="\/services\/integration"/);
  assert.doesNotMatch(rendered, /<script|<iframe|onclick=|dangerouslySetInnerHTML/);
  assert.equal(rendered, renderToStaticMarkup(createElement(PageRenderer, { modules })));
});
test("renderer rejects injected modules even if a caller bypasses TypeScript", () => {
  assert.throws(() => renderToStaticMarkup(createElement(PageRenderer, { modules: [{ type: "hero", schema_version: 1, data: { headline: "<img src=x onerror=alert(1)>", description: "测试", cta: { label: "测试", href: "javascript:alert(1)", action: "navigate" } } }] as PageModules })));
});
test("unreleased media IDs cannot be requested through rendered image src", () => {
  const withMedia: PageModules = [{ type: "hero", schema_version: 1, data: { ...modules[0]!.data as Extract<PageModules[number], { type: "hero" }>["data"], media: { asset_id: "00000000-0000-4000-8000-000000000009", alt: "授权配图" } } }];
  assert.doesNotMatch(renderToStaticMarkup(createElement(PageRenderer, { modules: withMedia })), /<img/);
  assert.match(renderToStaticMarkup(createElement(PageRenderer, { modules: withMedia, availableMediaIds: ["00000000-0000-4000-8000-000000000009"] })), /src="\/media\/00000000-0000-4000-8000-000000000009"/);
});
