(function(){
"use strict";
const $=id=>document.getElementById(id);
const LS="nsx:mkteff:v4", LS_OLD3="nsx:mkteff:v3", LS_OLD2="nsx:mkteff:v2";
const NS="http://www.w3.org/2000/svg";
const el=(t,a)=>{const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);return e;};

/* ---------- number formatting (one rule: whole dollars for money, 2dp only for ratios) */
const money =n=>(n<0?"-":"")+"$"+Math.round(Math.abs(n)).toLocaleString("en-US");
const money2=n=>(n<0?"-":"")+"$"+Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const ratio =n=>n.toFixed(2);
const pct   =n=>n.toFixed(1)+"%";
const grp   =n=>Number(n||0).toLocaleString("en-US");

const ACCR={x12_over_52:12/52, calendar_days:7/30.4375, divide_4:1/4};
let D=null,cfg=null,rows=[],cur=null,basisKey=null,accrual="x12_over_52";
let periodType="week", refundsOn=true;
let ST={amounts:{},added:[],removed:[],ltv:{}}, dirty=false, savedAt=null;
let baselineCac=null;

/* ---------- state ---------- */
function loadState(){
  try{
    const r=localStorage.getItem(LS);
    if(r){const p=JSON.parse(r);
      ST=Object.assign({amounts:{},added:[],removed:[],ltv:{}},p.ST||{});
      basisKey=p.basisKey||null; accrual=p.accrual||accrual; savedAt=p.savedAt||null;
      periodType=p.periodType||periodType;
      refundsOn = p.refundsOn===undefined?true:!!p.refundsOn;
      return;}
    const o3=localStorage.getItem(LS_OLD3);
    if(o3){const p=JSON.parse(o3);
      ST=Object.assign(ST,p.ST||{}); basisKey=p.basisKey||null; accrual=p.accrual||accrual; return;}
    const o2=localStorage.getItem(LS_OLD2);
    if(o2){const p=JSON.parse(o2),e=p.edits||{};
      ST.ltv=e.__ltv||{};
      for(const k in e) if(k!=="__ltv") ST.amounts[k]=+e[k];
      basisKey=p.basisKey||null;}
  }catch(e){}
}
function persist(){try{localStorage.setItem(LS,JSON.stringify(
  {ST,basisKey,accrual,savedAt,periodType,refundsOn}));}catch(e){}}
function touch(){dirty=true;persist();render();}

const monthly=l=>(l.id in ST.amounts)?+ST.amounts[l.id]:l.monthly;
function lines(){return cfg.cost_lines.filter(l=>!ST.removed.includes(l.id)).concat(ST.added);}
function effectiveConfig(){
  const out=JSON.parse(JSON.stringify(cfg));
  out.cost_lines=lines().map(l=>Object.assign({},l,{monthly:monthly(l)}));
  out.accrual.method=accrual; out.refund_bases.default=basisKey;
  Object.assign(out.ltv_assumptions,ST.ltv);
  return out;
}
function changeCount(){return Object.keys(ST.amounts).length+ST.added.length+ST.removed.length
  +Object.keys(ST.ltv).length;}

/* ---------- the refund rate that applies to a period ----------
   A matured period has actually experienced its refunds, so it uses its own measured
   rate. A young one has no choice but to borrow the planned assumption. */
function rateFor(p){
  const planned=(p.refund_bases_available[basisKey]||p.refund_bases_available.planning);
  if(p.refund_actual.is_mature && p.refund_actual.booked_pct!=null)
    return {rate:p.refund_actual.booked_pct, kind:"actual", label:"actual",
            note:"this period's own measured refunds"};
  return {rate:planned.rate_pct, kind:"planned", label:planned.label.toLowerCase(),
          note:"planned assumption — this period has not matured"};
}

/* ---------- math ---------- */
function costs(p){
  const wt = p.period_type==="month" ? 1 : ACCR[accrual];
  let retainers=0,variable=0;
  lines().forEach(l=>{ if(l.kind==="retainer") retainers+=monthly(l)*wt;
                       else if(l.kind==="variable") variable+=monthly(l)*wt; });
  const ads=p.measured.ad_spend;
  return {ads,retainers,variable,total:ads+retainers+variable};
}
function calc(p){
  const c=costs(p);
  const nc=p.measured.new_customers, gross=p.measured.gross_bookings;
  const cac= nc>0 ? c.total/nc : null;
  const aspG= nc>0 ? gross/nc : null;
  const r=rateFor(p);
  const tax= aspG!=null ? aspG*r.rate/100 : null;
  const aspN= aspG!=null ? aspG-tax : null;
  const asp = refundsOn ? aspN : aspG;
  const L=Object.assign({},cfg.ltv_assumptions,ST.ltv);
  const consum=(+L.consumables_per_month)*(+L.active_months)*(+L.attach_rate_pct)/100;
  const ltv= asp!=null ? asp+consum+(+L.repeat_hardware) : null;
  return Object.assign(c,{nc,gross,cac,aspG,aspN,asp,tax,r,ltv,consum,L,
    aspCac:(asp!=null&&cac)?asp/cac:null, ltvCac:(ltv!=null&&cac)?ltv/cac:null});
}
const ratioOf=p=>{const k=calc(p);return k.aspCac;};

/* ---------- hero ---------- */
function renderHero(p,k){
  $("heroPeriod").textContent=p.label+(p.period_type==="week"?" (7 days)":"");
  const r=k.aspCac;
  $("bigRatio").textContent = r==null?"—":ratio(r);
  if(r!=null){const s=document.createElement("small");s.textContent="×";$("bigRatio").appendChild(s);}
  $("bigRatio").className="big mono "+(r>=1?"over":"under");

  // deltas vs previous period and vs trailing 4
  const i=rows.indexOf(p), prev=i>0?rows[i-1]:null;
  const win=rows.slice(Math.max(0,i-4),i).map(ratioOf).filter(v=>v!=null);
  const avg= win.length? win.reduce((a,b)=>a+b,0)/win.length : null;
  const dl=[];
  const fmt=(v,lab)=>{
    if(v==null||r==null) return "";
    const d=r-v, cls=d>=0?"up":"down", sgn=d>=0?"+":"−";
    return '<span>'+lab+' <b class="'+cls+'">'+sgn+ratio(Math.abs(d))+'×</b></span>';
  };
  if(prev) dl.push(fmt(ratioOf(prev), "vs prev"));
  if(avg!=null) dl.push(fmt(avg, "vs trailing 4"));
  dl.push('<span>CAC <b>'+(k.cac?money2(k.cac):"—")+'</b></span>');
  dl.push('<span>New customers <b>'+grp(k.nc)+'</b></span>');
  $("bigDeltas").innerHTML=dl.join("");

  // refund ledger + toggle
  const on=refundsOn;
  $("ledger").innerHTML=
    '<div class="sw-wrap" id="refToggle" role="button" tabindex="0" aria-pressed="'+on+'">'
      +'<span class="sw"></span><span class="sw-lab">Apply refund rate</span></div>'
    +'<div style="margin-top:14px">'
      +'<div class="led-row"><span>Gross ASP</span><span class="v v-m">'+(k.aspG!=null?money(k.aspG):"—")+'</span></div>'
      +(on
        ?'<div class="led-row tax"><span>Refund tax · '+pct(k.r.rate)+' <span class="tag '
           +(k.r.kind==="actual"?"m":"a")+'">'+k.r.label+'</span></span><span class="v">−'
           +money(k.tax)+'</span></div>'
         +'<div class="led-row tot"><span>Net ASP</span><span class="v">'+money(k.aspN)+'</span></div>'
        :'<div class="led-row tot"><span>ASP applied</span><span class="v">'+money(k.aspG)+'</span></div>')
    +'</div>'
    +'<div class="led-note">'+(on
        ? k.r.note.charAt(0).toUpperCase()+k.r.note.slice(1)+"."
        : "Refunds switched off — this is the no-refund case, an assumption we know is false. "
          +"Switch on to see the tax.")+'</div>';
  const t=$("refToggle");
  const flip=()=>{refundsOn=!refundsOn;persist();render();};
  t.addEventListener("click",flip);
  t.addEventListener("keydown",e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();flip();}});

  $("bigVerdict").textContent = r==null ? "No new customers recorded in this period."
    : r>=1 ? "The first order covers acquisition with "+money(k.asp-k.cac)+" left over per customer"
             +(on?"":", but only because refunds are switched off")+"."
    : "You recover "+Math.round(r*100)+"% of acquisition cost on the first order. The gap is "
      +money(k.cac-k.asp)+" per customer, carried by repeat revenue."
      +(on?"":" Refunds are switched off, so the real gap is wider.");

  const pos=v=>Math.max(0,Math.min(100,v/2*100));
  $("hFill").style.width=pos(r||0)+"%";
  $("hFill").className="fill"+(r<1?" under":"");
  $("hMark").style.left="calc("+pos(r||0)+"% - 2px)";
  $("hThresh").style.left=pos(1)+"%";
  const other= k.cac ? (on?k.aspG:k.aspN)/k.cac : null;
  if(other==null){$("hGhost").style.display="none";}
  else{$("hGhost").style.display="";$("hGhost").style.left=pos(other)+"%";
       $("hGhost").dataset.tip=(on?"Without refunds":"With refunds")+": "+ratio(other)+"×";}
}

