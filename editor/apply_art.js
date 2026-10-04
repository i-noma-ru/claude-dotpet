#!/usr/bin/env node
'use strict';
// 使い方:
// node editor/apply_art.js <JSON> [--no-deploy] [--force]
// node editor/apply_art.js --check <JSON> [--force]
// node editor/apply_art.js --regen [--no-deploy]
// 終了コード: 0=成功 / 1=失敗 / 2=引数の誤り。
// 既定: 退避は MOD フォルダの backup/、台帳は apply_ledger.json、検査は claude plugin validate と test、配備はしない。
// editor/apply_art.local.json があれば、退避先・台帳・検査・配備をその環境の道具に差し替える（root からの相対パス）:
//   {"root": "<このファイルのフォルダから見た基準>", "backupDir": "…", "ledgerFile": "…", "check": ["<node で動かすスクリプト>", …], "deploy": ["<同>", …]}
// テスト用: DOTPET_ART_ROOT=MODフォルダ（設定ファイルを読まない）、DOTPET_ART_SKIP_CHECK=1でMOD検査を省略。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// エディタにも同じ関数を埋め込み、回帰テストで結果の一致を確認する。
const KEYS = ['A', 'S', 'M', 'E', 'P', 'K', 'B', 'C', 'V'];
const MODES = ['idle', 'work', 'done', 'sleep'];
const LENGTHS = [8, 48, 8, 8];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validate(data) {
  const errors = [];
  if (!object(data)) return ['JSON の全体はオブジェクトが必要です'];
  if (data.version !== 1) errors.push('version は 1 が必要です');
  if (!object(data.palette) || Object.keys(data.palette).length !== 9 || KEYS.some(k => !Object.hasOwn(data.palette, k))) {
    errors.push('palette のキーは A S M E P K B C V の9個が必要です');
  }
  for (const key of KEYS) {
    if (typeof data.palette?.[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(data.palette[key])) errors.push(`palette.${key} は # と16進6桁の色が必要です`);
  }
  for (const size of ['big', 'small']) {
    const part = data[size], rows = size === 'big' ? 10 : 12;
    if (!object(part)) { errors.push(`${size} はオブジェクトが必要です`); continue; }
    if (part.columns !== 20) errors.push(`${size}.columns は 20 が必要です`);
    if (part.rows !== rows) errors.push(`${size}.rows は ${rows} が必要です`);
    if (!Array.isArray(part.poses) || part.poses.length === 0) errors.push(`${size}.poses は1枚以上の絵が必要です`);
    if (Array.isArray(part.poses)) part.poses.forEach((pose, p) => {
      const label = `${size} の絵 ${p + 1}`;
      if (!Array.isArray(pose)) { errors.push(`${label} は行の配列が必要です`); return; }
      if (pose.length !== rows) errors.push(`${label} の行数が ${pose.length}（${rows} が必要）`);
      pose.forEach((line, y) => {
        if (typeof line !== 'string') { errors.push(`${label}・行 ${y + 1} は文字列が必要です`); return; }
        if (line.length !== 20) errors.push(`${label}・行 ${y + 1} の長さが ${line.length}（20 が必要）`);
        for (const key of new Set(line)) if (key !== ' ' && (!KEYS.includes(key) || !Object.hasOwn(data.palette || {}, key))) errors.push(`${label}・行 ${y + 1} にパレットに無い文字: ${key}`);
      });
      if (size === 'small' && pose.length === rows && pose.every(line => typeof line === 'string' && line.length === 20)) {
        for (let y = 0; y < rows; y += 4) for (let x = 0; x < 20; x += 2) {
          const colors = [...new Set([0,1,2,3].flatMap(dy => [pose[y+dy][x], pose[y+dy][x+1]]))];
          if (colors.length > 2) errors.push(`${label}・マス (列 ${x/2+1}, 行 ${y/4+1}) に ${colors.length} 色: ${colors.map(k => k === ' ' ? '空白' : k).join(' ')}`);
        }
      }
    });
    if (!object(part.order) || Object.keys(part.order).length !== 4 || MODES.some(m => !Object.hasOwn(part.order, m))) errors.push(`${size}.order のキーは idle work done sleep の4個が必要です`);
    MODES.forEach((mode, i) => {
      const frames = part.order?.[mode];
      if (!Array.isArray(frames)) { errors.push(`${size}.order.${mode} はコマ番号の配列が必要です`); return; }
      if (frames.length !== LENGTHS[i]) errors.push(`${size}.order.${mode} の長さが ${frames.length}（${LENGTHS[i]} が必要）`);
      frames.forEach((n, f) => {
        if (!Number.isInteger(n) || n < 0 || n >= (part.poses?.length || 0)) errors.push(`${size}.order.${mode}・コマ ${f + 1} の絵番号 ${String(n)} は poses の範囲内の整数が必要です`);
      });
    });
  }
  return errors;
}
function normalize(data) {
  const out = {version: 1, palette: Object.fromEntries(KEYS.map(k => [k, data.palette[k].toLowerCase()]))};
  for (const size of ['big', 'small']) {
    const poses = [], order = {}, seen = new Map();
    for (const mode of MODES) order[mode] = data[size].order[mode].map(n => {
      const pose = data[size].poses[n], key = JSON.stringify(pose);
      if (!seen.has(key)) { seen.set(key, poses.length); poses.push([...pose]); }
      return seen.get(key);
    });
    out[size] = {columns: 20, rows: size === 'big' ? 10 : 12, poses, order};
  }
  return out;
}
function serialize(data) {
  return JSON.stringify(data, null, 2).replace(/\[\n\s+(\d+(?:,\n\s+\d+)*)\n\s+\]/g, (_, values) => '[' + values.replace(/,\n\s+/g, ', ') + ']') + '\n';
}
// 共有関数ここまで

const COMMENT = '// art/dotpet_art.json から editor/apply_art.js が作る。手で直さない\n';
function generate(data) {
  const poseFile = (part, name) => COMMENT + '\nconst POSES: readonly (readonly string[])[] = ' + JSON.stringify(part.poses, null, 2) + '\n\nconst ORDER: Record<\'idle\' | \'work\' | \'done\' | \'sleep\', readonly number[]> = {\n' + MODES.map(m => `  ${m}: [${part.order[m].join(', ')}],`).join('\n') + '\n}\n\n' + `export function ${name}(mode: 'idle' | 'work' | 'done' | 'sleep', frame: number): readonly string[] {\n  const frames = ORDER[mode]\n\n  return POSES[frames[frame % frames.length]!]!\n}\n`;
  return {
    'hooks/palette.ts': COMMENT + '\nexport const PALETTE: Record<string, number> = {\n' + KEYS.map(k => `  ${k}: 0x${data.palette[k].slice(1).toLowerCase()},`).join('\n') + '\n}\n',
    'hooks/sit_art.ts': poseFile(data.big, 'sitDots'),
    'hooks/octant_art.ts': poseFile(data.small, 'octDots'),
    // 元の印: エディタが書き出しに入れ、反映のときに「今の正本を元に塗ったか」を照合する。
    'editor/dotpet_art.js': COMMENT + 'window.DOTPET_ART = ' + serialize(data).trimEnd() + ';\nwindow.DOTPET_ART_BASE = ' + JSON.stringify(baseId(serialize(data))) + ';\n',
  };
}
// 元の印は正本 art/dotpet_art.json の中身（バイト列）のハッシュ。
function baseId(masterText) { return crypto.createHash('sha1').update(masterText, 'utf8').digest('hex').slice(0, 12); }
const sha1 = text => crypto.createHash('sha1').update(text, 'utf8').digest('hex');
// 絵の番号（1 始まり）を「大 2・3／小 4」の形に並べる。pick(size, i) が真の絵だけを拾う。
function poseList(count, pick) {
  const out = [];
  for (const size of ['big', 'small']) {
    const n = Array.from({length: count(size)}, (_, i) => i).filter(i => pick(size, i)).map(i => i + 1);
    if (n.length) out.push(`${size === 'big' ? '大' : '小'} ${n.join('・')}`);
  }
  return out.join('／') || 'なし';
}
// 古い絵を元にした書き出しを見つける。戻り値は {stop, lines}。元の版を退避から見つけ、
// 正本の変更がすべて書き出しに入っていると確かめられたときは stop=false（知らせる 1 行だけ）。
function staleBase(raw, data, masterText, backups) {
  const now = baseId(masterText);
  if (raw.base === now) return {stop: false, lines: []};
  let master = null;
  try { master = JSON.parse(masterText); } catch { /* 正本が壊れているときは絵の比較を省く */ }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const count = size => Math.max(data[size].poses.length, master ? master[size].poses.length : 0);
  const lines = [];
  if (typeof raw.base !== 'string') {
    lines.push('この書き出しには元の印がありません（旧版のエディタの書き出しか、手で作ったファイルです）。');
    if (master) lines.push(`今の絵と違う絵: ${poseList(count, (s, i) => !same(data[s].poses[i], master[s].poses[i]))}`);
  } else {
    lines.push(`この書き出しは、今の絵より古い版を元にしています（書き出しの元の印 ${raw.base}／今の絵の印 ${now}）。`);
    let base = null;
    try {
      for (const dir of fs.readdirSync(backups).filter(n => n.startsWith('dotpet_art_')).sort().reverse()) {
        const file = path.join(backups, dir, 'art/dotpet_art.json');
        if (!fs.existsSync(file)) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (baseId(text) === raw.base) { base = JSON.parse(text); break; }
      }
    } catch { /* 退避が読めないときは下の「違う絵」だけを出す */ }
    if (base && master) {
      // 絵・色・コマの割り当てを 1 項目ずつ 3 者で比べる。正本が変えた項目が書き出しに同じ形で入っていなければ失われる。
      const all = size => Math.max(count(size), base[size].poses.length);
      const list = pick => {
        const poses = poseList(all, (s, i) => pick(data[s].poses[i], base[s].poses[i], master[s].poses[i]));
        const rest = [];
        if (pick(data.palette, base.palette, master.palette)) rest.push('色');
        for (const s of ['big', 'small']) if (pick(data[s].order, base[s].order, master[s].order)) rest.push(`${s === 'big' ? '大' : '小'}のコマの割り当て`);
        return [...(poses === 'なし' ? [] : [poses]), ...rest].join('／') || 'なし';
      };
      const rolled = list((d, b, m) => !same(m, b) && same(d, b));
      const both = list((d, b, m) => !same(m, b) && !same(d, b) && !same(d, m));
      const painted = list((d, b) => !same(d, b));
      if (rolled === 'なし' && both === 'なし') {
        return {stop: false, lines: [`元の印は 1 つ前の版 ${raw.base} ですが、今の絵 ${now} の変更はすべて含まれています。今回塗った絵: ${painted}`]};
      }
      lines.push(`反映すると巻き戻る絵: ${rolled}`, `両方で変えた絵: ${both}`, `今回塗った絵: ${painted}`);
    } else if (master) {
      lines.push(`元の版が退避に見つからないため、巻き戻る絵を特定できません。今の絵と違う絵: ${poseList(count, (s, i) => !same(data[s].poses[i], master[s].poses[i]))}`);
    }
  }
  lines.push('エディタを開き直して塗り直すか、内容を確かめたうえで --force を付けてください（--force はこのファイルの絵で上書きします。巻き戻る絵も戻ります）。');
  return {stop: true, lines};
}
// 同じフォルダにある、まだ反映していない別の書き出しを拾う。台帳に載っているものと、今の正本と同じ絵のものは数えない。
function unapplied(file, inputText, masterText, ledger) {
  const dir = path.dirname(path.resolve(file)), known = new Set(ledger.map(x => x.sha1));
  const out = [];
  for (const name of fs.readdirSync(dir).filter(n => /^dotpet_art.*\.json$/.test(n)).sort()) {
    const full = path.join(dir, name);
    if (full === path.resolve(file)) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (text === inputText || known.has(sha1(text))) continue;
    try { const d = JSON.parse(text); if (!validate(d).length && serialize(normalize(d)) === masterText) continue; } catch { /* 読めないファイルも名指しして人に見てもらう */ }
    out.push({name, sha1: sha1(text), mtime: fs.statSync(full).mtime});
  }
  return out;
}
const SELF = path.relative(process.cwd(), __filename) || __filename;
const USAGE = `使い方:\nnode ${SELF} <JSON> [--no-deploy] [--force]\nnode ${SELF} --check <JSON> [--force]\nnode ${SELF} --regen [--no-deploy]\n--no-deploy: 配備の設定があっても配備しない\n` + '--force: 「古い絵を元にしている」「未反映の別の書き出しがある」で止めずに続ける（内容は表示する）';
function main(args) {
  const check = args.includes('--check'), regen = args.includes('--regen'), noDeploy = args.includes('--no-deploy'), force = args.includes('--force');
  const files = args.filter(a => !a.startsWith('--'));
  if (args.some(a => a.startsWith('--') && !['--check','--regen','--no-deploy','--force'].includes(a)) || new Set(args).size !== args.length || (check && (regen || noDeploy)) || (regen && force) || files.length !== (regen ? 0 : 1)) {
    console.error(USAGE); return 2;
  }
  const mod = process.env.DOTPET_ART_ROOT ? path.resolve(process.env.DOTPET_ART_ROOT) : path.resolve(__dirname, '..');
  let local = null;
  const localFile = path.join(__dirname, 'apply_art.local.json');
  if (!process.env.DOTPET_ART_ROOT && fs.existsSync(localFile)) {
    try { local = JSON.parse(fs.readFileSync(localFile, 'utf8')); }
    catch (e) { console.error(`設定を読めません: ${localFile}: ${e.message}`); return 1; }
  }
  const root = local ? path.resolve(__dirname, local.root || '.') : mod;
  const parent = local?.backupDir ? path.join(root, local.backupDir) : path.join(mod, 'backup');
  // 台帳: 反映した書き出しと、--force で確認済みにした書き出しの記録（中身のハッシュで照合する）。
  const ledgerFile = local?.ledgerFile ? path.join(root, local.ledgerFile) : path.join(mod, 'apply_ledger.json');
  let data, raw, inputText = '';
  try { inputText = fs.readFileSync(regen ? path.join(mod, 'art/dotpet_art.json') : files[0], 'utf8'); raw = data = JSON.parse(inputText); }
  catch (e) { console.error(`JSON を読めません: ${e.message}`); return 1; }
  const errors = validate(data);
  if (errors.length) { console.error(errors.join('\n')); return 1; }
  data = normalize(data);
  let ledger = [], dismissed = [];
  if (!regen) {
    try { ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')); } catch { /* 初回は台帳が無い */ }
    const masterFile = path.join(mod, 'art/dotpet_art.json');
    const masterText = fs.existsSync(masterFile) ? fs.readFileSync(masterFile, 'utf8') : null;
    const stale = masterText === null ? {stop: false, lines: []} : staleBase(raw, data, masterText, parent);
    const stops = stale.stop ? stale.lines : [];
    if (!stale.stop && stale.lines.length) console.error(stale.lines.join('\n'));
    dismissed = unapplied(files[0], inputText, masterText, ledger);
    if (dismissed.length) {
      const time = d => d.toLocaleString('sv-SE').slice(5, 16);
      stops.push('まだ反映していない別の書き出しがあります:', ...dismissed.map(x => `  ${x.name}（${time(x.mtime)}）`), '先にそちらの中身を確かめてください。不要なら削除するか、--force を付けて反映すると確認済みとして記録し、次から数えません。');
    }
    if (stops.length) {
      console.error((force ? '⚠️ --force のため止めずに続けます。\n' : '') + stops.join('\n'));
      if (!force) return 1;
    }
  }
  if (check) { console.log(`OK: 大 ${data.big.poses.length} 枚・小 ${data.small.poses.length} 枚`); return 0; }
  const outputs = {'art/dotpet_art.json': serialize(data), ...generate(data)};
  fs.mkdirSync(parent, {recursive:true});
  const date = new Date().toLocaleString('sv-SE').replace(/[-:]/g, '').replace(' ', '-');
  const backup = fs.mkdtempSync(path.join(parent, `dotpet_art_${date}_`));
  const existed = {};
  for (const name of Object.keys(outputs)) {
    existed[name] = fs.existsSync(path.join(mod, name));
    if (existed[name]) { fs.mkdirSync(path.dirname(path.join(backup,name)), {recursive:true}); fs.copyFileSync(path.join(mod,name), path.join(backup,name)); }
  }
  function restore() {
    for (const name of Object.keys(outputs)) {
      if (existed[name]) fs.copyFileSync(path.join(backup,name), path.join(mod,name));
      else if (fs.existsSync(path.join(mod,name))) fs.renameSync(path.join(mod,name), path.join(backup, 'new_' + name.replaceAll('/', '_')));
    }
  }
  try {
    for (const [name, text] of Object.entries(outputs)) { fs.mkdirSync(path.dirname(path.join(mod,name)), {recursive:true}); fs.writeFileSync(path.join(mod,name), text, 'utf8'); }
  } catch (e) { restore(); throw e; }
  const run = ([script, ...rest]) => spawnSync(process.execPath, [path.join(root, script), ...rest], {cwd:root, encoding:'utf8'});
  // 設定が無いときは Claude Code の検査を使う。claude が見つからなければ、検査を省いたことを知らせて続ける。
  const claude = step => spawnSync('claude', ['plugin', step, mod], {encoding:'utf8', shell: process.platform === 'win32'});
  if (process.env.DOTPET_ART_SKIP_CHECK !== '1') {
    const results = local?.check ? [run(local.check)] : [];
    if (!local?.check) for (const step of ['validate', 'test']) {
      const r = claude(step);
      if (r.error && r.error.code === 'ENOENT') { console.error('claude コマンドが見つからないため、MOD の検査（claude plugin validate・test）は省きました。'); break; }
      results.push(r);
      if (r.status !== 0) break;
    }
    const r = results.find(x => x.status !== 0 || x.error);
    if (r) {
      restore(); console.error('MOD の検査に失敗したため5本を退避から戻しました。');
      console.error((`${r.stdout || ''}${r.stderr || ''}${r.error ? r.error.message : ''}`).trimEnd().split('\n').slice(-20).join('\n')); return 1;
    }
  }
  if (!regen) {
    const at = new Date().toLocaleString('sv-SE');
    ledger.push({name: path.basename(files[0]), sha1: sha1(inputText), kind: 'applied', at}, ...dismissed.map(x => ({name: x.name, sha1: x.sha1, kind: 'dismissed', at})));
    fs.mkdirSync(path.dirname(ledgerFile), {recursive:true});
    fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1) + '\n', 'utf8');
  }
  const deployed = !noDeploy && Boolean(local?.deploy);
  if (deployed) {
    const r = run(local.deploy);
    const output = `${r.stdout || ''}${r.stderr || ''}${r.error ? r.error.message : ''}`.trimEnd();
    console.log(output.split('\n').at(-1));
    if (r.status !== 0 || r.error) { console.error('配備に失敗しました（正本は反映済みです）。'); return 1; }
  }
  const label = process.env.DOTPET_ART_ROOT ? backup : path.relative(root, backup);
  console.log(`反映しました${noDeploy ? '（配備はしていません）' : ''}: 大 ${data.big.poses.length} 枚・小 ${data.small.poses.length} 枚。退避: ${label}。開いているセッションで絵が変わらないときは /dotpet を 2 回打つか、開き直してください`);
  return 0;
}
module.exports = {validate, normalize, generate, serialize, baseId};
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error(`反映に失敗しました: ${e.message}`); process.exitCode = 1; }
}
