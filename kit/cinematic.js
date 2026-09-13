/* ============================================================
   PORTAL KIT v4.5 — PX CINEMATIC TRANSITION ENGINE
   ------------------------------------------------------------
   A dependency-free motion layer that upgrades every navigation
   in AM3I_OS into an authored, cross-page sequence.

   What it owns
     · screen-space SVG filter rig (liquid warp / chromatic split / datamosh)
     · camera rig (push, pull, shake, roll, focus-blur) driven on <body>
     · canvas FX compositor (warp starfield, vortex, glyph debris, rings,
       glitch bars, singularity) — additive, transparent, trail-persisted
     · DOM shatter / reassemble (clip-path slices + per-slice physics)
     · iris (black-hole / pupil / pinhole), flash, bloom, veil
     · procedural sound design (risers, sub-drops, stutters, impacts)
     · handoff across navigation, so the effect CONTINUES on the next page

   Public API (all guarded, all optional)
     PX.play(move, opts)      -> Promise   exit-side sequence
     PX.go(href, move, opts)  -> void      exit-side then navigate (never fails)
     PX.enter(move, opts)     -> Promise   entry-side sequence
     PX.shatter(el, o) / PX.assemble(el, o)
     PX.glitch(el, o) / PX.camera(o) / PX.setFilter(o)
     PX.iris(o) / PX.flash(o) / PX.caption(text, sub, o)
     PX.scramble(el, text, o)
     PX.fx.onFrame(fn) / PX.fx.starfield(o) / PX.fx.debris(o) ...
     PX.sfx.*

   Safe by construction: every public entry point is wrapped, the navigation
   always fires on a failsafe timer, and the entry veil auto-clears.
   ============================================================ */
