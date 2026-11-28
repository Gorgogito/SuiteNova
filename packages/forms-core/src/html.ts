import { parseMath, toMathML } from '@suitenova/math-core';
import { BLOCKED_EXTENSIONS, FILE_KINDS, MAX_FILES, MAX_RESPONSE_MB } from './files';
import { PAGE_EN, localize } from './i18n';
import { MAX_NAME, RATING_SYMBOLS, type Form } from './model';
import { pageBackground } from './session';

/**
 * The rules of logic.ts (and of files.ts, flow.ts, i18n.ts and session.ts) as plain JavaScript, written into the standalone form. A test runs this text
 * and the TypeScript version on the same inputs and checks that they agree.
 */
export const LOGIC_JS = `
var BLOCKED=${JSON.stringify(BLOCKED_EXTENSIONS)};
var KINDS=${JSON.stringify(Object.fromEntries(FILE_KINDS.map((k) => [k.id, k.extensions])))};
var MAX_FILES=${MAX_FILES},MAX_RESPONSE_MB=${MAX_RESPONSE_MB},MB=1048576;
var PAGE_EN=${JSON.stringify(PAGE_EN)};
var EXACT=new Map(PAGE_EN),PATTERNS=PAGE_EN.filter(function(p){return /\\{[#*]\\}/.test(p[0]);}).map(function(p){
return {en:p[1],re:new RegExp('^'+p[0].split(/(\\{[#*]\\})/).map(function(x){return x==='{#}'?'(-?[0-9]+(?:\\\\.[0-9]+)?(?:e[+-]?[0-9]+)?)':x==='{*}'?'([\\\\s\\\\S]+?)':x.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&');}).join('')+'$')};});
function localize(text,lang){if(lang!=='en')return text;var e=EXACT.get(text);if(e!==undefined)return e;for(var i=0;i<PATTERNS.length;i++){var m=PATTERNS[i].re.exec(text);if(m){var n=1;return PATTERNS[i].en.replace(/\\{[#*]\\}/g,function(){return m[n++];});}}return text;}
function availability(form,now){if(form.closed)return 'closed';if(form.start&&now<Date.parse(form.start))return 'notYet';if(form.end&&now>=Date.parse(form.end))return 'closed';return 'open';}
function norm(s){return String(s).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').trim().toLowerCase();}
function isEmpty(a){if(a===null||a===undefined)return true;if(typeof a==='string')return a.trim()==='';if(Array.isArray(a))return a.length===0;if(typeof a==='object')return Object.values(a).every(function(v){return !v;});return false;}
function asText(a){if(a===null||a===undefined)return [];if(Array.isArray(a))return a.filter(function(x){return typeof x==='string';});if(typeof a==='object')return Object.values(a);return [String(a)];}
function realDate(s){var d=new Date(s+'T00:00:00Z');return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;}
function isInput(q){return q.type!=='title'&&q.type!=='section';}
function hashText(s){var h=0x811c9dc5;for(var i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),0x01000193);return h>>>0;}
function shuffled(list,seed){var a=hashText(seed);function random(){a=(a+0x6d2b79f5)>>>0;var x=Math.imul(a^(a>>>15),1|a);x=(x+Math.imul(x^(x>>>7),61|x))^x;return ((x^(x>>>14))>>>0)/4294967296;}
var out=list.slice();for(var i=out.length-1;i>0;i--){var j=Math.floor(random()*(i+1));var t=out[i];out[i]=out[j];out[j]=t;}return out;}
function orderOf(q,seed){return q.shuffle?shuffled(q.options,seed+q.id):q.options;}
function extensionOf(name){var m=/\\.([^./\\\\]*)$/.exec(name.replace(/[. ]+$/,''));return m?m[1].toLowerCase():'';}
function allowedExtensions(q){var out=[];Object.keys(KINDS).forEach(function(k){if(q.kinds&&q.kinds.indexOf(k)>=0)out=out.concat(KINDS[k]);});return out;}
function fileProblem(q,name,size){var ext=extensionOf(name);if(BLOCKED.indexOf(ext)>=0)return 'No se admiten archivos .'+ext+'.';var allowed=allowedExtensions(q);
if(allowed.length&&allowed.indexOf(ext)<0)return 'El archivo «'+name+'» no es de un tipo admitido.';if(size<=0)return 'El archivo «'+name+'» está vacío.';
var max=q.maxMb===undefined?10:q.maxMb;return size>max*MB?'El archivo «'+name+'» pasa de '+max+' MB.':null;}
function conditionsOf(q){return q.showIf?[q.showIf].concat(q.showIf.more||[]):[];}
function pagesOf(form){var pages=[];form.questions.forEach(function(q){if(q.type==='section')pages.push({section:q,items:[]});else{if(!pages.length)pages.push({section:null,items:[]});pages[pages.length-1].items.push(q);}});return pages.length?pages:[{section:null,items:[]}];}
function met(c,answers){var got=asText(answers[c.question]).map(norm);var want=norm(c.value);if(c.op==='eq')return got.indexOf(want)>=0;if(c.op==='neq')return got.indexOf(want)<0;return got.some(function(g){return g.indexOf(want)>=0;});}
function passes(form,q,answers,shown){var qs=form.questions;var at=qs.indexOf(q);var usable=conditionsOf(q).filter(function(c){var i=qs.findIndex(function(x){return x.id===c.question;});return i>=0&&i<at;});if(!usable.length)return true;var one=function(c){return shown.has(c.question)&&met(c,answers);};return q.showIf&&q.showIf.anyOf?usable.some(one):usable.every(one);}
function leads(pages,i,target){if(target==='end')return pages.length;var j=pages.findIndex(function(p){return p.section&&p.section.id===target;});return j>i?j:i+1;}
function pageAfter(pages,i,shown,answers){var target;pages[i].items.forEach(function(q){var a=answers[q.id];if(shown.has(q.id)&&q.branch&&typeof a==='string'&&Object.prototype.hasOwnProperty.call(q.branch,a))target=q.branch[a];});
if(target===undefined&&pages[i].section)target=pages[i].section.next;return target?leads(pages,i,target):i+1;}
function route(form,answers){var pages=pagesOf(form);var out={pages:[],shown:new Set()};for(var i=0;i<pages.length;i=pageAfter(pages,i,out.shown,answers)){out.pages.push(i);var p=pages[i];if(p.section)out.shown.add(p.section.id);p.items.forEach(function(q){if(passes(form,q,answers,out.shown))out.shown.add(q.id);});}return out;}
function isVisible(form,q,answers){var f=form.questions.indexOf(q)>=0?form:Object.assign({},form,{questions:form.questions.map(function(x){return x.id===q.id?q:x;})});return route(f,answers).shown.has(q.id);}
function canShuffle(form){return !form.questions.some(function(q){return q.type==='section';});}
function staysPut(form,q){return q.type==='title'||!!q.locked||!!q.showIf||form.questions.some(function(x){return conditionsOf(x).some(function(c){return c.question===q.id;});});}
function displayOrder(form,seed){if(!form.shuffle||!canShuffle(form))return form.questions;var free=shuffled(form.questions.filter(function(q){return !staysPut(form,q);}),seed+'order');var n=0;return form.questions.map(function(q){return staysPut(form,q)?q:free[n++];});}
function validateAnswer(q,a){
if(!isInput(q))return null;
if(isEmpty(a))return q.required?'Esta pregunta es obligatoria.':null;
var t=q.type;
if(t==='text'||t==='longtext'){var s=String(a).trim();
if(q.format==='email'&&!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(s))return 'Escribe un correo electrónico válido.';
if(q.format==='url'&&!/^https?:\\/\\/[^\\s]+$/i.test(s))return 'Escribe una dirección web que empiece por http:// o https://.';
if(q.min!==null&&s.length<q.min)return 'Escribe al menos '+q.min+' caracteres.';
if(q.maxValue!==null&&s.length>q.maxValue)return 'Escribe como máximo '+q.maxValue+' caracteres.';
return null;}
if(t==='number'){var n=typeof a==='number'?a:Number(String(a).replace(',','.'));
if(!isFinite(n))return 'Escribe un número.';
if(q.integer&&Math.floor(n)!==n)return 'Escribe un número entero.';
var rule=q.rule||'range';
if(rule==='gt')return q.min!==null&&n<=q.min?'Escribe un número mayor que '+q.min+'.':null;
if(rule==='lt')return q.maxValue!==null&&n>=q.maxValue?'Escribe un número menor que '+q.maxValue+'.':null;
if(rule==='ne')return q.min!==null&&n===q.min?'El número no puede ser '+q.min+'.':null;
if(rule==='outside')return q.min!==null&&q.maxValue!==null&&n>=q.min&&n<=q.maxValue?'Escribe un número menor que '+q.min+' o mayor que '+q.maxValue+'.':null;
if(q.min!==null&&n<q.min)return 'El valor mínimo es '+q.min+'.';
if(q.maxValue!==null&&n>q.maxValue)return 'El valor máximo es '+q.maxValue+'.';
return null;}
if(t==='date')return typeof a==='string'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(a)&&realDate(a)?null:'Escribe una fecha válida.';
if(t==='rating'){var r=Number(a);return Math.floor(r)===r&&r>=1&&r<=q.max?null:'Elige una puntuación de 1 a '+q.max+'.';}
if(t==='nps'){var p=Number(a);return Math.floor(p)===p&&p>=0&&p<=10?null:'Elige un valor de 0 a 10.';}
if(t==='choice'||t==='dropdown'){if(typeof a!=='string')return 'Elige una opción.';return q.options.indexOf(a)>=0||(q.allowOther&&t==='choice')?null:'Elige una de las opciones.';}
if(t==='multi'){if(!Array.isArray(a))return 'Elige una o varias opciones.';if(!a.every(function(x){return typeof x==='string'&&(q.options.indexOf(x)>=0||q.allowOther);}))return 'Hay una opción que no existe.';
if(q.min!==null&&a.length<q.min)return 'Elige al menos '+q.min+' opciones.';if(q.maxValue!==null&&a.length>q.maxValue)return 'Elige como máximo '+q.maxValue+' opciones.';return null;}
if(t==='ranking'){if(!Array.isArray(a)||!a.every(function(x){return typeof x==='string'&&q.options.indexOf(x)>=0;}))return 'Hay un elemento que no existe.';return a.length===q.options.length&&new Set(a).size===a.length?null:'Ordena todos los elementos.';}
if(t==='file'){if(!Array.isArray(a)||!a.every(function(x){return typeof x==='object'&&x!==null;}))return 'Adjunta un archivo.';var m=Math.min(MAX_FILES,q.maxFiles===undefined?1:q.maxFiles);
if(a.length>m)return 'Puedes adjuntar como máximo '+m+' archivo(s).';for(var i=0;i<a.length;i++){var pr=fileProblem(q,a[i].name,a[i].size);if(pr)return pr;}
return a.reduce(function(s,f){return s+f.size;},0)>MAX_RESPONSE_MB*MB?'Entre todos, los archivos pasan de '+MAX_RESPONSE_MB+' MB.':null;}
if(t==='likert'){if(typeof a!=='object'||Array.isArray(a))return 'Responde cada fila.';var miss=q.rows.filter(function(r){return !a[r];});if(q.required&&miss.length)return 'Responde todas las filas.';if(Object.values(a).some(function(v){return v&&q.options.indexOf(v)<0;}))return 'Hay una columna que no existe.';return null;}
return null;}
function validateAll(form,answers){var out={};var shown=route(form,answers).shown;form.questions.forEach(function(q){if(!shown.has(q.id))return;var e=validateAnswer(q,answers[q.id]);if(e)out[q.id]=e;});return out;}
function visibleAnswers(form,answers){var out={};var shown=route(form,answers).shown;form.questions.forEach(function(q){if(isInput(q)&&shown.has(q.id)&&!isEmpty(answers[q.id]))out[q.id]=answers[q.id];});return out;}
function tidyAnswers(form,answers){var out=visibleAnswers(form,answers);form.questions.forEach(function(q){var v=out[q.id];if(typeof v==='string')v=v.trim();else if(Array.isArray(v)&&q.type==='multi')v=v.map(function(x){return x.trim();}).filter(Boolean);
if(q.type==='number'&&typeof v==='string'&&v!=='')v=Number(v.replace(',','.'));if(v!==undefined)out[q.id]=v;});return out;}
function timedAnswers(form,answers){var tidy=tidyAnswers(form,answers),out={};form.questions.forEach(function(q){var v=tidy[q.id];if(v!==undefined&&!isEmpty(v)&&!validateAnswer(Object.assign({},q,{required:false}),v))out[q.id]=v;});return out;}
function answerText(q,a){if(a===undefined||a===null||isEmpty(a))return '—';if(Array.isArray(a)){if(a.length&&typeof a[0]==='object')return a.map(function(f){return f.name;}).join(', ');return q.type==='ranking'?a.map(function(x,i){return (i+1)+'. '+x;}).join('  '):a.join(', ');}
if(typeof a==='object')return Object.entries(a).map(function(e){return e[0]+': '+e[1];}).join('; ');return String(a);}
function answerLines(form,answers,name){var shown=route(form,answers).shown,n=0,lines=[];form.questions.forEach(function(q){if(!isInput(q))return;n++;if(shown.has(q.id))lines.push({label:(form.hideNumbers?'':n+'. ')+q.title,text:answerText(q,answers[q.id])});});
return name?[{label:localize('Nombre',form.language),text:name}].concat(lines):lines;}
function isRight(q,a){if(isEmpty(a))return false;var right=q.correct.map(norm);if(!right.length)return false;var t=q.type;
if(t==='choice'||t==='dropdown')return typeof a==='string'&&norm(a)===right[0];
if(t==='multi'){if(!Array.isArray(a))return false;var got=a.map(norm);return got.length===right.length&&right.every(function(r){return got.indexOf(r)>=0;});}
if(t==='text')return typeof a==='string'&&right.indexOf(norm(a))>=0;
if(t==='number'){var n=typeof a==='number'?a:Number(String(a).replace(',','.'));return isFinite(n)&&right.some(function(r){return Number(r.replace(',','.'))===n;});}
return false;}
function manualGraded(q){return !!q.manual&&['text','longtext','number','date','file','ranking'].indexOf(q.type)>=0;}
function autoGraded(q){return ['choice','multi','dropdown','text','number'].indexOf(q.type)>=0&&!manualGraded(q)&&q.correct.length>0;}
function countsPoints(q){return autoGraded(q)||manualGraded(q);}
function round(n){return Math.round(n*100)/100;}
function own(o,k){return !!o&&Object.prototype.hasOwnProperty.call(o,k);}
function score(form,answers,review){var s={earned:0,total:0,byQuestion:{}};if(!form.quiz)return s;var shown=route(form,answers).shown;form.questions.forEach(function(q){if(!countsPoints(q)||!shown.has(q.id))return;s.total=round(s.total+q.points);
var given=review&&own(review.points,q.id)?review.points[q.id]:undefined,got;if(given!==undefined)got=Math.min(q.points,Math.max(0,given));else if(autoGraded(q))got=isRight(q,answers[q.id])?q.points:0;else if(isEmpty(answers[q.id]))got=0;else{if(q.points)s.pending=round((s.pending||0)+q.points);return;}
s.byQuestion[q.id]=got;s.earned=round(s.earned+got);});return s;}
function correctText(q){return autoGraded(q)?q.correct.join(q.type==='multi'?', ':' / '):'';}
function optionFeedback(q,a){if(q.type!=='choice'&&q.type!=='dropdown'&&q.type!=='multi')return [];var chosen=Array.isArray(a)?a:typeof a==='string'?[a]:[];var out=[];chosen.forEach(function(o){if(own(q.feedback,o))out.push(q.type==='multi'?o+': '+q.feedback[o]:q.feedback[o]);});return out;}
function reviewLines(form,answers,review){var shown=route(form,answers).shown,s=score(form,answers,review),n=0,lines=[];form.questions.forEach(function(q){if(!isInput(q))return;n++;if(!shown.has(q.id))return;
var counts=form.quiz&&countsPoints(q),earned=counts&&own(s.byQuestion,q.id)?s.byQuestion[q.id]:null,mark='none';
if(counts){if(earned===null)mark=q.points>0?'pending':'none';else if(q.points>0)mark=earned>=q.points?'right':earned<=0?'wrong':'partial';else if(autoGraded(q))mark=isRight(q,answers[q.id])?'right':'wrong';}
lines.push({id:q.id,label:(form.hideNumbers?'':n+'. ')+q.title,answer:answerText(q,answers[q.id]),mark:mark,points:counts?q.points:null,earned:earned,correct:form.quiz?correctText(q):'',feedback:form.quiz?optionFeedback(q,answers[q.id]):[],explanation:form.quiz?(q.explanation||''):'',comment:review&&own(review.comments,q.id)?review.comments[q.id]:''});});return lines;}
function worthShowing(lines){return lines.filter(function(l){return l.points!==null||l.feedback.length>0||l.explanation!==''||l.comment!=='';});}
function checkAnswer(q,a){if(isEmpty(a))return {problem:'Responde antes de comprobar.'};var p=validateAnswer(Object.assign({},q,{required:false}),a);if(p)return {problem:p};return {right:isRight(q,a),feedback:optionFeedback(q,a),correct:correctText(q),explanation:q.explanation||''};}
function pendingText(n){return n===1?'Queda 1 punto por corregir a mano.':'Quedan '+n+' puntos por corregir a mano.';}
`;

