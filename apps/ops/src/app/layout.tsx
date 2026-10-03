import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Shell } from '@/components/shell';
import { currentOpsAccess } from '@/lib/access';
import { authenticate } from '@/lib/server-context';
import {DomainError} from '@boran/domain/core';
import './globals.css';
export const metadata:Metadata={title:{default:'今日工作 · 泊冉营销工作台',template:'%s · 泊冉营销工作台'},description:'泊冉市场推广自动化系统',robots:{index:false,follow:false}};
export const dynamic='force-dynamic';
export default async function RootLayout({children}:{children:ReactNode}) {
  const access=currentOpsAccess();
  let name='',message=access.allowed?'组织身份验证失败':access.message;
  if(access.allowed)try{const ctx=await authenticate(await headers());const user=(await ctx.db.query<{display_name:string}>('SELECT display_name FROM users WHERE id=$1',[ctx.actorId])).rows[0];name=user?.display_name??'运营人员';}catch(error){message=error instanceof DomainError?error.message:'数据库或服务暂不可用，请检查本地运行状态';}
  return <html lang="zh-CN"><body>{access.allowed&&name?<Shell mode={access.mode==='mock'?'mock':'live'} actorName={name}>{children}</Shell>:<main className="identity-gate"><p className="eyebrow">泊冉营销工作台</p><h1>工作空间暂不可用</h1><p>{message}</p></main>}</body></html>;
}