(function (global) {
'use strict';

var doc = document, win = window;

/* ============================================================
   0. environment + math
============================================================ */
function mm(q){ try { return !!(win.matchMedia && win.matchMedia(q).matches); } catch(e){ return false; } }
var REDUCED = mm('(prefers-reduced-motion: reduce)');
var COARSE  = mm('(hover: none), (pointer: coarse)');
var CORES   = Math.max(1, navigator.hardwareConcurrency || 4);
var LOW     = REDUCED || (COARSE && CORES <= 4);
var DPR     = Math.min(win.devicePixelRatio || 1, COARSE ? 1.3 : 1.7);

var clamp = function(v,a,b){ return v<a?a:(v>b?b:v); };
var lerp  = function(a,b,t){ return a+(b-a)*t; };
var rand  = function(a,b){ return b===undefined ? Math.random()*a : a+Math.random()*(b-a); };
var rint  = function(a,b){ return Math.floor(rand(a,b+1)); };
var pick  = function(a){ return a[(Math.random()*a.length)|0]; };
var smoothstep = function(a,b,x){ var t=clamp((x-a)/(b-a||1e-6),0,1); return t*t*(3-2*t); };

var E = {
  lin:  function(t){ return t; },
  oQ:   function(t){ return 1-(1-t)*(1-t); },
  iQ:   function(t){ return t*t; },
  ioQ:  function(t){ return t<.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2; },
  oC:   function(t){ return 1-Math.pow(1-t,3); },
  iC:   function(t){ return t*t*t; },
  ioC:  function(t){ return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; },
  iQu:  function(t){ return Math.pow(t,4); },
  iQu5: function(t){ return Math.pow(t,5); },
  oQu5: function(t){ return 1-Math.pow(1-t,5); },
  ioQu5:function(t){ return t<.5?16*t*t*t*t*t:1-Math.pow(-2*t+2,5)/2; },
  oEx:  function(t){ return t>=1?1:1-Math.pow(2,-10*t); },
  iEx:  function(t){ return t<=0?0:Math.pow(2,10*t-10); },
  iBa:  function(t){ return 2.70158*t*t*t-1.70158*t*t; },
  oBa:  function(t){ return 1+2.70158*Math.pow(t-1,3)+1.70158*Math.pow(t-1,2); },
  oEl:  function(t){ return t<=0?0:t>=1?1:Math.pow(2,-9*t)*Math.sin((t*10-.75)*(2*Math.PI/3))+1; },
  oSi:  function(t){ return Math.sin(t*Math.PI/2); },
  ioSi: function(t){ return -(Math.cos(Math.PI*t)-1)/2; }
};

function sget(k){ try { return sessionStorage.getItem(k); } catch(e){ return null; } }
function sset(k,v){ try { sessionStorage.setItem(k,v); } catch(e){} }
function sdel(k){ try { sessionStorage.removeItem(k); } catch(e){} }

function hexToRgb(h){
  if(!h) return null;
  h = String(h).trim();
  var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  if(!m) return null;
  return [parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)];
}
function rgba(rgbArr, a){ return 'rgba('+rgbArr[0]+','+rgbArr[1]+','+rgbArr[2]+','+a+')'; }
function accentRGB(){
  var v = '';
  try { v = getComputedStyle(doc.documentElement).getPropertyValue('--pk-accent').trim(); } catch(e){}
  var rgb = hexToRgb(v);
  if(rgb) return rgb;
  try { var raw = getComputedStyle(doc.documentElement).getPropertyValue('--pk-accent-rgb').trim();
        if(raw){ var p = raw.split(',').map(Number); if(p.length===3 && !isNaN(p[0])) return p; } } catch(e){}
  return [0,255,224];
}

var wait = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
var raf  = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : function(f){ return setTimeout(function(){ f(Date.now()); },16); };

/* ============================================================
   1. RIG construction (runs pre-body: mounts on <html>)
============================================================ */
var RIG_ID = 'px-rig';
var rig = null, L = {};               // L = layer refs
var DEFS = '<svg id="px-defs" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">'
  + '<defs>'
  /* --- liquid displacement : organic distortion --- */
  + '<filter id="px-warp" x="-14%" y="-14%" width="128%" height="128%" color-interpolation-filters="sRGB">'
  +   '<feTurbulence id="px-turb" type="fractalNoise" baseFrequency="0.006 0.017" numOctaves="2" seed="7" result="n"/>'
  +   '<feDisplacementMap id="px-disp" in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G"/>'
  + '</filter>'
  /* --- datamosh : row-wise block tearing --- */
  + '<filter id="px-tear" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">'
  +   '<feTurbulence id="px-tear-noise" type="turbulence" baseFrequency="0.0001 0.9" numOctaves="1" seed="2" result="tn"/>'
  +   '<feDisplacementMap id="px-tear-map" in="SourceGraphic" in2="tn" scale="0" xChannelSelector="R" yChannelSelector="G"/>'
  + '</filter>'
  /* --- chromatic aberration : additive per-channel offset + radial bleed --- */
  + '<filter id="px-chroma" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">'
  +   '<feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>'
  +   '<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>'
  +   '<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>'
  +   '<feOffset id="px-chr-r" in="r" dx="0" dy="0" result="ro"/>'
  +   '<feOffset id="px-chr-b" in="b" dx="0" dy="0" result="bo"/>'
  +   '<feBlend in="ro" in2="g" mode="screen" result="rg"/>'
  +   '<feBlend in="rg" in2="bo" mode="screen"/>'
  + '</filter>'
  + '</defs></svg>';

var RIG_HTML =
    '<canvas id="px-fx"></canvas>'
  + '<div id="px-trails"></div>'
  + '<div id="px-scan"></div>'
  + '<div id="px-noise"></div>'
  + '<div id="px-shards"></div>'
  + '<div id="px-iris"><i class="core"></i><i class="ring"></i></div>'
  + '<div id="px-bloom"></div>'
  + '<div id="px-flash"></div>'
  + '<div id="px-veil"></div>'
  + '<div id="px-cap"><b class="m"></b><s class="s"></s></div>'
  + '<div id="px-rail"><span class="a"></span><span class="lbl"></span><span class="pct"></span></div>';

function ensureCSS(){
  if(doc.getElementById('px-css')) return;
  var link = doc.createElement('link');
  link.id = 'px-css'; link.rel = 'stylesheet';
  var base = '';
  try { base = (doc.currentScript && doc.currentScript.src) ? doc.currentScript.src.replace(/[^/]*$/,'') : './kit/'; } catch(e){ base = './kit/'; }
  link.href = base + 'cinematic.css';
  (doc.head || doc.documentElement).appendChild(link);
}

function build(){
  if(rig) return rig;
  var root = doc.documentElement;
  if(!root) return null;
  rig = doc.getElementById(RIG_ID);
  if(!rig){
    var shell = doc.createElement('div');
    shell.id = RIG_ID;
    shell.setAttribute('aria-hidden','true');
    shell.innerHTML = RIG_HTML;
    root.appendChild(shell);
    var svgHost = doc.createElement('div');
    svgHost.innerHTML = DEFS;
    var svg = svgHost.firstElementChild;
    if(svg) root.insertBefore(svg, shell);
    rig = shell;
  }
  L.fx     = doc.getElementById('px-fx');
  L.iris   = doc.getElementById('px-iris');
  L.flash  = doc.getElementById('px-flash');
  L.bloom  = doc.getElementById('px-bloom');
  L.veil   = doc.getElementById('px-veil');
  L.shards = doc.getElementById('px-shards');
  L.cap    = doc.getElementById('px-cap');
  L.rail   = doc.getElementById('px-rail');
  L.flt    = {
    turb:  doc.getElementById('px-turb'),
    disp:  doc.getElementById('px-disp'),
    tnoise:doc.getElementById('px-tear-noise'),
    tmap:  doc.getElementById('px-tear-map'),
    cr:    doc.getElementById('px-chr-r'),
    cb:    doc.getElementById('px-chr-b')
  };
  syncAccent();
  if(typeof FX !== 'undefined' && FX) FX.size();
  return rig;
}
ensureCSS();
build();
if(doc.readyState === 'loading'){
  doc.addEventListener('DOMContentLoaded', function(){ build(); }, {once:true});
}
win.addEventListener('resize', function(){ if(rig) FX.size(); }, {passive:true});

/* ============================================================
   2. AUDIO — procedural sound design
============================================================ */
var A = (function(){
  var ctx=null, bus=null, dry=null, verb=null, enabled = (function(){ try{ return localStorage.getItem('portal_sfx') !== '0'; }catch(e){ return true; } })();
  var noiseBuf=null, curve=null;

  function ensure(){
    if(ctx) { if(ctx.state === 'suspended'){ try{ ctx.resume(); }catch(e){} } return ctx; }
    var AC = win.AudioContext || win.webkitAudioContext;
    if(!AC) return null;
    try { ctx = new AC(); } catch(e){ return null; }
    bus  = ctx.createGain(); bus.gain.value = .6;
    dry  = ctx.createGain(); dry.gain.value = 1;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value=-15; comp.knee.value=22; comp.ratio.value=9; comp.attack.value=.003; comp.release.value=.22;
    bus.connect(comp); comp.connect(ctx.destination);
    dry.connect(bus);
    verb = ctx.createConvolver();
    verb.buffer = impulse(2.0, 3.4);
    var vg = ctx.createGain(); vg.gain.value = .3;
    verb.connect(vg); vg.connect(bus);
    return ctx;
  }
  function impulse(dur, decay){
    var rate = ctx.sampleRate, len = Math.max(1, Math.floor(rate*dur));
    var b = ctx.createBuffer(2, len, rate);
    for(var ch=0; ch<2; ch++){
      var d = b.getChannelData(ch);
      for(var i=0;i<len;i++){
        var t = i/len;
        d[i] = (Math.random()*2-1) * Math.pow(1-t, decay) * (t<.004 ? t/.004 : 1);
      }
    }
    return b;
  }
  function distortion(amount){
    if(curve) return curve;
    var n = 1024, c = new Float32Array(n), k = amount || 12;
    for(var i=0;i<n;i++){ var x = i*2/n - 1; c[i] = (1+k)*x/(1+k*Math.abs(x)); }
    curve = c; return c;
  }
  function noiseBuffer(){
    if(noiseBuf) return noiseBuf;
    var rate = ctx.sampleRate, len = Math.floor(rate*2.2);
    var b = ctx.createBuffer(1, len, rate), d = b.getChannelData(0);
    for(var i=0;i<len;i++) d[i] = Math.random()*2-1;
    noiseBuf = b; return b;
  }
  function env(g,t,a,d,peak){
    g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(Math.max(.0002,peak),t+a);
    g.gain.exponentialRampToValueAtTime(.0001,t+a+d);
  }
  function tone(o){
    if(!enabled) return; if(!ensure()) return;
    var t = ctx.currentTime + (o.at||0);
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type||'sine';
    osc.frequency.setValueAtTime(Math.max(1,o.f||440), t);
    if(o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1,o.f1), t+(o.a||.008)+(o.d||.2));
    var node = osc;
    if(o.shape){ var ws = ctx.createWaveShaper(); ws.curve = distortion(o.shape); ws.oversample='2x'; node.connect(ws); node = ws; }
    if(o.filt){
      var f = ctx.createBiquadFilter(); f.type=o.filt; f.Q.value=o.q||1;
      f.frequency.setValueAtTime(o.fc||1200,t);
      if(o.fc1) f.frequency.exponentialRampToValueAtTime(Math.max(40,o.fc1), t+(o.a||.008)+(o.d||.2));
      node.connect(f); node = f;
    }
    env(g,t,o.a||.008,o.d||.2,o.v==null?.3:o.v);
    node.connect(g); g.connect(dry);
    if(o.send && verb){ var s = ctx.createGain(); s.gain.value=o.send; g.connect(s); s.connect(verb); }
    osc.start(t); osc.stop(t+(o.a||.008)+(o.d||.2)+.1);
  }
  function noise(o){
    if(!enabled) return; if(!ensure()) return;
    o = o||{};
    var t = ctx.currentTime + (o.at||0);
    var src = ctx.createBufferSource(); src.buffer = noiseBuffer(); src.loop = true;
    src.playbackRate.value = o.rate || 1;
    var f = ctx.createBiquadFilter();
    f.type = o.type||'bandpass'; f.Q.value = o.q==null?.9:o.q;
    f.frequency.setValueAtTime(Math.max(30,o.fc||1200),t);
    if(o.fc1) f.frequency.exponentialRampToValueAtTime(Math.max(30,o.fc1), t+(o.a||.006)+(o.d||.4));
    var g = ctx.createGain(); env(g,t,o.a||.006,o.d||.4,o.v==null?.3:o.v);
    src.connect(f); f.connect(g); g.connect(dry);
    if(o.send && verb){ var s = ctx.createGain(); s.gain.value=o.send; g.connect(s); s.connect(verb); }
    src.start(t); src.stop(t+(o.a||.006)+(o.d||.4)+.15);
  }
  function lfo(target, rate, depth, t, dur){
    var o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o2.frequency.value = rate; g2.gain.value = depth;
    o2.connect(g2); g2.connect(target);
    o2.start(t); o2.stop(t+dur);
  }
  var api = {
    get enabled(){ return enabled; },
    set: function(on){ enabled = !!on; if(enabled){ ensure(); } },
    resume: function(){ if(enabled) ensure(); },
    /* --- UI --- */
    tick:  function(){ tone({f:1500,f1:820,type:'square',a:.002,d:.026,v:.05}); },
    blip:  function(f){ tone({f:f||520,type:'square',a:.004,d:.05,v:.13}); },
    zap:   function(){ tone({f:900,f1:120,type:'sawtooth',a:.004,d:.13,v:.2}); },
    deny:  function(){ tone({f:220,type:'square',d:.16,v:.26}); tone({f:176,type:'square',a:.004,d:.2,v:.26,at:.13}); },
    chime: function(big){
      var seq = big?[523,659,784,1047]:[659,880];
      for(var i=0;i<seq.length;i++) tone({f:seq[i],type:'sine',a:.008,d:.32,v:.2,send:.4,at:i*.085});
      if(big) tone({f:1568,type:'sine',a:.01,d:.5,v:.12,send:.5,at:.34});
    },
    whoosh: function(p){
      p = p||1;
      noise({d:.45*p,fc:280,fc1:4200,v:.22*p,send:.25});
      noise({d:.4*p,fc:4200,fc1:180,v:.18*p,at:.2*p});
    },
    /* --- cinematic --- */
    riser: function(dur, o){
      o = o||{}; dur = dur||1.2;
      var base = o.base||70, i;
      for(i=0;i<3;i++){
        tone({f:base*(1+i*.5), f1:base*(1+i*.5)*Math.pow(2, 2.4+i*.35), type:i?'sawtooth':'square',
              a:dur*.82, d:dur*.22, v:(.11-i*.02), filt:'lowpass', fc:240, fc1:5200, q:6, at:i*.03});
      }
      noise({d:dur, fc:300, fc1:9000, q:1.6, v:.13, at:0, send:.3});
      tone({f:base*.5, f1:base*.5*8, type:'sine', a:dur*.9, d:.06, v:.16});
    },
    stutter: function(n, dur, o){
      o = o||{}; n = n||14;
      for(var i=0;i<n;i++){
        var t = (i/n)*(i/n)*dur;
        tone({f:rand(260,2400), type:'square', a:.001, d:rand(.008,.03), v:.06, at:t});
        if(i%3===0) noise({d:.02, fc:rand(1200,7000), v:.05, at:t});
      }
    },
    impact: function(p, o){
      p = p==null?1:p; o=o||{};
      tone({f:120*(o.f||1), f1:26, type:'sine', a:.004, d:.55, v:.42*p});
      tone({f:70, f1:34, type:'triangle', a:.004, d:.34, v:.2*p, shape:8});
      noise({d:.24, fc:2600, fc1:120, v:.22*p, send:.4});
      noise({d:.05, fc:8000, v:.14*p, at:.002});
    },
    sub_drop: function(){
      tone({f:180, f1:22, type:'sine', a:.02, d:1.5, v:.4, send:.3});
      noise({d:1.1, fc:900, fc1:60, v:.1, send:.5});
    },
    portal: function(o){
      o = o||{};
      noise({d:.85, fc:180, fc1:5200, q:2.4, v:.16, send:.6});
      var chord = o.chord || [130.8,196,261.6,392,523.3];
      for(var i=0;i<chord.length;i++){
        tone({f:chord[i], type:'sine', a:.02, d:1.5+i*.2, v:.1, send:.75, at:.5+i*.045});
        tone({f:chord[i]*2.01, type:'triangle', a:.05, d:1.1, v:.035, send:.6, at:.55+i*.045});
      }
    },
    snake: function(){
      noise({d:1.15, fc:6200, fc1:2400, q:.6, v:.1, send:.4});
      tone({f:58, f1:34, type:'sawtooth', a:.35, d:1.2, v:.17, filt:'lowpass', fc:340, fc1:140, q:9, shape:6});
      tone({f:970, f1:210, type:'sawtooth', a:.06, d:1.35, v:.06, filt:'bandpass', fc:1400, q:11, send:.55});
    },
    hiss: function(dur){
      noise({d:dur||.5, fc:7400, fc1:5200, q:.4, v:.075, send:.3});
    },
    heartbeat: function(times, gap){
      times = times||2;
      for(var i=0;i<times;i++){
        var t = i*(gap||.86);
        tone({f:62, f1:34, type:'sine', a:.006, d:.15, v:.3, at:t});
        tone({f:56, f1:30, type:'sine', a:.006, d:.2, v:.19, at:t+.22});
      }
    },
    scream: function(){
      tone({f:1500, f1:170, type:'sawtooth', a:.05, d:1.15, v:.11, filt:'bandpass', fc:2200, fc1:400, q:7, shape:14, send:.7});
      tone({f:1520, f1:180, type:'square', a:.06, d:1.0, v:.05, filt:'highpass', fc:900, send:.7});
    },
    boot: function(){
      tone({f:110,type:'square',a:.004,d:.09,v:.12});
      tone({f:220,type:'square',a:.004,d:.09,v:.1,at:.09});
      tone({f:440,type:'sine',a:.006,d:.3,v:.14,send:.4,at:.19});
    },
    crack: function(){
      noise({d:.09, fc:9000, v:.2, send:.2});
      tone({f:2200, f1:300, type:'square', a:.001, d:.06, v:.09});
    },
    sweep: function(dur, up){
      var d = dur||.6;
      noise({d:d, fc: up?200:5000, fc1: up?5000:200, q:1.2, v:.12, send:.45});
    }
  };
  /* expose LFO hook for pages that want to modulate */
  api._ctx = function(){ return ensure() ? ctx : null; };
  api._lfo = lfo;
  return api;
})();

