"use strict";
(() => {
  const canvas = document.getElementById("worldCanvas");
  if (!canvas) return;
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, powerPreference: "low-power" });
  if (!gl) {
    canvas.hidden = true;
    document.documentElement.classList.add("no-webgl");
    return;
  }

  const vertex = `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    attribute float aSize;
    uniform mat4 uProjection;
    uniform mat4 uView;
    uniform float uTime;
    uniform float uPointMode;
    varying vec3 vColor;
    varying float vDepth;
    void main() {
      vec3 p = aPosition;
      float drift = sin(uTime * 0.22 + p.x * 1.7 + p.z) * 0.035;
      p.y += drift;
      vec4 viewPosition = uView * vec4(p, 1.0);
      gl_Position = uProjection * viewPosition;
      gl_PointSize = clamp(aSize * (190.0 / max(1.0, -viewPosition.z)), 1.0, 26.0);
      vColor = aColor;
      vDepth = clamp((-viewPosition.z - 2.0) / 26.0, 0.0, 1.0);
    }`;
  const fragment = `
    precision mediump float;
    varying vec3 vColor;
    varying float vDepth;
    uniform float uPointMode;
    void main() {
      if (uPointMode > 0.5) {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        if (d > 0.5) discard;
        float glow = 1.0 - smoothstep(0.02, 0.5, d);
        gl_FragColor = vec4(vColor, glow * (0.45 + (1.0 - vDepth) * 0.5));
      } else {
        gl_FragColor = vec4(vColor, 0.19 * (1.0 - vDepth * 0.65));
      }
    }`;
  function shader(type, source) {
    const item = gl.createShader(type);
    gl.shaderSource(item, source);
    gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item));
    return item;
  }
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    canvas.hidden = true;
    return;
  }
  gl.useProgram(program);
  const attributes = {
    position: gl.getAttribLocation(program, "aPosition"),
    color: gl.getAttribLocation(program, "aColor"),
    size: gl.getAttribLocation(program, "aSize")
  };
  const uniforms = {
    projection: gl.getUniformLocation(program, "uProjection"),
    view: gl.getUniformLocation(program, "uView"),
    time: gl.getUniformLocation(program, "uTime"),
    pointMode: gl.getUniformLocation(program, "uPointMode")
  };
  const buffer = gl.createBuffer();
  const points = [];
  const links = [];
  const palette = [[0.28,0.48,0.95],[0.26,0.78,0.72],[0.64,0.61,0.98],[0.85,0.72,0.48]];
  for (let i = 0; i < 58; i++) {
    const ring = Math.floor(i / 14);
    const angle = i * 2.399963;
    const radius = 2.5 + ring * 1.35 + (i % 4) * 0.13;
    const p = [Math.cos(angle) * radius, Math.sin(angle * 0.83) * (1.7 + ring * 0.35), -5 - (i % 9) * 2.25];
    const c = palette[i % palette.length];
    points.push([...p, ...c, i % 9 === 0 ? 8.5 : 3 + (i % 3) * 1.4]);
    if (i > 0 && i % 3 !== 0) {
      const prev = points[i - 1];
      links.push([...p, ...c, 1, ...prev.slice(0, 3), ...prev.slice(3, 6), 1]);
    }
  }
  for (let i = 0; i < 180; i++) {
    const x = Math.sin(i * 91.7) * 15;
    const y = Math.cos(i * 37.3) * 9;
    const z = -4 - (i * 13 % 32);
    points.push([x,y,z,0.55,0.67,0.9,1.1 + (i % 3) * 0.4]);
  }
  const pointData = new Float32Array(points.flat());
  const linkData = new Float32Array(links.flat());
  let width = 1, height = 1, targetX = 0, targetY = 0, cameraX = 0, cameraY = 0;
  let pointerX = 0, pointerY = 0, frame = 0;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.7);
    width = Math.max(1, Math.floor(window.innerWidth * dpr));
    height = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
      canvas.style.width = "100%"; canvas.style.height = "100%";
      gl.viewport(0, 0, width, height);
    }
  }
  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
  }
  function viewMatrix(x, y, t) {
    const a = Math.sin(t * 0.00012) * 0.035 + pointerY * 0.035;
    const b = Math.cos(t * 0.0001) * 0.04 + pointerX * 0.035;
    const c = Math.cos(a), s = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    return new Float32Array([
      cb, sb*s, sb*c, 0,
      0, c, -s, 0,
      -sb, cb*s, cb*c, 0,
      -x, -y, -22, 1
    ]);
  }
  function draw(data, mode, pointMode) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = 7 * 4;
    gl.enableVertexAttribArray(attributes.position);
    gl.vertexAttribPointer(attributes.position, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(attributes.color);
    gl.vertexAttribPointer(attributes.color, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(attributes.size);
    gl.vertexAttribPointer(attributes.size, 1, gl.FLOAT, false, stride, 24);
    gl.uniform1f(uniforms.pointMode, pointMode);
    gl.drawArrays(mode, 0, data.length / 7);
  }
  function render(now) {
    resize();
    const elapsed = reduceMotion ? 0 : now;
    cameraX += (targetX - cameraX) * 0.12;
    cameraY += (targetY - cameraY) * 0.12;
    gl.clearColor(0.965, 0.975, 0.995, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(uniforms.projection, false, perspective(0.82, width / height, 0.1, 100));
    gl.uniformMatrix4fv(uniforms.view, false, viewMatrix(cameraX, cameraY, elapsed));
    gl.uniform1f(uniforms.time, elapsed * 0.001);
    draw(linkData, gl.LINES, 0);
    draw(pointData, gl.POINTS, 1);
    frame = requestAnimationFrame(render);
  }
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("wheel", event => {
    if (event.ctrlKey || event.metaKey) return;
    const area = event.target.closest?.(".hero, .learning-view");
    if (!area) return;
    // Trackpad two-finger scroll pans the 3D camera. It does not capture pointer movement,
    // so one-finger cursor movement and normal clicking remain unchanged.
    targetX = Math.max(-13, Math.min(13, targetX - event.deltaX * 0.008));
    targetY = Math.max(-8, Math.min(8, targetY - event.deltaY * 0.008));
  }, { passive: true });
  window.addEventListener("pointermove", event => {
    pointerX = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
    pointerY = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else if (!frame) {
      frame = requestAnimationFrame(render);
    }
  });
  resize();
  frame = requestAnimationFrame(render);
  window.EduRollScene = { reset: () => { targetX = 0; targetY = 0; } };
})();