/* ---------- trend ---------- */
function renderTrend(){
  const svg=$("trend"); svg.textContent="";
  const W=900,H=300,ml=54,mr=18,mt=16,mb=44;
  const pts=rows.map(p=>({p,v:ratioOf(p),r:rateFor(p)})).filter(o=>o.v!=null);
  if(pts.length<2){$("trendCap").textContent="Not enough periods yet.";return;}
  // ASP/CAC lives in 0–2 in any normal week; a launch spike (Feb 9 hit 3.8x) would
  // otherwise flatten every other point into unreadability. Clamp and flag instead.
  const raw=pts.map(o=>o.v);
  const CEIL=2.0;
  const hi=Math.max(1.15, Math.min(Math.max(...raw)*1.06, CEIL));
  const lo=Math.max(0, Math.min(...raw, .9)*.92);
  const over=pts.filter(o=>o.v>hi).length;
  const x=i=>ml+(i/(pts.length-1))*(W-ml-mr);
  const yv=v=>mt+(1-(Math.min(v,hi)-lo)/(hi-lo))*(H-mt-mb);
  const y=yv;

  // gridlines
  const ticks=4;
  for(let i=0;i<=ticks;i++){
    const v=lo+(hi-lo)*i/ticks;
    svg.appendChild(el("line",{x1:ml,x2:W-mr,y1:y(v),y2:y(v),stroke:"var(--rule-2)","stroke-width":1}));
    const t=el("text",{x:ml-10,y:y(v)+4,"text-anchor":"end","font-size":11,fill:"var(--ink-3)",
      "font-family":"var(--mono)"}); t.textContent=ratio(v)+"×"; svg.appendChild(t);
  }
  // breakeven
  svg.appendChild(el("line",{x1:ml,x2:W-mr,y1:y(1),y2:y(1),stroke:"var(--ink-2)",
    "stroke-width":1.5,"stroke-dasharray":"5 4"}));
  const bl=el("text",{x:W-mr,y:y(1)-8,"text-anchor":"end","font-size":11,fill:"var(--ink-2)",
    "font-family":"var(--mono)"}); bl.textContent="1.0× breakeven"; svg.appendChild(bl);

  // x labels: place right-to-left from the newest, skipping any that would collide
  let lastL=Infinity;
  for(let i=pts.length-1;i>=0;i--){
    const lab=pts[i].p.label, wpx=lab.length*6.4+16;
    const cx=x(i);
    if(cx+wpx/2>lastL) continue;
    lastL=cx-wpx/2;
    const t=el("text",{x:cx,y:H-mb+20,"text-anchor":"middle","font-size":10.5,
      fill:"var(--ink-3)","font-family":"var(--mono)"}); t.textContent=lab; svg.appendChild(t);
  }

  // split the line: matured periods use their own actual rate, young ones the planned one.
  // Drawn as two strokes so the eye can see where measurement stops and assumption starts.
  const segs=[];let curk=null;
  pts.forEach((o,i)=>{const k=refundsOn?o.r.kind:"gross";
    if(k!==curk){segs.push({kind:k,pts:[]});curk=k;}
    const s=segs[segs.length-1];
    if(s.pts.length===0&&segs.length>1){const prev=pts[i-1];segs[segs.length-2].pts.push({i:i-1,v:prev.v});s.pts.push({i:i-1,v:prev.v});}
    s.pts.push({i,v:o.v});});
  segs.forEach(s=>{
    if(s.pts.length<2) return;
    const dd=s.pts.map((q,j)=>(j?"L":"M")+x(q.i)+","+y(q.v)).join(" ");
    svg.appendChild(el("path",{d:dd,fill:"none",stroke:"var(--measured)","stroke-width":2.5,
      "stroke-linejoin":"round","stroke-linecap":"round",
      "stroke-dasharray": s.kind==="planned"?"7 5":"none",
      opacity: s.kind==="planned"?.75:1}));
  });
  // markers + hover
  pts.forEach((o,i)=>{
    const isActual=refundsOn&&o.r.kind==="actual";
    if(o.v>hi){   // pinned at the ceiling, drawn as a caret so it reads as "off the chart"
      svg.appendChild(el("path",{d:"M"+(x(i)-6)+","+(yv(hi)+7)+" L"+x(i)+","+(yv(hi)-1)
        +" L"+(x(i)+6)+","+(yv(hi)+7)+" Z",fill:"var(--measured)"}));
      const ot=el("text",{x:x(i),y:yv(hi)-7,"text-anchor":"middle","font-size":10,
        fill:"var(--measured)","font-family":"var(--mono)","font-weight":600});
      ot.textContent=ratio(o.v)+"×"; svg.appendChild(ot);
      return;
    }
    svg.appendChild(el("circle",{cx:x(i),cy:y(o.v),r:o.p===cur?6:4,
      fill: isActual||!refundsOn?"var(--measured)":"var(--card)",
      stroke:"var(--measured)","stroke-width":2}));
    if(o.p===cur) svg.appendChild(el("circle",{cx:x(i),cy:y(o.v),r:10,fill:"none",
      stroke:"var(--measured)","stroke-width":1.5,opacity:.4}));
    const hit=el("rect",{x:x(i)-((W-ml-mr)/pts.length)/2,y:mt,
      width:(W-ml-mr)/pts.length,height:H-mt-mb,fill:"transparent",style:"cursor:pointer"});
    hit.dataset.tip=o.p.label+" · "+ratio(o.v)+"× · CAC "+money(calc(o.p).cac)
      +(refundsOn?" · refunds "+pct(o.r.rate)+" ("+o.r.label+")":" · refunds off");
    hit.addEventListener("click",()=>{cur=o.p;$("period").value=o.p.start;render();});
    svg.appendChild(hit);
  });

  const nAct=pts.filter(o=>o.r.kind==="actual").length;
  $("trendLegend").innerHTML = refundsOn
    ? '<span><i class="sw2" style="background:var(--measured)"></i>Solid — actual refund rate '
      +'(period matured past week '+D.refund_curve.maturity_weeks+')</span>'
      +'<span><i class="sw2" style="background:var(--measured);opacity:.5"></i>Dashed — planned rate '
      +'(refunds still arriving)</span>'
    : '<span><i class="sw2" style="background:var(--measured)"></i>No refunds applied</span>';
  $("trendSub").textContent = (refundsOn
    ? nAct+" of "+pts.length+" periods have matured and use their own measured refunds"
    : "Refunds switched off")
    + (over? " · "+over+" period"+(over>1?"s":"")+" above "+ratio(hi)+"× pinned to the top" : "");
  $("trendCap").innerHTML = refundsOn
    ? "Where the line is <b>solid</b>, the refund rate is that period's own measured experience. "
      +"Where it is <b>dashed</b>, refunds are still arriving and the planned rate stands in — so "
      +"the right-hand end of this chart is the part most likely to move."
      +(over? " The axis is capped at "+ratio(hi)+"×; "+over+" launch-scale period"+(over>1?"s sit":" sits")
        +" above it, marked with a caret and its true value — uncapped, one spike would flatten "
        +"everything else into a straight line." : "")
    : "Refunds are switched off, so every point is gross ASP over CAC — the ceiling, not the outcome.";
}

