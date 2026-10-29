import type { Form } from './model';

/**
 * The rules of logic.ts as plain JavaScript, written into the standalone form. A test runs this text and the
 * TypeScript version on the same inputs and checks that they agree.
 */
export const LOGIC_JS = `
function norm(s){return String(s).normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').trim().toLowerCase();}
function isEmpty(a){if(a===null||a===undefined)return true;if(typeof a==='string')return a.trim()==='';if(Array.isArray(a))return a.length===0;if(typeof a==='object')return Object.values(a).every(function(v){return !v;});return false;}
function asText(a){if(a===null||a===undefined)return [];if(Array.isArray(a))return a;if(typeof a==='object')return Object.values(a);return [String(a)];}
function realDate(s){var d=new Date(s+'T00:00:00Z');return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;}
function isInput(q){return q.type!=='title';}
function isVisible(form,q,answers){var c=q.showIf;if(!c)return true;var qs=form.questions;var src=qs.find(function(x){return x.id===c.question;});if(!src||qs.indexOf(src)>=qs.indexOf(q))return true;if(!isVisible(form,src,answers))return false;var got=asText(answers[c.question]).map(norm);var want=norm(c.value);if(c.op==='eq')return got.indexOf(want)>=0;if(c.op==='neq')return got.indexOf(want)<0;return got.some(function(g){return g.indexOf(want)>=0;});}
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
if(q.min!==null&&n<q.min)return 'El valor mínimo es '+q.min+'.';
if(q.maxValue!==null&&n>q.maxValue)return 'El valor máximo es '+q.maxValue+'.';
return null;}
if(t==='date')return typeof a==='string'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(a)&&realDate(a)?null:'Escribe una fecha válida.';
if(t==='rating'){var r=Number(a);return Math.floor(r)===r&&r>=1&&r<=q.max?null:'Elige una puntuación de 1 a '+q.max+'.';}
if(t==='nps'){var p=Number(a);return Math.floor(p)===p&&p>=0&&p<=10?null:'Elige un valor de 0 a 10.';}
if(t==='choice'||t==='dropdown'){if(typeof a!=='string')return 'Elige una opción.';return q.options.indexOf(a)>=0||(q.allowOther&&t==='choice')?null:'Elige una de las opciones.';}
if(t==='multi'){if(!Array.isArray(a))return 'Elige una o varias opciones.';return a.every(function(x){return q.options.indexOf(x)>=0||q.allowOther;})?null:'Hay una opción que no existe.';}
if(t==='likert'){if(typeof a!=='object'||Array.isArray(a))return 'Responde cada fila.';var miss=q.rows.filter(function(r){return !a[r];});if(q.required&&miss.length)return 'Responde todas las filas.';if(Object.values(a).some(function(v){return v&&q.options.indexOf(v)<0;}))return 'Hay una columna que no existe.';return null;}
return null;}
function validateAll(form,answers){var out={};form.questions.forEach(function(q){if(!isVisible(form,q,answers))return;var e=validateAnswer(q,answers[q.id]);if(e)out[q.id]=e;});return out;}
function visibleAnswers(form,answers){var out={};form.questions.forEach(function(q){if(isInput(q)&&isVisible(form,q,answers)&&!isEmpty(answers[q.id]))out[q.id]=answers[q.id];});return out;}
function isRight(q,a){if(isEmpty(a))return false;var right=q.correct.map(norm);if(!right.length)return false;var t=q.type;
if(t==='choice'||t==='dropdown')return typeof a==='string'&&norm(a)===right[0];
if(t==='multi'){if(!Array.isArray(a))return false;var got=a.map(norm);return got.length===right.length&&right.every(function(r){return got.indexOf(r)>=0;});}
if(t==='text')return typeof a==='string'&&right.indexOf(norm(a))>=0;
if(t==='number'){var n=typeof a==='number'?a:Number(String(a).replace(',','.'));return isFinite(n)&&right.some(function(r){return Number(r.replace(',','.'))===n;});}
return false;}
function score(form,answers){var s={earned:0,total:0,byQuestion:{}};if(!form.quiz)return s;form.questions.forEach(function(q){if(['choice','multi','dropdown','text','number'].indexOf(q.type)<0||!q.correct.length||!isVisible(form,q,answers))return;s.total+=q.points;var got=isRight(q,answers[q.id])?q.points:0;s.byQuestion[q.id]=got;s.earned+=got;});return s;}
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
.ends{display:flex;justify-content:space-between;color:var(--mut);font-size:.85em;margin-top:2px}
table{border-collapse:collapse;width:100%}th,td{padding:6px 4px;text-align:center;border-bottom:1px solid var(--line);font-weight:400}th:first-child,td:first-child{text-align:left}
.err{color:var(--err);margin:6px 0 0;font-size:.92em}
.invalid{border-color:var(--err)}
button{font:inherit;padding:9px 18px;border-radius:6px;border:1px solid var(--c);background:var(--c);color:#fff;cursor:pointer;margin:4px 8px 4px 0}
button.sec{background:transparent;color:var(--c)}
[hidden]{display:none!important}
.done h2{margin-top:0}.score{font-size:1.3em;font-weight:600}
.foot{color:var(--mut);font-size:.85em;text-align:center;margin:16px 0}
`;

