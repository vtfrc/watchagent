export const APP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>WatchAgent</title>
<style>
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px;--bg:#f6f7f2;--surface:#fff;--input:#fafbf7;--text:#20251b;--muted:#66705d;--line:#e1e5d9;--accent:#c5f34b;--accent-hover:#b6e43c;--accent-ink:#4e6816;--on-accent:#202b0b;--soft:#f0f6e3;--soft-hover:#e6efd1;--focus:#83a534;--ring:#eaf2d8;--neutral:#f0f2eb;--empty:#fafbf7;--error:#b33232;--error-bg:#fff0ed;--shadow:0 4px 24px #20251005;color:var(--text);background:var(--bg)}
@media(prefers-color-scheme:dark){:root{--bg:#10120e;--surface:#181c15;--input:#12160f;--text:#edf1e6;--muted:#a5af9b;--line:#30372a;--accent-ink:#c5f34b;--soft:#252e18;--soft-hover:#333f20;--focus:#c5f34b;--ring:#303d1b;--neutral:#262c20;--empty:#141910;--error:#ff9d94;--error-bg:#351f1b;--shadow:0 4px 24px #00000018}}
*{box-sizing:border-box}body{margin:0}button,input,textarea{font:inherit}button,a,input,textarea,summary{-webkit-tap-highlight-color:transparent}a{color:var(--accent-ink)}button{cursor:pointer}button:disabled{opacity:.6;cursor:wait}:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
.shell{max-width:1180px;margin:auto;padding:30px 28px 40px}.topbar{display:flex;align-items:center}.brand{display:flex;align-items:center;gap:10px;font-size:19px;font-weight:750;letter-spacing:-.5px}.logo{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:var(--accent);color:var(--on-accent)}.logo svg{width:24px;height:24px}
.hero{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin:42px 0 26px}h1{font-size:clamp(30px,4.5vw,44px);line-height:1.15;letter-spacing:-1.6px;margin:0;font-weight:730}h1 span{color:var(--accent-ink)}.lead{color:var(--muted);line-height:1.7;max-width:470px;margin:14px 0 0}.flow{display:flex;gap:9px;align-items:center;color:var(--muted);font-size:12px;white-space:nowrap;padding-bottom:6px}.flow span{background:var(--surface);border:1px solid var(--line);padding:9px 12px;border-radius:9px}.flow b{font-weight:400;color:var(--muted)}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}.access{padding:20px 24px;margin-bottom:24px}.access-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:end}.access input{margin-top:7px}.hint{font-size:12px;color:var(--muted);line-height:1.6;margin:8px 0 0}#auth-status{font-size:12px;line-height:1.6;margin:10px 0 0;overflow-wrap:anywhere}.ok{color:var(--accent-ink)}.error{color:var(--error)}
label{display:block;font-size:12px;font-weight:650;margin-bottom:7px}input:not([type=checkbox]),textarea{width:100%;border:1px solid var(--line);border-radius:10px;background:var(--input);padding:11px 12px;color:var(--text);transition:border-color .15s,box-shadow .15s}input::placeholder,textarea::placeholder{color:var(--muted);opacity:.8}input:focus,textarea:focus{border-color:var(--focus);box-shadow:0 0 0 3px var(--ring);outline:none}textarea{min-height:110px;resize:vertical;line-height:1.6}button{border:0;border-radius:10px;background:var(--accent);color:var(--on-accent);font-weight:700;font-size:13px;padding:12px 17px;transition:background .15s}button:hover:not(:disabled){background:var(--accent-hover)}.primary{width:100%;margin-top:20px}.secondary{background:var(--soft);color:var(--accent-ink);padding:8px 12px;font-size:12px}.secondary:hover:not(:disabled){background:var(--soft-hover)}
.workspace{display:grid;grid-template-columns:350px minmax(0,1fr);gap:24px;align-items:start}.create-panel{padding:24px}.section-head{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:18px}.section-head h2{margin:0;font-size:17px;letter-spacing:-.3px;font-weight:700}.section-head p{margin:5px 0 0;font-size:12px;color:var(--muted)}.counter{font-size:12px;min-width:26px;padding:4px 9px;text-align:center;border-radius:8px;color:var(--muted);background:var(--neutral);font-variant-numeric:tabular-nums}.field{margin-top:18px}.unit-input{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px}.unit-input span{font-size:12px;color:var(--muted)}.advanced{border-top:1px solid var(--line);margin-top:22px;padding-top:17px}.advanced>summary{font-size:12px;color:var(--muted);cursor:pointer}.check{display:flex;align-items:flex-start;gap:9px;margin-top:18px;cursor:pointer;font-weight:500}.check input{margin:3px 0 0;accent-color:var(--accent)}.check strong{font-size:12px;font-weight:650}.check small{display:block;font-size:11px;color:var(--muted);line-height:1.5;margin-top:3px}.optional{font-weight:400;color:var(--muted)}.baseline-note{margin:12px 0 0;font-size:11px;line-height:1.6;color:var(--muted);text-align:center}.feeds{display:grid;gap:24px}.feed-panel{padding:24px;min-width:0}.empty-state{border:1px dashed var(--line);border-radius:12px;background:var(--empty);text-align:center;color:var(--muted);font-size:13px;line-height:1.7;padding:32px 20px}.list{display:grid;gap:12px}.item{padding:18px;border:1px solid var(--line);border-radius:12px;min-width:0}.item-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}.page-link{font-size:12px;overflow-wrap:anywhere;text-decoration:none;min-width:0}.page-link:hover{text-decoration:underline}.badge{font-size:10px;font-weight:700;border-radius:5px;padding:4px 7px;background:var(--neutral);color:var(--muted);white-space:nowrap}.badge.active,.badge.event{background:var(--soft);color:var(--accent-ink)}.condition,.event-summary{font-size:14px;line-height:1.65;overflow-wrap:anywhere;margin:0;font-weight:550}.item-meta{display:flex;flex-wrap:wrap;gap:6px 15px;font-size:11px;color:var(--muted);line-height:1.6;margin:10px 0 0}.item-footer{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:14px}.technical{font-size:11px;color:var(--muted);min-width:0}.technical summary{cursor:pointer;display:inline-block}.technical pre{margin:12px 0 0;padding:12px;border-radius:8px;background:var(--bg);font-size:11px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--muted)}.notice{padding:12px 16px;border-radius:10px;background:var(--soft);font-size:12px;line-height:1.65;overflow-wrap:anywhere;margin:0 0 20px}.notice:empty{display:none}.notice.error{background:var(--error-bg)}footer{border-top:1px solid var(--line);padding-top:18px;margin-top:32px;color:var(--muted);font-size:11px}
.review textarea{margin-top:10px;min-height:70px}.review .actions{margin-top:10px}.report-controls{display:grid;gap:10px;margin:16px 0}.report-controls input{margin-top:5px}.actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}.danger{background:var(--error-bg);color:var(--error)}.danger:hover:not(:disabled){background:var(--error-bg);filter:brightness(.95)}.diagnostic{margin-top:14px;padding:12px;border-radius:9px;background:var(--empty);font-size:12px;line-height:1.65;overflow-wrap:anywhere}.diagnostic p{margin:5px 0}.run-title{font-weight:700}.run-metrics{font-size:11px;color:var(--muted)}.history{display:grid;gap:10px;margin-top:10px}.evidence{margin-top:10px;font-size:12px}.evidence blockquote{margin:5px 0 10px;padding:8px 11px;border-left:3px solid var(--accent);background:var(--empty);white-space:pre-wrap;overflow-wrap:anywhere}.technical{margin-top:12px}
@media(max-width:850px){.workspace{grid-template-columns:300px minmax(0,1fr)}.flow{display:none}.shell{padding:24px 20px}.feed-panel,.create-panel{padding:20px}}
@media(max-width:680px){.shell{padding:20px 16px}.hero{margin:32px 0 24px}.workspace{grid-template-columns:1fr;gap:20px}.access{padding:18px}.access-row{grid-template-columns:1fr}.access-row button{width:100%}.feeds{gap:20px}h1{letter-spacing:-1px}.item{padding:15px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><main class="shell">
<header class="topbar"><div class="brand"><span class="logo" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m10 7h-3m-7 10v-3M2 12h3"/></svg></span>WatchAgent</div></header>
<section class="hero"><div><h1>The web changes.<br><span>Know when it matters.</span></h1><p class="lead">Watch a page. Describe what you’re waiting for. Get an event when it happens.</p></div><div class="flow" aria-hidden="true"><span>Page</span><b>→</b><span>Condition</span><b>→</b><span>Event</span></div></section>
<section class="panel access" aria-label="API access"><div class="access-row"><div><label for="key">Your API key</label><input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="wa_…" aria-describedby="auth-status key-hint"></div><button id="load" type="button">Connect & refresh</button></div><p id="key-hint" class="hint">Your key stays in this tab. It is not saved in browser storage.</p><p id="auth-status" role="status" aria-live="polite">Enter your API key to load your watches and events.</p></section>
<div id="message" class="notice" role="status" aria-live="polite"></div>
<div class="workspace"><section class="panel create-panel"><div class="section-head"><div><h2>New watch</h2><p>Tell us what to look out for.</p></div></div>
<form id="create"><div class="field"><label for="watch-url">Page to watch</label><input id="watch-url" name="url" type="url" required maxlength="2048" placeholder="https://competitor.com/pricing"></div><div class="field"><label for="watch-condition">What should trigger an event?</label><textarea id="watch-condition" name="condition" required minlength="3" maxlength="1000" placeholder="Notify me if they launch a plan under $50"></textarea><p class="hint">Describe your condition in plain language.</p></div><div class="field"><label for="watch-interval">Check frequency</label><div class="unit-input"><input id="watch-interval" name="interval_minutes" type="number" min="5" max="10080" value="60" required><span>minutes</span></div></div>
<details class="advanced"><summary>Advanced options</summary><label class="check"><input name="use_browser" type="checkbox"><span><strong>Always render JavaScript</strong><small>For pages that need a browser. Otherwise, rendering is enabled automatically when needed.</small></span></label><div class="field"><label for="watch-webhook">Webhook <span class="optional">· optional</span></label><input id="watch-webhook" name="webhook" type="url" maxlength="2048" placeholder="https://your-service.com/events"></div></details>
<button class="primary" type="submit">Create watch →</button><p class="baseline-note">The first check saves a baseline.<br>Events start with subsequent changes.</p></form></section>
<div class="feeds"><section class="panel feed-panel"><details id="activity" class="technical"><summary>Activity report</summary><p class="hint">Complete aggregates for the selected window, not just the latest 100 runs. Human feedback is not independently measured accuracy.</p><div id="report-controls" class="report-controls"></div><div id="report-body" class="history">Open to load the last seven days.</div></details></section><section class="panel feed-panel"><div class="section-head"><div><h2>Your watches</h2><p>The pages you’re keeping an eye on.</p></div><span id="watches-count" class="counter" aria-label="Number of watches">—</span></div><div id="watches" class="empty-state">Connect your API key to load watches.</div></section><section class="panel feed-panel"><div class="section-head"><div><h2>Recent events</h2><p>Changes that match your condition.</p></div><span id="events-count" class="counter" aria-label="Number of events">—</span></div><div id="events" class="empty-state">Connect your API key to load events.</div></section></div></div>
<footer>WatchAgent</footer></main>
<script>
const key=document.getElementById('key'),message=document.getElementById('message');
const load=document.getElementById('load'),authStatus=document.getElementById('auth-status');
const pendingRuns=new Map();
const runLabels={queued:'Queued',running:'Checking',retry:'Retry pending',baseline:'Baseline saved',unchanged:'Unchanged',not_matched:'No relevant change',matched:'Event emitted',failed:'Failed'};
async function api(path,options={}){
  const token=key.value.trim();
  if(!token)throw Error('Enter your API key.');
  let r;try{r=await fetch(path,{...options,headers:{authorization:'Bearer '+token,'content-type':'application/json'}})}catch{throw Error('Unable to connect. Check your connection and try again.')}
  let b;try{b=await r.json()}catch{throw Error('The server returned an unexpected response. Please try again.')}
  if(!r.ok)throw Error(b.error?.message||'Request failed (HTTP '+r.status+').');
  return b;
}
function el(tag,className,text){const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=String(text);return node}
function date(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('en-US',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
function notify(text,error=false){message.className=error?'notice error':'notice';message.textContent=text}
function evidenceView(evidence){
  const node=el('div','evidence');
  if(!evidence){node.append(el('p','hint','Evidence not captured for this older event.'));return node}
  for(const [label,value] of [['Before',evidence.before],['After',evidence.after]]){
    node.append(el('strong','',label));node.append(el('blockquote','',value||'No quote provided.'));
  }
  return node;
}
function reviewView(kind,row,onSaved=()=>{}){
  const node=el('details','technical review'),labels={correct:'Correct',false_positive:'False alarm',false_negative:'Missed change',unsure:'Unsure'};
  const title=el('summary','',''),note=el('textarea'),status=el('p','hint');
  const update=()=>{title.textContent=row.review?'Review: '+labels[row.review.verdict]:(kind==='event'?'Review event':'Review non-event');status.textContent=row.review?'Saved '+date(row.review.updated_at)+'. Latest judgement only.':'Not reviewed. A missed change needs independently observed evidence.'};
  note.value=row.review?.note||'';note.maxLength=1000;note.placeholder='Optional note or evidence (up to 1,000 characters).';note.ariaLabel='Review note';
  const actions=el('div','actions'),buttons=[];let busy=false;
  for(const verdict of ['correct',kind==='event'?'false_positive':'false_negative','unsure']){
    const button=actionButton(labels[verdict],async()=>{
      if(busy)return;busy=true;for(const b of buttons)b.disabled=true;note.disabled=true;
      const token=key.value.trim();
      try{
        const result=await api('/v1/'+kind+'/'+row.id+'/review',{method:'POST',body:JSON.stringify({verdict,note:note.value})});
        if(key.value.trim()!==token)return;
        row.review=result;update();onSaved();notify('Review saved.');
        if(activity.open)await loadReport();
      }finally{busy=false;for(const b of buttons)b.disabled=false;note.disabled=false}
    });buttons.push(button);actions.append(button);
  }
  node.append(title);node.append(status);node.append(note);node.append(actions);update();return node;
}
function diagnostic(run,onSaved=()=>{}){
  const node=el('div','diagnostic');
  if(!run){node.append(el('p','hint','Not checked yet.'));return node}
  const cancelled=run.error&&run.error.startsWith('Cancelled:');
  node.append(el('p','run-title','Last run: '+(cancelled?'Cancelled':(runLabels[run.status]||run.status))));
  if(run.id)node.append(el('p','run-metrics',run.id));
  node.append(el('p','run-metrics',date(run.finished_at||run.started_at||run.created_at)+' · '+(run.fetch_mode||'fetch pending')+(run.http_status?' · HTTP '+run.http_status:'')));
  node.append(el('p','run-metrics','Attempts: '+run.attempts+' · AI calls: '+(run.ai_calls==null?'not recorded':run.ai_calls)+(run.fetch_ms!=null?' · Fetch: '+run.fetch_ms+' ms':'')+(run.ai_ms!=null?' · AI: '+run.ai_ms+' ms':'')));
  if(run.error)node.append(el('p',cancelled?'hint':'error',run.error));
  const evaluation=run.evaluation;
  if(evaluation){
    node.append(el('p','',evaluation.summary));node.append(el('p','hint',evaluation.reason));
    if(evaluation.matched&&evaluation.confidence<0.8)node.append(el('p','hint','No event: confidence below the 80% threshold.'));
    node.append(evidenceView(evaluation.evidence));
  }
  if(run.id&&['not_matched','unchanged'].includes(run.status))node.append(reviewView('run',run,onSaved));
  return node;
}
const activity=document.getElementById('activity');
let reportFrom,reportUntil,reportButton,reportSequence=0;
function reportMetrics(data){
  const node=el('div','diagnostic'),n=key=>data[key]||0;
  node.append(el('p','','Runs: '+n('runs')+' · Pending: '+n('pending')+' · Failed: '+n('failed')+' · Cancelled: '+n('cancelled')));
  node.append(el('p','','Baseline: '+n('baseline')+' · Unchanged: '+n('unchanged')+' · No relevant change: '+n('not_matched')+' · Event runs: '+n('matched')));
  node.append(el('p','','Attempts: '+n('attempts')+' · Extra attempts: '+n('extra_attempts')+' · Recorded AI calls: '+n('ai_calls')));
  if(n('ai_calls_unmeasured_runs'))node.append(el('p','hint','AI calls not recorded for '+n('ai_calls_unmeasured_runs')+' historical runs.'));
  node.append(el('p','hint','Last measured attempt averages · Fetch: '+(n('fetch_samples')?Math.round(n('fetch_ms_total')/n('fetch_samples'))+' ms':'not recorded')+' · AI: '+(n('ai_samples')?Math.round(n('ai_ms_total')/n('ai_samples'))+' ms':'not recorded')));
  node.append(el('p','','Events: '+n('events')+' · Correct: '+n('event_correct')+' · False alarms: '+n('event_false_positive')+' · Unsure: '+n('event_unsure')+' · Unreviewed: '+n('event_unreviewed')));
  node.append(el('p','','Non-event reviews · Correct: '+n('run_correct')+' · Reported misses: '+n('run_false_negative')+' · Unsure: '+n('run_unsure')+' · Unreviewed: '+n('run_unreviewed')));
  return node;
}
async function loadReport(){
  const body=document.getElementById('report-body'),token=key.value.trim(),sequence=++reportSequence;
  body.replaceChildren();body.textContent='Loading report…';if(reportButton)reportButton.disabled=true;
  try{
    const params=new URLSearchParams();
    if(reportFrom?.value)params.set('since',new Date(reportFrom.value).toISOString());
    if(reportUntil?.value)params.set('until',new Date(reportUntil.value).toISOString());
    const data=await api('/v1/report'+(params.size?'?'+params.toString():''));if(key.value.trim()!==token||sequence!==reportSequence)return;
    body.replaceChildren();body.append(el('p','hint',date(data.since)+' → '+date(data.until)+' · '+(data.watches||[]).length+' watches'));
    if(data.truncated)body.append(el('p','error','Only the first 100 watches are included; these totals are partial.'));
    body.append(reportMetrics(data.totals||{}));
    for(const row of data.watches||[]){const item=el('details','technical');item.append(el('summary','',row.url+' · '+(row.runs||0)+' runs'));item.append(el('p','condition',row.condition));item.append(reportMetrics(row));body.append(item)}
    body.append(el('p','hint',data.scope||'No measurements available.'));
  }catch(e){if(sequence===reportSequence&&key.value.trim()===token)body.textContent=e.message}finally{if(reportButton&&sequence===reportSequence)reportButton.disabled=false}
}
activity.ontoggle=async()=>{
  if(!activity.open)return;
  if(!reportFrom){
    const controls=document.getElementById('report-controls');
    reportFrom=el('input');reportUntil=el('input');
    for(const [field,labelText] of [[reportFrom,'From (local time, optional)'],[reportUntil,'Until (local time, optional)']]){
      field.type='datetime-local';field.step='1';const label=el('label','',labelText);label.append(field);controls.append(label);
    }
    reportButton=actionButton('Update report',loadReport);controls.append(reportButton);
  }
  await loadReport();
};
async function runNow(row,button){
  if(pendingRuns.has(row.id))return;
  const marker={},token=key.value.trim();pendingRuns.set(row.id,marker);button.disabled=true;
  try{
    const result=await api('/v1/watch/'+row.id+'/run',{method:'POST'});
    notify('Run queued: '+result.run_id+'. Waiting for the result…');
    for(let i=0;i<60;i++){
      if(pendingRuns.get(row.id)!==marker||key.value.trim()!==token)return;
      const runs=await api('/v1/watch/'+row.id+'/runs');
      if(pendingRuns.get(row.id)!==marker||key.value.trim()!==token)return;
      const run=runs.find(item=>item.id===result.run_id);
      if(run&&!['queued','running','retry'].includes(run.status)){
        pendingRuns.delete(row.id);notify(run.error?'Run failed: '+run.error:'Run finished: '+(runLabels[run.status]||run.status)+'.',run.status==='failed');await refresh();return;
      }
      notify('Run '+result.run_id+': '+(run?runLabels[run.status]:'Queued')+'. Updating automatically…');
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    notify('The run is still in progress. Use Connect & refresh to check again.');
  }catch(e){notify(e.message,true)}
  finally{if(pendingRuns.get(row.id)===marker)pendingRuns.delete(row.id);button.disabled=false}
}
function actionButton(text,handler,className='secondary'){
  const button=el('button',className,text);button.type='button';
  button.onclick=async()=>{button.disabled=true;try{await handler()}catch(e){notify(e.message,true)}finally{button.disabled=false}};
  return button;
}
function historyView(id){
  const details=el('details','technical'),body=el('div','history');details.append(el('summary','','Run history'));details.append(body);
  let loaded=false;
  details.ontoggle=async()=>{
    if(!details.open||loaded)return;loaded=true;body.textContent='Loading runs…';
    try{const runs=await api('/v1/watch/'+id+'/runs');body.replaceChildren();if(!runs.length)body.textContent='No runs yet.';for(const run of runs.slice(0,10))body.append(diagnostic(run))}
    catch(e){loaded=false;body.textContent=e.message}
  };
  return details;
}
function render(id,rows){
  const node=document.getElementById(id);node.replaceChildren();node.className=rows.length?'list':'empty-state';
  if(!rows.length){node.textContent=id==='watches'?'No watches yet. Create your first watch using the form.':'No events yet. The first check saves a baseline without generating an event.';return}
  for(const row of rows){
    const article=el('article','item'),head=el('div','item-head'),meta=el('div','item-meta');
    if(id==='watches'){
      let url;try{url=new URL(row.url)}catch{}
      const publicLink=url&&['https:','http:'].includes(url.protocol);
      const link=el(publicLink?'a':'span','page-link',publicLink?url.hostname+url.pathname:(row.url||'Watched page'));
      if(publicLink){link.href=url.href;link.target='_blank';link.rel='noopener noreferrer'}
      const active=row.status==='active';
      head.append(link);head.append(el('span',active?'badge active':'badge',active?'ACTIVE':(row.status||'WATCH')));
      article.append(head);article.append(el('p','condition',row.condition));
      meta.append(el('span','', 'Every '+row.interval_minutes+' min'));
      meta.append(el('span','',row.use_browser?'JavaScript rendering':'Automatic rendering'));
      meta.append(el('span','',row.status==='paused'?'Checks paused':'Next: '+date(row.next_run_at)));
    }else{
      head.append(el('span','badge event',row.event_type||'semantic_change'));head.append(el('span','item-meta',date(row.created_at)));
      article.append(head);article.append(el('p','event-summary',row.summary));
      if(typeof row.confidence==='number'&&Number.isFinite(row.confidence))meta.append(el('span','','Confidence '+Math.round(row.confidence*100)+'%'));
      const delivery={delivered:'Webhook delivered',pending:'Webhook pending',failed:'Webhook delivery failed',not_required:'No webhook'};
      meta.append(el('span','',delivery[row.delivery_status]||'Event saved'));
    }
    article.append(meta);
    const details=el('details','technical'),summary=el('summary','','View JSON'),p=el('pre','',JSON.stringify(row,null,2));
    details.append(summary);details.append(p);
    if(id==='watches'){
      article.append(diagnostic(row.latest_run,()=>{p.textContent=JSON.stringify(row,null,2)}));
      const actions=el('div','actions'),button=el('button','secondary','Run now');button.type='button';
      button.disabled=row.status==='paused'||pendingRuns.has(row.id);button.onclick=()=>runNow(row,button);actions.append(button);
      actions.append(actionButton(row.status==='paused'?'Resume':'Pause',async()=>{
        const status=row.status==='paused'?'active':'paused';
        await api('/v1/watch/'+row.id,{method:'PATCH',body:JSON.stringify({status})});pendingRuns.delete(row.id);
        notify(status==='paused'?'Watch paused. Pending checks were cancelled.':'Watch resumed. The next check is due now.');await refresh();
      }));
      actions.append(actionButton('Delete',async()=>{
        if(!confirm('Delete this watch and all its runs and events?'))return;
        await api('/v1/watch/'+row.id,{method:'DELETE'});pendingRuns.delete(row.id);notify('Watch deleted.');await refresh();
      },'secondary danger'));
      article.append(actions);article.append(historyView(row.id));
    }else{
      article.append(evidenceView(row.evidence));
      if(row.id)article.append(reviewView('event',row,()=>{p.textContent=JSON.stringify(row,null,2)}));
    }
    article.append(details);node.append(article);
  }
}
async function refresh(){
  if(load.disabled)return;
  load.disabled=true;load.textContent='Loading…';authStatus.className='';authStatus.textContent='Checking your API key…';
  try{
    const [watches,events]=await Promise.all([api('/v1/watches'),api('/v1/events')]);
    render('watches',watches);render('events',events);
    document.getElementById('watches-count').textContent=String(watches.length);document.getElementById('events-count').textContent=String(events.length);
    authStatus.className='ok';authStatus.textContent='Connected. API key verified. Watches: '+watches.length+'. Recent events: '+events.length+'.';
    if(activity.open)await loadReport();
  }catch(e){
    authStatus.className='error';authStatus.textContent=e.message;
    document.getElementById('watches').textContent='Watches could not be loaded. Check your API key and try again.';
    document.getElementById('events').textContent='Events could not be loaded.';
    document.getElementById('watches-count').textContent='—';document.getElementById('events-count').textContent='—';
    reportSequence++;const reportBody=document.getElementById('report-body');reportBody.replaceChildren();reportBody.textContent='Report could not be loaded. Check your API key and try again.';
  }finally{load.disabled=false;load.textContent='Connect & refresh'}
}
load.onclick=refresh;
key.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();refresh()}};
document.getElementById('create').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget,submit=form.querySelector('button[type="submit"]');
  const f=new FormData(form),body={url:f.get('url'),condition:f.get('condition'),interval_minutes:Number(f.get('interval_minutes')),use_browser:f.get('use_browser')==='on'};
  if(f.get('webhook'))body.webhook=f.get('webhook');
  submit.disabled=true;submit.textContent='Creating…';
  try{const watch=await api('/v1/watch',{method:'POST',body:JSON.stringify(body)});notify('Watch created: '+watch.id);await refresh()}
  catch(e){notify(e.message,true)}
  finally{submit.disabled=false;submit.textContent='Create watch →'}
};
</script></body></html>`;
