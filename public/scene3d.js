"use strict";
(() => {
  const canvas=document.getElementById("worldCanvas"); if(!canvas)return;
  const gl=canvas.getContext("webgl",{alpha:true,antialias:true,powerPreference:"high-performance"});
  if(!gl){canvas.hidden=true;return;}
  const vs=`
    attribute vec3 p; attribute vec3 n; uniform mat4 projection,view,model;
    varying vec3 normal; varying vec3 position;
    void main(){vec4 w=model*vec4(p,1.0);position=w.xyz;normal=normalize(mat3(model)*n);gl_Position=projection*view*w;}
  `;
  const fs=`
    precision mediump float; varying vec3 normal; varying vec3 position;
    uniform vec3 tint; uniform float glow,opacity;
    void main(){vec3 N=normalize(normal);float light=max(dot(N,normalize(vec3(-.4,.7,.8))),0.0);
      float rim=pow(1.0-max(dot(N,vec3(0.0,0.0,1.0)),0.0),2.0);
      vec3 c=tint*(.17+light*.95+rim*.9+glow);gl_FragColor=vec4(c,opacity);}
  `;
  function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  try{
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    const L={p:gl.getAttribLocation(program,"p"),n:gl.getAttribLocation(program,"n"),projection:gl.getUniformLocation(program,"projection"),view:gl.getUniformLocation(program,"view"),model:gl.getUniformLocation(program,"model"),tint:gl.getUniformLocation(program,"tint"),glow:gl.getUniformLocation(program,"glow"),opacity:gl.getUniformLocation(program,"opacity")};
    function sphere(lat=22,lon=32){const d=[];for(let y=0;y<lat;y++)for(let x=0;x<lon;x++){const pt=(v,u)=>[Math.sin(v)*Math.cos(u),Math.cos(v),Math.sin(v)*Math.sin(u)];const a=pt(y/lat*Math.PI,x/lon*Math.PI*2),b=pt((y+1)/lat*Math.PI,x/lon*Math.PI*2),c=pt((y+1)/lat*Math.PI,(x+1)/lon*Math.PI*2),e=pt(y/lat*Math.PI,(x+1)/lon*Math.PI*2);for(const q of [a,b,e,b,c,e])d.push(...q,...q);}return new Float32Array(d);}
    function torus(seg=120,sides=7){const d=[],R=1,r=.012;for(let i=0;i<seg;i++)for(let j=0;j<sides;j++){const pt=(u,v)=>{const c=Math.cos(v),s=Math.sin(v),cu=Math.cos(u),su=Math.sin(u);return [[(R+r*c)*cu,r*s,(R+r*c)*su],[c*cu,s,c*su]]};const a=pt(i/seg*2*Math.PI,j/sides*2*Math.PI),b=pt((i+1)/seg*2*Math.PI,j/sides*2*Math.PI),c=pt((i+1)/seg*2*Math.PI,(j+1)/sides*2*Math.PI),e=pt(i/seg*2*Math.PI,(j+1)/sides*2*Math.PI);for(const q of [a,b,e,b,c,e])d.push(...q[0],...q[1]);}return new Float32Array(d);}
    function mesh(data){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return{b,count:data.length/6};}
    const ball=mesh(sphere()),ring=mesh(torus());
    const I=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    function mul(a,b){const o=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o;}
    function T(x,y,z){const m=I();m[12]=x;m[13]=y;m[14]=z;return m;}
    function S(x,y,z){const m=I();m[0]=x;m[5]=y;m[10]=z;return m;}
    function RX(a){const c=Math.cos(a),s=Math.sin(a);return new Float32Array([1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1]);}
    function RY(a){const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]);}
    function RZ(a){const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1]);}
    function M(x,y,z,s,rx=0,ry=0,rz=0){return mul(T(x,y,z),mul(RZ(rz),mul(RY(ry),mul(RX(rx),S(s,s,s)))));}
    function P(f,a,n,z){const v=1/Math.tan(f/2),nf=1/(n-z);return new Float32Array([v/a,0,0,0,0,v,0,0,0,0,(z+n)*nf,-1,0,0,2*z*n*nf,0]);}
    function draw(m,mat,color,glow=0,opacity=1){gl.bindBuffer(gl.ARRAY_BUFFER,m.b);gl.enableVertexAttribArray(L.p);gl.vertexAttribPointer(L.p,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(L.n);gl.vertexAttribPointer(L.n,3,gl.FLOAT,false,24,12);gl.uniformMatrix4fv(L.model,false,mat);gl.uniform3fv(L.tint,color);gl.uniform1f(L.glow,glow);gl.uniform1f(L.opacity,opacity);gl.drawArrays(gl.TRIANGLES,0,m.count);}
    const clusters=[
      {x:3.6,y:0,z:-8,r:2.45,c:[.12,.4,1],a:[.1,.85,.8]},
      {x:-3.1,y:-1.3,z:-22,r:1.9,c:[.43,.27,.98],a:[.22,.8,.98]},
      {x:3,y:1.5,z:-38,r:2.15,c:[.08,.72,.72],a:[.46,.7,1]},
      {x:-2.8,y:-.5,z:-54,r:1.7,c:[.22,.48,.98],a:[.15,.86,.75]}
    ];
    let w=1,h=1,raf=0,camZ=0,panX=0,panY=0,tx=0,ty=0,progress=0;
    const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
    function resize(){const d=Math.min(devicePixelRatio||1,1.6);w=Math.max(1,innerWidth*d);h=Math.max(1,innerHeight*d);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}}
    function scroll(){progress=Math.min(1,scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight));}
    function render(now){resize();const t=reduced?0:now*.001;camZ+=( -progress*22-camZ)*.08;panX+=(tx-panX)*.08;panY+=(ty-panY)*.08;
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix4fv(L.projection,false,P(.78,w/h,.1,120));gl.uniformMatrix4fv(L.view,false,T(-panX,-panY,-camZ));
      clusters.forEach((c,i)=>{const spin=reduced?0:t*.09*(i%2?-1:1);
        draw(ball,M(c.x,c.y,c.z,c.r,0,spin,Math.sin(t*.2+i)*.06),c.c,.24,1);
        draw(ring,M(c.x,c.y,c.z,c.r*1.45,1.05+i*.16,spin*.7,.3),c.a,.7,.95);
        draw(ring,M(c.x,c.y,c.z,c.r*1.72,.3,spin*-.6,-.42),[.36,.5,1],.42,.7);
        for(let j=0;j<4;j++){const a=t*.22+j*Math.PI/2+i*.55,rr=c.r*1.85,s=j===0?.2:.115;
          draw(ball,M(c.x+Math.cos(a)*rr,c.y+Math.sin(a)*rr*.52,c.z+Math.sin(a*1.4),s),j%2?c.a:[.55,.82,1],.75,1);}
      });
      raf=requestAnimationFrame(render);
    }
    addEventListener("resize",resize,{passive:true});addEventListener("scroll",scroll,{passive:true});
    addEventListener("wheel",e=>{if(e.ctrlKey||e.metaKey||e.target.closest?.(".modal-backdrop,input,textarea,select,[contenteditable='true']"))return;
      // Two-finger trackpad deltas pan the world; native scrolling is intentionally not intercepted.
      tx=Math.max(-5,Math.min(5,tx-e.deltaX*.0045));ty=Math.max(-3,Math.min(3,ty-e.deltaY*.0012));
    },{passive:true});
    document.addEventListener("visibilitychange",()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else if(!raf)raf=requestAnimationFrame(render);});
    scroll();resize();raf=requestAnimationFrame(render);
    window.EduRollScene={reset:()=>{tx=0;ty=0;},state:()=>({progress,panX,panY})};
  }catch(error){console.error("eduRoll 3D scene failed:",error);canvas.hidden=true;}
})();