/* ---------- what changed ---------- */
function renderChanged(p,k){
  const i=rows.indexOf(p), prev=i>0?rows[i-1]:null;
  const pk=prev?calc(prev):null;
  const cells=[
    {lab:"ASP / CAC", v:k.aspCac!=null?ratio(k.aspCac)+"×":"—", p:pk?pk.aspCac:null, c:k.aspCac, f:v=>ratio(v)+"×", good:1},
    {lab:"CAC",       v:k.cac?money2(k.cac):"—", p:pk?pk.cac:null, c:k.cac, f:money, good:-1},
    {lab:"New customers", v:grp(k.nc), p:pk?pk.nc:null, c:k.nc, f:grp, good:1},
    {lab:"Ad spend",  v:money(k.ads), p:pk?pk.ads:null, c:k.ads, f:money, good:0},
    {lab:"Gross bookings", v:money(k.gross), p:pk?pk.gross:null, c:k.gross, f:money, good:1},
  ];
  $("chg").innerHTML=cells.map(x=>{
    let d="";
    if(x.p!=null&&x.c!=null&&x.p!==0){
      const diff=x.c-x.p, pctd=diff/Math.abs(x.p)*100;
      const dir=diff>=0?1:-1;
      const cls= x.good===0?"":(dir*x.good>0?"up":"down");
      d='<div class="chg-d '+cls+'">'+(diff>=0?"+":"−")+x.f(Math.abs(diff))
        +" ("+(pctd>=0?"+":"−")+Math.abs(pctd).toFixed(1)+"%)</div>";
    }
    return '<div class="chg-cell"><div class="chg-lab">'+x.lab+'</div>'
      +'<div class="chg-val">'+x.v+'</div>'+d+'</div>';
  }).join("");
  $("chgSub").textContent = prev? "versus "+prev.label : "no earlier period to compare";
}

