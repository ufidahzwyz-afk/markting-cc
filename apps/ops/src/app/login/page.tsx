'use client';
import { useState, type FormEvent } from 'react';
export default function LoginPage() {
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/local-auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login_name: loginName, password }) });
      const value = await response.json();
      setPassword('');
      if (!response.ok) throw new Error(value.error?.message ?? '登录未完成');
      window.location.assign('/overview');
    } catch (e) { setError(e instanceof Error ? e.message : '登录未完成，请稍后再试'); }
    finally { setPassword(''); setBusy(false); }
  }
  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f3f5f8', padding: 20 }}><form onSubmit={submit} style={{ width: '100%', maxWidth: 400, padding: 30, background: '#fff', border: '1px solid #dbe3ed', borderRadius: 12 }}><p style={{ color: '#41658c', fontSize: 14 }}>泊冉 · 市场推广工作台</p><h1 style={{ fontSize: 24 }}>登录本地工作台</h1><p style={{ color: '#697b90', lineHeight: 1.6 }}>使用已配置的运营账号查看任务、资料和共享线索。</p><label style={{ display: 'block', marginTop: 20 }}>登录名<input required autoComplete="username" value={loginName} onChange={event => setLoginName(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 8, border: '1px solid #cdd8e5', borderRadius: 6 }}/></label><label style={{ display: 'block', marginTop: 16 }}>密码<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 10, marginTop: 8, border: '1px solid #cdd8e5', borderRadius: 6 }}/></label>{error && <p role="alert" style={{ color: '#a43131', fontSize: 14 }}>{error}</p>}<button disabled={busy} type="submit" style={{ width: '100%', marginTop: 24, padding: 12, background: '#245dc8', color: '#fff', border: 0, borderRadius: 6 }}>{busy ? '正在登录…' : '登录'}</button></form></main>;
}
