(function(){
"use strict";

var canvas = document.getElementById('demoCanvas');
var ctx = canvas.getContext('2d');
var hint = document.getElementById('demoHint');
var engineStateEl = document.getElementById('teleEngineState');
var collisionEl = document.getElementById('teleCollision');
var weatherEl = document.getElementById('teleWeather');

// --- Teclas en pantalla ---
var keys = {};
function updateKeyVisuals(){
  // Antes esto iteraba por cada tecla individual (arrowup, w, arrowdown, s...)
  // y alternaba la clase 'active' en el elemento que le correspondía — pero
  // como 'arrowup' y 'w' apuntan al MISMO botón, procesar 'w' justo después
  // de 'arrowup' en el mismo bucle apagaba la clase que 'arrowup' acababa de
  // encender (si solo esa tecla estaba pulsada). Se agrupa por elemento y se
  // calcula el OR de todas sus teclas antes de tocar el DOM.
  var groups = { keyUp: ['arrowup','w'], keyDown: ['arrowdown','s'], keyLeft: ['arrowleft','a'], keyRight: ['arrowright','d'] };
  for (var elId in groups){
    var el = document.getElementById(elId);
    if (!el) continue;
    var active = groups[elId].some(function(k){ return !!keys[k]; });
    el.classList.toggle('active', active);
  }
}

// --- Controles táctiles: las mismas cajas que muestran qué tecla está
// pulsada son también botones reales — sin esto, en un móvil (sin
// teclado físico) era imposible conducir la demo por mucho que se viera
// bien. Cada caja se ata a la MISMA tecla que ya usa readControls(), así
// que dedo y teclado alimentan el mismo estado sin duplicar lógica.
var touchKeyMap = { keyUp: 'w', keyDown: 's', keyLeft: 'a', keyRight: 'd' };
function bindTouchControl(elId, key){
  var el = document.getElementById(elId);
  if (!el) return;
  var press = function(e){ e.preventDefault(); keys[key] = true; hasMoved = true; updateKeyVisuals(); };
  var release = function(e){ e.preventDefault(); keys[key] = false; updateKeyVisuals(); };
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', release); // soltar si el dedo/ratón se arrastra fuera de la caja
}
for (var touchEl in touchKeyMap) bindTouchControl(touchEl, touchKeyMap[touchEl]);

// --- Doble mando (botones grandes ◀▶▼▲, solo visibles en pantallas
// táctiles de verdad vía CSS) — mismo principio: escriben en el mismo
// objeto keys que ya lee readControls(), sin lógica de control duplicada.
document.querySelectorAll('.touch-btn').forEach(function(btn){
  var key = btn.dataset.key;
  var press = function(e){ e.preventDefault(); keys[key] = true; btn.classList.add('active'); updateKeyVisuals(); };
  var release = function(e){ e.preventDefault(); keys[key] = false; btn.classList.remove('active'); updateKeyVisuals(); };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
});

// --- Configuración de coche y clima ---
var carConfigs = {
  stock: { mass: 1200, engineTorque: 200, muStatic: 1.0, muDynamic: 0.8, suspensionSpring: 40000 },
  sport: { mass: 950, engineTorque: 350, muStatic: 1.2, muDynamic: 1.0, suspensionSpring: 60000 }
};
var weatherConfigs = {
  dry:  { name: '☀️ Seco',   muStatic: 1.0, muDynamic: 0.85, particles: null },
  rain: { name: '🌧️ Lluvia', muStatic: 0.7, muDynamic: 0.55, particles: 'rain' },
  snow: { name: '❄️ Nieve',  muStatic: 0.5, muDynamic: 0.35, particles: 'snow' }
};

var car = null;
var currentWeather = 'dry';
var visualState = { pitch: 0, roll: 0 };
var collisionFX = { active: false, lastCollisionTime: 0 };
var particles = [];
var tireMarks = [];
var camX = 0, camZ = 0, camTargetX = 0, camTargetZ = 0;
var chaseCamX = 0, chaseCamZ = 0, chaseCamTargetX = 0, chaseCamTargetZ = 0;
var trackHalfWidth = 6.0;
var scale = 10;

var manualMode = false;
var manualGear = 1;

function createCar(configKey){
  var cfg = carConfigs[configKey] || carConfigs.stock;
  car = TireSimEngine.createVehicle({
    mass: cfg.mass, wheelbase: 2.5, track: 1.45, numWheels: 4,
    drivetrain: 'REAR', transmissionMode: manualMode ? 'manual' : 'auto', restitution: 0.3,
    engineTorque: cfg.engineTorque, suspensionSpring: cfg.suspensionSpring
  });
  // Si ya estábamos en manual con una marcha concreta, se respeta al
  // cambiar de coche — antes esto se olvidaba y siempre volvía a
  // automático sin avisar, desincronizado del botón/indicador visibles.
  car.setGear(manualMode ? manualGear : 1);
  // Obstáculos: (x=adelante, z=lateral, radio, altura, rigidez) — en este
  // motor "adelante" es el eje X, no Z (comprobado con el motor real).
  car.addObstacle(40, 0, 1.5, 1.0, 1.0);
  car.addObstacle(80, 2.0, 0.8, 1.0, 1.0);
  car.addObstacle(120, -2.0, 0.8, 1.0, 1.0);
  car.addObstacle(160, 0, 0.5, 0.5, 1.0);
  applyWeather(currentWeather);
}

function applyWeather(weatherKey){
  var weather = weatherConfigs[weatherKey];
  currentWeather = weatherKey;
  car.contact.muStatic = weather.muStatic;
  car.contact.muDynamic = weather.muDynamic;
  if (weatherEl) weatherEl.textContent = weather.name;
  if (weather.particles){
    particles = [];
    var rect = canvas.getBoundingClientRect();
    for (var i = 0; i < 150; i++){
      particles.push({
        x: Math.random() * rect.width,
        y: Math.random() * rect.height,
        speed: weather.particles === 'rain' ? (15 + Math.random()*10) : (1 + Math.random()*2),
        drift: weather.particles === 'rain' ? -2 : (Math.random()-0.5)*2,
        size: weather.particles === 'rain' ? 2 : 3
      });
    }
  } else {
    particles = [];
  }
}
createCar('stock');

var carButtons = document.querySelectorAll('.car-btn');
carButtons.forEach(function(btn){
  btn.addEventListener('click', function(){
    carButtons.forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    createCar(btn.dataset.car);
    visualState = { pitch: 0, roll: 0 };
    tireMarks = [];
    camX = 0; camZ = 0;
  });
});
document.querySelector('[data-car="stock"]').classList.add('active');

var weatherButtons = document.querySelectorAll('.weather-btn');
weatherButtons.forEach(function(btn){
  btn.addEventListener('click', function(){
    weatherButtons.forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    applyWeather(btn.dataset.weather);
  });
});
document.querySelector('[data-weather="dry"]').classList.add('active');

function resize(){
  var rect = canvas.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

window.addEventListener('keydown', function(e){
  keys[e.key.toLowerCase()] = true;
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].indexOf(e.key.toLowerCase()) > -1) e.preventDefault();
  updateKeyVisuals();
});
window.addEventListener('keyup', function(e){ keys[e.key.toLowerCase()] = false; updateKeyVisuals(); });

var hasMoved = false;
function readControls(){
  var throttle = (keys['arrowup'] || keys['w']) ? 1 : 0;
  var brake = (keys['arrowdown'] || keys['s']) ? 1 : 0;
  var steer = 0;
  if (keys['arrowleft'] || keys['a']) steer -= 1;
  if (keys['arrowright'] || keys['d']) steer += 1;
  if (throttle || brake || steer) hasMoved = true;
  return { throttle: throttle, brake: brake, steer: steer };
}

// --- Cambio manual de marchas ---
// Ojo: NO se usan ↑/↓ para subir/bajar marcha — esas teclas ya son
// acelerador y freno (readControls arriba). Reutilizarlas habría hecho
// que acelerar en modo manual subiera de marcha sin parar. Se usa Q/E,
// convención habitual en juegos de conducción.
var modeToggleBtn = document.getElementById('modeToggleBtn');
function setManualMode(on){
  manualMode = on;
  car.setTransmissionMode(manualMode ? 'manual' : 'auto');
  var modeEl = document.getElementById('teleTransmissionMode');
  if (modeEl) modeEl.textContent = manualMode ? 'Manual' : 'Auto';
  if (modeToggleBtn){
    modeToggleBtn.textContent = manualMode ? '🕹️ Modo manual (M)' : '🕹️ Cambiar a manual (M)';
    modeToggleBtn.classList.toggle('active', manualMode);
  }
  if (manualMode) { manualGear = car.transmission.currentGear || 1; car.setGear(manualGear); }
}
if (modeToggleBtn) modeToggleBtn.addEventListener('click', function(){ setManualMode(!manualMode); });

window.addEventListener('keydown', function(e){
  var key = e.key.toLowerCase();
  if (key === 'm') { setManualMode(!manualMode); return; }
  if (!manualMode) return;
  if (key >= '1' && key <= '6'){ manualGear = parseInt(key, 10); car.setGear(manualGear); }
  else if (key === 'r'){ manualGear = -1; car.setGear(-1); }
  else if (key === 'n'){ manualGear = 0; car.setGear(0); }
  else if (key === 'e' && car.transmission.currentGear < 6){ manualGear = car.transmission.currentGear + 1; car.setGear(manualGear); }
  else if (key === 'q' && car.transmission.currentGear > 1){ manualGear = car.transmission.currentGear - 1; car.setGear(manualGear); }
});

function addTireMarks(out){
  var halfTrack = (car.track || 1.45) / 2;
  var halfWB = (car.wheelbase || 2.5) / 2;
  var cS = Math.cos(out.state.psi), sS = Math.sin(out.state.psi);
  for (var i = 0; i < out.wheels.length; i++){
    var wheel = out.wheels[i];
    if (Math.abs(wheel.slip) > 0.2 && out.state.u > 1){
      var lon = (i < 2 ? halfWB : -halfWB);
      var lat = (i % 2 === 0 ? -halfTrack : halfTrack);
      var wheelX = out.state.x + lon * cS - lat * sS;
      var wheelZ = out.state.z + lon * sS + lat * cS;
      tireMarks.push({ x: wheelX, z: wheelZ, alpha: Math.min(1, Math.abs(wheel.slip) * 1.5) });
    }
  }
  if (tireMarks.length > 800) tireMarks.splice(0, tireMarks.length - 800);
}

function updateCamera(out, dt){
  var lookAhead = 5;
  camTargetZ = out.state.x + lookAhead * Math.cos(out.state.psi);
  camTargetX = out.state.z + lookAhead * Math.sin(out.state.psi);
  var lerpSpeed = 1 - Math.exp(-dt * 5);
  camZ += (camTargetZ - camZ) * lerpSpeed;
  camX += (camTargetX - camX) * lerpSpeed;

  // Cámara aparte para la vista exterior en perspectiva: la de arriba
  // (camX/camZ) mira algo por delante del coche — razonable para la
  // vista superior, que así muestra más de lo que viene. Pero una
  // "vista exterior" en perspectiva necesita la cámara DETRÁS del
  // coche para verlo de frente — comprobado con el motor real: con la
  // cámara compartida (delante), hasta el propio coche salía con
  // profundidad negativa respecto a su propia cámara (-4.6 conduciendo
  // recto), aunque fuera casi imperceptible en el ángulo de visión.
  var chaseLookBehind = -8;
  chaseCamTargetZ = out.state.x + chaseLookBehind * Math.cos(out.state.psi);
  chaseCamTargetX = out.state.z + chaseLookBehind * Math.sin(out.state.psi);
  chaseCamZ += (chaseCamTargetZ - chaseCamZ) * lerpSpeed;
  chaseCamX += (chaseCamTargetX - chaseCamX) * lerpSpeed;
}

function worldToScreen(lateral, forward, w, h){
  var depth = forward - camZ;
  if (depth < -100) depth = -100;
  var perspectiveScale = scale * (200 / (200 + Math.abs(depth)));
  return {
    x: w/2 + (lateral - camX) * perspectiveScale,
    y: h/2 - depth * perspectiveScale * 0.5,
    scale: perspectiveScale
  };
}

function fmt(n, d){ return (isFinite(n) ? n : 0).toFixed(d == null ? 1 : d); }

// --- Sonido de motor (Web Audio API) ---
// Se inicializa solo con un clic explícito del usuario en el botón — los
// navegadores bloquean el audio hasta una interacción directa, y esto
// evita el parpadeo/silencio confuso de intentarlo en cualquier clic.
var audioCtx = null, engineOscillator = null, engineGain = null, engineFilter = null;
var audioInitialized = false;

function initAudio(){
  if (!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    engineOscillator = audioCtx.createOscillator();
    engineOscillator.type = 'sawtooth';
    engineFilter = audioCtx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 800;
    engineFilter.Q.value = 2;
    engineGain = audioCtx.createGain();
    engineGain.gain.value = 0.0;
    engineOscillator.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(audioCtx.destination);
    engineOscillator.start();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  audioInitialized = true;
}

function updateEngineSound(out){
  if (!audioInitialized || !audioCtx || !engineOscillator) return;
  var rpmNorm = out.engineRPM / 7000;
  var freq = 80 + rpmNorm * 720;
  engineOscillator.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
  var targetVolume = 0.05 + (out.throttle * 0.15);
  engineGain.gain.setTargetAtTime(targetVolume, audioCtx.currentTime, 0.05);
  engineFilter.frequency.setTargetAtTime(400 + rpmNorm * 1200, audioCtx.currentTime, 0.1);
}

var audioBtn = document.getElementById('audioToggleBtn');
if (audioBtn){
  audioBtn.addEventListener('click', function(){
    initAudio();
    initTireSquealSound();
    audioBtn.textContent = '🔊 Sonido activado';
    audioBtn.classList.add('audio-active');
    audioBtn.disabled = true;
    setTimeout(function(){
      audioBtn.style.opacity = '0';
      audioBtn.style.transform = 'translateY(-4px)';
      setTimeout(function(){ audioBtn.style.display = 'none'; }, 500);
    }, 2000);
  });
}

function draw(out, dt){
  var rect = canvas.getBoundingClientRect();
  var w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);

  if (particles.length){
    ctx.fillStyle = currentWeather === 'rain' ? 'rgba(150,180,255,0.6)' : 'rgba(255,255,255,0.8)';
    for (var pi = 0; pi < particles.length; pi++){
      var pt = particles[pi];
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI*2); ctx.fill();
      pt.y += pt.speed; pt.x += pt.drift;
      if (pt.y > h){ pt.y = -10; pt.x = Math.random()*w; }
      if (pt.x < 0) pt.x = w;
      if (pt.x > w) pt.x = 0;
    }
  }

  var forward = out.state.x, lateral = out.state.z, psi = out.state.psi;

  ctx.fillStyle = currentWeather === 'snow' ? '#2a3038' : '#1a1e23';
  var horizonY = h * 0.4;
  ctx.fillRect(0, 0, w, horizonY);

  ctx.fillStyle = currentWeather === 'snow' ? '#3a424c' : '#13161a';
  var roadNear1 = worldToScreen(lateral - trackHalfWidth, forward - 6, w, h);
  var roadNear2 = worldToScreen(lateral + trackHalfWidth, forward - 6, w, h);
  var vanishX = w/2 - camX * 2;
  ctx.beginPath();
  ctx.moveTo(vanishX - 6, horizonY);
  ctx.lineTo(vanishX + 6, horizonY);
  ctx.lineTo(roadNear2.x, h);
  ctx.lineTo(roadNear1.x, h);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  ctx.setLineDash([14, 14]);
  for (var fM = Math.floor((forward - 20) / 20) * 20; fM < forward + 200; fM += 20){
    var lineP1 = worldToScreen(lateral, fM, w, h);
    var lineScale = lineP1.scale;
    ctx.beginPath();
    ctx.moveTo(lineP1.x - 2*lineScale, lineP1.y);
    ctx.lineTo(lineP1.x + 2*lineScale, lineP1.y);
    ctx.stroke();
    ctx.font = Math.max(8, 11*lineScale/10) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#565e6a';
    ctx.fillText(Math.round(fM) + 'm', lineP1.x + 8, lineP1.y - 4);
  }
  ctx.setLineDash([]);

  for (var i = 0; i < tireMarks.length; i++){
    var mark = tireMarks[i];
    var sm = worldToScreen(mark.z, mark.x, w, h);
    ctx.fillStyle = 'rgba(0,0,0,' + (mark.alpha*0.6) + ')';
    var msize = 6 * sm.scale / 10;
    ctx.fillRect(sm.x - msize/2, sm.y - msize, msize, msize*2);
  }

  for (var j = 0; j < car.obstacles.length; j++){
    var obs = car.obstacles[j];
    var so = worldToScreen(obs.z, obs.x, w, h);
    var osize = obs.radius * so.scale * 0.8;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(so.x, so.y + osize*0.4, osize*1.2, osize*0.4, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#ff5d5d';
    ctx.beginPath();
    ctx.moveTo(so.x, so.y - osize*1.2);
    ctx.lineTo(so.x + osize, so.y + osize*0.4);
    ctx.lineTo(so.x - osize, so.y + osize*0.4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(so.x - osize*0.7, so.y - osize*0.4, osize*1.4, osize*0.4);
  }

  var longitudinalAccel = (out.state.u - (out.previousU != null ? out.previousU : out.state.u)) / Math.max(dt, 0.001);
  var lateralAccel = out.state.v * out.state.r;
  visualState.pitch += ((-longitudinalAccel * 0.015) - visualState.pitch) * dt * 4;
  visualState.roll += ((lateralAccel * 0.02) - visualState.roll) * dt * 4;

  if (out.collisionActive && out.collisionForce > 500){
    collisionFX.active = true;
    collisionFX.lastCollisionTime = performance.now()/1000;
  }
  var timeSinceCollision = performance.now()/1000 - collisionFX.lastCollisionTime;
  if (timeSinceCollision > 0.2) collisionFX.active = false;
  var collisionFlash = collisionFX.active ? Math.max(0, 0.5 - timeSinceCollision) : 0;

  var p = worldToScreen(lateral, forward, w, h);
  var carL = 4.4 * p.scale, carW = 1.9 * p.scale;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(-psi);
  ctx.transform(1, visualState.roll*0.1, visualState.pitch*0.1, 1, 0, 0);

  ctx.save();
  ctx.translate(0, carL*0.3);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.ellipse(0, 0, carW*0.55, carL*0.25, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  var carColor = '#ff8a3d';
  if (collisionFlash > 0){
    carColor = 'rgb(255,' + Math.floor(138*(1-collisionFlash)) + ',' + Math.floor(61*(1-collisionFlash)) + ')';
  }
  ctx.fillStyle = carColor;
  ctx.fillRect(-carW/2, -carL/2, carW, carL);
  ctx.fillStyle = '#0a0c0f';
  ctx.fillRect(-carW/2 + 4, -carL/2 + 6, carW - 8, carL*0.32);

  // Ruedas visibles en las 4 esquinas reales del coche (track/wheelbase
  // físicos, no una fracción arbitraria del sprite) — dibujadas en este
  // mismo sistema de coordenadas local (ya trasladado y rotado con el
  // coche), así que su posición sale gratis con el mismo cálculo que ya
  // usa addTireMarks() para las marcas de derrape.
  var halfTrackPx = ((car.track || 1.45) / 2) * p.scale;
  var halfWBpx = ((car.wheelbase || 2.5) / 2) * p.scale;
  var wheelL = carL * 0.22, wheelW = carW * 0.16;
  ctx.fillStyle = '#15181c';
  [[-halfWBpx, -halfTrackPx], [-halfWBpx, halfTrackPx], [halfWBpx, -halfTrackPx], [halfWBpx, halfTrackPx]].forEach(function(pos){
    ctx.fillRect(pos[1] - wheelW/2, pos[0] - wheelL/2, wheelW, wheelL);
  });

  ctx.restore();
}

var minimapCanvas = document.getElementById('minimapCanvas');
var minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
function drawMinimap(out){
  if (!minimapCtx) return;
  var mw = minimapCanvas.width, mh = minimapCanvas.height;
  minimapCtx.clearRect(0, 0, mw, mh);
  var mapSize = 200;
  var scaleX = mw / mapSize, scaleY = mh / mapSize;
  var centerX = mw/2, centerY = mh/2;

  minimapCtx.strokeStyle = '#30363d';
  minimapCtx.lineWidth = 2;
  minimapCtx.beginPath();
  minimapCtx.moveTo(0, centerY - 6*scaleY); minimapCtx.lineTo(mw, centerY - 6*scaleY);
  minimapCtx.moveTo(0, centerY + 6*scaleY); minimapCtx.lineTo(mw, centerY + 6*scaleY);
  minimapCtx.stroke();

  minimapCtx.fillStyle = '#ff5d5d';
  for (var j = 0; j < car.obstacles.length; j++){
    var obs = car.obstacles[j];
    var sx = centerX + (obs.x - out.state.x) * scaleX;
    var sy = centerY + (obs.z - out.state.z) * scaleY;
    if (sx > 0 && sx < mw && sy > 0 && sy < mh){
      minimapCtx.beginPath(); minimapCtx.arc(sx, sy, 4, 0, Math.PI*2); minimapCtx.fill();
    }
  }

  minimapCtx.save();
  minimapCtx.translate(centerX, centerY);
  minimapCtx.rotate(-out.state.psi);
  minimapCtx.fillStyle = '#ff8a3d';
  minimapCtx.beginPath();
  minimapCtx.moveTo(6, 0); minimapCtx.lineTo(-4, -4); minimapCtx.lineTo(-4, 4);
  minimapCtx.closePath(); minimapCtx.fill();
  minimapCtx.restore();
}
// ===== VISTA INMERSIVA: ESCENA 3D REAL CON THREE.JS =====
// Sustituye la vista pseudo-3D anterior (proyección en perspectiva sobre
// canvas 2D) por una escena WebGL de verdad, con geometría real de
// neumático/llanta/radios — igual que en tiresim-pro.html, del que se
// ha adaptado esta construcción de rueda (simplificada a un solo estilo
// de neumático/llanta en vez del catálogo completo, que es config. de
// producto, no algo necesario para el escaparate).
//
// Aviso de ejes, comprobado leyendo el motor interno de tiresim-pro.html:
// en ESA escena original, "adelante" es el eje Z de Three.js (su propia
// física usa worldDz = u*cos(psi), z += worldDz). En MI motor (el que
// realmente corre aquí) "adelante" es el eje X (comprobado extensamente
// esta sesión). Así que al pasar los datos del motor a la escena 3D,
// threeX = out.state.z (lateral) y threeZ = out.state.x (adelante) —
// intercambiados a propósito, no es un despiste.
var viewMode = 'topdown';
var scene3d = null, camera3d = null, renderer3d = null, chassisGroup3d = null;
var wheelMeshes3d = [], groundGroup3d = null, obstacleMeshes3d = [];
var scene3dReady = false;
var wheelSpinAngle = [0, 0, 0, 0];

function make3dWheel(){
  var R0 = car.wheelRadius || 0.32;
  var halfW = 0.11;
  var tube = Math.min(0.45*R0, Math.max(0.035, halfW*0.85));
  var torusR = Math.max(0.12, R0 - tube);
  function axleX(geo){ geo.rotateY(Math.PI/2); return geo; }

  var g = new THREE.Group();
  var spinGroup = new THREE.Group();

  var tireMesh = new THREE.Mesh(
    axleX(new THREE.TorusGeometry(torusR, tube, 12, 22)),
    new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.9, metalness: 0.04 })
  );
  spinGroup.add(tireMesh);

  var sideMat = new THREE.MeshStandardMaterial({ color: 0x2a2a32, roughness: 0.85, metalness: 0.06, side: THREE.DoubleSide });
  var side1 = new THREE.Mesh(axleX(new THREE.RingGeometry(torusR*0.72, torusR+tube*0.15, 20)), sideMat);
  side1.position.x = halfW*0.42;
  spinGroup.add(side1);
  var side2 = side1.clone(); side2.position.x = -halfW*0.42;
  spinGroup.add(side2);

  var rimRing = new THREE.Mesh(
    axleX(new THREE.TorusGeometry(torusR*0.78, Math.max(0.012, tube*0.18), 8, 18)),
    new THREE.MeshStandardMaterial({ color: 0xb8c4d0, roughness: 0.28, metalness: 0.82 })
  );
  spinGroup.add(rimRing);

  var hubGeo = new THREE.CylinderGeometry(0.30*R0, 0.30*R0, Math.max(0.05, halfW*1.2), 16);
  hubGeo.rotateZ(Math.PI/2);
  var hub = new THREE.Mesh(hubGeo, new THREE.MeshStandardMaterial({ color: 0xe8a54b, roughness: 0.3, metalness: 0.7, emissive: 0xe8a54b, emissiveIntensity: 0.35 }));
  spinGroup.add(hub);

  var spokeMat = new THREE.MeshStandardMaterial({ color: 0xb8c4d0, roughness: 0.32, metalness: 0.75 });
  var nSp = 8;
  for (var i = 0; i < nSp; i++){
    var spoke = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.02, halfW*0.7), 1.45*torusR, 0.032), spokeMat);
    spoke.rotation.x = i * (Math.PI / nSp);
    spinGroup.add(spoke);
  }

  var treadMat = new THREE.MeshStandardMaterial({ color: 0x3a3a46, roughness: 0.95, metalness: 0.02 });
  var nTread = 10, ch = 0.06;
  for (var t = 0; t < nTread; t++){
    var ang = t * Math.PI * 2 / nTread;
    var bar = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.06, halfW*2.05), ch, ch*1.15), treadMat);
    bar.position.set(0, Math.cos(ang)*(torusR+tube*0.12), Math.sin(ang)*(torusR+tube*0.12));
    bar.rotation.x = ang;
    spinGroup.add(bar);
  }

  g.add(spinGroup);
  g.userData.spinGroup = spinGroup;
  return g;
}