/* ============================================================
   3. BODY FILTER + CAMERA drivers
============================================================ */
var F = { warp:0, chroma:0, tear:0, blur:0, bright:0, sat:0, invert:0, hue:0, enabled:false };
var filterRAF = 0;
function applyFilter(){
  var root = doc.documentElement;
  var parts = [];
  if(F.warp  > .4) parts.push('url(#px-warp)');
  if(F.tear  > .4) parts.push('url(#px-tear)');
  if(F.chroma> .2) parts.push('url(#px-chroma)');
  if(F.blur  > .05) parts.push('blur('+F.blur.toFixed(2)+'px)');
  if(Math.abs(F.bright)>.005) parts.push('brightness('+(1+F.bright).toFixed(3)+')');
  if(Math.abs(F.sat)>.005)     parts.push('saturate('+(1+F.sat).toFixed(3)+')');
  if(F.hue>.5)                 parts.push('hue-rotate('+F.hue.toFixed(1)+'deg)');
  if(F.invert>.01)             parts.push('invert('+F.invert.toFixed(3)+')');
  root.style.setProperty('--px-filter', parts.length ? parts.join(' ') : 'none');
  root.classList.toggle('px-fx', !!parts.length);
  var fl = L.flt;
  if(fl){
    if(fl.disp) fl.disp.setAttribute('scale', F.warp.toFixed(2));
    if(fl.turb) fl.turb.setAttribute('baseFrequency', (0.004 + F.warp*0.0009).toFixed(4)+' '+(0.014 + F.warp*0.0022).toFixed(4));
    if(fl.tmap) fl.tmap.setAttribute('scale', F.tear.toFixed(2));
    if(fl.tnoise) fl.tnoise.setAttribute('baseFrequency', '0.0001 '+(0.55 + F.tear*0.03).toFixed(3));
    var off = F.chroma.toFixed(2);
    if(fl.cr) fl.cr.setAttribute('dx', off);
    if(fl.cb) fl.cb.setAttribute('dx', (-F.chroma).toFixed(2));
  }
}
var PX_FILTER = {
  set: function(o){
    if(!o) return;
    for(var k in o) if(k in F) F[k] = o[k];
    applyFilter();
  },
  reset: function(){ F.warp=F.chroma=F.tear=F.blur=F.bright=F.sat=F.invert=F.hue=0; applyFilter(); },
  /* animate one or more params: {warp:[0,24,0], dur:600, ease:'iC' } */
  tween: function(spec, dur, ease){
    var keys = Object.keys(spec), t0 = performance.now(), D = dur||400, fn = E[ease||'ioC'];
    if(REDUCED){ keys.forEach(function(k){ F[k] = Array.isArray(spec[k]) ? spec[k][spec[k].length-1] : spec[k]; }); applyFilter(); return Promise.resolve(); }
    return new Promise(function(res){
      (function loop(now){
        var t = clamp((now-t0)/D,0,1), e = fn(t);
        for(var i=0;i<keys.length;i++){
          var k = keys[i], v = spec[k];
          if(Array.isArray(v)){
            if(v.length===2) F[k] = lerp(v[0], v[1], e);
            else { var seg = e*(v.length-1), a = Math.floor(seg); F[k] = lerp(v[a], v[Math.min(a+1,v.length-1)], seg-a); }
          } else F[k] = v;
        }
        applyFilter();
        if(t<1) raf(loop); else res();
      })(t0);
    });
  }
};

var C = { x:0, y:0, scale:1, rot:0, ox:.5, oy:.5, skewX:0, skewY:0, persp:0 };
function applyCam(){
  var root = doc.documentElement;
  var s = 'translate3d('+C.x.toFixed(2)+'px,'+C.y.toFixed(2)+'px,0)';
  if(C.persp) s = 'perspective('+C.persp+'px) '+s;
  s += ' scale('+C.scale.toFixed(4)+')';
  if(C.rot)   s += ' rotate('+C.rot.toFixed(3)+'deg)';
  if(C.skewX||C.skewY) s += ' skew('+C.skewX.toFixed(2)+'deg,'+C.skewY.toFixed(2)+'deg)';
  root.style.setProperty('--px-cam', s);
  root.style.setProperty('--px-cam-o', (C.ox*100).toFixed(2)+'% '+(C.oy*100).toFixed(2)+'%');
  root.classList.toggle('px-cam', (C.scale!==1||C.x!==0||C.y!==0||C.rot!==0||C.skewX!==0||C.skewY!==0));
}
var PX_CAMERA = {
  set: function(o){ if(!o) return; for(var k in o) if(k in C) C[k]=o[k]; applyCam(); },
  reset: function(){ C.x=C.y=C.rot=C.skewX=C.skewY=0; C.scale=1; C.ox=C.oy=.5; C.persp=0; applyCam(); },
  tween: function(spec, dur, ease, easeFn){
    var t0 = performance.now(), D = dur||500, fn = E[ease||'ioC'];
    var from = {}; Object.keys(spec).forEach(function(k){ from[k] = C[k]||0; });
    if(REDUCED){ Object.keys(spec).forEach(function(k){ C[k]=spec[k]; }); applyCam(); return Promise.resolve(); }
    return new Promise(function(res){
      (function loop(now){
        var t = clamp((now-t0)/D,0,1), e = fn(t);
        Object.keys(spec).forEach(function(k){ C[k] = lerp(from[k], spec[k], e); });
        applyCam();
        if(t<1) raf(loop); else res();
      })(t0);
    });
  },
  /* decaying shake — the good kind of chaos */
  shake: function(o){
    o = o||{};
    var amp = o.amp==null?12:o.amp, dur = o.dur||400, freq = o.freq||44, decay = o.decay==null?3.2:o.decay;
    if(REDUCED) return Promise.resolve();
    var t0 = performance.now(), baseX = C.x, baseY = C.y, baseR = C.rot, sx=o.roll==null?.35:o.roll;
    return new Promise(function(res){
      (function loop(now){
        var t = (now-t0)/1000, D = dur/1000;
        if(t>=D){ C.x=baseX; C.y=baseY; C.rot=baseR; applyCam(); res(); return; }
        var k = amp*Math.exp(-decay*t)*(0.55+0.45*Math.sin(t*freq*1.7));
        C.x = baseX + Math.sin(t*freq)*k + rand(-k*.3,k*.3);
        C.y = baseY + Math.cos(t*freq*.83)*k*.72 + rand(-k*.3,k*.3);
        C.rot = baseR + Math.sin(t*freq*.61)*k*sx*.14;
        applyCam();
        raf(loop);
      })(t0);
    });
  }
};

