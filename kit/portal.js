/* ============================================================
   PORTAL KIT v4 — engine (AM3I_OS shared layer)
   Config:  window.PORTAL_KIT = { title, code, accent, mode, bg, skipIntro, cursor }
   mode: 'tool' | 'arcade' | 'narrative'   bg: 'full' | 'stars' | 'off'
============================================================ */
(function(){
"use strict";
var CFG = Object.assign({
  title: document.title || 'AM3I_OS',
  code: 'SUBSYSTEM',
  accent: '#00ffe0',
  accentRgb: '0,255,224',
  mode: 'tool',
  bg: 'full',
  skipIntro: false,
  cursor: true,
}, window.PORTAL_KIT || {});
var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;
var TOUCH = window.matchMedia && matchMedia('(hover:none),(pointer:coarse)').matches;
var IS_NAV = /^https?:$/.test(location.protocol) || location.protocol === 'file:';

/* ---------- theme ---------- */
var root = document.documentElement;
root.style.setProperty('--pk-accent', CFG.accent);
root.style.setProperty('--pk-accent-rgb', CFG.accentRgb);
document.body.classList.add('pk-' + CFG.mode);

/* ---------- storage ---------- */
function sget(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function sset(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }

/* ============================================================
   AUDIO — synthesized SFX (no assets)
============================================================ */
var AudioFX = (function(){
  var ctx=null, master=null, enabled = sget('portal_sfx') !== '0';
  function init(){
    if(ctx) return true;
    try{
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = .14; master.connect(ctx.destination);
    }catch(e){ return false; }
    return true;
  }
  function env(g,t,a,d,peak){
    g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(peak,t+a);
    g.gain.exponentialRampToValueAtTime(.0001,t+a+d);
  }
  function tone(o){
    if(!enabled||!init()) return;
    o = o||{};
    var t = ctx.currentTime + (o.delay||0);
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type||'square';
    osc.frequency.setValueAtTime(o.f||440, t);
    if(o.fe) osc.frequency.exponentialRampToValueAtTime(Math.max(1,o.fe), t+(o.a||.005)+(o.d||.1));
    env(g,t,o.a||.005,o.d||.1,o.v||.4);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t+(o.a||.005)+(o.d||.1)+.05);
  }
  function noise(o){
    if(!enabled||!init()) return;
    o = o||{};
    var t = ctx.currentTime + (o.delay||0);
    var len = Math.floor(ctx.sampleRate*(o.d||.3));
    var buf = ctx.createBuffer(1,len,ctx.sampleRate), data = buf.getChannelData(0);
    for(var i=0;i<len;i++) data[i]=Math.random()*2-1;
    var src = ctx.createBufferSource(); src.buffer=buf;
    var f = ctx.createBiquadFilter(); f.type='bandpass'; f.Q.value=.8;
    f.frequency.setValueAtTime(o.ff||2400,t);
    f.frequency.exponentialRampToValueAtTime(Math.max(1,o.ft||300), t+(o.d||.3));
    var g = ctx.createGain(); env(g,t,.01,o.d||.3,o.v||.3);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }
  return {
    get enabled(){ return enabled; },
    toggle: function(){
      enabled = !enabled;
      if(enabled){ init(); if(ctx && ctx.state==='suspended') ctx.resume(); tone({f:880,d:.06,v:.2}); }
      sset('portal_sfx', enabled ? '1' : '0');
      return enabled;
    },
    tick: function(){ tone({f:1500,fe:900,a:.002,d:.026,v:.05}); },
    zap:  function(){ tone({f:900,fe:120,type:'sawtooth',a:.004,d:.13,v:.22}); },
    blip: function(f){ tone({f:f||520,d:.05,v:.14}); },
    chime:function(big){
      var seq = big?[523,659,784,1047]:[659,880];
      for(var i=0;i<seq.length;i++) tone({f:seq[i],type:'sine',a:.008,d:.32,v:.26,delay:i*.085});
      if(big) tone({f:1568,type:'sine',a:.01,d:.5,v:.16,delay:.34});
    },
    whoosh:function(){ noise({d:.45,ff:300,ft:3800,v:.26}); noise({d:.35,ff:3800,ft:220,v:.2,delay:.22}); },
  };
})();
window.PK = window.PK || {};
window.PK.sfx = AudioFX;

/* ============================================================
   CHROME INJECTION
============================================================ */
var frag = document.createElement('div');
frag.innerHTML =
  (CFG.bg!=='off' && !REDUCED ? '<canvas id="pk-bg"></canvas>' : '') +
  '<div class="pk-vignette"></div>' +
  '<div class="pk-scanlines"></div>' +
  (REDUCED ? '' : '<div class="pk-grain"></div><div class="pk-sweep"></div>') +
  '<div class="pk-corner tl"></div><div class="pk-corner tr"></div><div class="pk-corner bl"></div><div class="pk-corner br"></div>' +
  '<header id="pk-hud">' +
    '<a class="pk-hud-back" href="./index.html" data-cur="PORTAL">&#9664; PORTAL</a>' +
    '<span class="pk-hud-title">' + CFG.code + ' <b>//</b> ' + CFG.title + '</span>' +
    '<span class="pk-hud-sep"></span>' +
    '<span class="pk-hud-item pk-opt"><span class="pk-led"></span> LINK <b>STABLE</b></span>' +
    '<span class="pk-hud-item pk-opt">FPS <b id="pkFps">--</b></span>' +
    '<span class="pk-hud-item">TIME <b id="pkClock">--:--:--</b></span>' +
    '<button class="pk-hud-btn' + (AudioFX.enabled?' on':'') + '" id="pkSfxBtn" type="button">SFX: ' + (AudioFX.enabled?'ON':'OFF') + '</button>' +
  '</header>' +
  '<div id="pk-toasts"></div>' +
  '<div id="pk-shutter"><i class="t"></i><i class="b"></i><em></em></div>' +
  (CFG.cursor && !TOUCH ?
  '<div id="pk-cursor"><div class="ticks"></div><div class="ring"></div><div class="dot"></div></div>' : '');
var inject = document.createElement('div');
while(frag.firstChild) inject.appendChild(frag.firstChild);
document.body.appendChild(inject);

/* ============================================================
   HUD: clock / fps / sfx toggle / narrative autohide
============================================================ */
setInterval(function(){
  var d = new Date();
  var el = document.getElementById('pkClock');
  if(el) el.textContent = [d.getHours(),d.getMinutes(),d.getSeconds()].map(function(n){return String(n).padStart(2,'0');}).join(':');
},1000);
var fpsN = 0;
(function fpsLoop(){ fpsN++; requestAnimationFrame(fpsLoop); })();
setInterval(function(){
  var el = document.getElementById('pkFps');
  if(el) el.textContent = fpsN*2; fpsN = 0;
},500);
document.getElementById('pkSfxBtn').addEventListener('click', function(){
  var on = AudioFX.toggle();
  this.textContent = 'SFX: ' + (on?'ON':'OFF');
  this.classList.toggle('on', on);
});

if(CFG.mode === 'narrative'){
  var hud = document.getElementById('pk-hud');
  var idleT = null;
  function wake(){
    hud.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(function(){ hud.classList.add('idle'); }, 3000);
  }
  window.addEventListener('pointermove', wake, {passive:true});
  window.addEventListener('keydown', wake);
  wake();
}

/* ============================================================
   TOASTS
============================================================ */
function toast(title, msg, gold){
  var box = document.getElementById('pk-toasts');
  var el = document.createElement('div');
  el.className = 'pk-toast' + (gold?' gold':'');
  el.innerHTML = '<div class="t">&#9670; ' + title + '</div><div>' + msg + '</div><i></i>';
  box.appendChild(el);
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ el.classList.add('show'); }); });
  if(gold) AudioFX.chime(true); else AudioFX.blip(660);
  setTimeout(function(){ el.classList.remove('show'); setTimeout(function(){ el.remove(); },600); }, 3200);
}
window.PK.toast = toast;