const RUNTIME = `
var form=JSON.parse(document.getElementById('form-data').textContent);
var root=document.getElementById('app');
var blocks={};
function el(tag,attrs,kids){var e=document.createElement(tag);for(var k in (attrs||{})){if(k==='text')e.textContent=attrs[k];else if(k==='class')e.className=attrs[k];else e.setAttribute(k,attrs[k]);}(kids||[]).forEach(function(c){if(c)e.appendChild(c);});return e;}
function uid(){return 'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
function build(){
 document.documentElement.style.setProperty('--c',form.color);
 var head=el('div',{class:'card head'},[el('h1',{text:form.title})]);
 if(form.description)head.appendChild(el('p',{class:'desc',text:form.description}));
 root.appendChild(head);
 var f=el('form',{novalidate:'novalidate',id:'f'});
 form.questions.forEach(function(q,i){var b=renderQ(q,i);blocks[q.id]=b;f.appendChild(b);});
 var actions=el('div',{class:'card'},[el('button',{type:'submit',text:'Enviar'}),el('button',{type:'reset',class:'sec',text:'Borrar respuestas'})]);
 f.appendChild(actions);
 f.addEventListener('submit',function(e){e.preventDefault();submit();});
 f.addEventListener('reset',function(){setTimeout(refresh,0);});
 f.addEventListener('input',refresh);f.addEventListener('change',refresh);
 root.appendChild(f);
 refresh();
}
function renderQ(q,i){
 var card=el('div',{class:'card','data-q':q.id});
 if(q.type==='title'){card.appendChild(el('h2',{text:q.title}));if(q.description)card.appendChild(el('p',{class:'q-desc',text:q.description}));return card;}
 var fs=el('fieldset');var lg=el('legend');lg.appendChild(document.createTextNode((i+1)+'. '+q.title));
 if(q.required){var s=el('span',{class:'req',text:' *'});s.setAttribute('aria-label','obligatoria');lg.appendChild(s);}
 fs.appendChild(lg);if(q.description)fs.appendChild(el('p',{class:'q-desc',text:q.description}));
 var name='q_'+q.id;var t=q.type;var body;
 if(t==='text'){body=el('input',{type:q.format==='email'?'email':q.format==='url'?'url':'text',name:name,'aria-label':q.title});}
 else if(t==='longtext'){body=el('textarea',{name:name,'aria-label':q.title});}
 else if(t==='number'){body=el('input',{type:'text',inputmode:'decimal',name:name,'aria-label':q.title});}
 else if(t==='date'){body=el('input',{type:'date',name:name,'aria-label':q.title});}
 else if(t==='dropdown'){body=el('select',{name:name,'aria-label':q.title},[el('option',{value:'',text:'Elige una opción'})].concat(q.options.map(function(o){return el('option',{value:o,text:o});})));}
 else if(t==='choice'||t==='multi'){body=el('div');q.options.forEach(function(o){var id=name+'_'+body.children.length;body.appendChild(el('div',{class:'opt'},[el('input',{type:t==='choice'?'radio':'checkbox',name:name,id:id,value:o}),el('label',{for:id,text:o})]));});
  if(q.allowOther){var oid=name+'_other';body.appendChild(el('div',{class:'opt'},[el('input',{type:t==='choice'?'radio':'checkbox',name:name,id:oid,value:'\__other__'}),el('label',{for:oid,text:'Otro:'}),el('input',{type:'text',name:name+'__other','aria-label':'Otro'})]));}}
 else if(t==='rating'||t==='nps'){var lo=t==='nps'?0:1,hi=t==='nps'?10:q.max;body=el('div');var sc=el('div',{class:'scale',role:'radiogroup','aria-label':q.title});for(var n=lo;n<=hi;n++){sc.appendChild(el('label',{},[el('input',{type:'radio',name:name,value:String(n)}),document.createTextNode(String(n))]));}body.appendChild(sc);
  if(t==='nps')body.appendChild(el('div',{class:'ends'},[el('span',{text:'Nada probable'}),el('span',{text:'Muy probable'})]));}
 else if(t==='likert'){var tb=el('table');var hr=el('tr',{},[el('th',{scope:'col'})]);q.options.forEach(function(o){hr.appendChild(el('th',{scope:'col',text:o}));});tb.appendChild(hr);
  q.rows.forEach(function(r,ri){var tr=el('tr',{},[el('th',{scope:'row',text:r})]);q.options.forEach(function(o){tr.appendChild(el('td',{},[el('input',{type:'radio',name:name+'__'+ri,value:o,'aria-label':r+': '+o})]));});tb.appendChild(tr);});body=tb;}
 fs.appendChild(body);fs.appendChild(el('p',{class:'err',role:'alert',hidden:'hidden'}));card.appendChild(fs);return card;}
function collect(){
 var a={};var data=new FormData(document.getElementById('f'));
 form.questions.forEach(function(q){if(!isInput(q))return;var name='q_'+q.id;var t=q.type;var v=null;
  if(t==='text'||t==='longtext'||t==='date'){v=data.get(name);v=v===null?null:String(v);}
  else if(t==='number'){v=data.get(name);v=v===null||String(v).trim()===''?null:String(v).trim();if(v!==null&&isFinite(Number(v.replace(',','.'))))v=Number(v.replace(',','.'));}
  else if(t==='dropdown'){v=data.get(name);v=v?String(v):null;}
  else if(t==='choice'){v=data.get(name);if(v==='\__other__'){var o=String(data.get(name+'__other')||'').trim();v=o||null;}else v=v?String(v):null;}
  else if(t==='multi'){v=data.getAll(name).map(String).map(function(x){return x==='\__other__'?String(data.get(name+'__other')||'').trim():x;}).filter(Boolean);}
  else if(t==='rating'||t==='nps'){v=data.get(name);v=v===null?null:Number(v);}
  else if(t==='likert'){v={};q.rows.forEach(function(r,ri){var x=data.get(name+'__'+ri);if(x)v[r]=String(x);});}
  a[q.id]=v;});
 return a;}
function refresh(){var a=collect();form.questions.forEach(function(q){blocks[q.id].hidden=!isVisible(form,q,a);});}
function showErrors(errs){var first=null;form.questions.forEach(function(q){var b=blocks[q.id];var p=b.querySelector('.err');if(!p)return;var e=errs[q.id];p.hidden=!e;p.textContent=e||'';b.querySelectorAll('input,select,textarea').forEach(function(i){if(e)i.setAttribute('aria-invalid','true');else i.removeAttribute('aria-invalid');});if(e&&!first)first=b;});
 if(first){first.scrollIntoView({block:'center'});var i=first.querySelector('input,select,textarea');if(i)i.focus();}}
var lastResponse=null;
function submit(){
 var a=collect();var errs=validateAll(form,a);showErrors(errs);if(Object.keys(errs).length)return;
 lastResponse={id:uid(),at:new Date().toISOString(),answers:visibleAnswers(form,a)};
 document.getElementById('f').hidden=true;
 var done=el('div',{class:'card done',id:'done'},[el('h2',{text:'Respuesta lista'}),el('p',{text:form.thanks})]);
 if(form.quiz&&form.showScore){var s=score(form,lastResponse.answers);done.appendChild(el('p',{class:'score',text:'Puntuación: '+s.earned+' de '+s.total}));}
 done.appendChild(el('p',{text:'Este formulario no se envía solo: descarga tu respuesta y mándasela a quien te lo compartió.'}));
 var dl=el('button',{type:'button',id:'dl',text:'Descargar mi respuesta'});dl.onclick=download;
 var cp=el('button',{type:'button',class:'sec',id:'cp',text:'Copiar respuesta'});cp.onclick=copy;
 var again=el('button',{type:'button',class:'sec',text:'Responder otra vez'});again.onclick=function(){document.getElementById('f').reset();document.getElementById('f').hidden=false;done.remove();refresh();window.scrollTo(0,0);};
 done.appendChild(dl);done.appendChild(cp);done.appendChild(again);root.appendChild(done);done.scrollIntoView();}
function payload(){return JSON.stringify({format:'novaforms-response',formId:form.id,id:lastResponse.id,at:lastResponse.at,answers:lastResponse.answers},null,1);}
function download(){var b=new Blob([payload()],{type:'application/json'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='respuesta-'+lastResponse.id+'.json';document.body.appendChild(a);a.click();a.remove();}
function copy(){if(navigator.clipboard)navigator.clipboard.writeText(payload()).then(function(){document.getElementById('cp').textContent='Copiada';});}
build();
`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A single HTML file with the form inside it. Answers are never sent anywhere: the respondent downloads a response
 * file and returns it, and it is imported into Nova Forms. Correct answers are only embedded when the score is shown.
 */
export function exportHtml(form: Form): string {
  const shown: Form = form.quiz && form.showScore ? form : { ...form, questions: form.questions.map((q) => ({ ...q, correct: [] })) };
  const data = JSON.stringify(shown).replace(/</g, '\\u003c').replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${esc(form.title)}</title><style>${CSS}</style></head>
<body><main id="app"></main><p class="foot">Formulario creado con Nova Forms</p>
<script type="application/json" id="form-data">${data}</script>
<script>${LOGIC_JS}${RUNTIME}</script>
</body></html>
`;
}