/* ============================================================
   4. CANVAS FX COMPOSITOR
============================================================ */
var FX = (function(){
  var cv=null, c=null, W=0, H=0, sys=[], running=false, last=0, heavy=0, degrade=LOW;
  function size(){
    cv = L.fx; if(!cv) return;
    W = win.innerWidth; H = win.innerHeight;
    cv.width = Math.floor(W*DPR); cv.height = Math.floor(H*DPR);
    cv.style.width = W+'px'; cv.style.height = H+'px';
    c = cv.getContext('2d');
    if(c) c.setTransform(DPR,0,0,DPR,0,0);
  }
  function clear(){ if(c){ c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,cv.width,cv.height); c.setTransform(DPR,0,0,DPR,0,0); } }
  function add(s){
    size();
    if(REDUCED){ return {kill:function(){}, done:Promise.resolve()}; }
    if(s.init) s.init(c,W,H);
    if(sys.length > 14) sys.splice(0, sys.length-14);
    sys.push(s); start();
    var handle = {
      kill: function(){ var i = sys.indexOf(s); if(i>=0) sys.splice(i,1); },
      sys: s
    };
    s._handle = handle;
    if(s.once) handle.done = wait(s.once);
    return handle;
  }
  function start(){
    if(running) return; running = true; last = performance.now();
    raf(loop);
  }
  function loop(now){
    var dt = Math.min((now-last)/1000, .05); last = now;
    var t0 = now;
    if(c){
      /* trail persistence: erase rather than fill, so the page stays visible */
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = 'rgba(0,0,0,'+(degrade?.55:.30)+')';
      c.fillRect(0,0,W,H);
      c.globalCompositeOperation = 'lighter';
      for(var i=sys.length-1;i>=0;i--){
        var s = sys[i];
        if(s.dead){ sys.splice(i,1); continue; }
        try { s.draw(c,W,H,(now-(s.t0||(s.t0=now)))/1000, dt); }
        catch(e){ s.dead = true; }
        if(s.until && now-s.t0 > s.until){ s.dead = true; }
      }
      c.globalCompositeOperation = 'source-over';
    }
    /* perf governor — bail on filters if the machine is choking */
    var cost = performance.now()-t0;
    heavy = heavy*.9 + cost*.1;
    if(heavy > 26 && !degrade){ degrade = true; PX_FILTER.set({warp:0, tear:0}); }
    if(sys.length){ raf(loop); } else { running = false; }
  }
  size();

  var api = {
    size: size, clear: clear, add: add,
    get ctx(){ if(!c) size(); return c; },
    get W(){ return W; }, get H(){ return H; },
    /* generic per-frame hook for page-authored layers */
    onFrame: function(fn, until){
      return add({ draw: function(cc,w,h,t,dt){ if(fn(cc,w,h,t,dt) === false) this.dead = true; }, until: until });
    },
    /* ---------- warp starfield (tunnel travel) ---------- */
    starfield: function(o){
      o = o||{};
      var rgb = o.rgb || accentRGB();
      var n = Math.floor((o.count || (LOW?260:760)) * (W*H)/(1440*900) + 120);
      var f = o.focal || Math.min(W,H)*.9;
      var stars = [], cx = o.cx!=null?o.cx:W/2, cy = o.oy!=null?o.oy:H/2;
      for(var i=0;i<n;i++) stars.push(newStar(true));
      function newStar(init){
        return { x:rand(-W*1.2,W*1.2), y:rand(-H*1.2,H*1.2), z: init?rand(20,W*1.4):W*rand(1.0,1.6), px:0, py:0, pk:0, hot: Math.random()<(o.hot||.08) };
      }
      var p = { sp: o.sp0==null?.4:o.sp0, t:0 };
      return add({
        until: o.until || o.maxLife || 4200,
        draw: function(cc,w,h,t,dt){
          p.t += dt;
          var prog = o.power ? o.power(t,dt) : null;
          var sp = prog!=null ? prog : p.sp;
          p.sp = sp;
          var swirl = (o.swirl||0) * (1+sp/260);
          for(var i=0;i<stars.length;i++){
            var s = stars[i];
            var sx = cx + s.x*(f/s.z), sy = cy + s.y*(f/s.z);
            if(s.px){
              var depth = clamp(1 - s.z/(W*1.4), 0, 1);
              var wdt = depth*depth*4.6 + .35;
              var boost = clamp(sp/240,0,1);
              var col = s.hot
                ? rgba([255,lerp(255,rgb[1],boost),lerp(255,rgb[2],boost)], .35+depth*.6)
                : rgba(rgb, (.12+depth*.85)*(.35+boost*.85));
              cc.strokeStyle = col; cc.lineWidth = wdt*(1+boost*.5); cc.lineCap='round';
              cc.beginPath(); cc.moveTo(s.px, s.py); cc.lineTo(sx, sy); cc.stroke();
              if(boost>.35){ /* chroma doubling */
                cc.strokeStyle = rgba([255,60,80], .12*boost); cc.lineWidth = wdt*.7;
                cc.beginPath(); cc.moveTo(s.px-2, s.py-1); cc.lineTo(sx-2, sy-1); cc.stroke();
                cc.strokeStyle = rgba([60,140,255], .12*boost);
                cc.beginPath(); cc.moveTo(s.px+2, s.py+1); cc.lineTo(sx+2, sy+1); cc.stroke();
              }
            }
            s.px = sx; s.py = sy;
            var ang = swirl*dt*.0016;
            if(ang){ var cs=Math.cos(ang), sn=Math.sin(ang), nx=s.x*cs-s.y*sn; s.y=s.x*sn+s.y*cs; s.x=nx; }
            s.z -= sp*dt*(s.hot?1.25:1);
            if(o.gravity){ s.x *= (1 - o.gravity*dt*.6); s.y *= (1 - o.gravity*dt*.6); }
            if(s.z < 12 || Math.abs(s.x)>W*2.4 || Math.abs(s.y)>H*2.4){ stars[i] = newStar(false); }
          }
          if((o.until||o.maxLife||4200)/1000 < t) this.dead = true;
          if(o.spansOut && sp < 1) this.dead = true;
        }
      });
    },
    /* ---------- glyph debris (data being torn apart) ---------- */
    debris: function(o){
      o = o||{};
      var rgb = o.rgb || accentRGB();
      var glyphs = (o.glyphs || 'ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽ0123456789ABCDEF#$%&*+=<>/\\|_[]{}').split('');
      var n = Math.floor(o.count || (LOW?70:190));
      var cx = o.cx!=null?o.cx:W/2, cy = o.oy!=null?o.oy:H/2;
      var items = [];
      for(var i=0;i<n;i++){
        var a = o.from==='center' ? rand(0,Math.PI*2) : rand(0,Math.PI*2);
        var d = o.from==='center' ? rand(4,90) : rand(Math.min(W,H)*.35, Math.max(W,H)*.75);
        items.push({
          x: cx+Math.cos(a)*d, y: cy+Math.sin(a)*d,
          vx: rand(-30,30), vy: rand(-30,30),
          g: pick(glyphs), s: rand(o.sizeMin||9, o.sizeMax||19),
          rot: rand(0,Math.PI*2), vr: rand(-2.4,2.4), a: rand(.35,1),
          hot: Math.random()<.14, life: rand(.4,1)
        });
      }
      return add({
        until: o.until || ((o.dur||1)*1000 + 260),
        draw: function(cc,w,h,t,dt){
          var pull = o.pull||0, prog = clamp(t/(o.dur||1),0,1);
          cc.textAlign='center'; cc.textBaseline='middle';
          for(var i=0;i<items.length;i++){
            var p = items[i];
            var dx = cx-p.x, dy = cy-p.y, dist = Math.hypot(dx,dy)||1;
            if(pull) { p.vx += (dx/dist)*pull*dt; p.vy += (dy/dist)*pull*dt; }
            if(o.swirl){ var nx = -dy/dist, ny = dx/dist; p.vx += nx*o.swirl*dt; p.vy += ny*o.swirl*dt; }
            p.vx *= .995; p.vy *= .995;
            p.x += p.vx*dt; p.y += p.vy*dt;
            p.rot += p.vr*dt*(1+prog*3);
            if(p.hot && Math.random()<.06) p.g = pick(glyphs);
            var al = p.a * (1-prog) * (pull ? smoothstep(0,60,dist) : 1);
            if(al <= .01) continue;
            cc.save(); cc.translate(p.x,p.y); cc.rotate(p.rot);
            cc.font = 'bold '+p.s.toFixed(1)+'px "Share Tech Mono", monospace';
            cc.fillStyle = p.hot ? rgba([255,255,255], al) : rgba(rgb, al);
            cc.fillText(p.g, 0, 0);
            cc.restore();
          }
        }
      });
    },
    /* ---------- expanding rings / shockwaves ---------- */
    rings: function(o){
      o = o||{};
      var rgb = o.rgb || accentRGB();
      var t0 = performance.now();
      return add({
        draw: function(cc,w,h){
          var t = (performance.now()-t0)/1000, D = o.dur||1.1, n = o.count||3;
          if(t > D) { this.dead = true; return; }
          for(var i=0;i<n;i++){
            var pr = clamp((t - i*(D/(n*1.7)))/D, 0, 1);
            if(pr<=0) continue;
            var r = lerp(o.r0||8, o.r1||Math.max(w,h)*.9, E.oQu5(pr));
            var a = (1-pr)*(o.alpha||.5);
            cc.strokeStyle = rgba(rgb, a);
            cc.lineWidth = Math.max(.4, (o.width||2.4)*(1-pr));
            cc.beginPath();
            cc.ellipse(o.cx!=null?o.cx:w/2, o.cy!=null?o.cy:h/2, r, r*(o.squash||1), o.rot||0, 0, Math.PI*2);
            cc.stroke();
            if(o.chroma){
              cc.strokeStyle = rgba([255,40,60], a*.5);
              cc.beginPath(); cc.ellipse((o.cx||w/2)-4, o.cy||h/2, r, r*(o.squash||1), o.rot||0,0,Math.PI*2); cc.stroke();
              cc.strokeStyle = rgba([40,120,255], a*.5);
              cc.beginPath(); cc.ellipse((o.cx||w/2)+4, o.cy||h/2, r, r*(o.squash||1), o.rot||0,0,Math.PI*2); cc.stroke();
            }
          }
        }
      });
    },
    /* ---------- glitch bars painted over everything ---------- */
    bars: function(o){
      o = o||{};
      var rgb = o.rgb || accentRGB();
      var bars = [], next = 0;
      return add({
        until: o.until || (o.dur || 700),
        draw: function(cc,w,h,t,dt){
          var prog = clamp(t/((o.dur||700)/1000),0,1);
          if(t > next){
            next = t + rand(.01,.06)*(1-prog*.5);
            var cnt = 1+((Math.random()*(o.max||5))|0);
            for(var i=0;i<cnt;i++){
              bars.push({ y: rand(0,h), h: rand(1, o.thick||22), x: rand(-60,60)*(1-prog*.3), a: rand(.06,.4),
                          rgb: Math.random()<.28 ? [255,255,255] : rgb, shift: rand(-1,1) });
            }
          }
          for(var j=bars.length-1;j>=0;j--){
            var b = bars[j];
            b.a -= dt*(2.4+prog*3);
            if(b.a<=0){ bars.splice(j,1); continue; }
            cc.fillStyle = rgba(b.rgb, b.a*(1-prog*.35));
            cc.fillRect(b.x, b.y, w, b.h);
            if(Math.abs(b.shift)>.5){
              cc.fillStyle = rgba([0,0,0], b.a*.5);
              cc.fillRect(b.x + b.shift*14, b.y+b.h*.5, w, b.h*.5);
            }
          }
        }
      });
    }
  };
  return api;
})();
if(rig) FX.size();