/* ---------- CAC build + LTV ---------- */
function renderBuild(p,k){
  $("cacHead").textContent=money(k.total)+" ÷ "+grp(k.nc)+" new customers = "+money2(k.cac);
  const parts=[{lab:"Ad platforms (measured)",v:k.ads,col:"var(--measured)"},
               {lab:"Retainers (accrued)",v:k.retainers,col:"var(--accrued)"},
               {lab:"Variable (assumed timing)",v:k.variable,col:"var(--assumed)"}].filter(x=>x.v>0);
  const bar=$("build"),leg=$("buildLeg");bar.textContent="";leg.textContent="";
  parts.forEach(x=>{
    const pc=x.v/k.total*100;
    const dv=document.createElement("div");dv.className="bseg";dv.style.flex=pc;
    dv.style.background=x.col;dv.textContent=pc>=11?Math.round(pc)+"%":"";
    dv.dataset.tip=x.lab+" — "+money(x.v)+" ("+pc.toFixed(1)+"%)";bar.appendChild(dv);
    const s=document.createElement("span");
    s.innerHTML='<i class="sw2" style="background:'+x.col+'"></i>'+x.lab+" "+money(x.v);
    leg.appendChild(s);
  });
  const tw=p.triple_whale_cross_check;
  $("cacWarn").innerHTML = tw.custom_spend_suspected
    ? '<div class="callout bad"><b>Possible double count.</b> Triple Whale reports blended ad spend of '
      +money(tw.blendedAds)+", "+money(tw.unrecognised_blended_delta)
      +" more than the channels we recognise. Someone may have loaded Custom Spend (retainers) "
      +"into Triple Whale — those would be counted twice.</div>"
    : '<div class="callout info">Cross-check: Triple Whale blended ad spend '+money(tw.blendedAds)
      +" matches the channels above, so no Custom Spend is loaded there and retainers are not "
      +"double counted. Their own new-customer CPA ("+money(tw.tw_ncpa_do_not_use||0)
      +") is ad-spend-only and is deliberately not used.</div>";

  const eff=cfg.cost_table_effective_from||"2026-08-01";
  const retNow=lines().filter(l=>l.kind==="retainer").reduce((s,l)=>s+monthly(l),0);
  $("costBasis").innerHTML = p.start<eff
    ? '<div class="callout"><b>Approximate cost basis.</b> This period starts before '+eff
      +", when the current cost table took effect. The earlier structure carried $67,069/mo of "
      +"retainers against "+money(retNow)+"/mo now, so the accrued half of CAC here is not what "
      +"was actually contracted. Ad spend is still measured and exact.</div>" : "";

  // LTV — the modelled share is drawn hatched so the eye sees it before reading
  const lr=k.ltvCac;
  $("ltvRatio").textContent= lr==null?"—":ratio(lr);
  if(lr!=null){const s=document.createElement("small");s.textContent="×";
    s.style.fontSize="20px";$("ltvRatio").appendChild(s);}
  $("ltvRatio").className="big mono "+(lr>=1?"over":"under");
  const pos=v=>Math.max(0,Math.min(100,v/4*100));
  const measuredPart = k.cac? (k.asp/k.cac) : 0;
  $("lFill").style.width=pos(measuredPart)+"%";
  $("lFill").className="fill"+(lr<1?" under":"");
  const h=$("lHatch");
  h.style.left=pos(measuredPart)+"%";
  h.style.width=Math.max(0,pos(lr||0)-pos(measuredPart))+"%";
  h.style.background="repeating-linear-gradient(45deg,var(--assumed) 0 3px,transparent 3px 7px)";
  h.style.opacity=".85";
  h.dataset.tip="Modelled portion — "+money(k.ltv-k.asp)+" of assumed lifetime value";
  $("lMark").style.left="calc("+pos(lr||0)+"% - 2px)";
  $("lThresh").style.left=pos(1)+"%";
  $("lGhost3").style.left=pos(3)+"%";
  $("ltvVal").textContent= k.ltv!=null?money(k.ltv):"—";
  $("ltvNote").innerHTML=money(k.asp)+" first order <span class='tag m'>measured</span> + "
    +money(k.consum+(+k.L.repeat_hardware))+" modelled <span class='tag a'>assumed</span>";
  const share=k.ltv?((k.ltv-k.asp)/k.ltv*100):0;
  $("ltvWarn").innerHTML="<b>"+share.toFixed(0)+"% of this LTV is assumption</b> — the hatched part "
    +"of the bar. The 3.0× mark is the convention for gross-margin LTV, not revenue LTV, so it is "
    +"shown for reference only and is not a like-for-like target.";
  $("ltvMath").innerHTML="<b>Modelled, not measured.</b> LTV = first order ("+money(k.asp)
    +(refundsOn?", net of "+pct(k.r.rate)+" refunds":", refunds off")+") + consumables ($"
    +k.L.consumables_per_month+"/mo × "+k.L.active_months+" mo × "+k.L.attach_rate_pct
    +"% attach = "+money(k.consum)+")"
    +((+k.L.repeat_hardware)>0?" + repeat hardware ("+money(+k.L.repeat_hardware)+")":"")
    +" = "+money(k.ltv)+" per customer. No cohort LTV exists yet; these four inputs were chosen, "
    +"not observed.";
}