const CSS = `
:root{--c:#0f6cbd;--bg:#f3f4f6;--card:#fff;--fg:#1b1b1b;--mut:#5f6368;--line:#d0d4da;--err:#b3261e}
@media(prefers-color-scheme:dark){:root{--bg:#1c1c1e;--card:#2a2a2d;--fg:#f2f2f2;--mut:#aaa;--line:#4a4a4f;--err:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,'Segoe UI',sans-serif}
main{max-width:720px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px 18px;margin:12px 0}
.head{border-top:8px solid var(--c)}
h1{margin:4px 0 6px;font-size:1.6em}.desc{color:var(--mut);white-space:pre-wrap;margin:4px 0 0}
fieldset{border:0;margin:0;padding:0;min-width:0}legend{padding:0;font-weight:600;font-size:1.05em}
.req{color:var(--err)}.q-desc{color:var(--mut);margin:2px 0 8px;white-space:pre-wrap}
input[type=text],input[type=email],input[type=url],input[type=number],input[type=date],textarea,select{width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);font:inherit}
textarea{min-height:90px;resize:vertical}
.opt{display:flex;gap:8px;align-items:center;padding:4px 0}.opt input[type=text]{flex:1}
.scale{display:flex;flex-wrap:wrap;gap:6px}
.scale label{min-width:42px;text-align:center;border:1px solid var(--line);border-radius:6px;padding:6px 8px;cursor:pointer}
.scale input{position:absolute;opacity:0}.scale label:has(input:checked){background:var(--c);color:#fff;border-color:var(--c)}
.scale label:has(input:focus-visible){outline:2px solid var(--c);outline-offset:2px}
.scale.signs{gap:2px}.scale.signs label{border:0;min-width:0;padding:0 4px;font-size:2em;line-height:1.2;color:var(--c)}
.scale.signs label:has(input:checked){background:transparent;color:var(--c)}
.ends{display:flex;justify-content:space-between;gap:16px;color:var(--mut);font-size:.85em;margin-top:2px}
table{border-collapse:collapse;width:100%}th,td{padding:6px 4px;text-align:center;border-bottom:1px solid var(--line);font-weight:400}th:first-child,td:first-child{text-align:left}
.items{list-style:none;margin:6px 0;padding:0}
.items li{display:flex;gap:8px;align-items:center;border:1px solid var(--line);border-radius:6px;padding:4px 8px;margin:4px 0;background:var(--card)}
.items .n{font-weight:600;min-width:1.6em}.items .t{flex:1;overflow-wrap:anywhere}.items li[draggable=true]{cursor:grab}
.items button,button.mini{padding:2px 10px;margin:0;background:transparent;color:var(--c)}.items button:disabled{opacity:.35;cursor:default}
.ok{color:var(--mut);font-size:.92em;margin:4px 0}
.eq{margin:8px 0;overflow-x:auto;font-size:1.15em}
.err{color:var(--err);margin:6px 0 0;font-size:.92em}
.invalid{border-color:var(--err)}
button{font:inherit;padding:9px 18px;border-radius:6px;border:1px solid var(--c);background:var(--c);color:#fff;cursor:pointer;margin:4px 8px 4px 0}
button.sec{background:transparent;color:color-mix(in srgb,var(--c) 55%,var(--fg))}
button:disabled{opacity:.5}
[hidden]{display:none!important}
.section{border-left:6px solid var(--c)}.section h2{margin:2px 0}.section.empty{display:none}
.progress{display:flex;align-items:center;gap:12px;margin:12px 4px;color:var(--mut);font-size:.9em}.progress progress{flex:1;height:10px;accent-color:var(--c)}
.done h2{margin-top:0}.score{font-size:1.3em;font-weight:600}
.q-img{display:block;max-width:100%;height:auto;margin:8px 0;border-radius:4px}
.foot{color:var(--mut);font-size:.85em;text-align:center;margin:16px 0}
.wrap{overflow-x:auto}
.timer{position:sticky;top:8px;z-index:2;font-weight:600;font-variant-numeric:tabular-nums}
/* with a background of its own, what is not on a card gets one */
body.bg .progress,body.bg .foot{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 12px}
body.bg .foot{max-width:720px;margin:16px auto}
.check{margin-top:8px}.verdict{margin-top:6px;border-left:4px solid var(--line);padding:2px 0 2px 10px}.verdict p,.review p{margin:3px 0;white-space:pre-wrap;overflow-wrap:anywhere}
.verdict.right{border-color:#2e9e44}.verdict.wrong{border-color:var(--err)}
.review{text-align:left}.review .line{border-top:1px solid var(--line);padding:10px 0}.review h3{font-size:1em;margin:0 0 4px}.mark{font-weight:700}
.mark.right{color:#17692c}.mark.wrong{color:var(--err)}.mark.partial,.mark.pending{color:#7a4f01}
@media(prefers-color-scheme:dark){.mark.right{color:#8fd99f}.mark.partial,.mark.pending{color:#ffcf70}}
#receipt{display:none}
@media print{body{background:#fff;color:#000}main,.foot{display:none}#receipt{display:block;padding:0 12px}#receipt dt{font-weight:700;margin-top:10px}#receipt dd{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}}
@media(max-width:520px){main{padding:8px}.card{padding:12px}.scale label{min-width:34px;padding:6px}}
`;

