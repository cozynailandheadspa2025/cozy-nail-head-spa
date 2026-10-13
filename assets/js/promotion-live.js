/* Cozy Promotion Manager — Google Sheets (published CSV + Google Visualization fallback)
   To update promotions, edit column B of the Promotion tab in Google Sheets.
   Never put private client/business information in the published tab.
*/
(()=>{
  'use strict';
  // User-provided published CSV. Public promotional content only.
  const SHEET_CSV_URL='https://docs.google.com/spreadsheets/d/e/2PACX-1vQLARtPKeTyzNVa6AZYEz7fEQKXh7g3girHMIgLCOVwlDP2Z9upJYnXCcZxXTcmKyDA8scv2JTRscGA/pub?gid=579929338&single=true&output=csv';
  // Fallback for browsers that cannot fetch Google Sheets CSV due to CORS.
  const SHEET_DOCUMENT_ID='1ilG8zh8cZuQjUmeR9nS5A2x396pga0tTlLzw6ZdF09o';
  const SHEET_GID='579929338';
  const BOOKING_URL='https://booking.gocheckin.net/v2/16063';

  const elem=(tag,cl,txt)=>{
    const e=document.createElement(tag);if(cl)e.className=cl;if(txt!==undefined)e.textContent=txt;return e;
  };
  const clean=v=>v==null?'':String(v).trim();
  function csvRows(csv){
    const rows=[];let cell='',row=[],quoted=false;
    csv=String(csv).replace(/^\uFEFF/,'');
    for(let i=0;i<csv.length;i++){
      const c=csv[i];
      if(quoted){
        if(c==='"'&&csv[i+1]==='"'){cell+='"';i++}
        else if(c==='"')quoted=false;
        else cell+=c;
      }else if(c==='"')quoted=true;
      else if(c===','){row.push(cell);cell='';}
      else if(c==='\r'||c==='\n'){
        if(c==='\r'&&csv[i+1]==='\n')i++;
        row.push(cell);rows.push(row);row=[];cell='';
      }else cell+=c;
    }
    if(cell||row.length){row.push(cell);rows.push(row)}
    return rows;
  }
  function getPublishedCsv(){
    // Browser fetch can fail due to Google's cross-origin restrictions;
    // in that case try Google Visualization JSONP, without third-party proxies.
    const u=new URL(SHEET_CSV_URL);
    u.searchParams.set('_cozy_cache',String(Math.floor(Date.now()/300000)));
    return fetch(u.href,{mode:'cors',cache:'no-store',credentials:'omit'})
      .then(r=>{if(!r.ok)throw Error('CSV HTTP '+r.status);return r.text()})
      .then(t=>{if(/^\s*<!doctype html|^\s*<html/i.test(t))throw Error('Unexpected HTML instead of CSV');return csvRows(t)});
  }
  function getPublishedGviz(){
    return new Promise((resolve,reject)=>{
      const callbackName='cozySheetCb_'+Math.round(Math.random()*1e9);
      const u=new URL('https://docs.google.com/spreadsheets/d/'+SHEET_DOCUMENT_ID+'/gviz/tq');
      u.searchParams.set('gid',SHEET_GID);
      u.searchParams.set('headers','1');
      u.searchParams.set('tqx','out:json;responseHandler:'+callbackName);
      u.searchParams.set('_cozy_cache',String(Math.floor(Date.now()/300000)));
      const script=document.createElement('script');script.async=true;
      let finished=false;
      const timer=setTimeout(()=>finish(Error('Google Visualization timeout')),9000);
      function finish(error,rows){
        if(finished)return;finished=true;clearTimeout(timer);
        script.remove();try{delete window[callbackName]}catch(_){window[callbackName]=undefined}
        error?reject(error):resolve(rows);
      }
      window[callbackName]=(response)=>{
        if(!response||response.status!=='ok'||!response.table?.rows){finish(Error('Google Visualization response error'));return}
        const rows=response.table.rows.map(r=>(r.c||[]).map(c=>{
          if(!c)return '';
          if(c.v instanceof Date){
            return [c.v.getFullYear(),String(c.v.getMonth()+1).padStart(2,'0'),String(c.v.getDate()).padStart(2,'0')].join('-');
          }
          return clean(c.v??c.f);
        }));
        finish(null,rows);
      };
      script.onerror=()=>finish(Error('Google Visualization not accessible'));
      script.src=u.href;document.head.append(script);
    });
  }
  async function loadSettings(){
    // Both paths access exactly the same published user sheet.
    let rows;
    try{rows=await Promise.any([getPublishedCsv(),getPublishedGviz()])}
    catch(error){console.warn('Cozy Promotion: Google Sheets is unreachable; promotion hidden.',error);return null}
    const values=Object.create(null);
    rows.forEach(r=>{const key=clean(r[0]);if(!key||/^key\s*\(/i.test(key))return;values[key]=clean(r[1])});
    return values;
  }
  function texasToday(){
    const parts=new Intl.DateTimeFormat('en-US',{
      timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(new Date());
    const val=k=>parts.find(p=>p.type===k)?.value||'';
    return `${val('year')}-${val('month')}-${val('day')}`;
  }
  const yes=x=>/^(yes|true|1|on)$/i.test(clean(x));
  function dateVal(x){
    x=clean(x);
    if(!x)return '';
    if(/^\d{4}-\d{2}-\d{2}$/.test(x))return x;
    const m=x.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(m)return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    return null; // Misformatted dates must not cause a stale promotion to linger.
  }
  function safeUrl(raw,fallback){
    try{
      const u=new URL(clean(raw)||fallback,document.baseURI);
      if(u.protocol!=='https:'&&u.origin!==location.origin)return fallback;
      if(!['https:','http:'].includes(u.protocol))return fallback;
      return u.href;
    }catch(_){return fallback}
  }
  function getStored(key){try{return localStorage.getItem(key)}catch(_){return null}}
  function setStored(key,v){try{localStorage.setItem(key,v)}catch(_){}}
  function show(values){
    if(!values||!yes(values.enabled))return;
    const start=dateVal(values.start_date),end=dateVal(values.end_date),today=texasToday();
    if(start===null||end===null)return;
    if(start&&today<start)return;
    if(end&&today>end)return;
    if(start&&end&&start>end)return;
    const barActive=yes(values.show_bar),popupActive=yes(values.show_popup);
    if(!barActive&&!popupActive)return;
    const campaign=clean(values.promotion_id||'cozy-default').slice(0,60).replace(/[^a-zA-Z0-9_-]/g,'_');
    const storageKey='cozy-promo-dismissed-'+campaign;
    const cooldown=Math.max(1,Math.min(90,Number(values.popup_cooldown_days)||7));
    const bookingUrl=safeUrl(values.button_url,BOOKING_URL);
    const imageUrl=safeUrl(values.image_url,'assets/images/head-spa-shampoo-2026.webp');
    let shade,panel,previousFocus;
    function closePopup(){
      if(!shade)return;shade.hidden=true;
      document.body.classList.remove('cozy-promo-locked');
      setStored(storageKey,String(Date.now()));
      previousFocus?.focus?.({preventScroll:true});
    }
    function openPopup(){
      if(!popupActive||!shade)return;
      previousFocus=document.activeElement;
      shade.hidden=false;document.body.classList.add('cozy-promo-locked');
      panel.querySelector('.cozy-promo-x').focus();
    }
    if(barActive){
      const bar=elem('div','cozy-promo-bar');
      bar.setAttribute('aria-label','Current Cozy salon promotion');
      const inner=elem('div','cozy-promo-bar-inner');
      const sparkle=elem('span','cozy-promo-spark','✦');sparkle.setAttribute('aria-hidden','true');
      inner.append(sparkle);
      inner.append(elem('span','cozy-promo-bar-msg',values.banner_text||'Special offers at Cozy Nail & Head Spa'));
      const open=elem(popupActive?'button':'a','cozy-promo-bar-cta',popupActive?'View offer ↗':'Book now ↗');
      if(popupActive){open.type='button';open.addEventListener('click',openPopup)}
      else{open.href=bookingUrl;open.target='_blank';open.rel='noopener noreferrer'}
      inner.append(open);bar.append(inner);
      const dismiss=elem('button','cozy-promo-bar-close','×');dismiss.type='button';
      dismiss.setAttribute('aria-label','Hide announcement');dismiss.addEventListener('click',()=>bar.remove());bar.append(dismiss);
      document.body.insertBefore(bar,document.querySelector('.topline')||document.body.firstChild);
    }
    if(popupActive){
      shade=elem('div','cozy-promo-shade');shade.hidden=true;
      panel=elem('section','cozy-promo-panel');panel.setAttribute('role','dialog');
      panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','cozyPromoTitle');
      const close=elem('button','cozy-promo-x','×');close.type='button';
      close.setAttribute('aria-label','Close promotion');close.addEventListener('click',closePopup);panel.append(close);
      const image=elem('img','cozy-promo-photo');image.src=imageUrl;
      image.alt='Special offer at Cozy Nail & Head Spa';image.loading='lazy';panel.append(image);
      const body=elem('div','cozy-promo-body');
      body.append(elem('div','cozy-promo-kicker',values.eyebrow||'A SPECIAL TREAT AT COZY'));
      body.append(elem('div','cozy-promo-line'));
      const title=elem('h2','',values.title||'A Special Treat For You');title.id='cozyPromoTitle';body.append(title);
      body.append(elem('div','cozy-promo-offer',values.offer||'SPECIAL OFFER'));
      body.append(elem('p','cozy-promo-description',values.description||'A little something special for you.'));
      const book=elem('a','cozy-promo-btn',(values.button_text||'BOOK NOW')+' ↗');
      book.href=bookingUrl;book.target='_blank';book.rel='noopener noreferrer';body.append(book);
      if(values.fine_print)body.append(elem('div','cozy-promo-fine',values.fine_print));
      const later=elem('button','cozy-promo-dismiss','Maybe later');later.type='button';
      later.addEventListener('click',closePopup);body.append(later);
      panel.append(body);shade.append(panel);document.body.append(shade);
      shade.addEventListener('click',e=>{if(e.target===shade)closePopup()});
      document.addEventListener('keydown',e=>{
        if(shade.hidden)return;
        if(e.key==='Escape'){closePopup();return}
        if(e.key==='Tab'){
          const tabbable=[...panel.querySelectorAll('button,a[href]')];
          if(!tabbable.length)return;
          if(e.shiftKey&&document.activeElement===tabbable[0]){e.preventDefault();tabbable.at(-1).focus()}
          else if(!e.shiftKey&&document.activeElement===tabbable.at(-1)){e.preventDefault();tabbable[0].focus()}
        }
      });
      const lastDismissed=Number(getStored(storageKey)||0);
      if(!lastDismissed||Date.now()-lastDismissed>cooldown*86400000){
        window.setTimeout(openPopup,1100);
      }
    }
  }
  function start(){loadSettings().then(show).catch(err=>console.warn('Cozy promotion unavailable',err))}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