/* ---------- cost table ---------- */
function renderCosts(p,k){
  const tb=$("costs").querySelector("tbody");tb.textContent="";
  const wt = p.period_type==="month" ? 1 : ACCR[accrual];
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  $("thPeriod").textContent = p.period_type==="month"?"This month":"This week";
  lines().forEach(l=>{
    const isAd=l.kind==="ad", isNew=ST.added.some(a=>a.id===l.id);
    const wv= isAd ? (p.measured.ad_spend_by_line[l.id]??null) : monthly(l)*wt;
    const tr=document.createElement("tr");
    tr.innerHTML=
      '<td><input class="nm" type="text" value="'+esc(l.name)+'" data-id="'+l.id+'" '
        +(isNew?'':'readonly title="Rename committed lines in config.json — the id joins to Triple Whale spend"')+'></td>'
      +'<td><select class="kd" data-id="'+l.id+'">'
        +[["ad","measured (ad)"],["retainer","accrued (retainer)"],["variable","assumed (variable)"]]
          .map(([kk,lab])=>'<option value="'+kk+'"'+(kk===l.kind?" selected":"")+">"+lab+"</option>").join("")
        +'</select></td>'
      +'<td class="r"><input class="amt" type="text" inputmode="numeric" value="'+grp(monthly(l))+'" data-id="'+l.id+'"></td>'
      +'<td class="r mono">'+(wv==null?'<span style="color:var(--ink-3)">n/a</span>':money2(wv))+'</td>'
      +'<td class="r"><button class="del" data-id="'+l.id+'" title="Remove line">&times;</button></td>';
    tb.appendChild(tr);
  });
  tb.querySelectorAll("input.amt").forEach(i=>{
    i.addEventListener("focus",e=>{e.target.value=String(+String(e.target.value).replace(/[^0-9.-]/g,"")||0);});
    i.addEventListener("input",e=>{
      ST.amounts[e.target.dataset.id]=+String(e.target.value).replace(/[^0-9.-]/g,"")||0;
      dirty=true;persist();
      // live impact: recompute without losing focus
      const nk=calc(cur);
      $("impact").className="impact on";
      $("impact").innerHTML="CAC <b>"+money2(baselineCac)+" → "+money2(nk.cac)+"</b>  ·  ASP/CAC <b>"
        +ratio(nk.aspCac)+"×</b>";
      renderHero(cur,nk);renderTrend();renderChanged(cur,nk);renderBuild(cur,nk);
      const mt=lines().reduce((s,l)=>s+monthly(l),0);
      $("costs").querySelector("tfoot").innerHTML='<tr><td>Total</td><td></td><td class="r mono">'
        +money(mt)+'</td><td class="r mono">'+money2(nk.total)+'</td><td></td></tr>';
      shareState();
    });
    i.addEventListener("blur",e=>{e.target.value=grp(+String(e.target.value).replace(/[^0-9.-]/g,"")||0);});
  });
  tb.querySelectorAll("input.nm:not([readonly])").forEach(i=>i.addEventListener("input",e=>{
    const a=ST.added.find(x=>x.id===e.target.dataset.id);
    if(a){a.name=e.target.value;dirty=true;persist();shareState();}}));
  tb.querySelectorAll("select.kd").forEach(s=>s.addEventListener("change",e=>{
    const id=e.target.dataset.id,kk=e.target.value;
    const a=ST.added.find(x=>x.id===id);
    if(a) a.kind=kk;
    else{const base=cfg.cost_lines.find(x=>x.id===id);
      if(base){ST.removed.push(id);
        ST.added.push(Object.assign({},base,{kind:kk,monthly:monthly(base),
          tw_metric:kk==="ad"?base.tw_metric:null,_from:id}));}}
    touch();}));
  tb.querySelectorAll("button.del").forEach(b=>b.addEventListener("click",e=>{
    const id=e.target.dataset.id, ai=ST.added.findIndex(x=>x.id===id);
    if(ai>=0) ST.added.splice(ai,1); else if(!ST.removed.includes(id)) ST.removed.push(id);
    delete ST.amounts[id];touch();}));

  const mt=lines().reduce((s,l)=>s+monthly(l),0);
  $("costs").querySelector("tfoot").innerHTML='<tr><td>Total</td><td></td><td class="r mono">'
    +money(mt)+'</td><td class="r mono">'+money2(k.total)+'</td><td></td></tr>';
  $("costNote").innerHTML="Ad rows show <b>measured</b> spend from Triple Whale; their monthly "
    +"figures are budget only and do not feed CAC. "
    +(p.period_type==="month"
      ? "In the month view a monthly retainer simply applies once, so there is <b>no accrual "
        +"assumption at all</b> — the accrual selector only affects the week view."
      : "Retainers are accrued at <b>"+$("accrual").selectedOptions[0].textContent+"</b>. "
        +"Variable lines are real budget whose weekly split is an assumption about when lumpy "
        +"spend lands, so they are flagged assumed, not accrued.")
    +(cfg.notes_to_resolve?"<br><br>"+cfg.notes_to_resolve.map(n=>"· "+n).join("<br>"):"");
}

