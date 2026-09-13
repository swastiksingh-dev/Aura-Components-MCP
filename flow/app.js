(function(){
var root=document.documentElement;
try{var s=localStorage.getItem('acm-theme');if(s==='dark'||s==='light')root.setAttribute('data-theme',s);}catch(e){}
var t=document.getElementById('themeBtn');
function paint(){if(t)t.textContent=root.getAttribute('data-theme')==='dark'?'\u263E':'\u2600';}
if(t)t.addEventListener('click',function(){var n=root.getAttribute('data-theme')==='dark'?'light':'dark';root.setAttribute('data-theme',n);try{localStorage.setItem('acm-theme',n);}catch(e){}paint();});
paint();
var nodes=[document.getElementById('n0'),document.getElementById('n1'),document.getElementById('n2')];
var i=0;
function tick(){nodes.forEach(function(n,k){if(n)n.classList.toggle('live',k===i%3);});i++;}
tick();setInterval(tick,1600);
var here=(location.pathname.split('/').pop()||'index.html').toLowerCase().split('?')[0].split('#')[0];
Array.prototype.forEach.call(document.querySelectorAll('.tabs a'),function(a){var h=(a.getAttribute('href')||'').toLowerCase().split('?')[0].split('#')[0].replace('./','');var cur=here.replace('./','');a.classList.toggle('on',h===cur||(cur===''&&h==='index.html'));});
function lazyUnicorn(){var el=document.querySelector('.aura-bg');if(!el||el.dataset.done)return;var r=el.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight+400)return;el.dataset.done='1';var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v1.4.29/dist/unicornStudio.umd.js';s.onload=function(){try{if(window.UnicornStudio&&!window.UnicornStudio.isInitialized){var d=document.createElement('div');d.setAttribute('data-us-project',el.getAttribute('data-project'));d.style.cssText='position:absolute;inset:0';el.appendChild(d);UnicornStudio.init();window.UnicornStudio.isInitialized=!0;}}catch(e){}};document.head.appendChild(s);}
var uT=null;function schedU(){if(uT)clearTimeout(uT);uT=setTimeout(lazyUnicorn,120);}
addEventListener('scroll',schedU,{passive:!0});addEventListener('resize',schedU);setTimeout(lazyUnicorn,900);
})();