function syncAccent(){
  var rgb = accentRGB();
  try{
    var st = doc.documentElement.style;
    st.setProperty('--px-acc-rgb', rgb.join(','));
    st.setProperty('--px-acc', 'rgb('+rgb.join(',')+')');
  }catch(e){}
  return rgb;
}

/* ============================================================
   5. IRIS / FLASH / BLOOM / VEIL / CAPTION / RAIL
============================================================ */
var irisState = { r: -1, x:.5, y:.5, edge:.06, tint:null, glow:1, rgb:null };
function applyIris(){
  var el = L.iris; if(!el) return;
  if(irisState.r < 0){ el.classList.remove('on'); return; }
  var r = irisState.r, e = Math.max(.002, irisState.edge);
  el.classList.add('on');
  el.style.setProperty('--x', (irisState.x*100).toFixed(2)+'%');
  el.style.setProperty('--y', (irisState.y*100).toFixed(2)+'%');
  el.style.setProperty('--r', r.toFixed(3));
  el.style.setProperty('--e', e.toFixed(3));
  el.style.setProperty('--glow', irisState.glow.toFixed(2));
  if(irisState.rgb) el.style.setProperty('--px-acc-rgb', irisState.rgb.join(','));
  if(irisState.tint) el.style.setProperty('--tint', irisState.tint);
  else el.style.removeProperty('--tint');
}
var PX_IRIS = {
  /* close onto a point (leaves a pinhole of radius r), or open from black */
  to: function(o){
    o = o||{};
    var from = o.from==null?1.55:o.from, to = o.to==null?0:o.to;
    var dur = o.dur||520, ease = E[o.ease||'ioQu5'];
    if(o.x!=null) irisState.x = o.x; if(o.y!=null) irisState.y = o.y;
  irisState.rgb = o.rgb && o.rgb.length===3 ? o.rgb : null;
    irisState.tint = o.tint||null; irisState.edge = o.edge==null?.075:o.edge;
    irisState.glow = o.glow==null?1:o.glow;
    if(REDUCED){ irisState.r = to; applyIris(); return Promise.resolve(); }
    var t0 = performance.now();
    return new Promise(function(res){
      (function loop(now){
        var t = clamp((now-t0)/dur,0,1);
        irisState.r = lerp(from,to,ease(t));
        if(o.follow) { var p = o.follow(t); irisState.x = p.x; irisState.y = p.y; }
        applyIris();
        if(t<1) raf(loop); else res();
      })(t0);
    });
  },
  set: function(o){ if(!o) return; for(var k in o) if(k in irisState) irisState[k]=o[k]; applyIris(); },
  off: function(){ irisState.r = -1; applyIris(); }
};
function flash(o){
  o = o||{};
  var el = L.flash; if(!el || REDUCED) return Promise.resolve();
  var rgb = o.rgb || (o.color ? hexToRgb(o.color) : null) || accentRGB();
  el.style.setProperty('--c', rgba(rgb, 1));
  el.style.setProperty('--peak', (o.peak==null?.92:o.peak));
  el.style.setProperty('--dur', ((o.dur||420))+'ms');
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  if(o.silent !== true) A.impact(o.impact==null?.8:o.impact);
  return wait(o.dur||420);
}
function bloom(o){
  o = o||{};
  var el = L.bloom; if(!el || REDUCED) return Promise.resolve();
  var rgb = o.rgb || accentRGB();
  el.style.setProperty('--c', rgba(rgb,1));
  el.style.setProperty('--x', ((o.x==null?.5:o.x)*100).toFixed(2)+'%');
  el.style.setProperty('--y', ((o.y==null?.5:o.y)*100).toFixed(2)+'%');
  el.style.setProperty('--peak', (o.peak==null?.7:o.peak));
  el.style.setProperty('--dur', ((o.dur||700))+'ms');
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  return wait(o.dur||700);
}
var veil = {
  on:  function(){ if(L.veil) L.veil.classList.add('on'); },
  off: function(dur){ var el=L.veil; if(!el) return Promise.resolve();
    el.style.setProperty('--dur', (dur||420)+'ms'); el.classList.remove('on'); el.classList.add('fade');
    return wait(dur||420).then(function(){ el.classList.remove('fade'); }); },
  in:  function(dur){ var el=L.veil; if(!el) return Promise.resolve();
    el.style.setProperty('--dur', (dur||380)+'ms'); el.classList.add('in');
    return wait(dur||380).then(function(){ el.classList.add('on'); el.classList.remove('in'); }); }
};

var capHandle = null;
function scramble(el, text, o){
  o = o||{};
  if(!el) return Promise.resolve();
  var GL = o.glyphs || 'ｦｧｨｩｪｫｬｭｮｯ01#%&*+=<>/\\|ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var dur = o.dur||520, speed = o.speed||.55;
  var t0 = performance.now();
  el.dataset.orig = el.dataset.orig || el.textContent;
  if(REDUCED){ el.textContent = text; return Promise.resolve(); }
  return new Promise(function(res){
    (function loop(now){
      var t = clamp((now-t0)/dur,0,1);
      var reveal = Math.floor(t*text.length*1.02);
      var out = '';
      for(var i=0;i<text.length;i++){
        if(i < reveal - 1 || text[i]===' ') out += text[i];
        else if(i < reveal + 6) out += GL[(Math.random()*GL.length)|0];
        else out += (Math.random()<speed ? GL[(Math.random()*GL.length)|0] : ' ');
      }
      el.textContent = out;
      if(t<1) raf(loop); else { el.textContent = text; res(); }
    })(t0);
  });
}
function caption(main, sub, o){
  o = o||{};
  var el = L.cap; if(!el || REDUCED) return { kill:function(){}, setText:function(){} };
  var m = el.querySelector('.m'), s = el.querySelector('.s');
  el.classList.add('on');
  if(o.rgb) el.style.setProperty('--c', rgba(o.rgb,1)); else el.style.removeProperty('--c');
  if(o.align) el.dataset.align = o.align;
  m.textContent = main||''; s.textContent = sub||'';
  m.classList.remove('go'); s.classList.remove('go'); void m.offsetWidth;
  m.classList.add('go'); s.classList.add('go');
  if(main) scramble(m, main, {dur:o.dur||460});
  if(sub) scramble(s, sub, {dur:(o.dur||460)+180});
  if(o.autoKill) setTimeout(function(){ kill(); }, o.autoKill);
  function kill(){ el.classList.remove('on'); if(capHandle && capHandle.el===el) capHandle = null; }
  capHandle = { el: el, kill: kill, setText: function(a,b){ m.textContent=a||''; s.textContent=b||''; scramble(m,a||'',{dur:300}); if(b) scramble(s,b,{dur:380}); } };
  return capHandle;
}
var railHandle = null;
function rail(label, o){
  o = o||{};
  var el = L.rail; if(!el) return { set:function(){}, kill:function(){} };
  var lbl = el.querySelector('.lbl'), pct = el.querySelector('.pct'), bar = el.querySelector('.a');
  el.classList.add('on');
  lbl.textContent = label||'';
  if(o.rgb) el.style.setProperty('--c', rgba(o.rgb,1)); else el.style.removeProperty('--c');
  var h = {
    set: function(p, txt){
      bar.style.setProperty('--w', (clamp(p,0,1)*100).toFixed(1)+'%');
      pct.textContent = Math.round(clamp(p,0,1)*100)+'%'+(txt?' · '+txt:'');
    },
    kill: function(){ el.classList.remove('on'); railHandle = null; }
  };
  railHandle = h; h.set(o.value||0);
  return h;
}