function init3dScene(){
  if (scene3dReady) return;
  var container = document.getElementById('scene3dContainer');
  if (!container || typeof THREE === 'undefined') return;
  var w = container.clientWidth || 700, h = container.clientHeight || 400;

  scene3d = new THREE.Scene();
  scene3d.background = new THREE.Color(0x0a0e17);
  camera3d = new THREE.PerspectiveCamera(50, w/h, 0.1, 300);
  renderer3d = new THREE.WebGLRenderer({ antialias: true });
  renderer3d.setSize(w, h);
  renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer3d.domElement);

  scene3d.add(new THREE.AmbientLight(0x8899aa, 1.05));
  var dir = new THREE.DirectionalLight(0xffffff, 1.15);
  dir.position.set(20, 40, 10);
  scene3d.add(dir);
  var fill = new THREE.DirectionalLight(0xaaccff, 0.55);
  fill.position.set(-15, 20, -10);
  scene3d.add(fill);

  groundGroup3d = new THREE.Group();
  scene3d.add(groundGroup3d);
  groundGroup3d.add(new THREE.GridHelper(400, 80, 0x2a3a55, 0x1a2332));

  var laneMat = new THREE.LineBasicMaterial({ color: 0xffee88 });
  function laneLine(x){
    var geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.02, -80), new THREE.Vector3(x, 0.02, 400)]);
    return new THREE.Line(geo, laneMat);
  }
  scene3d.add(laneLine(-(car.track||1.5)/2 - 1.8));
  scene3d.add(laneLine((car.track||1.5)/2 + 1.8));

  chassisGroup3d = new THREE.Group();
  scene3d.add(chassisGroup3d);
  var chassisBody = new THREE.Mesh(
    new THREE.BoxGeometry(car.track ? car.track*0.85 : 1.7, 0.5, 4.2),
    new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.45, metalness: 0.25 })
  );
  chassisBody.position.y = 0.55;
  chassisGroup3d.add(chassisBody);
  var nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.55, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8a54b, emissive: 0xe8a54b, emissiveIntensity: 0.35, roughness: 0.4 })
  );
  nose.rotation.x = Math.PI/2;
  nose.position.set(0, 0.55, 2.3);
  chassisGroup3d.add(nose);

  wheelMeshes3d = [];
  for (var i = 0; i < 4; i++){
    var mesh = make3dWheel();
    chassisGroup3d.add(mesh);
    wheelMeshes3d.push(mesh);
  }

  obstacleMeshes3d = car.obstacles.map(function(obs){
    var m = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.4, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0x440010, roughness: 0.55 })
    );
    // obs.x = adelante (mi motor), obs.z = lateral -> three.js (lateral, _, adelante)
    m.position.set(obs.z, 0.7, obs.x);
    scene3d.add(m);
    return m;
  });

  scene3dReady = true;
}