const RUNTIME = `
var form=JSON.parse(document.getElementById('form-data').textContent);
function L(text){return localize(text,form.language);}
var SIGNS=${JSON.stringify(Object.fromEntries(RATING_SYMBOLS.map((s) => [s.id, [s.on, s.off]])))};
var root=document.getElementById('app');
var blocks={},redraw=[],checks=[],reading=0,ticking=null,deadline=0;
var ranks={},files={},seed=uid();
var pages=pagesOf(form),pageOf={},at=0,nav={};
pages.forEach(function(p,i){(p.section?[p.section]:[]).concat(p.items).forEach(function(q){pageOf[q.id]=i;});});
function el(tag,attrs,kids){var e=document.createElement(tag);for(var k in (attrs||{})){if(k==='text')e.textContent=attrs[k];else if(k==='class')e.className=attrs[k];else e.setAttribute(k,attrs[k]);}(kids||[]).forEach(function(c){if(c)e.appendChild(c);});return e;}
function pic(q){var m=q.image;if(!m||!/^data:image\\/(png|jpeg|gif|webp);base64,/.test(m.src))return null;var i=el('img',{class:'q-img',alt:m.alt||'',src:m.src});var w={small:160,medium:320,large:480}[m.size];if(w)i.style.width=w+'px';return i;}
function equation(q){if(typeof q.mathml!=='string'||q.mathml.indexOf('<math')!==0)return null;var d=el('div',{class:'eq'});d.innerHTML=q.mathml;return d;}
function uid(){return 'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
function build(){
 document.documentElement.style.setProperty('--c',form.color);
 var head=el('div',{class:'card head'},[el('h1',{text:form.title})]);
 if(form.description)head.appendChild(el('p',{class:'desc',text:form.description}));
 root.appendChild(head);
 var state=availability(form,Date.now());
 if(state!=='open'){root.appendChild(closedCard(state));return;}
 if(!form.timeLimit){buildForm();return;}
 var m=form.timeLimit;var go=el('button',{type:'button',id:'start',text:L('Empezar')});
 var card=el('div',{class:'card'},[el('p',{text:L(m===1?'Este formulario tiene un tiempo límite de 1 minuto.':'Este formulario tiene un tiempo límite de '+m+' minutos.')}),el('p',{text:L('El tiempo empieza al pulsar «Empezar».')}),go]);
 go.onclick=function(){card.remove();deadline=Date.now()+m*60000;buildForm();ticking=setInterval(tick,500);tick();};
 root.appendChild(card);
}
function closedCard(state){var lines=[];if(state==='notYet'){var when=new Date(form.start).toLocaleString(form.language||'es',{dateStyle:'long',timeStyle:'short'});lines=[L('Este formulario todavía no admite respuestas.'),L('Empieza el '+when+'.')];}
 else lines=[form.closedMessage&&form.closedMessage.trim()?form.closedMessage:L('Este formulario ya no admite respuestas.')];
 return el('div',{class:'card',id:'closed',role:'status'},lines.map(function(t){return el('p',{class:'desc',text:t});}));}
function tick(){var left=Math.max(0,Math.ceil((deadline-Date.now())/1000));var text=L('Tiempo restante: '+Math.floor(left/60)+':'+('0'+left%60).slice(-2));if(nav.clock.textContent!==text)nav.clock.textContent=text;if(left===0)timeUp();}
function stopClock(){if(ticking!==null){clearInterval(ticking);ticking=null;}}
// the time ran out: what was answered rightly is sent, nothing can be changed any more
function timeUp(){stopClock();var a=timedAnswers(form,collect());document.getElementById('f').hidden=true;
 var state=availability(form,Date.now());if(state!=='open'){root.appendChild(closedCard(state));return;}
 if(Object.keys(a).length){finish(a,true);return;}
 var done=el('div',{class:'card done',id:'done'},[el('h2',{text:L('Se acabó el tiempo.')}),el('p',{text:L('No habías respondido nada.')})]);if(!form.noAgain)done.appendChild(againButton());root.appendChild(done);done.scrollIntoView();}
function nameValue(){var i=document.querySelector('input[name=__name]');return i?i.value.trim().slice(0,${MAX_NAME}):'';}
function buildForm(){
 var f=el('form',{novalidate:'novalidate',id:'f'});
 if(form.timeLimit){nav.clock=el('div',{class:'card timer',role:'timer','aria-live':'off'});f.appendChild(nav.clock);}
 if(form.progress&&pages.length>1){nav.text=el('span',{role:'status'});nav.bar=el('progress',{max:String(pages.length),value:'1','aria-label':L('Progreso')});f.appendChild(el('div',{class:'progress'},[nav.text,nav.bar]));}
 if(form.askName){var req=el('span',{class:'req',text:' *'});req.setAttribute('aria-label',L('obligatoria'));var lab=el('label',{for:'who'},[document.createTextNode(L('Tu nombre')),req]);
  nav.who=el('div',{class:'card'},[lab,el('input',{type:'text',id:'who',name:'__name',maxlength:'${MAX_NAME}',autocomplete:'name'}),el('p',{class:'err',role:'alert',hidden:'hidden'})]);f.appendChild(nav.who);}
 var n=0;displayOrder(form,seed).forEach(function(q){if(isInput(q))n++;var b=renderQ(q,n);blocks[q.id]=b;f.appendChild(b);});
 nav.back=el('button',{type:'button',class:'sec',id:'back',text:L('Atrás')});nav.next=el('button',{type:'button',id:'next',text:L('Siguiente')});nav.send=el('button',{type:'submit',id:'send',text:L('Enviar')});
 nav.back.onclick=function(){var r=route(form,collect());var i=r.pages.indexOf(at);if(i>0)go(r.pages[i-1]);};nav.next.onclick=forward;
 f.appendChild(el('div',{class:'card'},[nav.back,nav.next,nav.send,el('button',{type:'reset',class:'sec',text:L('Borrar respuestas')})]));
 f.addEventListener('submit',function(e){e.preventDefault();submit();});
 f.addEventListener('reset',function(){ranks={};files={};at=0;setTimeout(function(){redraw.forEach(function(d){d();});showErrors({});refresh();},0);});
 f.addEventListener('input',refresh);f.addEventListener('change',refresh);
 root.appendChild(f);
 redraw.forEach(function(d){d();});
 refresh();
}
function limitText(q){var a=q.min,b=q.maxValue;if(a!==null&&b!==null)return L(a===b?'Elige '+a+' opciones.':'Elige de '+a+' a '+b+' opciones.');if(a!==null)return L('Elige al menos '+a+' opciones.');if(b!==null)return L('Elige como máximo '+b+' opciones.');return '';}
function renderQ(q,num){
 var card=el('div',{class:'card','data-q':q.id});
 if(q.type==='title'||q.type==='section'){if(q.type==='section'){card.className='card section';if(!q.title.trim()&&!q.description.trim()&&!q.mathml&&!q.image)card.className+=' empty';}card.appendChild(el('h2',{text:q.title,tabindex:'-1'}));if(q.description)card.appendChild(el('p',{class:'q-desc',text:q.description}));var et=equation(q);if(et)card.appendChild(et);var pt=pic(q);if(pt)card.appendChild(pt);return card;}
 var fs=el('fieldset');var lg=el('legend');lg.appendChild(document.createTextNode((form.hideNumbers?'':num+'. ')+q.title));
 if(q.required){var s=el('span',{class:'req',text:' *'});s.setAttribute('aria-label',L('obligatoria'));lg.appendChild(s);}
 fs.appendChild(lg);if(q.description)fs.appendChild(el('p',{class:'q-desc',text:q.description}));var eq=equation(q);if(eq)fs.appendChild(eq);var pq=pic(q);if(pq)fs.appendChild(pq);
 var name='q_'+q.id;var t=q.type;var body;
 var err=el('p',{class:'err',role:'alert',hidden:'hidden'});
 if(t==='text'){body=el('input',{type:q.format==='email'?'email':q.format==='url'?'url':'text',name:name,'aria-label':q.title});}
 else if(t==='longtext'){body=el('textarea',{name:name,'aria-label':q.title});}
 else if(t==='number'){body=el('input',{type:'text',inputmode:'decimal',name:name,'aria-label':q.title});}
 else if(t==='date'){body=el('input',{type:'date',name:name,'aria-label':q.title});}
 else if(t==='dropdown'){body=el('select',{name:name,'aria-label':q.title},[el('option',{value:'',text:L('Elige una opción')})].concat(orderOf(q,seed).map(function(o){return el('option',{value:o,text:o});})));}
 else if(t==='choice'||t==='multi'){body=el('div');if(t==='multi'&&limitText(q))body.appendChild(el('p',{class:'q-desc',text:limitText(q)}));
  orderOf(q,seed).forEach(function(o){var id=name+'_'+body.children.length;body.appendChild(el('div',{class:'opt'},[el('input',{type:t==='choice'?'radio':'checkbox',name:name,id:id,value:o}),el('label',{for:id,text:o})]));});
  if(q.allowOther){var oid=name+'_other';body.appendChild(el('div',{class:'opt'},[el('input',{type:t==='choice'?'radio':'checkbox',name:name,id:oid,value:'__other__'}),el('label',{for:oid,text:L('Otro:')}),el('input',{type:'text',name:name+'__other','aria-label':L('Otro')})]));}
  if(t==='multi'&&q.maxValue!==null){var cap=function(){var boxes=body.querySelectorAll('input[type=checkbox]');var n=0;boxes.forEach(function(b){if(b.checked)n++;});boxes.forEach(function(b){b.disabled=!b.checked&&n>=q.maxValue;});};body.addEventListener('change',cap);redraw.push(cap);}}
 else if(t==='rating'||t==='nps'){var lo=t==='nps'?0:1,hi=t==='nps'?10:q.max;body=el('div');var sign=t==='rating'&&q.symbol&&q.symbol!=='number'?SIGNS[q.symbol]:null;
  var sc=el('div',{class:sign?'scale signs':'scale',role:'radiogroup','aria-label':q.title});var spans=[];
  for(var n=lo;n<=hi;n++){var input=el('input',{type:'radio',name:name,value:String(n),'aria-label':String(n)});var face=el('span',{'aria-hidden':'true',text:sign?sign[1]:String(n)});spans.push(face);sc.appendChild(el('label',{title:String(n)},[input,face]));}
  body.appendChild(sc);
  if(sign){var paint=function(){var on=sc.querySelector('input:checked');var v=on?Number(on.value):0;spans.forEach(function(s,i){s.textContent=sign[i<v?0:1];});};sc.addEventListener('change',paint);redraw.push(paint);}
  var low=q.lowLabel||(t==='nps'?L('Nada probable'):''),high=q.highLabel||(t==='nps'?L('Muy probable'):'');
  if(low||high)body.appendChild(el('div',{class:'ends'},[el('span',{text:low}),el('span',{text:high})]));}
 else if(t==='ranking'){body=el('div');var list=el('ol',{class:'items','aria-label':q.title});var keep=el('button',{type:'button',class:'mini',text:L('Dejar este orden')});var said=el('p',{class:'ok',role:'status'});body.appendChild(list);body.appendChild(keep);body.appendChild(said);
  var current=function(){return ranks[q.id]||orderOf(q,seed);};
  var put=function(from,to,focus){var o=current().slice();var it=o.splice(from,1)[0];o.splice(to,0,it);ranks[q.id]=o;draw();if(focus){var b=list.children[to].querySelectorAll('button')[focus-1];if(b.disabled)b=list.children[to].querySelector('button:not(:disabled)');b.focus();}refresh();};
  var dragged=null;
  var draw=function(){list.textContent='';var o=current();o.forEach(function(it,i){var up=el('button',{type:'button','aria-label':L('Subir '+it),text:'↑'});var down=el('button',{type:'button','aria-label':L('Bajar '+it),text:'↓'});up.disabled=i===0;down.disabled=i===o.length-1;up.onclick=function(){put(i,i-1,1);};down.onclick=function(){put(i,i+1,2);};
    var li=el('li',{draggable:'true'},[el('span',{class:'n',text:(i+1)+'.'}),el('span',{class:'t',text:it}),up,down]);
    li.addEventListener('dragstart',function(e){dragged=i;e.dataTransfer.setData('text/plain',it);});li.addEventListener('dragover',function(e){if(dragged!==null)e.preventDefault();});
    li.addEventListener('drop',function(e){e.preventDefault();if(dragged!==null&&dragged!==i)put(dragged,i);dragged=null;});li.addEventListener('dragend',function(){dragged=null;});list.appendChild(li);});
   keep.hidden=!!ranks[q.id];said.textContent=ranks[q.id]?L('Orden elegido.'):'';};
  keep.onclick=function(){ranks[q.id]=current().slice();draw();refresh();};redraw.push(draw);}
 else if(t==='file'){body=el('div');var max=Math.min(MAX_FILES,q.maxFiles===undefined?1:q.maxFiles);var exts=allowedExtensions(q);
  var pick=el('input',{type:'file','aria-label':q.title});if(max>1)pick.setAttribute('multiple','multiple');if(exts.length)pick.setAttribute('accept',exts.map(function(x){return '.'+x;}).join(','));
  var mb=q.maxMb===undefined?10:q.maxMb;
  body.appendChild(el('p',{class:'q-desc',text:L(max===1?'Un archivo de '+mb+' MB como mucho.':'Hasta '+max+' archivos de '+mb+' MB como mucho cada uno.')+(exts.length?' '+L('Tipos: '+exts.map(function(x){return '.'+x;}).join(', ')+'.'):'')}));
  var chosen=el('ul',{class:'items','aria-label':L('Archivos elegidos')});body.appendChild(pick);body.appendChild(chosen);
  var show=function(){chosen.textContent='';(files[q.id]||[]).forEach(function(f,i){var rm=el('button',{type:'button','aria-label':L('Quitar '+f.name),text:'✕'});rm.onclick=function(){files[q.id].splice(i,1);show();refresh();};chosen.appendChild(el('li',{},[el('span',{class:'t',text:f.name+' ('+Math.max(1,Math.round(f.size/1024))+' KB)'}),rm]));});};
  var tell=function(m){err.hidden=!m;err.textContent=m?L(m):'';};
  pick.addEventListener('change',function(){var picked=Array.prototype.slice.call(pick.files||[]);pick.value='';tell('');
   picked.forEach(function(file){var have=files[q.id]=files[q.id]||[];
    var problem=fileProblem(q,file.name,file.size);
    if(!problem&&max>1&&have.length>=max)problem='Puedes adjuntar como máximo '+max+' archivo(s).';
    if(!problem){var total=file.size;form.questions.forEach(function(o){(files[o.id]||[]).forEach(function(f){total+=f.size;});});if(total>MAX_RESPONSE_MB*MB)problem='Entre todos, los archivos pasan de '+MAX_RESPONSE_MB+' MB.';}
    if(problem){tell(problem);return;}
    var item={name:file.name,size:file.size,type:file.type,data:null};
    // with one file only, the new one takes the place of the old
    if(max===1)files[q.id]=[item];else have.push(item);
    reading++;document.getElementById('send').disabled=true;
    var rd=new FileReader();var done=function(ok){if(ok)item.data=String(rd.result).split(',')[1]||'';else{files[q.id]=(files[q.id]||[]).filter(function(x){return x!==item;});tell('No se pudo leer «'+file.name+'».');}
     if(--reading===0)document.getElementById('send').disabled=false;show();refresh();};
    rd.onload=function(){done(true);};rd.onerror=function(){done(false);};rd.readAsDataURL(file);});
   show();});
  redraw.push(show);}
 else if(t==='likert'){var tb=el('table');var hr=el('tr',{},[el('th',{scope:'col'})]);q.options.forEach(function(o){hr.appendChild(el('th',{scope:'col',text:o}));});tb.appendChild(hr);
  q.rows.forEach(function(r,ri){var tr=el('tr',{},[el('th',{scope:'row',text:r})]);q.options.forEach(function(o){tr.appendChild(el('td',{},[el('input',{type:'radio',name:name+'__'+ri,value:o,'aria-label':r+': '+o})]));});tb.appendChild(tr);});body=el('div',{class:'wrap'},[tb]);}
 fs.appendChild(body);fs.appendChild(err);card.appendChild(fs);if(form.quiz&&form.practice&&autoGraded(q))card.appendChild(practiceBox(q));return card;}
function collect(){
 var a={};var data=new FormData(document.getElementById('f'));
 form.questions.forEach(function(q){if(!isInput(q))return;var name='q_'+q.id;var t=q.type;var v=null;
  if(t==='text'||t==='longtext'||t==='date'){v=data.get(name);v=v===null?null:String(v);}
  else if(t==='number'){v=data.get(name);v=v===null||String(v).trim()===''?null:String(v).trim();if(v!==null&&isFinite(Number(v.replace(',','.'))))v=Number(v.replace(',','.'));}
  else if(t==='dropdown'){v=data.get(name);v=v?String(v):null;}
  else if(t==='choice'){v=data.get(name);if(v==='__other__'){var o=String(data.get(name+'__other')||'').trim();v=o||null;}else v=v?String(v):null;}
  else if(t==='multi'){var box=blocks[q.id];v=Array.prototype.slice.call(box.querySelectorAll('input[type=checkbox]:checked')).map(function(i){return i.value==='__other__'?String(data.get(name+'__other')||'').trim():i.value;}).filter(Boolean);}
  else if(t==='ranking'){v=ranks[q.id]?ranks[q.id].slice():null;}
  else if(t==='file'){v=(files[q.id]||[]).filter(function(f){return f.data!==null;});if(!v.length)v=null;}
  else if(t==='rating'||t==='nps'){v=data.get(name);v=v===null?null:Number(v);}
  else if(t==='likert'){v={};q.rows.forEach(function(r,ri){var x=data.get(name+'__'+ri);if(x)v[r]=String(x);});}
  a[q.id]=v;});
 return a;}
function refresh(){var a=collect();var r=route(form,a);
 // a change of mind can take the page one is on out of the way: back to the last one that is still on it
 if(r.pages.indexOf(at)<0){var before=r.pages.filter(function(p){return p<at;});at=before.length?before[before.length-1]:0;}
 form.questions.forEach(function(q){blocks[q.id].hidden=!(pageOf[q.id]===at&&r.shown.has(q.id));});
 if(checks.length){var now=collect();checks.forEach(function(c){c(now);});}
 if(nav.who)nav.who.hidden=at!==0;
 var last=pageAfter(pages,at,r.shown,a)>=pages.length;nav.send.hidden=!last;nav.next.hidden=last;nav.back.hidden=r.pages.indexOf(at)<=0;
 if(nav.bar){nav.bar.value=at+1;var said=L('Página '+(at+1)+' de '+pages.length);if(nav.text.textContent!==said)nav.text.textContent=said;}}
function go(p){at=p;refresh();window.scrollTo(0,0);
 if(p===0&&nav.who){nav.who.querySelector('input').focus({preventScroll:true});return;}var first=form.questions.find(function(q){return pageOf[q.id]===p&&!blocks[q.id].hidden;});if(first){var t=blocks[first.id].querySelector('h2,input,select,textarea,button');if(t)t.focus({preventScroll:true});}}
// on to the next page, once this one is right
function forward(){if(reading)return;var a=collect();var all=validateAll(form,a);var here={};Object.keys(all).forEach(function(id){if(pageOf[id]===at)here[id]=all[id];});if(at===0&&form.askName&&!nameValue())here.__name='Escribe tu nombre.';showErrors(here);if(Object.keys(here).length)return;go(pageAfter(pages,at,route(form,a).shown,a));}
function showErrors(errs){var first=null;
 var mark=function(b,e){var p=b.querySelector('.err');if(!p)return;p.hidden=!e;p.textContent=e?L(e):'';b.querySelectorAll('input,select,textarea').forEach(function(i){if(e)i.setAttribute('aria-invalid','true');else i.removeAttribute('aria-invalid');});if(e&&!first)first=b;};
 if(nav.who)mark(nav.who,errs.__name);
 form.questions.forEach(function(q){mark(blocks[q.id],errs[q.id]);});
 if(first){first.scrollIntoView({block:'center'});var i=first.querySelector('input,select,textarea,button:not(:disabled)');if(i)i.focus();}}
var lastResponse=null;
function submit(){
 if(reading)return;
 // the form may have closed while it was being answered
 var state=availability(form,Date.now());if(state!=='open'){stopClock();document.getElementById('f').hidden=true;root.appendChild(closedCard(state));return;}
 var a=collect();
 // Enter in a box of an earlier page goes on, it does not send
 if(pageAfter(pages,at,route(form,a).shown,a)<pages.length){forward();return;}
 var errs=validateAll(form,a);var nameless=form.askName&&!nameValue();if(nameless)errs.__name='Escribe tu nombre.';
 var wrong=form.questions.find(function(q){return errs[q.id];});var to=nameless?0:wrong?pageOf[wrong.id]:at;if(to!==at){at=to;refresh();}showErrors(errs);if(nameless||wrong)return;
 stopClock();document.getElementById('f').hidden=true;finish(tidyAnswers(form,a),false);}
// back to the form after a response that was not taken: the time goes on being counted
function review(){document.getElementById('f').hidden=false;if(form.timeLimit&&ticking===null){ticking=setInterval(tick,500);tick();}}
function againButton(){var again=el('button',{type:'button',class:'sec',id:'again',text:L('Responder otra vez')});again.onclick=function(){window.scrollTo(0,0);location.reload();};return again;}
function finish(answers,timed){
 lastResponse={id:uid(),at:new Date().toISOString(),answers:answers};var who=nameValue();if(form.askName&&who)lastResponse.name=who;if(SEND&&timed)lastResponse.timed=true;
 if(SEND)deliver(timed);else showDone(timed);}
function showDone(timed){
 var answers=lastResponse.answers;
 var done=el('div',{class:'card done',id:'done'},[el('h2',{text:L(timed?'Se acabó el tiempo.':SEND?'Respuesta enviada':'Respuesta lista')})]);
 if(timed)done.appendChild(el('p',{text:L('Se envió lo que habías respondido.')}));
 done.appendChild(el('p',{text:L(form.thanks)}));
 if(form.quiz&&form.showScore){var s=score(form,answers);done.appendChild(el('p',{class:'score',text:L('Puntuación: '+s.earned+' de '+s.total)}));if(s.pending)done.appendChild(el('p',{text:L(pendingText(s.pending))}));}
 if(!SEND){done.appendChild(el('p',{text:L('Este formulario no se envía solo: descarga tu respuesta y mándasela a quien te lo compartió.')}));
  done.appendChild(downloadButton(''));
  if(navigator.clipboard){var cp=el('button',{type:'button',class:'sec',id:'cp',text:L('Copiar respuesta')});cp.onclick=copy;done.appendChild(cp);}}
 if(form.receipt){var pr=el('button',{type:'button',class:'sec',id:'print',text:L('Imprimir o guardar mis respuestas')});pr.onclick=printAnswers;done.appendChild(pr);}
 if(!form.noAgain)done.appendChild(againButton());
 root.appendChild(done);
 if(form.quiz&&(form.showAnswers||form.practice))root.appendChild(reviewCard(answers));
 done.scrollIntoView();}
var MARKS={right:'Correcta',wrong:'Incorrecta',partial:'En parte',pending:'Por corregir'};
function reviewCard(answers){var card=el('div',{class:'card review',id:'review-list'},[el('h2',{text:L('Respuestas y comentarios')})]);
 worthShowing(reviewLines(form,answers)).forEach(function(l){var box=el('div',{class:'line'},[el('h3',{text:l.label})]);
  var said=[];if(l.mark!=='none')said.push(el('span',{class:'mark '+l.mark,text:L(MARKS[l.mark])}));
  if(l.points!==null)said.push(el('span',{text:(said.length?' · ':'')+L(l.earned===null?'Puntos: hasta '+l.points:'Puntos: '+l.earned+' de '+l.points)}));
  if(said.length)box.appendChild(el('p',{},said));
  box.appendChild(el('p',{text:L('Tu respuesta: '+l.answer)}));
  if(l.correct)box.appendChild(el('p',{text:L('Respuesta correcta: '+l.correct)}));
  l.feedback.forEach(function(f){box.appendChild(el('p',{text:f}));});
  if(l.explanation)box.appendChild(el('p',{text:L('Explicación: '+l.explanation)}));
  card.appendChild(box);});
 return card;}
// practice mode: checking one answer, which can be changed and checked again
function practiceBox(q){
 var out=el('div',{role:'status'});var seen=null;
 var button=el('button',{type:'button',class:'sec',text:L('Comprobar')});
 button.onclick=function(){var a=collect()[q.id];var c=checkAnswer(q,a);seen=JSON.stringify(a===undefined?null:a);out.textContent='';
  if(c.problem){out.appendChild(el('p',{class:'err',text:L(c.problem)}));return;}
  var v=el('div',{class:'verdict '+(c.right?'right':'wrong')},[el('p',{class:'mark '+(c.right?'right':'wrong'),text:L(c.right?'¡Correcto!':'No es correcto. Puedes cambiar la respuesta y volver a comprobar.')})]);
  c.feedback.forEach(function(f){v.appendChild(el('p',{text:f}));});
  var all=function(){v.appendChild(el('p',{text:L('Respuesta correcta: '+c.correct)}));if(c.explanation)v.appendChild(el('p',{text:L('Explicación: '+c.explanation)}));};
  if(c.right){if(c.explanation)v.appendChild(el('p',{text:L('Explicación: '+c.explanation)}));}
  else{var show=el('button',{type:'button',class:'sec',text:L('Ver la respuesta')});show.onclick=function(){show.remove();all();};v.appendChild(show);}
  out.appendChild(v);};
 // what was said no longer holds once the answer changes
 redraw.push(function(){if(seen!==null){seen=null;out.textContent='';}});
 checks.push(function(answers){if(seen!==null&&JSON.stringify(answers[q.id]===undefined?null:answers[q.id])!==seen){seen=null;out.textContent='';}});
 return el('div',{class:'check'},[button,out]);}
function downloadButton(cls){var dl=el('button',{type:'button',id:'dl',text:L('Descargar mi respuesta')});if(cls)dl.className=cls;dl.onclick=download;return dl;}
// sends the response to whoever serves this page, and says what came of it
function deliver(timed){
 var wait=el('div',{class:'card done',id:'sending',role:'status'},[el('p',{text:L('Enviando…')})]);root.appendChild(wait);wait.scrollIntoView();
 var stop=new AbortController();var timer=setTimeout(function(){stop.abort();},180000);
 var end=function(){clearTimeout(timer);wait.remove();};
 fetch(location.pathname.replace(/\\/+$/,'')+'/r',{method:'POST',headers:{'Content-Type':'application/json'},body:payload(),cache:'no-store',signal:stop.signal})
 .then(function(r){return r.json().catch(function(){return {};}).then(function(b){end();if(r.ok&&b.ok===true)showDone(timed);
  else showFailed(timed,b.message||(r.status===409?'Ya has enviado tu respuesta.':r.status===413?'La respuesta es demasiado grande.':r.status===429?'Hay demasiadas peticiones: espera un momento y reintenta.':r.status===503?'La aplicación que recoge las respuestas no contesta: reintenta.':'No se pudo enviar la respuesta.'),r.status);});})
 .catch(function(){end();showFailed(timed,'No se pudo conectar con quien recoge las respuestas.',0);});}
function showFailed(timed,message,status){
 var card=el('div',{class:'card done',id:'failed',role:'alert'},[el('h2',{text:L('No se ha enviado')}),el('p',{text:L(message)})]);
 if(status!==409){var retry=el('button',{type:'button',id:'retry',text:L('Reintentar')});retry.onclick=function(){card.remove();deliver(timed);};card.appendChild(retry);
  if(!timed){var back=el('button',{type:'button',class:'sec',id:'review',text:L('Revisar mis respuestas')});back.onclick=function(){card.remove();review();};card.appendChild(back);}
  card.appendChild(downloadButton('sec'));}
 root.appendChild(card);card.scrollIntoView();}
// a copy of the answers, which the printer dialog of the system can also keep as a PDF
function printAnswers(){var old=document.getElementById('receipt');if(old)old.remove();var list=el('dl');
 answerLines(form,lastResponse.answers,lastResponse.name).forEach(function(l){list.appendChild(el('dt',{text:l.label}));list.appendChild(el('dd',{text:l.text}));});
 var when=new Date(lastResponse.at).toLocaleString(form.language||'es',{dateStyle:'long',timeStyle:'short'});
 document.body.appendChild(el('div',{id:'receipt'},[el('h1',{text:form.title}),el('h2',{text:L('Mis respuestas')}),el('p',{text:L('Enviado el '+when)}),list]));window.print();}
function payload(){return JSON.stringify({format:'novaforms-response',formId:form.id,id:lastResponse.id,at:lastResponse.at,name:lastResponse.name,timed:lastResponse.timed,answers:lastResponse.answers},null,1);}
function download(){var b=new Blob([payload()],{type:'application/json'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='respuesta-'+lastResponse.id+'.json';document.body.appendChild(a);a.click();a.remove();}
function copy(){if(navigator.clipboard)navigator.clipboard.writeText(payload()).then(function(){document.getElementById('cp').textContent=L('Copiada');});}
build();
`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A single HTML file with the form inside it. Right answers are only embedded when the score or the answers are shown, or
 * in practice mode; comments and explanations, only with the last two.
 *
 * On its own, answers are never sent anywhere: the respondent downloads a response file and returns it, and it is
 * imported into Nova Forms. With `send`, it is the page that Nova Forms serves on the local network: it can only talk to
 * whoever served it, and sends the response there.
 */