/* ============================================================
   6. DOM SHATTER / REASSEMBLE
============================================================ */
function measure(el){ var r = el.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}; }
function shatter(el, o){
  o = o||{};
  var host = L.shards; if(!host || !el || REDUCED) return { restore: function(){}, done: Promise.resolve() };
  var m = measure(el);
  if(m.w<2 || m.h<2) return { restore:function(){}, done:Promise.resolve() };
  var N = o.slices || 16, rgb = o.rgb || accentRGB();
  var clones = [], prevBottom = 0, frag = doc.createDocumentFragment();
  var hidden = [];
  /* slice heights vary — irregular bands read as a real tear */
  var weights = [];
  var total = 0;
  for(var i=0;i<N;i++){ var wgt = rand(.45,1.6); weights.push(wgt); total += wgt; }
  for(var j=0;j<N;j++){
    var top = prevBottom, h = (weights[j]/total)*m.h; prevBottom = top+h;
    var clone = el.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.add('px-clone');
    clone.style.cssText += ';position:fixed;left:'+m.x+'px;top:'+m.y+'px;width:'+m.w+'px;height:'+m.h+'px;margin:0;'
      + 'clip-path:inset('+top+'px 0 '+(m.h-(top+h))+'px 0);z-index:2;pointer-events:none;overflow:hidden;';
    /* physics per band */
    var dir = (j%2 ? 1 : -1);
    var dx = dir*rand(30, m.w*.55)*(o.spread||1) + rand(-40,40);
    var dy = rand(-m.h*.25, m.h*.9)*(o.fall==null?1:o.fall);
    var rot = rand(-42,42)*(o.spin||1);
    var sc  = rand(.72,1.18);
    var delay = (j/N)*90 + rand(0,60);
    var dur = (o.dur||900) + rand(-120,260);
    var anim = clone.animate([
      { transform:'translate3d(0,0,0) rotate(0) scale(1)', opacity:1, filter:'none', offset:0 },
      { transform:'translate3d('+(dx*.12)+'px,'+(dy*.06)+'px,0) rotate('+(rot*.1)+'deg) scale('+(1+ (o.bulge||.04) *Math.sin(j))+')',
        opacity:1, filter:'brightness('+(1.6+Math.random()).toFixed(2)+')', offset:.14, easing:'cubic-bezier(.16,1,.3,1)' },
      { transform:'translate3d('+(dx*.7)+'px,'+(dy*.42)+'px,0) rotate('+(rot*.6)+'deg) scale('+sc.toFixed(3)+')',
        opacity:.85, filter:'brightness(1.1)', offset:.62, easing:'cubic-bezier(.5,0,.75,.2)' },
      { transform:'translate3d('+dx+'px,'+dy+'px,0) rotate('+rot+'deg) scale('+(sc*.7).toFixed(3)+')',
        opacity:0, filter:'blur(9px) brightness(.5)', offset:1 }
    ], { duration:dur, delay:delay, easing:'linear', fill:'both' });
    clones.push({node:clone, anim:anim});
    frag.appendChild(clone);
  }
  /* ghost frame: a bright outline of where the object was */
  var ghost = doc.createElement('div');
  ghost.className = 'px-ghost';
  ghost.style.cssText = 'position:fixed;left:'+m.x+'px;top:'+m.y+'px;width:'+m.w+'px;height:'+m.h+'px;border:1px solid '+rgba(rgb,.9)+';box-shadow:0 0 30px '+rgba(rgb,.5)+', inset 0 0 40px '+rgba(rgb,.2)+';';
  ghost.animate([{opacity:0,transform:'scale(1.02)'},{opacity:1,transform:'scale(1)',offset:.1},{opacity:0,transform:'scale(.96)'}],{duration:o.dur||900,easing:'ease-out',fill:'both'});
  frag.appendChild(ghost);
  host.appendChild(frag);
  /* hide originals */
  var hideTargets = o.hide || [el];
  hideTargets.forEach(function(t){ if(!t) return; hidden.push([t, t.style.visibility]); t.style.visibility='hidden'; });
  host.classList.add('on');
  var done = Promise.all(clones.map(function(c){ return c.anim.finished.catch(function(){}); })).then(function(){
    clones.forEach(function(c){ if(c.node.parentNode) c.node.parentNode.removeChild(c.node); });
    if(ghost.parentNode) ghost.parentNode.removeChild(ghost);
    host.classList.remove('on');
    hidden.forEach(function(p){ p[0].style.visibility = p[1]; });
  });
  return { restore: function(){ done; clones.forEach(function(c){ try{c.anim.cancel();}catch(e){} if(c.node.parentNode) c.node.parentNode.removeChild(c.node); });
                         if(ghost.parentNode) ghost.parentNode.removeChild(ghost); host.classList.remove('on');
                         hidden.forEach(function(p){ p[0].style.visibility = p[1]; }); },
           done: done, count: clones.length };
}
function assemble(el, o){
  o = o||{};
  var host = L.shards; if(!host || !el || REDUCED) return Promise.resolve();
  var m = measure(el); if(m.w<2||m.h<2) return Promise.resolve();
  var N = o.slices || 12, clones = [], frag = doc.createDocumentFragment();
  el.style.visibility = 'hidden';
  for(var i=0;i<N;i++){
    var top = (i/N)*m.h, h = m.h/N;
    var clone = el.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.add('px-clone');
    clone.style.cssText += ';position:fixed;left:'+m.x+'px;top:'+m.y+'px;width:'+m.w+'px;height:'+m.h+'px;margin:0;'
      + 'clip-path:inset('+top+'px 0 '+(m.h-(top+h))+'px 0);z-index:2;pointer-events:none;overflow:hidden;';
    var from = (i%2?-1:1)*rand(m.w*.4, m.w*1.2);
    var anim = clone.animate([
      { transform:'translate3d('+from+'px,'+rand(-40,40)+'px,0) rotate('+rand(-25,25)+'deg) scale(1.1)', opacity:0, filter:'blur(10px) brightness(2)', offset:0 },
      { transform:'translate3d('+(from*.18)+'px,0,0) rotate('+(o.jitter?rand(-2,2):0)+'deg) scale(1.02)', opacity:1, filter:'blur(1px) brightness(1.4)', offset:.62, easing:'cubic-bezier(.16,1,.3,1)' },
      { transform:'translate3d(0,0,0) rotate(0) scale(1)', opacity:1, filter:'none', offset:1 }
    ], { duration:(o.dur||620)+rand(-60,120), delay:i*(o.stagger||16), easing:'cubic-bezier(.16,1,.3,1)', fill:'both' });
    clones.push({node:clone, anim:anim});
    frag.appendChild(clone);
  }
  host.appendChild(frag);
  host.classList.add('on');
  return Promise.all(clones.map(function(c){ return c.anim.finished.catch(function(){}); })).then(function(){
    clones.forEach(function(c){ if(c.node.parentNode) c.node.parentNode.removeChild(c.node); });
    host.classList.remove('on');
    el.style.visibility = '';
  });
}
/* quick per-element glitch (no clone swap — pure transform chaos) */
function glitchEl(el, o){
  o = o||{};
  if(!el || REDUCED) return Promise.resolve();
  var dur = o.dur||360, n = o.slices||5, bands = [], frag = doc.createDocumentFragment();
  var m = measure(el);
  for(var i=0;i<n;i++){
    var b = doc.createElement('div');
    b.className = 'px-band';
    var y = rand(0,m.h*.9), h = rand(2, Math.max(4,m.h*.14));
    b.style.cssText = 'position:fixed;left:'+m.x+'px;top:'+(m.y+y)+'px;width:'+m.w+'px;height:'+h+'px;'
      + 'background:'+rgba(o.rgb||accentRGB(), rand(.12,.5))+';mix-blend-mode:screen;';
    b.animate([
      { transform:'translateX(0) scaleX(1)', opacity:0 },
      { transform:'translateX('+rand(-m.w*.3,m.w*.3)+'px) scaleX('+rand(.6,1.5).toFixed(2)+')', opacity:1, offset:.3 },
      { transform:'translateX('+rand(-m.w*.4,m.w*.4)+'px) scaleX(1)', opacity:0 }
    ], { duration: rand(dur*.4, dur), iterations: Math.max(2,(o.repeat||3)), easing:'steps(3)' });
    frag.appendChild(b); bands.push(b);
  }
  L.shards.appendChild(frag);
  L.shards.classList.add('on');
  if(el.animate){
    try{
      el.animate([
        {transform:'none',filter:'none'},
        {transform:'translate3d('+(o.amp?rand(-o.amp,o.amp):-4)+'px,0,0) skewX('+rand(-3,3).toFixed(2)+'deg)',filter:'hue-rotate('+rand(-40,40).toFixed(0)+'deg)',offset:.2},
        {transform:'translate3d('+rand(-6,6).toFixed(1)+'px,'+rand(-2,2).toFixed(1)+'px,0)',filter:'invert(1)',offset:.45},
        {transform:'none',filter:'none'}
      ], {duration:dur, easing:'steps(6)'});
    }catch(e){}
  }
  return wait(dur).then(function(){ bands.forEach(function(b){ if(b.parentNode) b.parentNode.removeChild(b); }); L.shards.classList.remove('on'); });
}

/* ============================================================
   7. MOVES — authored exit + entry halves
============================================================ */
var busy = false;
function heroEl(o){
  if(!o) return null;
  if(o.target) return typeof o.target==='string' ? doc.querySelector(o.target) : o.target;
  var sel = ['[data-px-hero]','.terminal-container','#hero','#stage','main','body>*:nth-child(2)'];
  for(var i=0;i<sel.length;i++){ var e = doc.querySelector(sel[i]); if(e) return e; }
  return null;
}
function lockPage(on){
  doc.documentElement.classList.toggle('px-active', !!on);
  var mv = [];
  if(on){
    ['.pk-cursor','#pk-cursor','#pk-toasts'].forEach(function(sel){
      var e = doc.querySelector(sel); if(e && e.parentNode!==rig){ rig.appendChild(e); mv.push([e, doc.body]); }
    });
  } else {
    mv = lockPage._mv || [];
  }
  lockPage._mv = mv;
  if(!on){
    mv.forEach(function(p){ if(p[0] && p[1] && p[0].parentNode!==p[1]) p[1].appendChild(p[0]); });
    lockPage._mv = [];
  }
}

