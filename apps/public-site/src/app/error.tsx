"use client";
export default function SiteError({ reset }: { reset: () => void }) {
  return <div className="public-placeholder"><h1>页面暂不可用</h1><p>页面服务暂未就绪，请稍后再试。</p><button type="button" className="public-button" onClick={reset}>重新加载</button></div>;
}
