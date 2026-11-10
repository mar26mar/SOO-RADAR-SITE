'use strict';
const $ = id => document.getElementById(id);
const put = (id,value) => { const el=$(id); if(el) el.textContent=String(value); };
const make = (tag,value,className) => {
  const el=document.createElement(tag);
  if(value!==undefined) el.textContent=String(value);
  if(className) el.className=className;
  return el;
};
let latest=null;
let selected=null;
const koTime = t => {
  const d=new Date(t);
  return Number.isNaN(d.getTime()) ? '시각 미확인' :
    d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
};
const ageText=t=>{
  const delta=Date.now()-new Date(t).getTime();
  if(!Number.isFinite(delta)||delta<0)return '관찰 시각 미확인';
  const min=Math.floor(delta/60000);
  if(min<2)return '최근 1분 이내 기록';
  if(min<60)return min+'분 전 관찰';
  if(min<1440)return Math.floor(min/60)+'시간 전 관찰';
  return Math.floor(min/1440)+'일 전 관찰';
};
const dollar=value=>(typeof value==='number'&&Number.isFinite(value))?'$'+value.toFixed(4):'가격 미검증';
const rowFind=ticker=>latest?.historical_observations.find(x=>x.ticker===ticker)||null;
const condition=(value)=>value===true?'과거 관찰됨':'미검증 또는 미충족';

function validate(data){
  if(!data||data.schema_version!==1||
    data.source!=='VERIFIED_PRIVATE_GITHUB_IEX_LEDGER'||data.historical_data_only!==true||
    data.trade_signal!==false||data.current_live_price_verified!==false||
    data.full_market_coverage_verified!==false||
    !/^\d+$/.test(String(data.run_id))||
    !Number.isFinite(new Date(data.observation_utc).getTime())||
    !Array.isArray(data.historical_observations)||data.historical_observations.length>50||
    !Array.isArray(data.research_candidates_this_run)||data.research_candidates_this_run.length>10)
    throw new Error('검증된 원장 데이터 파일이 아닙니다.');
  for(const row of data.historical_observations){
    if(!row||!(/^[A-Z0-9.\-]{1,16}$/).test(String(row.ticker))||
       !Number.isFinite(new Date(row.last_checked_utc).getTime())||
       typeof row.last_recorded_price_usd!=='number'||!Number.isFinite(row.last_recorded_price_usd)||
       !Array.isArray(row.observed_actual_trade_points||[]))
      throw new Error('종목 데이터의 형식이 잘못되었습니다.');
  }
  return data;
}

function renderCards(candidates){
  const tbody=$('candidate-list');tbody.replaceChildren();
  if(!candidates.length){
    const tr=make('tr'),td=make('td','♡ 이번 실제 실행에서 분봉 3조건 동시 관찰 후보가 확인되지 않았어요. 자료 부족 또는 조건 미충족일 수 있어요.','placeholder-cell');
    td.colSpan=6;tr.append(td);tbody.append(tr);return;
  }
  for(const item of candidates){
    // Only actual verified shortlist research rows may be displayed.
    const labels=item.conditions_observed;
    if(item.classification!=='RESEARCH_ONLY_TRIPLE_CONDITION' ||
       !Array.isArray(labels)||!['volume_accelerating','rising_lows','high_area_compression'].every(v=>labels.includes(v))){
      continue;
    }
    const tr=make('tr');
    const first=make('td');
    const match=rowFind(item.ticker);
    if(match){
      const button=make('button',item.ticker+' ♡','ticker-btn');
      button.type='button';
      button.addEventListener('click',()=>selectRow(item.ticker));
      first.append(button);
    }else first.append(make('strong',item.ticker,'ticker-label'));
    tr.append(first);
    const rv=item.observed_iex_15m_rvol;
    tr.append(make('td',(typeof rv==='number'&&Number.isFinite(rv))?rv.toFixed(2)+'배':'검증 불가'));
    for(let i=0;i<3;i++)tr.append(make('td','✓ 관찰','positive'));
    tr.append(make('td',match?dollar(match.last_recorded_price_usd)+' (기록)':'목록 표시 제한'));
    tbody.append(tr);
  }
  if(!tbody.children.length){
    const tr=make('tr'),td=make('td','검증 조건을 만족하는 연구 후보가 없습니다.','placeholder-cell');
    td.colSpan=6;tr.append(td);tbody.append(tr);
  }
}
function renderRepeated(rows){
  const parent=$('repeat-list'); parent.replaceChildren();
  // This is a count of ACTUALLY saved observations, never a personal watchlist
  // or an inferred accumulation/price-holding pattern.
  const repeated=rows.filter(x=>Number.isInteger(x.observations)&&x.observations>=2)
    .sort((a,b)=>b.observations-a.observations || a.ticker.localeCompare(b.ticker)).slice(0,6);
  if(!repeated.length){
    parent.append(make('div','♡ 실제 두 번 이상 기록된 가격 관찰 종목이 아직 없어요.','repeat-empty'));
    return;
  }
  repeated.forEach(row=>{
    const item=make('div',undefined,'repeat-item');
    const button=make('button',row.ticker+' ♡');
    button.type='button';
    button.addEventListener('click',()=>selectRow(row.ticker));
    item.append(button,make('small',row.observations+'회 가격 관찰 · 마지막 '+dollar(row.last_recorded_price_usd)));
    parent.append(item);
  });
}