/* ---------- shared: dive into a singularity (works on any page) ---------- */
function diveExit(o){
  o = o||{};
  var rgb = o.rgb || accentRGB();
  var dur = o.dur||2600;
  var cx = o.x==null?.5:o.x, cy = o.y==null?.5:o.y;
  var target = o.target || heroEl(o);
  var h;
  A.resume();
  return Promise.resolve().then(function(){
    if(o.silent!==true){ A.riser(dur*.42/1000); A.hiss(dur*.4/1000); }
    h = rail(o.label||'EVENT HORIZON', {rgb:rgb});
    caption(o.caption||'DIVE', o.sub||'SINGULARITY LOCK', {rgb:rgb});
    FX.add({
      draw: function(cc,w,hh,t,dt){
        var p = clamp(t/(dur/1000),0,1), e = E.iQu(p);
        var ox = cx*w, oy = cy*hh, R = Math.max(w,hh)*(.5-.46*e);
        /* accretion ring */
        for(var i=0;i<3;i++){
          var rr = R*(1.02+i*.06), a = (.5-i*.13)*(1-e*.5);
          cc.strokeStyle = rgba(i===1?[255,255,255]:rgb, a);
          cc.lineWidth = 1.4+i*2.2;
          cc.beginPath();
          for(var k=0;k<=64;k++){
            var an = k/64*Math.PI*2 + t*(1.6+i*.5);
            var wob = 1 + Math.sin(an*3+t*4)*.035*(1-e);
            var x = ox+Math.cos(an)*rr*wob, y = oy+Math.sin(an)*rr*wob*.86;
            if(k===0) cc.moveTo(x,y); else cc.lineTo(x,y);
          }
          cc.closePath(); cc.stroke();
        }
        /* infalling streaks */
        var n = LOW?26:80;
        for(var s=0;s<n;s++){
          var ang = (s/n)*Math.PI*2 + Math.sin(t*.7+s)*.6;
          var r0 = Math.max(w,hh)*.75*(1-e*.9), r1 = r0*.55;
          cc.strokeStyle = rgba(s%7===0?[255,255,255]:rgb, .3*(1-p*.4));
          cc.lineWidth = 1.1;
          cc.beginPath();
          cc.moveTo(ox+Math.cos(ang)*r0, oy+Math.sin(ang)*r0*.86);
          cc.lineTo(ox+Math.cos(ang+.12)*r1, oy+Math.sin(ang+.12)*r1*.86);
          cc.stroke();
        }
        if(t>dur/1000) this.dead = true;
      }
    });
    FX.debris({ rgb:rgb, pull:2600, swirl:900, count:LOW?90:230, dur:dur/1000*.95, from:'edges', cx:cx*win.innerWidth, cy:cy*win.innerHeight });
    FX.bars({ rgb:rgb, until:dur*.55, dur:dur*.6, max:7 });

    PX_FILTER.tween({ chroma:[0,22], warp:[0,16], tear:[0,9], bright:[0,.28], sat:[0,1.4] }, dur*.5, 'oC');
    PX_CAMERA.tween({ scale: o.zoom||1.28, rot: o.roll==null?4:o.roll, ox:cx, oy:cy }, dur*.8, 'iQu');
    if(target) setTimeout(function(){ try{ shatter(target, {rgb:rgb, slices:o.slices||14, dur:dur*.72, spread:1.25, fall:.62, spin:1.5, hide:o.hide}); }catch(e){} }, dur*.18);
    if(o.silent!==true) setTimeout(function(){ A.stutter(16, dur*.42); }, dur*.12);
    if(h) { var t0=performance.now(); (function u(){ if(!railHandle) return; var p=clamp((performance.now()-t0)/dur,0,1); h.set(E.oC(p)); if(p<1) raf(u); })(); }
    /* the collapse itself */
    return PX_IRIS.to({ from:1.55, to:0, dur:dur*.72, x:cx, y:cy, edge:.05, tint:o.tint, rgb:rgb })
      .then(function(){ if(o.silent!==true) A.sub_drop(); return wait(dur*.1); });
  }).then(function(){ if(h) h.kill(); return wait(0); });
}
function diveEnter(o){
  o = o||{};
  var rgb = o.rgb || accentRGB();
  var dur = o.dur||1000;
  veil.on();
  A.resume();
  FX.rings({ rgb:rgb, r0:6, r1:Math.max(win.innerWidth,win.innerHeight)*1.15, dur:dur/1000, count:4, width:3, chroma:true });
  FX.starfield({ count: LOW?200:520, rgb:rgb, until:dur+260, power:function(t){ return lerp(520, 12, E.oQu5(clamp(t/(dur/1000),0,1))); } });
  PX_FILTER.set({ chroma:0, warp:0, tear:0, blur:0, bright:0, sat:0 });
  return Promise.all([
    PX_IRIS.to({ from:0, to:1.6, dur:dur, x:o.x==null?.5:o.x, y:o.y==null?.5:o.y, edge:.16, rgb:rgb }),
    PX_FILTER.tween({ chroma:[26,0], warp:[22,0], tear:[12,0], bright:[.9,0], blur:[3,0] }, dur, 'oQu5'),
    PX_CAMERA.tween({ scale:1.35, rot:-3 }, 1, 'lin').then(function(){ return PX_CAMERA.tween({scale:1, rot:0}, dur, 'oQu5'); }),
    veil.off(dur*.8),
    wait(0)
  ]).then(function(){
    PX_IRIS.off(); PX_FILTER.reset(); PX_CAMERA.reset();
    if(o.silent!==true){ A.portal(); A.impact(.55); }
    if(o.caption) caption(o.caption, o.sub, {rgb:rgb, autoKill:900});
  });
}

/* ---------- warp ---------- */
function warpExit(o){
  o = o||{};
  var rgb = o.rgb || accentRGB(), dur = o.dur||1500;
  A.resume();
  caption(o.caption||'WARP', o.sub||'ENGAGING', {rgb:rgb});
  A.riser(dur*.72/1000);
  FX.starfield({ rgb:rgb, swirl:o.swirl==null?160:o.swirl, power:function(t){ var p=clamp(t/(dur/1000),0,1); return lerp(6, 760, E.iQu(p)); } });
  FX.debris({ rgb:rgb, from:'center', pull:-200, count:LOW?60:150, dur:dur/1000 });
  PX_FILTER.tween({ chroma:[0,26], warp:[0,10], bright:[0,.5], sat:[0,1] }, dur*.75, 'iQu');
  PX_CAMERA.tween({ scale:1.16, persp: 1200 }, dur, 'iQu');
  PX_CAMERA.shake({ amp:7, dur:dur, decay:1.2 });
  return Promise.all([ PX_IRIS.to({from:1.5,to:.32,dur:dur,x:.5,y:.5,edge:.02,rgb:rgb}), wait(dur*.86) ])
    .then(function(){ A.impact(1); flash({rgb:rgb, peak:1, dur:260}); return wait(160); });
}
function warpEnter(o){
  o = o||{};
  var rgb = o.rgb || accentRGB(), dur = o.dur||900;
  veil.on();
  FX.starfield({ rgb:rgb, until:dur+240, power:function(t){ var p=clamp(t/(dur/1000),0,1); return lerp(700, 8, E.oQu5(p)); }, swirl:120 });
  return Promise.all([
    PX_IRIS.to({from:.3,to:1.6,dur:dur,edge:.1,rgb:rgb}),
    PX_FILTER.tween({ chroma:[22,0], bright:[.6,0], blur:[2.5,0] }, dur, 'oQu5'),
    PX_CAMERA.tween({ scale:1.16 }, 1, 'lin').then(function(){ return PX_CAMERA.tween({scale:1, persp:0}, dur, 'oQu5'); }),
    veil.off(dur*.6)
  ]).then(function(){ PX_IRIS.off(); PX_FILTER.reset(); PX_CAMERA.reset(); A.chime(true); });
}

/* ---------- iris / pinhole (default for normal links) ---------- */
function irisExit(o){
  o = o||{};
  var rgb = o.rgb || accentRGB(), dur = o.dur||520;
  var x = o.x==null?.5:o.x, y = o.y==null?.5:o.y;
  A.resume(); A.whoosh(.7);
  PX_FILTER.tween({ chroma:[0,9], bright:[0,.16], warp:[0,5] }, dur*.5, 'oQ');
  PX_CAMERA.tween({ scale:o.zoom||1.09, x:(.5-x)*90, y:(.5-y)*70 }, dur, 'ioQu5');
  FX.rings({ rgb:rgb, r0: Math.max(win.innerWidth,win.innerHeight)*.05, r1: Math.max(win.innerWidth,win.innerHeight)*.42, dur:.6, count:2, cx:x*win.innerWidth, cy:y*win.innerHeight, chroma:true });
  return PX_IRIS.to({ from:1.5, to:0, dur:dur, x:x, y:y, edge:.045, rgb:rgb })
    .then(function(){ A.impact(.5); return wait(60); });
}
function irisEnter(o){
  o = o||{};
  var rgb = o.rgb || accentRGB(), dur = o.dur||560;
  veil.on();
  FX.rings({ rgb:rgb, r0:10, r1:Math.max(win.innerWidth,win.innerHeight)*.85, dur:dur/1000*1.1, count:3, chroma:true });
  return Promise.all([
    PX_IRIS.to({ from:0, to:1.6, dur:dur, edge:.12, x:o.x==null?.5:o.x, y:o.y==null?.5:o.y, rgb:rgb }),
    PX_CAMERA.tween({ scale:1.07 }, 1, 'lin').then(function(){ return PX_CAMERA.tween({scale:1}, dur, 'oQu5'); }),
    PX_FILTER.tween({ chroma:[12,0], bright:[.3,0] }, dur, 'oQu5'),
    veil.off(dur*.55)
  ]).then(function(){ PX_IRIS.off(); PX_FILTER.reset(); PX_CAMERA.reset(); A.blip(880); });
}

/* ---------- shatter ---------- */
function shatterExit(o){
  o = o||{};
  var rgb = o.rgb || accentRGB(), dur = o.dur||900;
  var t = o.target || heroEl(o);
  A.resume(); A.crack(); A.whoosh(.9);
  var s = null;
  if(t) s = shatter(t, { rgb:rgb, slices:o.slices||16, dur:dur*.9, hide:o.hide });
  FX.debris({ rgb:rgb, count:LOW?80:220, dur:dur/1000, pull:o.pull==null?900:o.pull, from:'edges' });
  PX_FILTER.tween({ chroma:[0,16], tear:[0,12], bright:[0,.3] }, dur*.4, 'oC');
  PX_CAMERA.shake({ amp:14, dur:dur*.5, decay:2.6, roll:.5 });
  return Promise.all([ s?s.done:Promise.resolve(), wait(dur) ])
    .then(function(){ return PX_IRIS.to({from:1.3,to:0,dur:dur*.5,x:o.x==null?.5:o.x,y:o.y==null?.5:o.y,rgb:rgb}); });
}
function shatterEnter(o){
  o = o||{};
  var rgb = o.rgb || accentRGB(), dur = o.dur||700;
  var t = o.target || heroEl(o);
  veil.on();
  var p = t ? assemble(t, { rgb:rgb, slices:o.slices||12, dur:dur, stagger:18 }) : Promise.resolve();
  if(!t) FX.bars({ rgb:rgb, until:dur, dur:dur, max:6 });
  return Promise.all([ p, PX_FILTER.tween({ chroma:[18,0], tear:[10,0], bright:[.5,0], blur:[3,0] }, dur, 'oQu5'),
                       PX_IRIS.to({from:0,to:1.6,dur:dur*.7,edge:.1,rgb:rgb}), veil.off(dur*.4) ])
    .then(function(){ PX_IRIS.off(); PX_FILTER.reset(); PX_CAMERA.reset(); A.chime(); });
}

