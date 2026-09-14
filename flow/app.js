(()=>{"use strict";const r=document.documentElement;
r.classList.remove("no-js");
const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
function syncMeta(){const dark=r.dataset.theme!=="light";
let single=document.querySelector('meta[name="theme-color"]:not([media])');
if(!single){single=document.createElement("meta");single.name="theme-color";document.head.appendChild(single)}
single.content=dark?"#000000":"#ffffff"}
function paint(){const t=document.getElementById("themeBtn");
if(t){t.textContent=r.dataset.theme==="dark"?"\u263E":"\u2600"}}
function setTheme(n){r.dataset.theme=n;
try{localStorage.setItem("acm-theme",n)}catch(e){}paint();syncMeta()}
const tb=document.getElementById("themeBtn");
if(tb){tb.addEventListener("click",function(){
const n=r.dataset.theme==="dark"?"light":"dark";
if(document.startViewTransition&&!reduced){document.startViewTransition(function(){setTheme(n)})}
else{setTheme(n)}})}
paint();syncMeta();
const panel=document.getElementById("mpanel"),menu=document.getElementById("menuBtn");
function openM(o){if(!panel){return}panel.classList.toggle("open",o);
document.body.style.overflow=o?"hidden":""}
if(menu&&panel){menu.addEventListener("click",function(){openM(!panel.classList.contains("open"))})}
if(panel){panel.addEventListener("click",function(e){
if(e.target.closest("[data-close]")||e.target===panel){openM(false)}})}
addEventListener("keydown",function(e){if(e.key==="Escape"){openM(false)}});
const here=(location.pathname.split("/").pop()||"index.html").toLowerCase().split("?")[0];
function mark(a){const h=(a.getAttribute("href")||"").toLowerCase().replace("./","");
a.classList.toggle("on",h===here||(here===""&&h==="index.html"))}
document.querySelectorAll(".tabs a").forEach(mark);
document.querySelectorAll(".msheet a[data-nav]").forEach(mark);
const nav=document.querySelector(".nav");
addEventListener("scroll",function(){if(nav){nav.classList.toggle("scrolled",(scrollY||0)>8)}},{passive:true});
document.querySelectorAll(".card,.fnode").forEach(function(c){
c.addEventListener("pointermove",function(e){
const b=c.getBoundingClientRect();
c.style.setProperty("--fx",((e.clientX-b.left)/b.width*100)+"%");
c.style.setProperty("--fy",((e.clientY-b.top)/b.height*100)+"%")},{passive:true})});
document.querySelectorAll("[data-copy]").forEach(function(btn){
btn.addEventListener("click",function(){
const pre=btn.parentElement.querySelector("pre");if(!pre){return}
const done=function(t){btn.textContent=t;setTimeout(function(){btn.textContent="Copy"},1400)};
if(navigator.clipboard&&navigator.clipboard.writeText){
navigator.clipboard.writeText(pre.innerText).then(function(){done("Copied")},function(){done("Select + Ctrl+C")})}
else{done("Select + Ctrl+C")}})});
document.querySelectorAll(".ctabs").forEach(function(g){
const btns=Array.prototype.slice.call(g.querySelectorAll("button"));
btns.forEach(function(b){b.addEventListener("click",function(){
btns.forEach(function(x){x.classList.remove("on")});b.classList.add("on");
const id=b.getAttribute("data-tab");if(!id||!g.parentElement){return}
const panes=g.parentElement.querySelectorAll("[data-pane]");
panes.forEach(function(p){p.hidden=p.getAttribute("data-pane")!==id})})})});
const yr=document.getElementById("yr");if(yr){yr.textContent=new Date().getFullYear()}
const hasGsap=(typeof gsap!=="undefined")&&(typeof ScrollTrigger!=="undefined");
if(!hasGsap||reduced){r.classList.add("no-gsap");
const els=document.querySelectorAll(".reveal");
if(!("IntersectionObserver" in window)){els.forEach(function(e){e.classList.add("in")})}
else{const io=new IntersectionObserver(function(es){
es.forEach(function(en){if(en.isIntersecting){en.target.classList.add("in");io.unobserve(en.target)}})},{threshold:.1});
els.forEach(function(e){io.observe(e)})}}
if(hasGsap&&!reduced){try{
r.style.scrollBehavior="auto";
gsap.registerPlugin(ScrollTrigger);
gsap.from(".hero-in > *",{y:26,opacity:0,duration:.8,stagger:.09,ease:"power3.out",clearProps:"all"});
gsap.utils.toArray(".reveal").forEach(function(el){
if(el.matches(".grid3 .card")){return}
gsap.fromTo(el,{y:24,opacity:0},{y:0,opacity:1,duration:.7,ease:"power3.out",
scrollTrigger:{trigger:el,start:"top 88%",once:true}})});
const batchCards=gsap.utils.toArray(".grid3 .card");
if(batchCards.length){gsap.set(batchCards,{y:28,opacity:0});
ScrollTrigger.batch(batchCards,{start:"top 88%",once:true,interval:.1,batchMax:3,
onEnter:function(batch){gsap.to(batch,{y:0,opacity:1,duration:.7,
ease:"power3.out",stagger:.12,overwrite:true})}});}
document.querySelectorAll(".stat b[data-count]").forEach(function(b){
const end=parseFloat(b.getAttribute("data-count"));const o={v:0};
function tick(){b.textContent=Math.round(o.v).toLocaleString("en-US")}
function play(){gsap.to(o,{v:end,duration:1.4,ease:"power2.out",onUpdate:tick})}
ScrollTrigger.create({trigger:b,start:"top 92%",once:true,onEnter:play});
});
addEventListener("load",function(){ScrollTrigger.refresh()});
}catch(err){r.classList.add("no-gsap")}}
(function(){if(reduced){return}
const cv=document.createElement("canvas");cv.id="bg-net";cv.setAttribute("aria-hidden","true");
document.body.prepend(cv);const cx=cv.getContext("2d");
let W=0,H=0,pts=[],run=true,mx=-999,my=-999;
const dark=function(){return r.dataset.theme!=="light"};
function fit(){const d=Math.min(devicePixelRatio||1,1.5);
W=innerWidth;H=innerHeight;cv.width=W*d;cv.height=H*d;
cv.style.width=W+"px";cv.style.height=H+"px";cx.setTransform(d,0,0,d,0,0);
const n=Math.min(90,(W*H/22000)|0);pts=[];
for(let i=0;i<n;i++){pts.push({x:Math.random()*W,y:Math.random()*H,
vx:(Math.random()-.5)*.35,vy:(Math.random()-.5)*.35})}}
addEventListener("resize",fit,{passive:true});fit();
addEventListener("pointermove",function(e){mx=e.clientX;my=e.clientY},{passive:true});
new IntersectionObserver(function(es){run=es[0].isIntersecting},{threshold:0}).observe(cv);
document.addEventListener("visibilitychange",function(){run=!document.hidden});
(function frame(){requestAnimationFrame(frame);
if(!run||document.hidden){return}
cx.clearRect(0,0,W,H);
const mono=dark()?"255,255,255":"0,0,0";
for(const p of pts){p.x+=p.vx;p.y+=p.vy;
if(p.x<0||p.x>W){p.vx*=-1}if(p.y<0||p.y>H){p.vy*=-1}}
for(let i=0;i<pts.length;i++){const a=pts[i];
for(let j=i+1;j<pts.length;j++){const b=pts[j];
const dx=a.x-b.x,dy=a.y-b.y,d=dx*dx+dy*dy;
if(d<150*150){cx.strokeStyle="rgba("+mono+","+(0.10*(1-d/22500)).toFixed(3)+")";
cx.lineWidth=1;cx.beginPath();cx.moveTo(a.x,a.y);cx.lineTo(b.x,b.y);cx.stroke()}}}
for(const p of pts){const dm=(p.x-mx)*(p.x-mx)+(p.y-my)*(p.y-my);
const glow=dm<120*120?0.5:0.22;
cx.fillStyle="rgba("+mono+","+glow.toFixed(2)+")";
cx.beginPath();cx.arc(p.x,p.y,dm<120*120?1.8:1.2,0,6.283);cx.fill()}})();
})();
const prog=document.getElementById("progress"),topBtn=document.getElementById("toTop");
function onPos(){const h=document.documentElement;
const max=h.scrollHeight-h.clientHeight;
const p=max>0?(h.scrollTop||document.body.scrollTop)/max:0;
if(prog){prog.style.transform="scaleX("+p+")"}
if(topBtn){topBtn.classList.toggle("show",(h.scrollTop||0)>600)}}
addEventListener("scroll",onPos,{passive:true});onPos();
if(topBtn){topBtn.addEventListener("click",function(){
scrollTo({top:0,behavior:reduced?"auto":"smooth"})})}
if(hasGsap&&!reduced){try{
gsap.to(".hero-in",{yPercent:-10,autoAlpha:.25,ease:"none",
scrollTrigger:{trigger:".hero",start:"top top",end:"bottom top",scrub:true}});
gsap.utils.toArray(".flow").forEach(function(f){
const items=f.querySelectorAll(".fnode");
if(items.length){gsap.fromTo(items,{y:34,autoAlpha:0},
{y:0,autoAlpha:1,duration:.6,stagger:.18,ease:"power3.out",
scrollTrigger:{trigger:f,start:"top 82%",once:true}})}});
}catch(err){}}
const fine=matchMedia("(pointer:fine)").matches;
if(fine&&!reduced){
const dot=document.createElement("div");dot.id="cursor";dot.setAttribute("aria-hidden","true");
const ring=document.createElement("div");ring.id="aura";ring.setAttribute("aria-hidden","true");
document.body.append(dot,ring);
let x=innerWidth/2,y=innerHeight/2,rx=x,ry=y,sc=1,tsc=1;
addEventListener("pointermove",function(e){x=e.clientX;y=e.clientY;
const t=e.target.closest?e.target.closest("a,button,.card,.fnode"):null;
tsc=t?2.1:1},{passive:true});
(function loop(){rx+=(x-rx)*.16;ry+=(y-ry)*.16;sc+=(tsc-sc)*.2;
dot.style.transform="translate("+x+"px,"+y+"px)";
ring.style.transform="translate("+rx+"px,"+ry+"px) scale("+sc.toFixed(3)+")";
requestAnimationFrame(loop)})();
const hasG=typeof gsap!=="undefined";
document.querySelectorAll(".hero .btn").forEach(function(b){
const qx=hasG?gsap.quickTo(b,"x",{duration:.3,ease:"power3"}):null;
const qy=hasG?gsap.quickTo(b,"y",{duration:.3,ease:"power3"}):null;
b.addEventListener("pointermove",function(e){
if(!qx||!qy){return}
const bb=b.getBoundingClientRect();
qx((e.clientX-(bb.left+bb.width/2))*.25);
qy((e.clientY-(bb.top+bb.height/2))*.25)});
b.addEventListener("pointerleave",function(){if(qx&&qy){qx(0);qy(0)}})});
document.querySelectorAll(".hero .btn").forEach(function(b){
if(b.querySelector(".ch")){return}
const txt=b.textContent;b.setAttribute("aria-label",txt);b.textContent="";
Array.prototype.forEach.call(txt,function(ch){
const s=document.createElement("span");s.className="ch";s.setAttribute("aria-hidden","true");
s.textContent=ch===" "?" ":ch;b.appendChild(s)});
b.addEventListener("mouseenter",function(){
if(!hasG){return}
gsap.fromTo(b.querySelectorAll(".ch"),{y:0},
{y:-5,duration:.13,ease:"power2.out",stagger:{each:.018,yoyo:true,repeat:1},overwrite:"auto"})})});
const heroEl=document.querySelector(".hero"),statsEl=document.querySelector(".hero .stats");
if(heroEl&&statsEl){statsEl.style.transformStyle="preserve-3d";
heroEl.addEventListener("pointermove",function(e){
const bb=statsEl.getBoundingClientRect();
const px=(e.clientX-bb.left)/bb.width-.5,py=(e.clientY-bb.top)/bb.height-.5;
statsEl.style.transform="perspective(800px) rotateX("+(-py*7).toFixed(2)+"deg) rotateY("+(px*9).toFixed(2)+"deg)"},{passive:true});
heroEl.addEventListener("pointerleave",function(){
statsEl.style.transform="perspective(800px)"})}
let lastY=scrollY||0;
addEventListener("scroll",function(){
const yy=scrollY||0;
if(!(panel&&panel.classList.contains("open"))){
if(yy>140&&yy>lastY+4&&nav){nav.classList.add("hide")}
else if((yy<lastY-4||yy<140)&&nav){nav.classList.remove("hide")}}
lastY=yy},{passive:true});
}
})();