/* ============================================================
   BACKGROUND ENGINE — stars + matrix + pulses (blend: screen)
============================================================ */
if(CFG.bg!=='off' && !REDUCED){
  (function(){
    var cv = document.getElementById('pk-bg'), cx = cv.getContext('2d');
    var W=0,H=0, stars=[], drops=[], pulses=[], rgb = CFG.accentRgb;
    function resize(){
      var dpr = Math.min(window.devicePixelRatio||1, 1.5);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = W*dpr; cv.height = H*dpr;
      cv.style.width = W+'px'; cv.style.height = H+'px';
      cx.setTransform(dpr,0,0,dpr,0,0);
      var q = TOUCH ? .5 : 1;
      var n = Math.floor(110*q*(W*H)/(1440*900));
      stars = [];
      for(var i=0;i<n;i++) stars.push({x:Math.random()*W, y:Math.random()*H, z:.25+Math.random()*.75, tw:Math.random()*6.28});
      var fs = 15, cols = Math.ceil(W/fs);
      drops = [];
      for(var c=0;c<cols;c++) drops.push({y:Math.random()*H/fs, sp:.3+Math.random()*.9, x:c*fs, hot:Math.random()<.05});
    }
    var CHARS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789ABCDEF#$%&+=*';
    var last = performance.now();
    function frame(now){
      var dt = Math.min((now-last)/1000,.05); last = now;
      cx.clearRect(0,0,W,H);
      var full = CFG.bg === 'full';
      for(var i=0;i<stars.length;i++){
        var s = stars[i];
        s.tw += dt*2;
        var a = (.3+s.z*.7) * (.4+.6*Math.abs(Math.sin(s.tw))) * .55;
        cx.fillStyle = 'rgba('+rgb+','+a.toFixed(3)+')';
        cx.fillRect(s.x, s.y, s.z*1.5, s.z*1.5);
      }
      if(full){
        cx.font = fs15();
        for(var j=0;j<drops.length;j++){
          var d = drops[j];
          d.y += d.sp*dt*11;
          var py = d.y*15;
          if(py > H+40){ d.y = -Math.random()*8; d.hot = Math.random()<.05; }
          cx.fillStyle = d.hot ? 'rgba(255,255,255,.75)' : 'rgba('+rgb+',.3)';
          cx.fillText(CHARS[(Math.random()*CHARS.length)|0], d.x, py);
        }
      }
      if(Math.random() < dt*.4 && pulses.length < 3){
        pulses.push({y:H*.08+Math.random()*H*.84, x:-240, sp:800+Math.random()*1000, w:90+Math.random()*180, a:.05+Math.random()*.1});
      }
      for(var k=pulses.length-1;k>=0;k--){
        var p = pulses[k]; p.x += p.sp*dt;
        if(p.x > W+320){ pulses.splice(k,1); continue; }
        var g = cx.createLinearGradient(p.x-p.w,0,p.x,0);
        g.addColorStop(0,'transparent'); g.addColorStop(1,'rgba('+rgb+','+p.a+')');
        cx.fillStyle = g; cx.fillRect(p.x-p.w, p.y, p.w, 1.3);
      }
      requestAnimationFrame(frame);
    }
    function fs15(){ return '15px "Share Tech Mono", monospace'; }
    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(frame);
  })();
}

