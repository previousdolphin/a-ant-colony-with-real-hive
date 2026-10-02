/* ============================================================
   ANT COLONY — crayon-sketch side-view biological simulation
   Vanilla JS, canvas 2D. Procedurally generated every load.
   ============================================================ */
(function(){
  "use strict";

  /* ---------- COLOR HELPERS (derived from the 4 brand colors) ---------- */
  const BASE = '#59e8b5', ACCENT1 = '#19c346', ACCENT2 = '#6ce139', INK = '#28382c';

  function hexToRgb(h){
    h = h.replace('#','');
    return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)];
  }
  function mixHex(h1,h2,t){
    const a=hexToRgb(h1), b=hexToRgb(h2);
    const r=Math.round(a[0]+(b[0]-a[0])*t);
    const g=Math.round(a[1]+(b[1]-a[1])*t);
    const bl=Math.round(a[2]+(b[2]-a[2])*t);
    return 'rgb('+r+','+g+','+bl+')';
  }
  function rgba(h,alpha){
    const c=hexToRgb(h);
    return 'rgba('+c[0]+','+c[1]+','+c[2]+','+alpha+')';
  }

  const COLORS = {
    ink: INK,
    accent1: ACCENT1,
    accent2: ACCENT2,
    base: BASE,
    skyTop: mixHex(BASE,'#ffffff',0.45),
    skyHorizon: BASE,
    cloud: mixHex(BASE,'#ffffff',0.72),
    dirt: INK,
    hatch: rgba(ACCENT1,0.16),
    tunnel: mixHex(INK, BASE, 0.30),
    tunnelRim: mixHex(INK, '#000000', 0.25),
    diggerColor: mixHex(INK, BASE, 0.18),
    eggColor: mixHex(BASE, '#ffffff', 0.6),
    pupaColor: mixHex(INK, ACCENT1, 0.45)
  };

  /* ---------- CONFIG ---------- */
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const CFG = {
    maxAnts: REDUCED ? 20 : 34,
    maxNodes: REDUCED ? 150 : 230,
    maxFoodArray: 14,
    eggCost: 2,
    maxEggs: 9,
    maxPher: 140
  };

  /* ---------- DOM ---------- */
  const stageEl = document.getElementById('stage');
  const canvas = document.getElementById('sim-canvas');
  const ctx = canvas.getContext('2d');
  const statAnts = document.getElementById('stat-ants');
  const statFood = document.getElementById('stat-food');
  const statEggs = document.getElementById('stat-eggs');
  const btnAbout = document.getElementById('btn-about');
  const btnAboutClose = document.getElementById('btn-about-close');
  const btnSound = document.getElementById('btn-sound');
  const btnSpeed = document.getElementById('btn-speed');
  const btnReset = document.getElementById('btn-reset');
  const aboutPanel = document.getElementById('about-panel');

  /* ---------- STATE ---------- */
  let W = { width:0, height:0 }; // world
  let timeNow = 0;
  let lastTime = 0;
  let rafId = null;
  let idCounter = 0;
  let statAccum = 0;
  let speedMultiplier = 1;
  let muted = true;
  let audioCtx = null;

  /* ---------- SETTINGS PERSISTENCE ---------- */
  function loadSettings(){
    try{
      const raw = localStorage.getItem('antcolony_settings');
      if(raw){
        const s = JSON.parse(raw);
        if(typeof s.muted === 'boolean') muted = s.muted;
        if(typeof s.speed === 'number') speedMultiplier = s.speed;
      }
    }catch(e){ /* ignore */ }
  }
  function saveSettings(){
    try{
      localStorage.setItem('antcolony_settings', JSON.stringify({ muted, speed: speedMultiplier }));
    }catch(e){ /* ignore */ }
  }

  /* ---------- AUDIO (created only on user gesture) ---------- */
  function ensureAudioCtx(){
    if(!audioCtx){
      try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch(e){ audioCtx = null; }
    }
    if(audioCtx && audioCtx.state === 'suspended'){ audioCtx.resume(); }
  }
  function blip(freq, dur, type, gainVal){
    if(muted || !audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(gainVal || 0.05, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  function playSound(kind){
    if(muted || !audioCtx) return;
    switch(kind){
      case 'found': blip(560, 0.12, 'triangle', 0.045); break;
      case 'deposit': blip(380, 0.1, 'sine', 0.035); break;
      case 'hatch': blip(300, 0.14, 'sine', 0.05); setTimeout(()=>blip(460,0.12,'sine',0.04),90); break;
      case 'lay': blip(640, 0.09, 'sine', 0.035); break;
      case 'dig': blip(95, 0.07, 'square', 0.025); break;
      case 'drop': blip(700, 0.08, 'triangle', 0.04); break;
      default: break;
    }
  }

  /* ---------- MATH / NOISE HELPERS ---------- */
  function lerpAngle(a,b,t){
    let diff = ((b - a + Math.PI*3) % (Math.PI*2)) - Math.PI;
    return a + diff*t;
  }

  /* ---------- WORLD GRAPH HELPERS ---------- */
  function addNode(x,y,type,radius){
    W.nodes.push({ x, y, type, radius });
    W.adj.push([]);
    return W.nodes.length - 1;
  }
  function addEdge(aIdx,bIdx){
    const a = W.nodes[aIdx], b = W.nodes[bIdx];
    const d = Math.hypot(a.x-b.x, a.y-b.y) || 1;
    W.adj[aIdx].push({ to:bIdx, dist:d });
    W.adj[bIdx].push({ to:aIdx, dist:d });
    W.edges.push({ a:aIdx, b:bIdx });
  }
  function bfsPath(start,goal){
    if(start === goal) return [];
    const n = W.nodes.length;
    const visited = new Array(n).fill(false);
    const parent = new Array(n).fill(-1);
    const queue = [start];
    visited[start] = true;
    let qi = 0;
    while(qi < queue.length){
      const cur = queue[qi++];
      if(cur === goal) break;
      const neighbors = W.adj[cur] || [];
      for(let i=0;i<neighbors.length;i++){
        const to = neighbors[i].to;
        if(!visited[to]){ visited[to]=true; parent[to]=cur; queue.push(to); }
      }
    }
    if(!visited[goal]) return [];
    const path = [];
    let c = goal;
    while(c !== start){
      path.push(c);
      c = parent[c];
      if(c === -1) return [];
    }
    path.reverse();
    return path;
  }
  function randomLeaf(){
    const leaves = [];
    for(let i=0;i<W.adj.length;i++){
      if(W.adj[i].length === 1 && i !== W.entranceIdx) leaves.push(i);
    }
    if(!leaves.length) return W.entranceIdx;
    return leaves[Math.floor(Math.random()*leaves.length)];
  }

  /* ---------- TUNNEL GENERATION ---------- */
  function ensureMinNodes(){
    while(W.nodes.length < 10){
      const parent = W.nodes.length ? W.nodes.length-1 : W.entranceIdx;
      const p = W.nodes[parent];
      const ny = Math.min(W.height-20, p.y + 28 + Math.random()*12);
      const nx = Math.max(16, Math.min(W.width-16, p.x + (Math.random()-0.5)*34));
      const idx = addNode(nx, ny, 'tunnel', 5);
      addEdge(parent, idx);
    }
  }
  function chooseChambers(){
    const candidates = [];
    for(let i=0;i<W.nodes.length;i++){ if(i !== W.entranceIdx) candidates.push(i); }
    candidates.sort((a,b)=> W.nodes[b].y - W.nodes[a].y); // deepest first
    const queenIdx = candidates[0];
    W.nodes[queenIdx].type = 'queen'; W.nodes[queenIdx].radius = 20;

    let nurseryIdx = candidates[Math.min(candidates.length-1, Math.floor(candidates.length*0.4))];
    if(nurseryIdx === queenIdx){
      nurseryIdx = candidates[Math.min(candidates.length-1, Math.floor(candidates.length*0.4)+1)] || candidates[1] || queenIdx;
    }
    W.nodes[nurseryIdx].type = 'nursery'; W.nodes[nurseryIdx].radius = 17;

    const remaining = candidates.filter(i => i !== queenIdx && i !== nurseryIdx);
    const shallowSorted = remaining.sort((a,b)=> W.nodes[a].y - W.nodes[b].y);
    const storageIdx = shallowSorted[Math.min(shallowSorted.length-1, Math.floor(shallowSorted.length*0.25))] || candidates[candidates.length-1];
    W.nodes[storageIdx].type = 'storage'; W.nodes[storageIdx].radius = 16;

    W.queenIdx = queenIdx;
    W.nurseryIdx = nurseryIdx;
    W.storageIdx = storageIdx;
  }
  function generateTunnels(){
    const entranceX = W.width * (0.42 + Math.random()*0.16);
    W.entranceIdx = addNode(entranceX, W.groundY, 'entrance', 9);
    const maxDepthY = W.height - Math.max(24, W.height*0.06);
    let heads = [{ node:W.entranceIdx, angle:90, depth:0, branch:0.34 }];
    let guard = 0;
    while(heads.length && W.nodes.length < 150 && guard < 5000){
      guard++;
      const head = heads.shift();
      const len = 16 + Math.random()*26;
      let angle = head.angle + (Math.random()-0.5)*50;
      const minA = head.depth<2 ? 55 : 25, maxA = head.depth<2 ? 125 : 155;
      angle = Math.max(minA, Math.min(maxA, angle));
      const rad = angle * Math.PI/180;
      const parent = W.nodes[head.node];
      const nx = parent.x + Math.cos(rad)*len;
      const ny = parent.y + Math.sin(rad)*len;
      if(ny < W.groundY+8 || ny > maxDepthY || nx < 18 || nx > W.width-18) continue;
      const idx = addNode(nx, ny, 'tunnel', 4.5 + Math.random()*2);
      addEdge(head.node, idx);
      const nd = head.depth+1;
      const nb = head.branch*0.88;
      if(Math.random() < head.branch && nd < 22){
        heads.push({ node:idx, angle: angle-26-Math.random()*22, depth:nd, branch:nb });
        heads.push({ node:idx, angle: angle+26+Math.random()*22, depth:nd, branch:nb });
      } else if(nd < 30){
        heads.push({ node:idx, angle: angle+(Math.random()-0.5)*24, depth:nd, branch:nb });
      }
    }
    ensureMinNodes();
    chooseChambers();
  }

  /* ---------- TERRAIN RENDERING (offscreen, baked) ---------- */
  function drawEdgeStamp(edge){
    const a = W.nodes[edge.a], b = W.nodes[edge.b];
    const tctx = W.terrainCtx;
    const w1 = (a.radius||6)*2.2, w2 = (b.radius||6)*2.2;
    const steps = Math.max(3, Math.round(Math.hypot(b.x-a.x, b.y-a.y)/6));
    tctx.fillStyle = COLORS.tunnel;
    for(let i=0;i<=steps;i++){
      const t = i/steps;
      const x = a.x + (b.x-a.x)*t, y = a.y + (b.y-a.y)*t;
      const r = Math.max(3, ((w1+(w2-w1)*t)/2) * (0.88+Math.random()*0.26));
      tctx.beginPath(); tctx.arc(x,y,r,0,Math.PI*2); tctx.fill();
    }
    tctx.strokeStyle = COLORS.tunnelRim;
    tctx.lineWidth = 1.2;
    tctx.globalAlpha = 0.3;
    tctx.beginPath(); tctx.moveTo(a.x,a.y); tctx.lineTo(b.x,b.y); tctx.stroke();
    tctx.globalAlpha = 1;
  }
  function drawChamberStamp(node){
    const tctx = W.terrainCtx;
    const r = node.radius * 1.9;
    tctx.fillStyle = COLORS.tunnel;
    tctx.beginPath(); tctx.arc(node.x,node.y,r,0,Math.PI*2); tctx.fill();
    tctx.strokeStyle = COLORS.tunnelRim;
    tctx.lineWidth = 1;
    tctx.globalAlpha = 0.4;
    for(let i=0;i<6;i++){
      const a = Math.random()*Math.PI*2;
      const rr = r*0.5 + Math.random()*r*0.3;
      tctx.beginPath(); tctx.arc(node.x,node.y,rr,a,a+0.6); tctx.stroke();
    }
    tctx.globalAlpha = 1;
  }
  function drawTerrainFull(){
    const tctx = W.terrainCtx;
    tctx.clearRect(0,0,W.width,W.height);
    tctx.fillStyle = COLORS.dirt;
    tctx.fillRect(0, W.groundY, W.width, W.height-W.groundY);
    tctx.strokeStyle = COLORS.hatch;
    tctx.lineWidth = 1;
    for(let y = W.groundY+6; y < W.height+40; y += 11){
      tctx.beginPath(); tctx.moveTo(0,y); tctx.lineTo(W.width, y-44); tctx.stroke();
    }
    for(const e of W.edges) drawEdgeStamp(e);
    for(const n of W.nodes){ if(n.type !== 'tunnel') drawChamberStamp(n); }
  }
  function buildSkyGradient(){
    W.skyGrad = ctx.createLinearGradient(0,0,0, Math.max(10, W.groundY));
    W.skyGrad.addColorStop(0, COLORS.skyTop);
    W.skyGrad.addColorStop(1, COLORS.skyHorizon);
  }

  /* ---------- ENTITY FACTORIES ---------- */
  function makeFood(){
    const amount = 2 + Math.floor(Math.random()*2);
    return { x: 20+Math.random()*(W.width-40), y: W.groundY-2, amount, maxAmount:amount, active:true, respawnTimer:0, seed:Math.random()*10 };
  }
  function makeEgg(){
    return {
      stage:'egg', progress:0,
      durationEgg: 4+Math.random()*3,
      durationLarva: 8+Math.random()*5,
      durationPupa: 4+Math.random()*3,
      ox: (Math.random()-0.5)*20,
      oy: (Math.random()-0.5)*12
    };
  }
  function spawnAnt(role, nodeIdx){
    const n = W.nodes[nodeIdx];
    idCounter++;
    return {
      id: idCounter, role, node: nodeIdx, x:n.x, y:n.y,
      path: [], edgeFrom:null, edgeTo:null, edgeT:0,
      state: 'idle', angle: Math.PI/2, speed: 24+Math.random()*13,
      carrying:false, wobbleSeed: Math.random()*100, legPhase: Math.random()*10,
      trail: [], freeX:n.x, freeY:n.y, freeAngle:0, timer:0,
      returnPath: null, returnIdx: 0
    };
  }
  function spawnInitialAnt(role){
    const ant = spawnAnt(role, W.entranceIdx);
    if(role === 'forager'){ startSearching(ant); }
    else if(role === 'nurse'){ ant.path = bfsPath(W.entranceIdx, W.nurseryIdx); ant.state='toNursery'; }
    else { const leaf = randomLeaf(); ant.path = bfsPath(W.entranceIdx, leaf); ant.state='toFrontier'; }
    W.ants.push(ant);
  }

  /* ---------- MOVEMENT ---------- */
  function moveAlongPath(ant, dt){
    if(ant.edgeFrom === null){
      if(ant.path.length === 0) return true;
      ant.edgeFrom = ant.node;
      ant.edgeTo = ant.path.shift();
      ant.edgeT = 0;
    }
    const a = W.nodes[ant.edgeFrom], b = W.nodes[ant.edgeTo];
    const dist = Math.hypot(b.x-a.x, b.y-a.y) || 1;
    ant.edgeT += (ant.speed*dt)/dist;
    if(ant.edgeT >= 1){
      ant.node = ant.edgeTo; ant.x = b.x; ant.y = b.y;
      ant.edgeFrom = null; ant.edgeTo = null; ant.edgeT = 0;
      if(ant.path.length === 0) return true;
      return false;
    }
    const t = ant.edgeT;
    const dx = b.x-a.x, dy = b.y-a.y, len = dist;
    const wobAmt = REDUCED ? 0.3 : 1.3;
    const wob = Math.sin(timeNow*4+ant.wobbleSeed)*wobAmt;
    ant.x = a.x + dx*t + (-dy/len)*wob;
    ant.y = a.y + dy*t + (dx/len)*wob;
    ant.angle = Math.atan2(dy,dx);
    ant.legPhase += dt*8;
    return false;
  }

  /* ---------- FORAGER BEHAVIOR ---------- */
  function startSearching(ant){
    ant.node = W.entranceIdx;
    const n = W.nodes[W.entranceIdx];
    ant.x = n.x; ant.y = n.y;
    ant.trail = [{x:n.x,y:n.y}];
    ant.freeX = n.x; ant.freeY = n.y;
    ant.freeAngle = -Math.PI/2 + (Math.random()-0.5)*1.4;
    ant.state = 'searching';
    ant.timer = 0;
  }
  function updateSearching(ant, dt){
    let desired = ant.freeAngle;
    let best=null, bestD=90;
    for(const p of W.pheromone){
      const d = Math.hypot(p.x-ant.freeX, p.y-ant.freeY);
      if(d < bestD){ bestD = d; best = p; }
    }
    if(best && Math.random() < 0.5){
      const a = Math.atan2(best.y-ant.freeY, best.x-ant.freeX);
      desired = lerpAngle(ant.freeAngle, a, 0.5);
    }
    const wobble = (Math.sin(timeNow*0.9+ant.wobbleSeed)+Math.sin(timeNow*0.37+ant.wobbleSeed*1.7))*0.5;
    ant.freeAngle += wobble*dt*1.5 + (desired-ant.freeAngle)*dt*0.8;
    const spd = ant.speed*0.9;
    ant.freeX += Math.cos(ant.freeAngle)*spd*dt;
    ant.freeY += Math.sin(ant.freeAngle)*spd*dt;
    const minY = W.groundY-72, maxY = W.groundY-4;
    if(ant.freeY < minY){ ant.freeY = minY; ant.freeAngle = Math.PI - ant.freeAngle; }
    if(ant.freeY > maxY){ ant.freeY = maxY; ant.freeAngle = -ant.freeAngle; }
    if(ant.freeX < 12){ ant.freeX = 12; ant.freeAngle = Math.PI - ant.freeAngle; }
    if(ant.freeX > W.width-12){ ant.freeX = W.width-12; ant.freeAngle = Math.PI - ant.freeAngle; }
    ant.x = ant.freeX; ant.y = ant.freeY; ant.angle = ant.freeAngle; ant.legPhase += dt*9;
    ant.timer += dt;
    if(ant.timer > 0.35){
      ant.timer = 0;
      ant.trail.push({x:ant.freeX,y:ant.freeY});
      if(ant.trail.length > 44) ant.trail.shift();
    }
    for(const f of W.foods){
      if(!f.active) continue;
      const d = Math.hypot(f.x-ant.freeX, f.y-ant.freeY);
      if(d < 11){
        f.amount--;
        if(f.amount <= 0){ f.active=false; f.respawnTimer = 4+Math.random()*6; }
        ant.carrying = true;
        playSound('found');
        for(const pt of ant.trail){ W.pheromone.push({x:pt.x,y:pt.y,ttl:16+Math.random()*6}); }
        while(W.pheromone.length > CFG.maxPher) W.pheromone.shift();
        ant.returnPath = ant.trail.slice().reverse();
        ant.returnIdx = 0;
        ant.state = 'returning';
        break;
      }
    }
  }
  function updateReturning(ant, dt){
    if(!ant.returnPath || ant.returnIdx >= ant.returnPath.length){
      ant.node = W.entranceIdx;
      const n = W.nodes[W.entranceIdx];
      ant.x = n.x; ant.y = n.y;
      ant.path = bfsPath(W.entranceIdx, W.storageIdx);
      ant.edgeFrom = null; ant.edgeTo = null; ant.edgeT = 0;
      ant.state = 'toStorage';
      return;
    }
    const target = ant.returnPath[ant.returnIdx];
    const dx = target.x-ant.freeX, dy = target.y-ant.freeY;
    const d = Math.hypot(dx,dy);
    if(d < 6){ ant.returnIdx++; return; }
    const ang = Math.atan2(dy,dx);
    ant.freeAngle = ang;
    const spd = ant.speed*1.05;
    ant.freeX += Math.cos(ang)*spd*dt;
    ant.freeY += Math.sin(ang)*spd*dt;
    ant.x = ant.freeX; ant.y = ant.freeY; ant.angle = ang; ant.legPhase += dt*10;
  }
  function updateForager(ant, dt){
    switch(ant.state){
      case 'toSurface': { const arrived = moveAlongPath(ant,dt); if(arrived) startSearching(ant); break; }
      case 'searching': updateSearching(ant,dt); break;
      case 'returning': updateReturning(ant,dt); break;
      case 'toStorage': {
        const arrived = moveAlongPath(ant,dt);
        if(arrived){
          W.storageFood++; ant.carrying=false; playSound('deposit');
          ant.path = bfsPath(W.storageIdx, W.entranceIdx);
          ant.state = 'toSurface';
        }
        break;
      }
      default: ant.state='toSurface'; ant.path=bfsPath(ant.node, W.entranceIdx);
    }
  }

  /* ---------- NURSE BEHAVIOR ---------- */
  function updateNurse(ant, dt){
    switch(ant.state){
      case 'toNursery': {
        const arrived = moveAlongPath(ant,dt);
        if(arrived){ ant.state='tending'; ant.timer=5+Math.random()*6; }
        break;
      }
      case 'tending': {
        const nn = W.nodes[W.nurseryIdx];
        const wob = REDUCED ? 0.2 : 1;
        ant.x = nn.x + Math.cos(timeNow*0.6+ant.wobbleSeed)*7*wob;
        ant.y = nn.y + Math.sin(timeNow*0.8+ant.wobbleSeed)*5*wob;
        ant.angle = Math.sin(timeNow*0.6+ant.wobbleSeed);
        ant.legPhase += dt*4;
        ant.timer -= dt;
        if(ant.timer <= 0){
          if(W.storageFood > 1 && Math.random() < 0.6){
            ant.path = bfsPath(W.nurseryIdx, W.storageIdx);
            ant.state = 'goStorage';
          } else {
            ant.timer = 3+Math.random()*4;
          }
        }
        break;
      }
      case 'goStorage': {
        const arrived = moveAlongPath(ant,dt);
        if(arrived){ ant.state='atStorage'; ant.timer=0.6+Math.random()*0.8; }
        break;
      }
      case 'atStorage': {
        ant.timer -= dt;
        if(ant.timer <= 0){ ant.path = bfsPath(W.storageIdx, W.nurseryIdx); ant.state='goBack'; }
        break;
      }
      case 'goBack': {
        const arrived = moveAlongPath(ant,dt);
        if(arrived){ ant.state='tending'; ant.timer=5+Math.random()*6; }
        break;
      }
      default: ant.state='tending'; ant.timer=2;
    }
  }

  /* ---------- DIGGER BEHAVIOR ---------- */
  function attemptDig(ant){
    if(W.nodes.length >= CFG.maxNodes){
      ant.path = bfsPath(ant.node, randomLeaf());
      ant.state = 'toFrontier';
      return;
    }
    const cur = W.nodes[ant.node];
    const base = isFinite(ant.angle) ? ant.angle : Math.PI/2;
    let placed = false;
    for(let tries=0; tries<6 && !placed; tries++){
      const angle = base + (Math.random()-0.5)*1.5;
      const len = 16 + Math.random()*22;
      const nx = cur.x + Math.cos(angle)*len;
      const ny = cur.y + Math.sin(angle)*len;
      if(ny < W.groundY+10 || ny > W.height-16 || nx < 16 || nx > W.width-16) continue;
      const idx = addNode(nx, ny, 'tunnel', 4+Math.random()*2);
      addEdge(ant.node, idx);
      drawEdgeStamp(W.edges[W.edges.length-1]);
      ant.node = idx; ant.x = nx; ant.y = ny; ant.angle = angle;
      placed = true;
      ant.path = Math.random() < 0.55 ? [] : bfsPath(idx, randomLeaf());
    }
    if(!placed){ ant.path = bfsPath(ant.node, randomLeaf()); }
    ant.state = 'toFrontier';
    if(Math.random() < 0.4) playSound('dig');
  }
  function updateDigger(ant, dt){
    if(ant.state === 'toFrontier'){
      const arrived = moveAlongPath(ant,dt);
      if(arrived){ ant.state='digging'; ant.timer=1.1+Math.random()*1.7; }
    } else if(ant.state === 'digging'){
      ant.legPhase += dt*14;
      ant.timer -= dt;
      if(ant.timer <= 0) attemptDig(ant);
    } else {
      ant.state = 'toFrontier';
      ant.path = bfsPath(ant.node, randomLeaf());
    }
  }

  function updateAnt(ant, dt){
    if(ant.role === 'forager') updateForager(ant,dt);
    else if(ant.role === 'nurse') updateNurse(ant,dt);
    else if(ant.role === 'digger') updateDigger(ant,dt);
  }

  /* ---------- QUEEN & NURSERY ---------- */
  function updateQueen(dt){
    W.queen.timer -= dt;
    if(W.queen.timer <= 0){
      if(W.storageFood >= CFG.eggCost && W.ants.length < CFG.maxAnts && W.eggs.length < CFG.maxEggs){
        W.storageFood -= CFG.eggCost;
        W.eggs.push(makeEgg());
        playSound('lay');
        W.queen.timer = 4+Math.random()*4;
      } else {
        W.queen.timer = 1.2+Math.random()*1.3;
      }
    }
  }
  function hatchEgg(){
    const r = Math.random();
    const role = r < 0.5 ? 'forager' : (r < 0.78 ? 'nurse' : 'digger');
    const newAnt = spawnAnt(role, W.nurseryIdx);
    if(role === 'forager'){
      newAnt.path = bfsPath(W.nurseryIdx, W.entranceIdx);
      newAnt.state = 'toSurface';
    } else if(role === 'nurse'){
      newAnt.state = 'tending';
      newAnt.timer = 3+Math.random()*4;
    } else {
      const leaf = randomLeaf();
      newAnt.path = bfsPath(W.nurseryIdx, leaf);
      newAnt.state = 'toFrontier';
    }
    W.ants.push(newAnt);
    playSound('hatch');
  }

  /* ---------- MAIN UPDATE ---------- */
  function update(dt){
    for(const f of W.foods){
      if(!f.active){
        f.respawnTimer -= dt;
        if(f.respawnTimer <= 0){
          f.x = 20+Math.random()*(W.width-40);
          f.amount = f.maxAmount;
          f.active = true;
        }
      }
    }
    for(let i=W.pheromone.length-1;i>=0;i--){
      W.pheromone[i].ttl -= dt;
      if(W.pheromone[i].ttl <= 0) W.pheromone.splice(i,1);
    }
    updateQueen(dt);
    const nurseBoost = W.ants.some(a => a.role==='nurse' && a.state==='tending');
    for(let i=W.eggs.length-1;i>=0;i--){
      const e = W.eggs[i];
      const rate = nurseBoost ? 1.6 : 0.85;
      e.progress += dt*rate;
      if(e.stage==='egg' && e.progress>=e.durationEgg){ e.stage='larva'; e.progress=0; }
      else if(e.stage==='larva' && e.progress>=e.durationLarva){ e.stage='pupa'; e.progress=0; }
      else if(e.stage==='pupa' && e.progress>=e.durationPupa){ hatchEgg(); W.eggs.splice(i,1); }
    }
    for(const a of W.ants){ updateAnt(a,dt); }
    for(let i=W.fx.length-1;i>=0;i--){
      W.fx[i].ttl -= dt;
      if(W.fx[i].ttl <= 0) W.fx.splice(i,1);
    }
    statAccum += dt;
    if(statAccum > 0.25){ statAccum = 0; updateStatsDOM(); }
  }
  function updateStatsDOM(){
    statAnts.textContent = String(W.ants.length);
    statFood.textContent = String(Math.floor(W.storageFood));
    statEggs.textContent = String(W.eggs.length);
  }

  /* ---------- RENDERING ---------- */
  function roleColor(role){
    if(role==='forager') return COLORS.accent1;
    if(role==='nurse') return COLORS.accent2;
    if(role==='digger') return COLORS.diggerColor;
    return COLORS.ink;
  }
  function drawSun(){
    const cx = W.width*0.86, cy = W.height*0.13, r = Math.min(W.width,W.height)*0.045+10;
    ctx.save(); ctx.translate(cx,cy);
    if(!REDUCED) ctx.rotate(timeNow*0.03);
    ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for(let i=0;i<10;i++){
      const a = (i/10)*Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a)*(r+4), Math.sin(a)*(r+4));
      ctx.lineTo(Math.cos(a)*(r+14), Math.sin(a)*(r+14));
      ctx.stroke();
    }
    ctx.beginPath(); ctx.fillStyle = COLORS.accent2; ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
    ctx.lineWidth = 2.6; ctx.stroke();
    ctx.restore();
  }
  function drawClouds(){
    for(const c of W.clouds){
      const drift = REDUCED ? 0 : Math.sin(timeNow*0.06+c.ph)*18;
      const x = c.fx*W.width + drift, y = c.fy*W.height;
      ctx.save(); ctx.translate(x,y); ctx.scale(c.s,c.s);
      ctx.fillStyle = COLORS.cloud;
      ctx.strokeStyle = rgba(INK,0.25); ctx.lineWidth = 1;
      const puffs = [[0,0,16],[16,4,12],[-15,5,12],[7,-7,11],[-6,-6,10]];
      for(const p of puffs){ ctx.beginPath(); ctx.arc(p[0],p[1],p[2],0,Math.PI*2); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
  }
  function drawGrass(){
    for(const g of W.grass){
      const x = g.fx*W.width, y = W.groundY;
      ctx.save(); ctx.translate(x,y); ctx.rotate(g.tilt);
      ctx.strokeStyle = g.tone===1 ? COLORS.accent1 : COLORS.accent2;
      ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0,0); ctx.quadraticCurveTo(3,-g.h*0.6,1,-g.h); ctx.stroke();
      ctx.restore();
    }
  }
  function drawGroundLine(){
    const pts = W.groundJitter;
    ctx.beginPath();
    ctx.moveTo(pts[0].fx*W.width, W.groundY+pts[0].dy);
    for(let i=1;i<pts.length;i++){ ctx.lineTo(pts[i].fx*W.width, W.groundY+pts[i].dy); }
    ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
  }
  function drawPheromone(){
    for(const p of W.pheromone){
      const alpha = Math.max(0, Math.min(0.32, p.ttl/20));
      ctx.fillStyle = rgba(ACCENT1, alpha);
      ctx.beginPath(); ctx.arc(p.x,p.y,2.4,0,Math.PI*2); ctx.fill();
    }
  }
  function drawFoods(){
    for(const f of W.foods){
      if(!f.active) continue;
      const bob = REDUCED ? 0 : Math.sin(timeNow*2+f.seed)*2;
      ctx.save(); ctx.translate(f.x, f.y+bob); ctx.rotate(Math.sin(f.seed)*0.3);
      ctx.beginPath(); ctx.ellipse(0,0,7,4.2,0,0,Math.PI*2);
      ctx.fillStyle = COLORS.accent2; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = COLORS.ink; ctx.stroke();
      ctx.beginPath(); ctx.arc(-2,-1,1.3,0,Math.PI*2); ctx.fillStyle = COLORS.accent1; ctx.fill();
      ctx.restore();
    }
  }
  function drawStorageDots(){
    const node = W.nodes[W.storageIdx];
    const n = Math.min(12, Math.floor(W.storageFood));
    for(let i=0;i<n;i++){
      const d = W.storageDots[i];
      ctx.beginPath(); ctx.arc(node.x+d.ox, node.y+d.oy, 3, 0, Math.PI*2);
      ctx.fillStyle = COLORS.accent2; ctx.fill();
      ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 0.8; ctx.stroke();
    }
  }
  function drawEggs(){
    const nn = W.nodes[W.nurseryIdx];
    for(const e of W.eggs){
      const x = nn.x+e.ox, y = nn.y+e.oy;
      ctx.save(); ctx.translate(x,y);
      if(e.stage === 'egg'){
        ctx.beginPath(); ctx.ellipse(0,0,4,5,0,0,Math.PI*2);
        ctx.fillStyle = COLORS.eggColor; ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = COLORS.ink; ctx.stroke();
      } else if(e.stage === 'larva'){
        const len = 7+9*(e.progress/e.durationLarva);
        ctx.rotate(Math.sin(timeNow*1.5+e.ox)*0.2);
        ctx.beginPath(); ctx.ellipse(0,0,len*0.4,4.4,0,0,Math.PI*2);
        ctx.fillStyle = COLORS.accent2; ctx.fill();
        ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1; ctx.stroke();
        for(let s=-1;s<=1;s++){
          ctx.beginPath(); ctx.moveTo(s*len*0.25,-3); ctx.lineTo(s*len*0.25,3);
          ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 0.6; ctx.stroke();
        }
      } else {
        ctx.beginPath(); ctx.ellipse(0,0,6,7,0,0,Math.PI*2);
        ctx.fillStyle = COLORS.pupaColor; ctx.fill();
        ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.restore();
    }
  }
  function drawQueen(){
    const q = W.queen;
    const breathe = 1 + (REDUCED ? 0 : Math.sin(timeNow*1.4+q.wobbleSeed)*0.05);
    ctx.save(); ctx.translate(q.x,q.y); ctx.scale(breathe,breathe);
    ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1.6; ctx.fillStyle = COLORS.accent2;
    ctx.beginPath(); ctx.ellipse(-10,0,11,7.5,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(2,0,5.5,4.4,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(10,0,4.2,3.6,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = COLORS.accent1; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(6,-6); ctx.lineTo(9,-11); ctx.lineTo(12,-7); ctx.lineTo(15,-12); ctx.lineTo(17,-7);
    ctx.stroke();
    ctx.restore();
  }
  function drawAnt(ant){
    const wob = REDUCED ? 0 : Math.sin(timeNow*5+ant.wobbleSeed)*0.6;
    ctx.save(); ctx.translate(ant.x, ant.y); ctx.rotate(ant.angle || 0);
    ctx.strokeStyle = COLORS.ink; ctx.fillStyle = roleColor(ant.role); ctx.lineWidth = 1.3;
    for(let i=-1;i<=1;i++){
      const swing = Math.sin(ant.legPhase + i*2.1) * (REDUCED ? 2 : 4.5);
      ctx.beginPath(); ctx.moveTo(i*3.2, 0); ctx.lineTo(i*3.2+swing*0.4, 6+Math.abs(swing)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i*3.2, 0); ctx.lineTo(i*3.2-swing*0.4, -6-Math.abs(swing)); ctx.stroke();
    }
    ctx.beginPath(); ctx.ellipse(-6, wob*0.2, 5.2, 3.6, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0,0,3.2,2.6,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(5,0,2.6,2.2,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6.8,-1); ctx.quadraticCurveTo(10,-5,9,-7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6.8,1); ctx.quadraticCurveTo(10,5,9,7); ctx.stroke();
    if(ant.carrying){
      ctx.beginPath(); ctx.fillStyle = COLORS.accent2; ctx.arc(-11,0,2.6,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
  }
  function drawHeartPath(){
    ctx.beginPath();
    ctx.moveTo(0,3);
    ctx.bezierCurveTo(-6,-4,-2,-8,0,-3);
    ctx.bezierCurveTo(2,-8,6,-4,0,3);
    ctx.closePath();
  }
  function drawFx(){
    for(const f of W.fx){
      ctx.save();
      if(f.type === 'spark'){
        ctx.globalAlpha = Math.max(0, f.ttl/0.6);
        ctx.strokeStyle = COLORS.accent1; ctx.lineWidth = 2;
        for(let i=0;i<6;i++){
          const a = (i/6)*Math.PI*2;
          ctx.beginPath(); ctx.moveTo(f.x,f.y); ctx.lineTo(f.x+Math.cos(a)*10, f.y+Math.sin(a)*10); ctx.stroke();
        }
      } else {
        const rise = (0.9 - f.ttl) * 14;
        ctx.globalAlpha = Math.max(0, f.ttl/0.9);
        ctx.translate(f.x, f.y - rise);
        ctx.fillStyle = COLORS.accent2; ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1;
        drawHeartPath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
  }
  function render(){
    ctx.clearRect(0,0,W.width,W.height);
    ctx.fillStyle = W.skyGrad;
    ctx.fillRect(0,0,W.width, W.groundY+2);
    drawSun();
    drawClouds();
    drawGrass();
    ctx.drawImage(W.terrainCanvas, 0, 0);
    drawGroundLine();
    drawPheromone();
    drawFoods();
    drawStorageDots();
    drawEggs();
    drawQueen();
    for(const a of W.ants) drawAnt(a);
    drawFx();
  }

  /* ---------- WORLD INIT ---------- */
  function initWorld(width, height){
    W.width = width; W.height = height;
    W.groundY = Math.round(height * (0.24 + Math.random()*0.05));
    W.nodes = []; W.adj = []; W.edges = [];
    generateTunnels();
    W.storageFood = 5;
    W.foods = [];
    for(let i=0;i<4;i++) W.foods.push(makeFood());
    W.eggs = [];
    for(let i=0;i<2;i++) W.eggs.push(makeEgg());
    W.pheromone = [];
    W.fx = [];
    W.ants = [];
    const roles = ['forager','forager','forager','nurse','nurse','digger','digger','forager','nurse'];
    for(const role of roles) spawnInitialAnt(role);
    W.queen = { x: W.nodes[W.queenIdx].x, y: W.nodes[W.queenIdx].y, wobbleSeed: Math.random()*10, timer: 3+Math.random()*3 };
    W.storageDots = [];
    for(let i=0;i<12;i++) W.storageDots.push({ ox:(Math.random()-0.5)*22, oy:(Math.random()-0.5)*14 });

    const gcount = Math.max(14, Math.round(width/26));
    W.grass = [];
    for(let i=0;i<gcount;i++) W.grass.push({ fx:Math.random(), h:6+Math.random()*11, tilt:(Math.random()-0.5)*0.7, tone: Math.random()<0.5?1:2 });

    W.clouds = [];
    for(let i=0;i<4;i++) W.clouds.push({ fx:0.08+i*0.24+Math.random()*0.05, fy:0.07+Math.random()*0.12, s:0.7+Math.random()*0.7, ph:Math.random()*Math.PI*2 });

    const jcount = Math.max(10, Math.round(width/20));
    W.groundJitter = [];
    for(let i=0;i<=jcount;i++) W.groundJitter.push({ fx:i/jcount, dy:(Math.random()-0.5)*5 });

    W.terrainCanvas = document.createElement('canvas');
    W.terrainCanvas.width = width; W.terrainCanvas.height = height;
    W.terrainCtx = W.terrainCanvas.getContext('2d');
    drawTerrainFull();
    buildSkyGradient();

    statAccum = 0;
    updateStatsDOM();
  }

  /* ---------- RESIZE ---------- */
  function handleResize(){
    const rect = stageEl.getBoundingClientRect();
    const newW = Math.max(300, Math.round(rect.width));
    const newH = Math.max(300, Math.round(rect.height));
    if(!W.width){
      canvas.width = newW; canvas.height = newH;
      initWorld(newW, newH);
      return;
    }
    const scaleX = newW / W.width, scaleY = newH / W.height;
    W.nodes.forEach(n => { n.x *= scaleX; n.y *= scaleY; });
    W.foods.forEach(f => { f.x *= scaleX; f.y *= scaleY; });
    W.ants.forEach(a => {
      a.x *= scaleX; a.y *= scaleY; a.freeX *= scaleX; a.freeY *= scaleY;
      a.trail.forEach(p => { p.x *= scaleX; p.y *= scaleY; });
      if(a.returnPath) a.returnPath.forEach(p => { p.x *= scaleX; p.y *= scaleY; });
    });
    W.eggs.forEach(e => { e.ox *= scaleX; e.oy *= scaleY; });
    W.pheromone.forEach(p => { p.x *= scaleX; p.y *= scaleY; });
    W.queen.x *= scaleX; W.queen.y *= scaleY;
    W.groundY *= scaleY;
    W.width = newW; W.height = newH;
    canvas.width = newW; canvas.height = newH;
    buildSkyGradient();
    W.terrainCanvas.width = newW; W.terrainCanvas.height = newH;
    W.terrainCtx = W.terrainCanvas.getContext('2d');
    drawTerrainFull();
  }
  function debounce(fn, wait){
    let t;
    return function(){
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(()=> fn.apply(null,args), wait);
    };
  }

  /* ---------- INTERACTION ---------- */
  function onPointerDown(e){
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);
    if(y <= W.groundY + 2){
      if(W.foods.length < CFG.maxFoodArray){
        W.foods.push({ x: Math.max(10, Math.min(W.width-10, x)), y: W.groundY-2, amount:2, maxAmount:2, active:true, respawnTimer:0, seed:Math.random()*10 });
        W.fx.push({ x, y: W.groundY-6, ttl:0.6, type:'spark' });
        playSound('drop');
      }
    } else {
      let nearest=null, bd=1e9;
      for(const a of W.ants){
        const d = Math.hypot(a.x-x, a.y-y);
        if(d < bd){ bd=d; nearest=a; }
      }
      if(nearest && bd < 140){
        W.fx.push({ x:nearest.x, y:nearest.y-14, ttl:0.9, type:'heart' });
      }
    }
  }

  function openAbout(){
    aboutPanel.hidden = false;
    stageEl.classList.add('about-open');
    btnAboutClose.focus();
  }
  function closeAbout(){
    aboutPanel.hidden = true;
    stageEl.classList.remove('about-open');
    btnAbout.focus();
  }

  btnAbout.addEventListener('click', openAbout);
  btnAboutClose.addEventListener('click', closeAbout);
  btnSound.addEventListener('click', function(){
    muted = !muted;
    ensureAudioCtx();
    btnSound.textContent = muted ? '🔇' : '🔊';
    btnSound.setAttribute('aria-pressed', String(!muted));
    saveSettings();
    if(!muted) playSound('lay');
  });
  btnSpeed.addEventListener('click', function(){
    const order = [1,2,0.5];
    let idx = order.indexOf(speedMultiplier);
    idx = (idx+1) % order.length;
    speedMultiplier = order[idx];
    btnSpeed.textContent = speedMultiplier===1 ? '1×' : (speedMultiplier===2 ? '2×' : '½×');
    saveSettings();
  });
  btnReset.addEventListener('click', function(){
    initWorld(W.width, W.height);
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && !aboutPanel.hidden){ closeAbout(); }
    else if(e.key === 'f' || e.key === 'F'){
      if(W.width && W.foods.length < CFG.maxFoodArray){
        W.foods.push({ x:20+Math.random()*(W.width-40), y:W.groundY-2, amount:2, maxAmount:2, active:true, respawnTimer:0, seed:Math.random()*10 });
      }
    }
    else if(e.key === 'm' || e.key === 'M'){ btnSound.click(); }
    else if(e.key === 'r' || e.key === 'R'){ btnReset.click(); }
    else if(e.key === '?'){ if(aboutPanel.hidden) openAbout(); else closeAbout(); }
  });
  canvas.addEventListener('pointerdown', onPointerDown);

  /* ---------- MAIN LOOP ---------- */
  function loop(ts){
    if(document.hidden) return;
    if(!lastTime) lastTime = ts;
    let rawDt = (ts - lastTime) / 1000;
    if(rawDt > 0.08) rawDt = 0.08;
    lastTime = ts;
    const dt = rawDt * speedMultiplier * (REDUCED ? 0.7 : 1);
    timeNow += dt;
    update(dt);
    render();
    rafId = requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden){
      lastTime = 0;
      rafId = requestAnimationFrame(loop);
    }
  });

  /* ---------- BOOT ---------- */
  loadSettings();
  btnSound.textContent = muted ? '🔇' : '🔊';
  btnSound.setAttribute('aria-pressed', String(!muted));
  btnSpeed.textContent = speedMultiplier===1 ? '1×' : (speedMultiplier===2 ? '2×' : '½×');
  handleResize();
  window.addEventListener('resize', debounce(handleResize, 180));
  rafId = requestAnimationFrame(loop);

})();