/* ---------- maturity curve ---------- */
function renderCurve(p){
  const cv=D.refund_curve,svg=$("curve");svg.textContent="";
  if(!cv)return;
  const W=860,H=250,ml=52,mr=18,mt=16,mb=40;
  const n=cv.pct_of_eventual_visible.length;
  const x=i=>ml+(i/(n-1))*(W-ml-mr), y=v=>mt+(1-v/100)*(H-mt-mb);
  [0,25,50,75,100].forEach(v=>{
    svg.appendChild(el("line",{x1:ml,x2:W-mr,y1:y(v),y2:y(v),stroke:"var(--rule-2)","stroke-width":1}));
    const t=el("text",{x:ml-10,y:y(v)+4,"text-anchor":"end","font-size":11,fill:"var(--ink-3)",
      "font-family":"var(--mono)"});t.textContent=v+"%";svg.appendChild(t);});
  [0,4,8,12,16].filter(i=>i<n).forEach(i=>{
    const t=el("text",{x:x(i),y:H-mb+20,"text-anchor":"middle","font-size":11,fill:"var(--ink-3)",
      "font-family":"var(--mono)"});t.textContent="wk "+i;svg.appendChild(t);});
  let dA="M"+x(0)+","+y(0),dL="";
  cv.pct_of_eventual_visible.forEach((v,i)=>{dA+=" L"+x(i)+","+y(v);dL+=(i?" L":"M")+x(i)+","+y(v);});
  dA+=" L"+x(n-1)+","+y(0)+" Z";
  svg.appendChild(el("path",{d:dA,fill:"var(--measured)","fill-opacity":.13}));
  svg.appendChild(el("path",{d:dL,fill:"none",stroke:"var(--measured)","stroke-width":2.5,
    "stroke-linejoin":"round"}));
  const age=Math.min(Math.max(p.age_weeks,0),n-1),vis=cv.pct_of_eventual_visible[age];
  svg.appendChild(el("line",{x1:x(age),x2:x(age),y1:mt,y2:H-mb,stroke:"var(--alert)",
    "stroke-width":2,"stroke-dasharray":"4 4"}));
  svg.appendChild(el("circle",{cx:x(age),cy:y(vis),r:6,fill:"var(--alert)",stroke:"var(--card)",
    "stroke-width":2.5}));
  const t=el("text",{x:Math.min(x(age)+12,W-mr-150),y:y(vis)-12,"font-size":12,fill:"var(--alert)",
    "font-family":"var(--mono)","font-weight":600});
  t.textContent="this period: "+vis.toFixed(0)+"% arrived";svg.appendChild(t);
  cv.pct_of_eventual_visible.forEach((v,i)=>{
    const hit=el("rect",{x:x(i)-((W-ml-mr)/n)/2,y:mt,width:(W-ml-mr)/n,height:H-mt-mb,fill:"transparent"});
    hit.dataset.tip="week "+i+": "+v.toFixed(1)+"% of eventual refunds booked ("
      +cv.cum_pct_of_gross[i].toFixed(2)+"% of gross)";svg.appendChild(hit);});
  const mature=p.refund_actual.is_mature;
  $("curveCap").innerHTML="<b>Share of a cohort's eventual refunds already booked, by weeks since "
    +"order.</b> Measured from "+cv.cohorts+" cohorts ("+cv.range[0]+" – "+cv.range[1]+", "
    +money(cv.gross)+" gross), which finally refund <b>"+pct(cv.final_rate_pct)+" of gross</b>. "
    +(mature
      ? "This period has passed week "+cv.maturity_weeks+", so its refunds are effectively complete "
        +"and the dashboard uses <b>its own measured rate of "+pct(p.refund_actual.booked_pct)+"</b>."
      : "This period is only "+vis.toFixed(0)+"% of the way there, so its own rate ("
        +pct(p.refund_actual.booked_pct||0)+" so far) is not yet meaningful and the planned "
        +"assumption stands in.");
}

