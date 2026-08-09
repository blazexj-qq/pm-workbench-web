// ============================================================
// 项目管理工作台 · 回归测试套件（自包含、按函数名抽取）
// 运行：双击「运行回归测试.bat」 或 node 回归测试.js
// 原理：从 ../通用项目管理工作台.html 抽取主脚本，用 vm 在带 DOM 桩的沙箱里加载，
//       再对纯计算函数与 5 个档案 Tab 渲染跑断言。不依赖行号，版本升级后依然可用。
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, '..', '通用项目管理工作台.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

// ---- 抽取主脚本（最后一个无属性 <script> 块）----
function extractMainScript(src) {
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m, last = null;
  while ((m = re.exec(src)) !== null) last = m[1];
  if (!last) throw new Error('未找到主脚本 <script> 块');
  return last;
}

// ---- 中和 init() 自启动（避免 DOM 桩不足时崩）----
function neutralizeInit(js) {
  const m = js.match(/\(\s*async\s+function\s+init\s*\(/) || js.match(/\(\s*function\s+init\s*\(/);
  let startWrap, idx;
  if (m) {
    startWrap = m.index;
    idx = js.indexOf('function init(', m.index);
  } else {
    idx = js.search(/\bfunction\s+init\s*\(/);
    if (idx < 0) return js;
    startWrap = idx;
  }
  let i = js.indexOf('{', idx);
  if (i < 0) return js;
  let depth = 0, end = -1;
  for (let j = i; j < js.length; j++) {
    if (js[j] === '{') depth++;
    else if (js[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) return js;
  // 吞掉 IIFE 尾部的 ')();'（含首尾空白与分号）
  let tail = end + 1;
  while (tail < js.length && /\s/.test(js[tail])) tail++;
  if (js[tail] === ')') tail++;
  if (js[tail] === '(') tail++;
  if (js[tail] === ')') tail++;
  if (js[tail] === ';') tail++;
  return js.slice(0, startWrap) + '/* init() removed for test */' + js.slice(tail);
}

const appJs = neutralizeInit(extractMainScript(html));

// ---- DOM / 浏览器 API 桩 ----
function makeStub() {
  const fn = function () { return stub; };
  const stub = new Proxy(fn, {
    get(t, p) {
      if (p === 'length') return 0;
      if (p === Symbol.toPrimitive) return () => '';
      if (p === 'then') return undefined; // 不要像 Promise
      if (p === 'nodeType') return 1;
      return stub;
    },
    set() { return true; },
    apply() { return stub; },
    construct() { return stub; }
  });
  return stub;
}
const noop = function () {};
const documentStub = makeStub();
const localStorageStub = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };
const fetchStub = () => Promise.resolve({ json: () => Promise.resolve({}), text: () => Promise.resolve(''), ok: true });

const sandbox = {
  console,
  document: documentStub,
  location: makeStub(),
  navigator: makeStub(),
  localStorage: localStorageStub,
  indexedDB: makeStub(),
  fetch: fetchStub,
  setTimeout: () => 0,
  clearTimeout: noop,
  setInterval: () => 0,
  clearInterval: noop,
  requestAnimationFrame: noop,
  queueMicrotask: noop,
  Blob: function () {},
  FileReader: function () {},
  XMLHttpRequest: function () {},
  crypto: { getRandomValues: (a) => a },
  btoa: () => '',
  atob: () => '',
  alert: noop,
  confirm: () => true,
  prompt: () => null,
  module: {}, exports: {}
};

const context = vm.createContext(sandbox);
context.window = context;
context.globalThis = context;

// ---- 测试代码（与主脚本在同一 vm 作用域，可直接引用其全局函数）----
const tests = `
var __pass=0,__fail=0,__fails=[];
function __eq(n,g,e){ var a=JSON.stringify(g),b=JSON.stringify(e); if(a===b)__pass++; else{__fail++;__fails.push(n+' => got '+a+' exp '+b);} }
function __ok(n,c){ if(c)__pass++; else{__fail++;__fails.push(n+' => expected truthy');} }
function __approx(n,a,b){ if(Math.abs(a-b)<1e-6)__pass++; else{__fail++;__fails.push(n+' => got '+a+' exp '+b);} }
function __fn(name){ return eval(name); } // 取 vm 全局函数

function mkProj(over){ return Object.assign({id:'P1',name:'测试项目',info:{},contracts:[],boq:[],milestones:[]}, over||{}); }

// ---------- contractTotal ----------
(function(){
  __eq('contractTotal.sum', contractTotal(mkProj({contracts:[{amount:100},{amount:50}]})), 150);
  __eq('contractTotal.infoFallback', contractTotal(mkProj({contracts:[],info:{contractAmount:200}})), 200);
  __eq('contractTotal.zeroContractFallsBack', contractTotal(mkProj({contracts:[{amount:0}],info:{contractAmount:200}})), 200);
  __eq('contractTotal.none', contractTotal(mkProj({contracts:[],info:{}})), 0);
})();

// ---------- overallCompletion ----------
(function(){
  data.tasks=[
    {id:'t1',projectId:'P1',dimension:'progress',status:'已完成'},
    {id:'t2',projectId:'P1',dimension:'progress',status:'已完成'},
    {id:'t3',projectId:'P1',dimension:'progress',status:'进行中'},
    {id:'t4',projectId:'P1',dimension:'quality',status:'已完成'},
    {id:'t5',projectId:'P2',dimension:'progress',status:'已完成'}
  ];
  __approx('overallCompletion.excludesOtherDim', overallCompletion(mkProj({})), 2/3);
  data.tasks=[];
  __eq('overallCompletion.empty', overallCompletion(mkProj({})), 0);
})();

// ---------- outputValue ----------
(function(){
  data.tasks=[{projectId:'P1',dimension:'progress',status:'已完成'},{projectId:'P1',dimension:'progress',status:'进行中'}];
  var ov=outputValue(mkProj({contracts:[{amount:1000}]}));
  __eq('outputValue.done', ov.done, 500);
  __eq('outputValue.rate', ov.rate, '50.0');
  var ov2=outputValue(mkProj({contracts:[]}));
  __eq('outputValue.zeroTotal', ov2.done, 0);
  __eq('outputValue.zeroRate', ov2.rate, '0.0');
})();

// ---------- boqPivot ----------
(function(){
  var pv=boqPivot(mkProj({boq:[
    {major:'电气',costType:'人工费',amount:100},
    {major:'电气',costType:'人工费',amount:50},
    {major:'电气',costType:'材料费',amount:200},
    {major:'消防',costType:'材料费',amount:80},
    {major:'',costType:'',amount:30},
    {major:'电气',costType:'机械费',qty:10,unitPrice:5}
  ]}));
  __eq('boqPivot.电气.人工费', pv['电气']['人工费'], 150);
  __eq('boqPivot.电气.材料费', pv['电气']['材料费'], 200);
  __eq('boqPivot.消防.材料费', pv['消防']['材料费'], 80);
  __eq('boqPivot.未分专业.综合', pv['未分专业']['综合'], 30);
  __eq('boqPivot.电气.机械费.qty', pv['电气']['机械费'], 50);
})();

// ---------- timeAccruedOutput ----------
(function(){
  data.tasks=[
    {projectId:'P1',dimension:'progress',status:'已完成',completedDate:'2026-01-15'},
    {projectId:'P1',dimension:'progress',status:'已完成',completedDate:'2026-01-20'},
    {projectId:'P1',dimension:'progress',status:'已完成',completedDate:'2026-03-10'},
    {projectId:'P1',dimension:'progress',status:'进行中'},
    {projectId:'P1',dimension:'progress',status:'已完成'}
  ];
  var r=timeAccruedOutput(mkProj({contracts:[{amount:1000}]}));
  __eq('timeAccr.total', r.total, 1000);
  __eq('timeAccr.share', r.share, 200);
  __eq('timeAccr.currentCum', r.currentCum, 800);
  __eq('timeAccr.2026-01', r.cum['2026-01'], 400);
  __eq('timeAccr.2026-03', r.cum['2026-03'], 600);
  __ok('timeAccr.undated', r.byMonth['__undated']===200);
  data.tasks=[];
  var r2=timeAccruedOutput(mkProj({contracts:[{amount:1000}]}));
  __eq('timeAccr.emptyTotal', r2.total, 0);
  __eq('timeAccr.emptyCum', r2.currentCum, 0);
})();

// ---------- detectPayPhase ----------
(function(){
  var mk=function(ms){return mkProj({milestones:ms});};
  var doneM=function(type,name){return {type:type,name:name,planEnd:'2026-01-01',actualEnd:'2026-01-01'};};
  var pendM=function(type,name){return {type:type,name:name,planEnd:'2099-01-01'};};
  __eq('phase.settleByType', detectPayPhase(mk([doneM('备案')])), 'settle');
  __eq('phase.settleByName', detectPayPhase(mk([doneM('其它','结算完成')])), 'settle');
  __eq('phase.acceptByType', detectPayPhase(mk([doneM('竣工验收')])), 'accept');
  __eq('phase.acceptByName', detectPayPhase(mk([doneM('其它','竣工')])), 'accept');
  __eq('phase.completeByType', detectPayPhase(mk([doneM('工序完工')])), 'complete');
  __eq('phase.completeByName', detectPayPhase(mk([doneM('其它','某某完工')])), 'complete');
  __eq('phase.progressPending', detectPayPhase(mk([pendM('备案')])), 'progress');
  __eq('phase.progressNone', detectPayPhase(mk([])), 'progress');
})();

// ---------- payableInfo ----------
(function(){
  data.tasks=[{projectId:'P1',dimension:'progress',status:'已完成'},{projectId:'P1',dimension:'progress',status:'进行中'}];
  var p=mkProj({contracts:[{amount:1000}]});
  var pi=payableInfo(p);
  __eq('payable.phase', pi.phase, 'progress');
  __eq('payable.curPct', pi.curPct, 75);
  __eq('payable.cumulative', pi.cumulativePayable, 375);
  __eq('payable.prevPct', pi.prevPct, 0);
  __eq('payable.increment', pi.phaseIncrement, 375);
  __eq('payable.warrantyResidual', pi.warrantyResidual, 5);
  p.payPhase='settle';
  var pi2=payableInfo(p);
  __eq('payable.settle.curPct', pi2.curPct, 95);
  __eq('payable.settle.cumulative', pi2.cumulativePayable, 475);
  __eq('payable.settle.prevPct', pi2.prevPct, 90);
  __eq('payable.settle.increment', pi2.phaseIncrement, 25);
  p.payPhase='warranty';
  var pi3=payableInfo(p);
  __eq('payable.warranty.curPct', pi3.curPct, 100);
  __eq('payable.warranty.cumulative', pi3.cumulativePayable, 500);
  __eq('payable.warranty.increment', pi3.phaseIncrement, 25);
  p.payPhase=''; p.payRatios={progress:70,complete:80,accept:90,settle:95};
  var pi4=payableInfo(p);
  __eq('payable.customProgress', pi4.curPct, 70);
  __eq('payable.customCumulative', pi4.cumulativePayable, 350);
  p.payRatios={progress:75,complete:80,accept:90};
  var pi5=payableInfo(p);
  __eq('payable.warrantyResidualDefault', pi5.warrantyResidual, 5);
})();

// ---------- msStatus ----------
(function(){
  var m=function(o){return Object.assign({type:'x',name:'x'},o);};
  __eq('ms.done', msStatus(m({planEnd:'2026-01-10',actualEnd:'2026-01-08'})), 'done');
  __eq('ms.delayedActual', msStatus(m({planEnd:'2026-01-10',actualEnd:'2026-01-20'})), 'delayed');
  __eq('ms.noPlan', msStatus(m({actualEnd:'2026-01-20'})), 'normal');
  __eq('ms.normal', msStatus(m({planEnd:'2099-01-01'})), 'normal');
  var T=new Date(); var d3=new Date(T.getTime()+2*86400000).toISOString().slice(0,10);
  __eq('ms.warn3', msStatus(m({planEnd:d3})), 'warn');
  var dPast=new Date(T.getTime()-2*86400000).toISOString().slice(0,10);
  __eq('ms.delayedPast', msStatus(m({planEnd:dPast})), 'delayed');
})();

// ---------- accrualChartSVG ----------
(function(){
  var svg=accrualChartSVG({'2026-01':400,'2026-03':600},['2026-01','2026-03']);
  __ok('chart.nonEmpty', svg.indexOf('<svg')===0);
  __ok('chart.hasPath', svg.indexOf('<path')>-1);
  __eq('chart.empty', accrualChartSVG({},[]), '');
})();

// ---------- 集成：5 个档案 Tab 渲染 ----------
(function(){
  data.projects=[mkProj({info:{buildArea:1000},contracts:[{amount:1000,name:'主合同'}],boq:[{major:'电气',costType:'人工费',amount:100}],milestones:[{type:'竣工验收',name:'竣工',planEnd:'2099-01-01'}]})];
  data.tasks=[{projectId:'P1',dimension:'progress',status:'已完成',completedDate:'2026-01-15'},{projectId:'P1',dimension:'progress',status:'进行中'}];
  var p=data.projects[0];
  ['archiveInfo','archiveContract','archiveBoq','archiveOutput','archiveSchedule'].forEach(function(fn){
    var h=__fn(fn)(p);
    __ok('render.'+fn+'.string', typeof h==='string' && h.length>0);
    __ok('render.'+fn+'.noObjectLeak', h.indexOf('[object Object]')<0);
  });
})();

// ---------- 集成：工期延期预警 ----------
(function(){
  data.projects=[mkProj({milestones:[{type:'工序完工',name:'某工序',planEnd:'2020-01-01'}]})];
  data.tasks=[];
  var r=computeReminders();
  __ok('reminders.isArray', Array.isArray(r));
  __ok('reminders.detectDelay', r.some(function(x){return x.lv==='bad' && /工期延期/.test(x.txt);}));
})();

// ---------- 集成：空项目不崩 ----------
(function(){
  var p=mkProj({});
  ['archiveInfo','archiveContract','archiveBoq','archiveOutput','archiveSchedule'].forEach(function(fn){
    var h=__fn(fn)(p);
    __ok('empty.'+fn, typeof h==='string');
  });
})();

console.log('\\n==== 回归测试结果 ====');
console.log('通过: '+__pass+'  失败: '+__fail);
if(__fail){ console.log('\\n失败项:'); __fails.forEach(function(f){console.log(' - '+f);}); throw new Error(__fail+' 项断言失败'); }
else { console.log('全部通过 ✅'); }
`;

try {
  vm.runInContext(appJs + '\n;\n' + tests, context, { filename: 'workbench-regression' });
} catch (e) {
  console.error('\n❌ 回归测试异常：', e && e.message ? e.message : e);
  process.exit(1);
}