/* ============================================================
   CUSTOM CURSOR
============================================================ */
if(CFG.cursor && !TOUCH){
  (function(){
    var cur = document.getElementById('pk-cursor');
    var x=innerWidth/2, y=innerHeight/2, tx=x, ty=y;
    window.addEventListener('pointermove', function(e){ tx=e.clientX; ty=e.clientY; }, {passive:true});
    window.addEventListener('pointerdown', function(e){
      cur.classList.add('down');
      var s = document.createElement('div');
      s.className='pk-shock'; s.style.left=e.clientX+'px'; s.style.top=e.clientY+'px';
      document.body.appendChild(s);
      setTimeout(function(){ s.remove(); }, 600);
      AudioFX.zap();
    });
    window.addEventListener('pointerup', function(){ cur.classList.remove('down'); });
    window.addEventListener('pointerover', function(e){
      var t = e.target.closest && e.target.closest('a,button,select,input,textarea,summary,[data-cur]');
      cur.classList.toggle('hover', !!t);
    }, {passive:true});
    (function loop(){
      x += (tx-x)*.24; y += (ty-y)*.24;
      cur.style.transform = 'translate('+x+'px,'+y+'px)';
      requestAnimationFrame(loop);
    })();
  })();
} else {
  document.addEventListener('pointerdown', function(){ AudioFX.zap(); });
}

