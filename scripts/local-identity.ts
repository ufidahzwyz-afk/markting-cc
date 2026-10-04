import { openDatabase } from '@boran/db';
import { DomainError } from '@boran/domain/core';
import { configureLocalIdentity, localIdentityReady } from '../apps/ops/src/lib/local-identity';

const help = '用法：npx tsx scripts/local-identity.ts --org <组织UUID> --owner <既有负责人UUID> --user <既有运营成员UUID> --login <登录名> [--password-stdin]';
function argumentsFrom(values: string[]) {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index++) {
    const key = values[index]!;
    if (key === '--password-stdin') { if (result[key] !== undefined) throw new Error(help); result[key] = 'true'; continue; }
    if (!['--org', '--owner', '--user', '--login'].includes(key) || !values[index + 1] || result[key] !== undefined) throw new Error(help);
    result[key] = values[++index]!;
  }
  if (['--org', '--owner', '--user', '--login'].some(key => !result[key])) throw new Error(help);
  return result;
}
async function passwordFromStdin(): Promise<string> {
  let source = '';
  for await (const chunk of process.stdin) {
    source += chunk.toString();
    if (Buffer.byteLength(source) > 4096) throw new DomainError('INVALID_PASSWORD_INPUT', 422, '私有 JSON 输入过大');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new DomainError('INVALID_PASSWORD_INPUT', 422, '标准输入须为仅包含 password 的私有 JSON'); }
  source = '';
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some(key => key !== 'password') || typeof (parsed as {password?:unknown}).password !== 'string') throw new DomainError('INVALID_PASSWORD_INPUT', 422, '标准输入须为仅包含 password 的私有 JSON');
  return (parsed as { password: string }).password;
}
async function hiddenPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new DomainError('PASSWORD_TTY_REQUIRED', 422, '请在终端隐藏输入密码，或使用 --password-stdin 读取私有 JSON；不支持密码参数');
  process.stderr.write(prompt);
  const previousRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      process.stdin.off('data', receive); process.stdin.setRawMode(previousRaw); process.stdin.pause(); process.stderr.write('\n');
      if (error) { value = ''; reject(error); } else resolve(value);
    };
    const receive = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003' || character === '\u0004') { finish(new DomainError('PASSWORD_INPUT_CANCELLED', 422, '已取消密码输入')); return; }
        if (character === '\r' || character === '\n') { finish(); return; }
        if (character === '\u007f' || character === '\b') { value = [...value].slice(0, -1).join(''); continue; }
        if (character >= ' ' && !/\p{Cc}/u.test(character)) value += character;
        if (Buffer.byteLength(value) > 256) { finish(new DomainError('INVALID_PASSWORD', 422, '密码长度不能超过 256 字节')); return; }
      }
    };
    process.stdin.on('data', receive);
  });
}

try {
  const args = argumentsFrom(process.argv.slice(2));
  if (!localIdentityReady({ ...process.env, BORAN_ORG_ID: args['--org'] })) throw new DomainError('LOCAL_AUTH_ENV_REQUIRED', 422, '请设置 AUTH_MODE=local、BORAN_MODE=live 和 APP_ENV=development 或 test；生产环境不启用本地身份');
  if (process.env.BORAN_ORG_ID && process.env.BORAN_ORG_ID !== args['--org']) throw new DomainError('ORG_CONFIG_MISMATCH', 422, '组织参数须与运行配置一致');
  let password = args['--password-stdin'] ? await passwordFromStdin() : await hiddenPassword('输入运营登录密码（隐藏，至少 12 个字符）：');
  if (!args['--password-stdin']) {
    const confirmation = await hiddenPassword('再次输入密码（隐藏）：');
    if (password !== confirmation) throw new DomainError('PASSWORD_MISMATCH', 422, '两次输入的密码不一致');
  }
  const db = await openDatabase({ mode: 'live', initialize: false });
  try { await configureLocalIdentity(db, { orgId: args['--org']!, ownerId: args['--owner']!, userId: args['--user']!, loginName: args['--login']!, password }); }
  finally { password = ''; await db.close(); }
  process.stdout.write('本地登录已配置；既有成员、业务数据和权限保持原状。已有登录会话将在凭据版本更新后失效。\n');
} catch (error) {
  process.stderr.write(error instanceof DomainError ? `初始化失败（${error.code}）：${error.message}\n` : `${help}\n初始化未完成；请检查现有数据库与成员配置。\n`);
  process.exitCode = 1;
}