/* ---------- history ---------- */
function renderHist(){
  const H=cfg.historical_cac_constants,tb=$("hist").querySelector("tbody");tb.textContent="";
  const shop=D.shopify_monthly_new_customers||{};
  H.months.forEach(m=>{
    const sc=shop[m.month];
    const tr=document.createElement("tr");
    tr.innerHTML="<td>"+m.month+'</td><td class="r mono">'+money(m.spend)+'</td><td class="r mono">'
      +grp(m.new_customers)+'</td><td class="r mono v-m">'+money2(m.cac)+'</td><td class="r mono">'
      +(sc?grp(sc):"—")+'</td><td class="r mono v-a">'+(sc?money2(m.spend/sc):"—")+"</td>";
    tb.appendChild(tr);});
  $("discont").innerHTML="<b>Intentional discontinuity.</b> The frozen CAC column uses the budget "
    +"sheet's own new-customer counts, which no automated source reproduces. Shopify's first-time-"
    +"purchaser counts run higher every month (January by about 50%), so the same spend on the "
    +"Shopify basis gives a materially lower CAC. Periods from August 2026 onward use the Shopify "
    +"basis. The two columns are not comparable and the break is deliberate.";
}

/* ---------- share/save ---------- */
function shareState(){
  const n=changeCount();
  $("saveCfg").className=dirty?"dirty":"";
  $("saveCfg").textContent=dirty?"Save changes •":"Save changes";
  $("saveState").innerHTML=dirty?'<span style="color:var(--assumed);font-weight:600">unsaved</span>'
    :(savedAt?"saved "+new Date(savedAt).toLocaleString():"no changes");
  $("shareState").innerHTML='<div class="callout"><b>Saving writes to this browser and hands you a '
    +'config.json.</b> '+(n?n+" change"+(n>1?"s":"")+" from the committed config. ":"No changes yet. ")
    +"Save keeps your work locally and downloads <code>config.json</code> (also copied to the "
    +"clipboard) — commit that file, or paste it into the shared cost sheet, and the change becomes "
    +"visible to Clayton, versioned, and safe from a cleared browser. Until then it lives only here, "
    +"and whoever commits last wins. Anyone can edit it afterwards.</div>";
}

/* ---------- health + sticky ---------- */
function renderHealth(p){
  const h=D.health,s=[];
  const tw=h.sources.triple_whale||{ok:0,fail:0};
  s.push('<span class="pill"><i class="led'+(tw.fail?" bad":"")+'"></i>Triple Whale '+tw.ok+" ok"
    +(tw.fail?" · "+tw.fail+" failed":"")+"</span>");
  s.push('<span class="pill"><i class="led"></i>Shopify '+grp((h.sources.shopify||{}).orders||0)+" orders</span>");
  const days=Math.round((Date.now()-new Date(h.generated_at+"T12:00:00Z").getTime())/864e5);
  $("health").className="health"+(days>9?" stale":"");
  $("health").innerHTML='<span>Last pull <b>'+h.generated_at+"</b>"+(days>0?" · "+days+"d ago":" · today")
    +"</span>"+s.join("")+'<span style="color:var(--ink-3)">'+p.label+" · age "+p.age_weeks+"w</span>"
    +(days>9?'<span style="color:var(--alert);font-weight:600">STALE — pipeline may be broken</span>':"");
}

/* ---------- master render ---------- */
function render(){
  const p=rows.find(x=>x.start===(cur&&cur.start))||cur||rows[rows.length-1];
  cur=p; if(!p) return;
  const k=calc(p);
  if(!dirty) baselineCac=k.cac;
  renderHero(p,k); renderTrend(); renderChanged(p,k); renderBuild(p,k);
  renderCosts(p,k); renderCurve(p); renderHealth(p); shareState();
  $("skPeriod").textContent=p.label;
  $("skAsp").textContent=k.aspCac!=null?ratio(k.aspCac)+"×":"—";
  $("skCac").textContent=k.cac?money2(k.cac):"—";
  $("skRef").textContent=refundsOn?pct(k.r.rate)+" ("+k.r.label+")":"off";
}