/* hover ticks (delegated, throttled) */
var lastTick = 0;
document.addEventListener('pointerover', function(e){
  if(!AudioFX.enabled) return;
  var now = Date.now();
  if(now-lastTick < 55) return;
  var t = e.target.closest && e.target.closest('a,button,select,summary');
  if(t){ lastTick = now; AudioFX.tick(); }
}, {passive:true});

/* ============================================================
   BOOT FLASH + page-enter
============================================================ */
var seen = false;
try{ seen = sessionStorage.getItem('pk_seen') === '1'; sessionStorage.setItem('pk_seen','1'); }catch(e){}
document.body.classList.add('pk-on');
function enterDone(){
  document.body.classList.add('pk-entered');
  document.body.dispatchEvent(new CustomEvent('pk:entered'));
}
window.PK.enterDone = enterDone;
if(REDUCED){ enterDone(); }
else if(CFG.skipIntro || seen){
  var b0 = document.getElementById('pk-boot');
  if(b0) b0.remove();
  document.body.style.animation = 'pk-flash-out .01s';
  setTimeout(enterDone, 60);
} else {
  var boot = document.createElement('div');
  boot.id = 'pk-boot';
  boot.innerHTML = '<div class="pk-crt"></div><div class="pk-stamp">' + CFG.title +
    '<small>' + CFG.code + ' // AM3I_OS v4.0</small></div>' +
    '<button class="pk-boot-skip" type="button">SKIP &raquo;</button>';
  document.body.appendChild(boot);
  requestAnimationFrame(function(){ requestAnimationFrame(function(){
    boot.classList.add('do-crt');
    AudioFX.whoosh();
  });});
  setTimeout(function(){ boot.classList.add('do-stamp'); AudioFX.blip(740); }, 500);
  function kill(){ if(!boot.classList.contains('done')){ boot.classList.add('done'); enterDone(); AudioFX.chime(); } }
  boot.querySelector('.pk-boot-skip').addEventListener('click', kill);
  setTimeout(kill, 2100);
}

/* ============================================================
   LINK-OUT SHUTTER (internal .html links)
============================================================ */
document.addEventListener('click', function(e){
  var a = e.target.closest && e.target.closest('a[href]');
  if(!a) return;
  var href = a.getAttribute('href');
  if(!href || a.target === '_blank' || e.metaKey || e.ctrlKey) return;
  if(!/\.html?$/.test(href.split('#')[0].split('?')[0])) return;
  if(/:\/\//.test(href) && href.indexOf(location.host) === -1) return;
  e.preventDefault();
  var sh = document.getElementById('pk-shutter');
  sh.classList.add('active');
  AudioFX.whoosh();
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ sh.classList.add('close'); }); });
  setTimeout(function(){ location.href = href; }, 400);
});
window.addEventListener('pageshow', function(e){
  if(e.persisted){
    var sh = document.getElementById('pk-shutter');
    sh.classList.remove('close','active');
  }
});

/* ============================================================
   KONAMI — every page
============================================================ */
var KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
var kIdx = 0;
window.addEventListener('keydown', function(e){
  if(e.target && e.target.tagName === 'INPUT') { kIdx = 0; return; }
  kIdx = (e.key === KONAMI[kIdx]) ? kIdx+1 : (e.key === KONAMI[0] ? 1 : 0);
  if(kIdx === KONAMI.length){
    kIdx = 0;
    toast('GOD MODE', '禁忌のコードを認識。現実が色を失い、再び満ちる。', true);
    document.body.classList.add('pk-godmode');
    setTimeout(function(){ document.body.classList.remove('pk-godmode'); }, 6200);
  }
});

/* expose tiny helpers for page glue */
window.PK.on = function(sel, ev, fn){ document.addEventListener(ev, function(e){ var t = e.target.closest && e.target.closest(sel); if(t) fn.call(t, e); }); };
})();