/* ---------- flash (cheap, for small hops) ---------- */
function flashExit(o){
  o = o||{}; var rgb = o.rgb || accentRGB();
  A.resume(); A.sweep(.28, true);
  PX_FILTER.tween({ chroma:[0,10], bright:[0,.4] }, o.dur||260, 'oC');
  return flash({ rgb:rgb, peak:.8, dur:o.dur||300, impact:.45 }).then(function(){ PX_FILTER.reset(); });
}
function flashEnter(o){
  o = o||{}; var rgb = o.rgb || accentRGB();
  veil.on();
  return Promise.all([ flash({rgb:rgb, peak:.55, dur:280, silent:true}), PX_FILTER.tween({bright:[.5,0], chroma:[10,0]}, 340, 'oQu5'), veil.off(260) ])
    .then(function(){ PX_FILTER.reset(); });
}

/* ---------- breach: hostile takeover (used by secret.html) ---------- */
function breachExit(o){
  o = o||{};
  var rgb = o.rgb || [191,0,255], dur = o.dur||1100;
  A.resume();
  A.scream(); A.stutter(22, dur*.6);
  FX.bars({ rgb:rgb, until:dur, dur:dur, max:9, thick:30 });
  FX.debris({ rgb:rgb, count:LOW?70:180, pull:1400, swirl:1200, dur:dur/1000 });
  PX_FILTER.tween({ chroma:[0,34], tear:[0,26], warp:[0,22], invert:[0,.6], bright:[0,.6] }, dur*.55, 'iQu');
  PX_CAMERA.tween({ scale:1.22, rot:2.5 }, dur*.6, 'iQu');
  PX_CAMERA.shake({ amp:26, dur:dur, decay:1.6, roll:1 });
  return Promise.all([ PX_IRIS.to({from:1.5,to:.02,dur:dur*.8,edge:.03,rgb:rgb}), wait(dur) ])
    .then(function(){ A.impact(1.2); PX_FILTER.reset(); PX_CAMERA.reset(); PX_IRIS.off(); return wait(90); });
}

/* ---------- corrupt: hard crash out ---------- */
function corruptExit(o){
  o = o||{};
  var rgb = o.rgb || [255,40,60], dur = o.dur||1300;
  A.resume(); A.stutter(30, dur*.8); A.hiss(dur/1000);
  FX.bars({ rgb:rgb, until:dur, dur:dur, max:14, thick:40 });
  PX_FILTER.tween({ invert:[0,1], chroma:[0,44], tear:[0,44], warp:[0,26], sat:[0,3] }, dur*.8, 'ioQu5');
  PX_CAMERA.shake({ amp:34, dur:dur, decay:.9, roll:1.6 });
  PX_CAMERA.tween({ scale:1.06 }, dur*.8, 'iQu');
  return wait(dur*.72).then(function(){
    PX_FILTER.tween({ blur:[0,22], bright:[0,-.7] }, 220, 'iC');
    A.impact(1.3);
    return wait(300);
  }).then(function(){ PX_FILTER.reset(); PX_CAMERA.reset(); });
}

var MOVES = {
  dive:    { exit:diveExit,    enter:diveEnter },
  warp:    { exit:warpExit,    enter:warpEnter },
  iris:    { exit:irisExit,    enter:irisEnter },
  shutter: { exit:irisExit,    enter:irisEnter },
  shatter: { exit:shatterExit, enter:shatterEnter },
  flash:   { exit:flashExit,   enter:flashEnter },
  breach:  { exit:breachExit,  enter:function(o){ return irisEnter(o); } },
  corrupt: { exit:corruptExit, enter:function(o){ return shatterEnter(o); } },
  none:    { exit:function(){return Promise.resolve();}, enter:function(){return Promise.resolve();} }
};

/* ============================================================
   8. PUBLIC
============================================================ */
function play(name, o){
  o = o||{};
  var m = MOVES[name] || MOVES.iris;
  if(REDUCED){ return Promise.resolve(); }
  if(busy && !o.force) return Promise.resolve();
  busy = true;
  syncAccent();
  lockPage(true);
  var phase = o.phase || 'exit';
  var fn = (phase==='enter' ? m.enter : m.exit) || function(){ return Promise.resolve(); };
  var guard = new Promise(function(res){ setTimeout(res, (o.hardTimeout||3600)); });
  return Promise.race([ Promise.resolve().then(function(){ return fn(o); }).catch(function(e){}), guard ])
    .then(function(){ busy = false; lockPage(false); if(o.release !== false){ PX_FILTER.reset(); PX_CAMERA.reset(); } });
}
function go(href, name, o){
  o = o||{};
  if(!href){ return; }
  if(REDUCED){ nav(href); return; }
  name = name || 'iris';
  PX_HANDOFF.write(name, o);
  var fired = false;
  function navOnce(){ if(fired) return; fired = true; nav(href); }
  setTimeout(navOnce, o.hardTimeout || 2600);
  play(name, Object.assign({}, o, {phase:'exit', release:false})).then(navOnce).catch(navOnce);
}
function nav(href){ try{ win.location.href = href; }catch(e){} }

var PX_HANDOFF = {
  write: function(name, o){
    sset('px_h', JSON.stringify({ m:name, t:Date.now(), rgb:o.rgb||null, x:o.x==null?null:o.x, y:o.y==null?null:o.y, cap:o.enterCaption||null }));
  },
  read: function(){
    var raw = sget('px_h'); if(!raw) return null;
    sdel('px_h');
    try { var h = JSON.parse(raw); if(Date.now()-h.t > 5000) return null; return h; } catch(e){ return null; }
  }
};

var PX = {
  REDUCED:REDUCED, LOW:LOW, COARSE:COARSE, DPR:DPR, E:E,
  sfx: A,
  fx: FX,
  camera: PX_CAMERA,
  filter: PX_FILTER,
  iris: PX_IRIS,
  flash: flash, bloom: bloom, veil: veil,
  caption: caption, rail: rail, scramble: scramble,
  shatter: shatter, assemble: assemble, glitch: glitchEl,
  play: play, go: go,
  onEnter: function(cb){ PX._enterCb = cb; return PX; },
  syncAccent: syncAccent,
  handoff: PX_HANDOFF,
  moves: MOVES,
  busy: function(){ return busy; },
  reset: function(){ PX_FILTER.reset(); PX_CAMERA.reset(); PX_IRIS.off(); if(capHandle) capHandle.kill(); if(railHandle) railHandle.kill(); },
  enter: function(name, o){
    o = o||{};
    name = name || 'iris';
    var m = MOVES[name] || MOVES.iris;
    if(REDUCED){ veil.off(1); return Promise.resolve(); }
    if(o.heavy === false) {}
    return Promise.resolve().then(function(){ return m.enter ? m.enter(o) : null; })
      .catch(function(){}).then(function(){ PX_FILTER.reset(); PX_CAMERA.reset(); PX_IRIS.off(); });
  }
};

/* ============================================================
   9. ENTRY — resume the exit that just happened
============================================================ */
var entered = false, PENDING = null;
/* Detect the handoff at parse time — the veil must exist before first paint,
   otherwise the arriving page pops in and the illusion dies. */
(function earlyHandoff(){
  if(!doc.documentElement) return;
  var h = PX_HANDOFF.read();
  if(!h) return;
  PENDING = h;
  doc.documentElement.classList.add('px-entering');
  if(L.veil) L.veil.classList.add('on');
})();
function autoEnter(){
  if(entered) return; entered = true;
  var h = PENDING; PENDING = null;
  if(!h){ if(L.veil) L.veil.classList.remove('on'); return; }
  var rgb = h.rgb || null;
  var o = { rgb: rgb, x: h.x==null?.5:h.x, y: h.y==null?.5:h.y, dur: 820 };
  var name = h.m || 'iris';
  veil.on();
  Promise.race([ PX.enter(name, o), wait(1500) ]).then(function(){
    doc.documentElement.classList.remove('px-entering');
    veil.off(200);
    if(PX._enterCb){ var cb = PX._enterCb; PX._enterCb = null; try{ cb(); }catch(e){} }
  });
  /* never leave the user staring at black */
  setTimeout(function(){ doc.documentElement.classList.remove('px-entering'); veil.off(200); }, 2200);
}
if(doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', autoEnter, {once:true});
else autoEnter();
/* hard safety: any stuck veil dies */
setTimeout(function(){ doc.documentElement.classList.remove('px-entering'); if(L.veil) L.veil.classList.remove('on'); }, 2600);

/* pointer-driven parallax is subtle but makes the rig feel physical */
var pointer = { x:.5, y:.5 };
win.addEventListener('pointermove', function(e){ pointer.x = e.clientX/win.innerWidth; pointer.y = e.clientY/win.innerHeight; }, {passive:true});
PX.pointer = pointer;

/* global so pages can call it directly */
global.PX = PX;

})(typeof window !== 'undefined' ? window : this);