function resize3dScene(){
  if (!scene3dReady || !renderer3d) return;
  var container = document.getElementById('scene3dContainer');
  var w = container.clientWidth, h = container.clientHeight;
  if (w < 10 || h < 10) return;
  camera3d.aspect = w/h;
  camera3d.updateProjectionMatrix();
  renderer3d.setSize(w, h);
}
window.addEventListener('resize', resize3dScene);

var viewToggleBtn = document.getElementById('viewToggleBtn');
if (viewToggleBtn){
  viewToggleBtn.addEventListener('click', function(){
    viewMode = (viewMode === 'topdown') ? 'immersive' : 'topdown';
    var immersiveEl = document.getElementById('immersiveWrap');
    if (immersiveEl) immersiveEl.style.display = (viewMode === 'immersive') ? 'block' : 'none';
    viewToggleBtn.classList.toggle('active', viewMode === 'immersive');
    viewToggleBtn.textContent = (viewMode === 'immersive') ? '📹 Vista superior' : '📹 Vista inmersiva (3D)';
    if (hint) hint.style.display = (viewMode === 'immersive') ? 'none' : '';
    if (viewMode === 'immersive'){
      init3dScene();
      setTimeout(resize3dScene, 50);
    }
  });
}

function update3dScene(out, dt, steerInput){
  if (!scene3dReady) return;

  // Intercambio de ejes deliberado: three.X=lateral(mi z), three.Z=adelante(mi x).
  chassisGroup3d.position.set(out.state.z, 0, out.state.x);
  chassisGroup3d.rotation.y = out.state.psi;

  var halfTrack = (car.track || 1.5) / 2, halfWB = (car.wheelbase || 2.6) / 2;
  var wheelLocalPos = [
    [-halfTrack, halfWB], [halfTrack, halfWB],   // FL, FR (delanteras)
    [-halfTrack, -halfWB], [halfTrack, -halfWB]  // RL, RR (traseras)
  ];
  var R0 = car.wheelRadius || 0.32;
  for (var i = 0; i < 4; i++){
    var mesh = wheelMeshes3d[i];
    if (!mesh) continue;
    mesh.position.set(wheelLocalPos[i][0], R0, wheelLocalPos[i][1]);
    // Las ruedas delanteras (0,1) giran con el volante; el ángulo real
    // de dirección no lo expone `out`, así que se aproxima con el input
    // de control (steer) escalado a un máximo razonable de 35°.
    if (i < 2) mesh.rotation.y = (steerInput || 0) * (35 * Math.PI / 180);
    wheelSpinAngle[i] += (out.wheels[i] ? out.wheels[i].omega : 0) * dt;
    if (mesh.userData.spinGroup) mesh.userData.spinGroup.rotation.x = -wheelSpinAngle[i];
  }

  var chaseDist = 7.5, chaseHeight = 3.0;
  var camXTarget = out.state.z - Math.sin(out.state.psi) * chaseDist;
  var camZTarget = out.state.x - Math.cos(out.state.psi) * chaseDist;
  camera3d.position.x += (camXTarget - camera3d.position.x) * Math.min(1, dt*4);
  camera3d.position.z += (camZTarget - camera3d.position.z) * Math.min(1, dt*4);
  camera3d.position.y += (chaseHeight - camera3d.position.y) * Math.min(1, dt*4);
  camera3d.lookAt(out.state.z, 0.6, out.state.x);

  document.getElementById('hud3dSpeed').textContent = Math.round(Math.abs(out.state.u) * 3.6) + ' km/h';
  document.getElementById('hud3dGear').textContent = out.gearName;
  document.getElementById('hud3dRpm').textContent = Math.round(out.engineRPM) + ' RPM';

  renderer3d.render(scene3d, camera3d);
}
var last = performance.now();
function loop(now){
  var dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  var controls = readControls();
  var previousU = car.u;
  var out = car.step(dt, controls);
  out.previousU = previousU;

  addTireMarks(out);
  updateCamera(out, dt);
  if (viewMode === 'immersive'){
    update3dScene(out, dt, controls.steer);
  } else {
    draw(out, dt);
  }
  drawMinimap(out);
  updateEngineSound(out);

  document.getElementById('teleSpeed').textContent = fmt(Math.abs(out.state.u) * 3.6, 1) + ' km/h';
  document.getElementById('teleGear').textContent = out.gearName;
  document.getElementById('teleDist').textContent = fmt(Math.abs(out.state.x), 1) + ' m';
  document.getElementById('teleRpm').textContent = fmt(out.engineRPM, 0);

  var rpmBar = document.getElementById('rpmBar');
  if (rpmBar) rpmBar.style.width = Math.min(100, (out.engineRPM / 7000) * 100) + '%';

  var shiftUpEl = document.getElementById('shiftUpIndicator');
  var shiftDownEl = document.getElementById('shiftDownIndicator');
  var shouldShiftUp = manualMode && out.engineRPM > 6000 && car.transmission.currentGear < 6;
  var shouldShiftDown = manualMode && out.engineRPM < 2000 && car.transmission.currentGear > 1;
  if (shiftUpEl) shiftUpEl.style.display = shouldShiftUp ? 'inline-flex' : 'none';
  if (shiftDownEl) shiftDownEl.style.display = shouldShiftDown ? 'inline-flex' : 'none';

  collisionEl.textContent = fmt(out.collisionForce, 0) + ' N';
  collisionEl.style.color = out.collisionForce > 0 ? 'var(--red)' : 'var(--green)';

  var ids = ['w0', 'w1', 'w2', 'w3'];
  for (var i = 0; i < 4 && i < out.wheels.length; i++){
    var el = document.getElementById(ids[i] + 's');
    var elf = document.getElementById(ids[i] + 'f');
    if (el) el.textContent = fmt(out.wheels[i].slip, 2);
    if (elf) elf.textContent = fmt(out.wheels[i].Fz, 0);
  }

  if (hasMoved){ hint.style.opacity = '0'; engineStateEl.textContent = 'en marcha'; }
  else { engineStateEl.textContent = 'en ralentí — pulsa una tecla'; }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

})();