/* ---------- tooltip + sticky ---------- */
const tip=$("tip");
document.addEventListener("mouseover",e=>{const t=e.target.closest&&e.target.closest("[data-tip]");
  if(t){tip.textContent=t.dataset.tip;tip.style.opacity=1;}});
document.addEventListener("mousemove",e=>{if(tip.style.opacity==1){
  tip.style.left=Math.min(e.clientX+14,innerWidth-tip.offsetWidth-10)+"px";
  tip.style.top=(e.clientY-34)+"px";}});
document.addEventListener("mouseout",e=>{if(e.target.closest&&e.target.closest("[data-tip]"))tip.style.opacity=0;});
addEventListener("scroll",()=>{$("sticky").className="sticky"+(scrollY>320?" on":"");});

/* ---------- init ---------- */
function fillPeriods(){
  rows=(D.periods&&D.periods[periodType])||D.weeks||[];
  const sel=$("period");sel.textContent="";
  rows.slice().reverse().forEach(p=>{const o=document.createElement("option");
    o.value=p.start;o.textContent=p.label+"  ("+p.start+" → "+p.end+")";sel.appendChild(o);});
  cur=rows[rows.length-1];
  if(cur) sel.value=cur.start;
}

async function init(){
  loadState();
  try{ D=await (await fetch("data/latest.json",{cache:"no-store"})).json(); }
  catch(e){ document.querySelector(".wrap").insertAdjacentHTML("afterbegin",
    '<div class="callout bad"><b>No data yet.</b> Run <code>python3 pipeline.py</code>, serve the '
    +'folder (<code>python3 -m http.server 8777</code>) and reload.</div>'); return; }
  cfg=D.config;
  if(ST.ltv) Object.assign(cfg.ltv_assumptions,ST.ltv);
  accrual=accrual||cfg.accrual.method; $("accrual").value=accrual;
  basisKey=basisKey||cfg.refund_bases.default;

  [...$("periodType").querySelectorAll("button")].forEach(b=>{
    b.setAttribute("aria-pressed", String(b.dataset.k===periodType));
    b.addEventListener("click",()=>{
      periodType=b.dataset.k;persist();
      [...$("periodType").querySelectorAll("button")].forEach(x=>
        x.setAttribute("aria-pressed",String(x.dataset.k===periodType)));
      fillPeriods();render();});
  });

  fillPeriods();
  const avail=(rows[rows.length-1]||{}).refund_bases_available||{};
  const bs=$("basis");
  ["target","planning","bad","measured"].filter(kk=>avail[kk]).forEach(kk=>{
    const o=document.createElement("option");o.value=kk;
    o.textContent=avail[kk].label+" — "+pct(avail[kk].rate_pct)
      +(kk===cfg.refund_bases.default?" (default)":"")+(kk==="measured"?" · from cohorts":"");
    bs.appendChild(o);});
  bs.value=basisKey;

  const keys=["consumables_per_month","active_months","attach_rate_pct","repeat_hardware"];
  ["consum","months","attach","repeat"].forEach((id,i)=>{
    $(id).value=cfg.ltv_assumptions[keys[i]];
    $(id).addEventListener("input",e=>{
      cfg.ltv_assumptions[keys[i]]=e.target.value===""?0:+e.target.value;
      ST.ltv[keys[i]]=cfg.ltv_assumptions[keys[i]];touch();});});

  $("period").addEventListener("change",e=>{cur=rows.find(p=>p.start===e.target.value);render();});
  bs.addEventListener("change",e=>{basisKey=e.target.value;persist();render();});
  $("accrual").addEventListener("change",e=>{accrual=e.target.value;persist();render();});
  $("theme").addEventListener("click",()=>{
    const dk=document.documentElement.getAttribute("data-theme")==="dark";
    document.documentElement.setAttribute("data-theme",dk?"light":"dark");render();});
  $("addLine").addEventListener("click",()=>{
    ST.added.push({id:"custom_"+Date.now().toString(36),name:"New line item",kind:"retainer",
      monthly:0,tw_metric:null,effective_from:null,effective_to:null,_added_locally:true});
    touch();
    setTimeout(()=>{const f=document.querySelectorAll("#costs input.nm:not([readonly])");
      if(f.length){const l=f[f.length-1];l.focus();l.select();}},0);});
  $("saveCfg").addEventListener("click",()=>{
    const txt=JSON.stringify(effectiveConfig(),null,2);
    savedAt=new Date().toISOString();dirty=false;persist();
    if(navigator.clipboard) navigator.clipboard.writeText(txt).catch(()=>{});
    try{const a=document.createElement("a");
      a.href=URL.createObjectURL(new Blob([txt],{type:"application/json"}));
      a.download="config.json";document.body.appendChild(a);a.click();a.remove();}catch(e){}
    $("impact").className="impact";render();});
  $("revert").addEventListener("click",()=>{
    if(!confirm("Discard local changes and go back to the committed config.json?"))return;
    ST={amounts:{},added:[],removed:[],ltv:{}};dirty=false;savedAt=null;persist();location.reload();});

  renderHist(); render();
}
init();
})();