function makeChart(row){
  const line=$('chart-line'),fill=$('chart-fill');
  line.setAttribute('d','');fill.setAttribute('d','');
  const empty=$('chart-empty');
  const points=(row?.observed_actual_trade_points||[]).filter(
    p=>typeof p.price_usd==='number'&&Number.isFinite(p.price_usd)&&
       Number.isFinite(new Date(p.trade_timestamp_utc).getTime())
  );
  if(points.length<2){empty.hidden=false;return;}
  // Sparse provider trade observations, NOT continuous candlesticks or live price history.
  empty.hidden=true;
  const prices=points.map(p=>p.price_usd);
  const low=Math.min(...prices),high=Math.max(...prices);
  const span=Math.max(high-low,Math.abs(high)*0.002,0.0001);
  const coords=points.map((p,i)=>[
    20+(320*i)/(points.length-1),
    114-88*((p.price_usd-low+span*.06)/(span*1.12))
  ]);
  const svgPath=coords.map(([x,y],i)=>(i?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)).join(' ');
  line.setAttribute('d',svgPath);
  const first=coords[0],last=coords[coords.length-1];
  fill.setAttribute('d',svgPath+' L '+last[0].toFixed(2)+' 130 L '+first[0].toFixed(2)+' 130 Z');
}

function selectRow(ticker){
  if(!latest) return;
  const row=rowFind(ticker);
  if(!row)return;
  selected=ticker;
  put('detail-symbol',row.ticker+' ♡');
  put('detail-label',row.three_conditions_observed_at_last_review?'과거 3조건 관찰':'연구 관찰 기록');
  put('detail-price',dollar(row.last_recorded_price_usd));
  put('detail-time','마지막 확인: '+koTime(row.last_checked_utc)+' · 현재가 아님 · '+row.observations+'회 관찰');
  [['sig-volume','volume_accelerating_observed'],['sig-lows','rising_lows_observed'],['sig-compress','high_area_compression_observed']]
    .forEach(([id,key])=>{
      const el=$(id);
      el.textContent=condition(row[key]);el.className=row[key]===true?'met':'';
    });
  makeChart(row);
}

function renderHistory(rows){
  const tbody=$('history-rows');tbody.replaceChildren();
  const term=$('search').value.trim().toUpperCase(),filter=$('filter').value;
  let shown=0;
  for(const row of rows){
    if(!row.ticker.includes(term) ||
      (filter==='triple'&&!row.three_conditions_observed_at_last_review) ||
      (filter==='fresh'&&!row.snapshot_fresh_at_collection)) continue;
    const tr=make('tr');
    const tickerCell=make('td');
    const btn=make('button',row.ticker+' ♡');
    btn.type='button';btn.className='ticker-btn';btn.setAttribute('aria-label',row.ticker+' 상세 관찰 기록 보기');
    btn.addEventListener('click',()=>selectRow(row.ticker));
    tickerCell.append(btn);tr.append(tickerCell);
    tr.append(make('td',dollar(row.last_recorded_price_usd)));
    tr.append(make('td',row.observations+'회'));
    tr.append(make('td',row.snapshot_fresh_at_collection?'수집 당시 15분 이내':'오래된 시세'));
    const cell=make('td',row.three_conditions_observed_at_last_review?'과거 3조건 관찰':'미검증·미충족',row.three_conditions_observed_at_last_review?'yes':'no');
    tr.append(cell);
    tr.append(make('td',koTime(row.last_checked_utc)));
    tbody.append(tr);shown++;
  }
  if(!shown){
    const tr=make('tr'),td=make('td','해당하는 과거 관찰 종목이 없어요 ♡');
    td.colSpan=6;tr.append(td);tbody.append(tr);
  }
  put('row-count','최대 50개 과거 관찰 종목 중 '+shown+'개 표시 · 실시간 시세 아님');
}