export function exportHtml(form: Form, { send = false }: { send?: boolean } = {}): string {
  const noted = form.quiz && (!!form.showAnswers || !!form.practice);
  const graded = (form.quiz && form.showScore) || noted;
  // equations go already drawn (MathML made here, from their source): the page needs nothing to show them
  const shown = { ...form, questions: form.questions.map((q) => ({ ...q, ...(graded ? {} : { correct: [] }), ...(noted ? {} : { feedback: undefined, explanation: undefined }), ...(q.equation ? { mathml: toMathML(parseMath(q.equation), true) } : {}) })) };
  const data = JSON.stringify(shown).replace(/</g, '\\u003c').replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');
  const background = pageBackground(form, 'var(--bg)');
  const lang = form.language ?? 'es';
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:${send ? "; connect-src 'self'" : ''}">
<title>${esc(form.title)}</title><style>${CSS}${background ? `@media screen{body{background:${background};min-height:100vh}}` : ''}</style></head>
<body${background ? ' class="bg"' : ''}><main id="app"></main><p class="foot">${localize('Formulario creado con Nova Forms', lang)}</p>
<script type="application/json" id="form-data">${data}</script>
<script>var SEND=${send};${LOGIC_JS}${RUNTIME}</script>
</body></html>
`;
}

/** What is served to a browser that already sent its response to a form that takes only one. */
export function answeredHtml(form: Form): string {
  const lang = form.language ?? 'es';
  const color = /^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : '#0f6cbd';
  return `<!doctype html>
<html lang="${lang}" style="--c:${color}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(form.title)}</title><style>${CSS}</style></head>
<body><main><div class="card head"><h1>${esc(form.title)}</h1></div><div class="card done" id="answered"><p>${localize('Ya has enviado tu respuesta.', lang)}</p></div></main><p class="foot">${localize('Formulario creado con Nova Forms', lang)}</p></body></html>
`;
}
