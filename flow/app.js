(function(){
'use strict';
var root=document.documentElement;
try{var s=localStorage.getItem('acm-theme');if(s==='dark'||s==='light')root.setAttribute('data-theme',s);else root.setAttribute('data-theme','dark');}catch(e){root.setAttribute('data-theme','dark');}
var t=document.getElementById('themeBtn');
function paint(){if(t)t.textContent=root.getAttribute('data-theme')==='dark'?'\u263E':'\u2600';}
if(t)t.addEventListener('click',function(){var n=root.getAttribute('data-theme')==='dark'?'light':'dark';root.setAttribute('data-theme',n);try{localStorage.setItem('acm-theme',n);}catch(e){}paint();});
paint();
var here=(location.pathname.split('/').pop()||'index.html').toLowerCase().split('?')[0].split('#')[0];
Array.prototype.forEach.call(document.querySelectorAll('.tabs a'),function(a){var h=(a.getAttribute('href')||'').toLowerCase().split('?')[0].split('#')[0].replace('./','');a.classList.toggle('on',h===here||(here===''&&h==='index.html'));});
var nodes=[document.getElementById('n0'),document.getElementById('n1'),document.getElementById('n2')];
var ni=0;function tick(){nodes.forEach(function(n,k){if(n)n.classList.toggle('live',k===ni%3);});ni++;}
if(nodes[0]){tick();setInterval(tick,1600);}
var io=null;
function reveal(){var els=document.querySelectorAll('.reveal');if(!('IntersectionObserver' in window)){Array.prototype.forEach.call(els,function(e){e.classList.add('in');});return;}io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.12});Array.prototype.forEach.call(els,function(e){io.observe(e);});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reveal);else reveal();
var cv=document.querySelector('canvas.gl');
if(cv&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
(function(){
var gl=cv.getContext('webgl',{antialias:false,alpha:true});
if(!gl)return;
function sh(t,src){var s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);return gl.getShaderParameter(s,gl.COMPILE_STATUS)?s:null;}
var vs=sh(gl.VERTEX_SHADER,'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}');
var fs=sh(gl.FRAGMENT_SHADER,'precision highp float;uniform vec2 R;uniform float T;void main(){vec2 uv=gl_FragCoord.xy/R;vec2 p=uv*2.-1.;p.x*=R.x/R.y;p.y+=.8;float r=length(p);float a=atan(p.y,p.x);float dist=abs(r-1.6);float warp=sin(r*4.-T*.5)*.3;float lines=sin((a+warp)*80.+T*2.);lines=smoothstep(.85,1.,lines);float mask=smoothstep(.5,0.,dist);float glow=.05/(dist*dist+.05);vec3 c1=vec3(0.,.4,1.);vec3 c2=vec3(.8,.1,.9);vec3 base=mix(c1,c2,sin(a*2.+T*.5)*.5+.5);vec3 line=mix(base,vec3(1.),.4);vec3 col=line*lines*mask*2.5+base*glow*1.5;col*=smoothstep(1.5,-.5,p.y);col*=smoothstep(3.,1.,r);gl_FragColor=vec4(col,1.);}');
if(!vs||!fs)return;
var pr=gl.createProgram();gl.attachShader(pr,vs);gl.attachShader(pr,fs);gl.linkProgram(pr);
if(!gl.getProgramParameter(pr,gl.LINK_STATUS))return;
var buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,1,1,1,-1,-1,1,-1]),gl.STATIC_DRAW);
var loc=gl.getAttribLocation(pr,'p');var uR=gl.getUniformLocation(pr,'R');var uT=gl.getUniformLocation(pr,'T');
function fit(){var d=Math.min(devicePixelRatio||1,1.5);var w=cv.clientWidth*d|0,h=cv.clientHeight*d|0;if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;gl.viewport(0,0,w,h);}}
var run=true;
new IntersectionObserver(function(es){run=es[0].isIntersecting;},{threshold:0}).observe(cv);
document.addEventListener('visibilitychange',function(){fit();});
addEventListener('resize',fit,{passive:true});fit();
function frame(t){requestAnimationFrame(frame);if(!run||document.hidden)return;gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(pr);gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(loc);gl.uniform2f(uR,cv.width,cv.height);gl.uniform1f(uT,t*.001);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}
requestAnimationFrame(frame);
})();
}
})();