function render(data){
  latest=data;
  put('last-observed',koTime(data.observation_utc));
  put('last-relative',ageText(data.observation_utc));
  const delta=Date.now()-new Date(data.observation_utc).getTime();
  put('old-data',delta>=0&&delta<20*60000?'최근 수집 보고서 · 실시간 아님':'지난 관찰 데이터 · 현재가 아님');
  put('snapshots',data.valid_iex_snapshots_in_run);
  put('price-matches',data.priced_tickers_in_run);
  put('technical',data.researched_in_run);
  put('triple-count',data.three_conditions_observed_this_run);
  put('flow-scanned',data.sampled_in_run);
  put('flow-priced',data.priced_tickers_in_run);
  put('flow-tech',data.researched_in_run);
  put('flow-ready',data.three_conditions_observed_this_run);
  put('run-info','검증된 GitHub 실행 ID '+data.run_id+' · 시세 관찰 '+koTime(data.observation_utc));
  put('generated',koTime(data.generated_utc));
  const link=$('run-link');
  link.href='https://github.com/mar26mar/NASDAQ7-CHINA1-RADAR/actions/runs/'+data.run_id;
  put('connection','검증된 보고서 파일 읽음');
  $('connection-dot').className='status-dot good';
  renderCards(data.research_candidates_this_run);
  renderObservedOverview(data);
  renderHistory(data.historical_observations);
  renderRepeated(data.historical_observations);
  if(selected&&rowFind(selected))selectRow(selected);
  else if(data.historical_observations.length)selectRow(data.historical_observations[0].ticker);
  else{
    put('detail-symbol','—');put('detail-label','기록 대기');put('detail-price','기록된 가격 없음');
    put('detail-time','실제 시세가 수집되면 기록을 확인할 수 있어요.');
    makeChart(null);
  }
}
async function load(){
  $('refresh').disabled=true;
  try{
    let data;
    if(location.protocol==='file:'){
      const embed=$('embedded-radar-data');
      if(!embed)throw new Error('로컬 미리보기에 검증 원장이 없음');
      data=JSON.parse(embed.textContent);
    }else{
      const response=await fetch('./data.json?at='+Date.now(),{cache:'no-store',credentials:'same-origin'});
      if(!response.ok)throw new Error('검증 보고서를 가져오지 못했음');
      data=await response.json();
    }
    render(validate(data));
  }catch(e){
    put('connection','아직 검증된 보고서 없음');
    $('connection-dot').className='status-dot bad';
    if(!latest){
      put('last-observed','실제 기록 대기');
      renderCards([]);
      $('repeat-list').replaceChildren(make('div','♡ 실제 반복 관찰 기록 대기','repeat-empty'));
      const tbody=$('history-rows');tbody.replaceChildren();
      const tr=make('tr'),td=make('td','아직 표시할 수 있는 실제 데이터가 없어요.');
      td.colSpan=6;tr.append(td);tbody.append(tr);
    }
  }finally{$('refresh').disabled=false;}
}
$('search').addEventListener('input',()=>{if(latest)renderHistory(latest.historical_observations);});
$('filter').addEventListener('change',()=>{if(latest)renderHistory(latest.historical_observations);});
$('refresh').addEventListener('click',load);
load();
setInterval(()=>{if(document.visibilityState==='visible')load();},60000);
setInterval(()=>{if(latest)put('last-relative',ageText(latest.observation_utc));},30000);

// Verified observations, not trading signals or real-time prices.
function renderObservedOverview(data) {
  const anchor = document.querySelector('.main-columns');
  if (!anchor) throw new Error('Observed-list placement unavailable');
  let panel = document.getElementById('observed-overview');
  if (!panel) {
    panel = make('section', undefined, 'panel');
    panel.id = 'observed-overview';
    anchor.before(panel);
  }
  panel.replaceChildren();
  const h = make('h2', '♡ 이번 회차 관측 종목 · 신호와 별개');
  const note = make('p', '실제 수집된 가격 기록만 표시합니다. 실시간 시세·매집 확인·매수 신호가 아닙니다.');
  const observedAt = new Date(data.observation_utc).getTime();
  const rows = data.historical_observations
    .filter(x => Number.isFinite(new Date(x.last_checked_utc).getTime()) &&
      Math.abs(new Date(x.last_checked_utc).getTime() - observedAt) <= 120000)
    .sort((a,b) => a.ticker.localeCompare(b.ticker));
  const count = make('p', '이번 회차 가격 관찰: ' + rows.length + '개 · 최종 3조건 후보: ' +
    data.three_conditions_observed_this_run + '개');
  panel.append(h, note, count);
  const holder = make('div', undefined, 'table-holder');
  const table = make('table');
  const head = make('thead'), headRow = make('tr');
  ['종목', '기록가 (USD)', '분봉 검증 상태', '관찰 시각 (KST)'].forEach(label =>
    headRow.append(make('th',label)));
  head.append(headRow);
  const body = make('tbody');
  if (!rows.length) {
    const tr = make('tr'), td = make('td', '이번 회차 가격 관찰 종목이 없습니다.');
    td.colSpan = 4; tr.append(td); body.append(tr);
  }
  for (const item of rows.slice(0,25)) {
    const tr = make('tr');
    const cell = make('td');
    const btn = make('button', item.ticker, 'ticker-btn');
    btn.type='button';
    btn.addEventListener('click',()=>selectRow(item.ticker));
    cell.append(btn);tr.append(cell);
    tr.append(make('td',dollar(item.last_recorded_price_usd)));
    tr.append(make('td',String(item.research_status || '미검증') + ' · 신호 아님'));
    tr.append(make('td',koTime(item.last_checked_utc)));
    body.append(tr);
  }
  table.append(head,body);holder.append(table);panel.append(holder);
}
