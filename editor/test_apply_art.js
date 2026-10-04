#!/usr/bin/env node
'use strict';
// 一時フォルダだけで反映を検査。claude と ~/.claude には触れない。
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const {spawnSync} = require('child_process');
const {validate, normalize, generate, serialize, baseId} = require('./apply_art');
const mod = path.resolve(__dirname, '..');
const real = JSON.parse(fs.readFileSync(path.join(mod,'art/dotpet_art.json'),'utf8'));
const copy = data => JSON.parse(JSON.stringify(data));
let count = 0, failed = 0;
function test(name, fn) { try {fn();count++;} catch(e) {failed++;console.error(`NG ${name}: ${e.stack}`);} }
function reject(name, change, location) {
 test(name,()=>{const data=copy(real);change(data);const errors=validate(data);assert.ok(errors.length>0,'不正入力が合格した');assert.ok(errors.some(e=>location.test(e)),errors.join('\n'));});
}
test('実物の検査',()=>assert.deepEqual(validate(real),[]));
test('正規化済み・生成4本のバイト一致',()=>{
 assert.deepEqual(normalize(real),real);
 assert.equal(fs.readFileSync(path.join(mod,'art/dotpet_art.json'),'utf8'),serialize(real));
 const files=generate(real);assert.equal(Object.keys(files).length,4);
 for(const [name,text] of Object.entries(files))assert.equal(fs.readFileSync(path.join(mod,name),'utf8'),text,name);
});
reject('行の長さ19',d=>d.big.poses[0][4]=d.big.poses[0][4].slice(1),/big の絵 1・行 5.*19/);
reject('行数不足',d=>d.big.poses[0].pop(),/big の絵 1 の行数.*9/);
reject('パレット外の文字',d=>d.big.poses[0][0]='X'+d.big.poses[0][0].slice(1),/big の絵 1・行 1.*X/);
reject('workの長さ47',d=>d.big.order.work.pop(),/big.order.work.*47/);
reject('絵番号範囲外',d=>d.big.order.idle[0]=d.big.poses.length,/big.order.idle・コマ 1/);
reject('パレットキー不足',d=>delete d.palette.V,/palette.*キー/);
reject('色の桁不足',d=>d.palette.A='#12345',/palette.A/);
reject('透明を含めて3色',d=>{
 d.small.poses[0]=Array(12).fill(' '.repeat(20));d.small.poses[0][4]='    AM              ';
},/small の絵 1・マス \(列 3, 行 2\).*3 色.*A.*M.*空白/);
reject('versionが2',d=>d.version=2,/version/);
for(const [name,lines] of [['空白＋1色',['A ','  ','  ','  ']],['2色',['AM','AM','AM','AM']]])test(name,()=>{
 const d=copy(real);d.small.poses[0]=Array(12).fill(' '.repeat(20));lines.forEach((line,y)=>d.small.poses[0][y]=line+' '.repeat(18));assert.deepEqual(validate(d),[]);
});
test('重複・未使用・初出順・再番号・冪等',()=>{
 const d=copy(real);
 for(const size of ['big','small']) {
   const rows=d[size].rows;d[size].poses=[Array(rows).fill('A'.repeat(20)),Array(rows).fill('S'.repeat(20)),Array(rows).fill('A'.repeat(20)),Array(rows).fill('E'.repeat(20))];
   for(const mode of ['idle','work','done','sleep'])d[size].order[mode]=Array(mode==='work'?48:8).fill(2);
   d[size].order.work[0]=1;
 }
 d.palette.A=d.palette.A.toUpperCase();const n=normalize(d);
 for(const size of ['big','small']){assert.equal(n[size].poses.length,2);assert.deepEqual(n[size].poses,[d[size].poses[0],d[size].poses[1]]);assert.equal(n[size].order.idle[0],0);assert.equal(n[size].order.work[0],1);}
 assert.equal(n.palette.A,real.palette.A);assert.deepEqual(normalize(n),n);
});
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'dotpet_art_test_'));
const input=path.join(temp,'input.json'), root=path.join(temp,'mod');
const paths=['art/dotpet_art.json',...Object.keys(generate(real))];
fs.mkdirSync(root,{recursive:true});
for(const name of paths){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),'before: '+name);}
// 書き出しには「どの絵を元に塗ったか」の印が要る。masterText は反映先にある正本の中身。
const stamped=(data,masterText)=>serialize({...data,base:baseId(masterText)});
const masterText=()=>fs.readFileSync(path.join(root,'art/dotpet_art.json'),'utf8');
fs.writeFileSync(input,stamped(real,'before: art/dotpet_art.json'));
const cli=(args, extra={})=>spawnSync(process.execPath,[path.join(__dirname,'apply_art.js'),...args],{cwd:temp,env:{...process.env,DOTPET_ART_ROOT:root,DOTPET_ART_SKIP_CHECK:'1',...extra},encoding:'utf8'});
test('CLI:反映・5本・退避',()=>{
 const r=cli([input,'--no-deploy']);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/反映しました（配備はしていません）/);
 for(const [name,text] of Object.entries({'art/dotpet_art.json':serialize(real),...generate(real)}))assert.equal(fs.readFileSync(path.join(root,name),'utf8'),text);
 const backups=fs.readdirSync(path.join(root,'backup'));assert.equal(backups.length,1);
 for(const name of paths)assert.equal(fs.readFileSync(path.join(root,'backup',backups[0],name),'utf8'),'before: '+name);
});
test('CLI:不合格なら5本とも変更しない',()=>{
 const before=paths.map(name=>fs.readFileSync(path.join(root,name),'utf8'));
 const invalid=copy(real);invalid.version=2;fs.writeFileSync(input,JSON.stringify(invalid));
 const r=cli([input,'--no-deploy']);assert.equal(r.status,1);assert.match(r.stderr,/version/);
 assert.deepEqual(paths.map(name=>fs.readFileSync(path.join(root,name),'utf8')),before);assert.equal(fs.readdirSync(path.join(root,'backup')).length,1);
});
test('CLI:check・引数エラー・読込失敗',()=>{
 const before=fs.readdirSync(path.join(root,'backup')).length;
 assert.equal(cli(['--check',input]).status,1);fs.writeFileSync(input,stamped(real,masterText()));
 const ok=cli(['--check',input]);assert.equal(ok.status,0,ok.stderr);assert.match(ok.stdout,/^OK: 大 \d+ 枚・小 \d+ 枚\n$/);
 for(const args of [[],['--unknown'],['--check','--regen'],['--regen',input],['--check',input,'--no-deploy'],[input,input]])assert.equal(cli(args).status,2,JSON.stringify(args));
 assert.equal(cli(['--check',path.join(temp,'missing')]).status,1);
 fs.writeFileSync(input,'{');assert.equal(cli(['--check',input]).status,1);fs.writeFileSync(input,stamped(real,masterText()));
 assert.equal(fs.readdirSync(path.join(root,'backup')).length,before);
 for(const args of [['--regen','--force'],['--check',input,'--force','--no-deploy']])assert.equal(cli(args).status,2,JSON.stringify(args));
});
const ledger=()=>JSON.parse(fs.readFileSync(path.join(root,'apply_ledger.json'),'utf8'));
const dot=(data,size,pose,key)=>{const d=copy(data);d[size].poses[pose][0]=key+d[size].poses[pose][0].slice(1);return d;};
test('元の印:無い書き出しは止まる・--force で通る',()=>{
 fs.writeFileSync(input,serialize(real));
 const r=cli(['--check',input]);assert.equal(r.status,1);assert.match(r.stderr,/元の印がありません/);
 const f=cli(['--check',input,'--force']);assert.equal(f.status,0,f.stderr);assert.match(f.stderr,/元の印がありません/);assert.match(f.stderr,/--force/);
});
test('元の印:古い絵を元にした書き出しは止まり、巻き戻る絵と塗った絵を分けて出す',()=>{
 const m0=masterText(), base0=JSON.parse(m0);
 const m1=dot(base0,'big',1,'V');fs.writeFileSync(input,stamped(m1,m0));
 assert.equal(cli([input,'--no-deploy']).status,0);            // 正本が m1 になる（退避に m0 が残る）
 const stale=dot(base0,'big',2,'K');fs.writeFileSync(input,stamped(stale,m0));   // m0 を元に絵 3 だけ塗った書き出し
 for(const args of [['--check',input],[input,'--no-deploy']]){
  const r=cli(args);assert.equal(r.status,1,JSON.stringify(args));
  assert.match(r.stderr,/古い版を元にしています/);assert.match(r.stderr,/巻き戻る絵: 大 2(?!\d)/);assert.match(r.stderr,/今回塗った絵: 大 3(?!\d)/);
 }
 assert.equal(masterText(),serialize(m1),'止まったのに正本が変わった');
 const f=cli([input,'--no-deploy','--force']);assert.equal(f.status,0,f.stderr);assert.match(f.stderr,/巻き戻る絵: 大 2/);
 assert.equal(masterText(),serialize(stale));
});
test('元の印:古くても今の絵の変更をすべて含む書き出しは通す',()=>{
 const m=masterText(), cur=JSON.parse(m);
 const m2=dot(cur,'big',7,'V');fs.writeFileSync(input,stamped(m2,m));assert.equal(cli([input,'--no-deploy']).status,0);
 const next=dot(m2,'big',8,'V');fs.writeFileSync(input,stamped(next,m));          // 同じタブで続きを塗った形（印は古いが m2 の変更を含む）
 const r=cli(['--check',input]);assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/すべて含まれています/);assert.match(r.stderr,/今回塗った絵: 大 8・9(?!\d)/);assert.doesNotMatch(r.stderr,/--force/);
 assert.equal(cli([input,'--no-deploy']).status,0);assert.equal(masterText(),serialize(next));
});
test('元の印:両方で変えた絵は止まる',()=>{
 const m=masterText(), cur=JSON.parse(m);
 fs.writeFileSync(input,stamped(dot(cur,'big',9,'V'),m));assert.equal(cli([input,'--no-deploy']).status,0);   // 正本が絵 10 を変えた
 fs.writeFileSync(input,stamped(dot(cur,'big',9,'B'),m));                                                    // 古い版を元に、同じ絵 10 を別の形に変えた書き出し
 const r=cli(['--check',input]);assert.equal(r.status,1);assert.match(r.stderr,/両方で変えた絵: 大 10(?!\d)/);assert.match(r.stderr,/巻き戻る絵: なし/);
});
test('元の印:色の巻き戻りは止まる',()=>{
 const m=masterText(), cur=JSON.parse(m);
 const recolor=copy(cur);recolor.palette.A='#123456';fs.writeFileSync(input,stamped(recolor,m));assert.equal(cli([input,'--no-deploy']).status,0);
 fs.writeFileSync(input,stamped(dot(cur,'big',11,'V'),m));                                                   // 古い色のまま絵 12 だけ塗った書き出し
 const r=cli(['--check',input]);assert.equal(r.status,1);assert.match(r.stderr,/巻き戻る絵: 色/);
});
test('未反映:同じフォルダの別の書き出しを名指しして止まる・反映済みと --force 済みは数えない',()=>{
 const dl=path.join(temp,'dl');fs.mkdirSync(dl);
 const m=masterText(), cur=JSON.parse(m);
 const a=path.join(dl,'dotpet_art_20260101-000001.json'), b=path.join(dl,'dotpet_art_20260101-000002.json'), same=path.join(dl,'dotpet_art (1).json');
 fs.writeFileSync(a,stamped(dot(cur,'big',4,'K'),m));fs.writeFileSync(b,stamped(dot(cur,'big',5,'K'),m));fs.writeFileSync(same,stamped(cur,m));
 const r=cli(['--check',b]);assert.equal(r.status,1);assert.match(r.stderr,/まだ反映していない別の書き出し/);assert.match(r.stderr,/dotpet_art_20260101-000001\.json/);assert.doesNotMatch(r.stderr,/dotpet_art \(1\)\.json/);
 assert.equal(cli([b,'--no-deploy']).status,1);assert.equal(masterText(),m);
 fs.unlinkSync(same);            // 正本が変わると「前の正本と同じ絵」も未反映に数えるので、ここで片付ける
 const f=cli([b,'--no-deploy','--force']);assert.equal(f.status,0,f.stderr);
 const rows=ledger();assert.ok(rows.some(x=>x.name==='dotpet_art_20260101-000002.json'&&x.kind==='applied'));assert.ok(rows.some(x=>x.name==='dotpet_art_20260101-000001.json'&&x.kind==='dismissed'));
 const c=path.join(dl,'dotpet_art_20260101-000003.json');fs.writeFileSync(c,stamped(dot(JSON.parse(masterText()),'big',6,'K'),masterText()));
 const ok=cli(['--check',c]);assert.equal(ok.status,0,ok.stderr);            // a は確認済み、b は反映済み
});
test('CLI:regen・連続反映の退避名は固有',()=>{const n=fs.readdirSync(path.join(root,'backup')).length;assert.equal(cli(['--regen','--no-deploy']).status,0);assert.equal(cli(['--regen','--no-deploy']).status,0);assert.equal(fs.readdirSync(path.join(root,'backup')).length,n+2);});
test('エディタと検査・正規化・書式の一致',()=>{
 const html=fs.readFileSync(path.join(__dirname,'dotpet_editor.html'),'utf8');
 const shared=html.slice(html.indexOf('const KEYS'),html.indexOf('const $ ='));
 const browser=vm.runInNewContext(shared+'\n({validate,normalize,serialize})');
 const cases=[real,null,{}, {...real,version:2}];
 const invalid=copy(real);invalid.small.poses[0]=Array(12).fill(' '.repeat(20));invalid.small.poses[0][0]='AM'+' '.repeat(18);cases.push(invalid);
 for(const value of cases)assert.equal(JSON.stringify(browser.validate(value)),JSON.stringify(validate(value)));
 assert.equal(JSON.stringify(browser.normalize(real)),JSON.stringify(normalize(real)));
 assert.equal(browser.serialize(browser.normalize(real)),serialize(normalize(real)));
});
// 一時フォルダは失敗時の調査にも使えるようそのまま残す（OSの一時領域）。
if(failed){console.error(`不合格 ${failed} 件（合格 ${count} 件）。一時フォルダ: ${temp}`);process.exitCode=1;}else console.log(`OK ${count} 件`);
