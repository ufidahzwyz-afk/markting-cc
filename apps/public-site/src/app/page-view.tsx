"use client";
import {useEffect,useRef} from 'react';
/** A per-load random event ID deduplicates retries. It is never a visitor or cross-site tracking ID. */
export function PageView({pageId,releaseId}:{pageId:string;releaseId:string}){
 const event=useRef<{event_id:string;event_type:'page_view';occurred_at:string;page_id:string;release_id:string}|null>(null);
 useEffect(()=>{if(!event.current||event.current.page_id!==pageId||event.current.release_id!==releaseId)event.current={event_id:crypto.randomUUID(),event_type:'page_view',occurred_at:new Date().toISOString(),page_id:pageId,release_id:releaseId};void fetch('/api/v1/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:[event.current]}),keepalive:true}).catch(()=>{});},[pageId,releaseId]);
 return <p className="public-form-note" role="note">本站仅记录本页匿名访问总量，不设置访客追踪标识，也不读取网址查询参数。</p>;
}
