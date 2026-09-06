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

// ===== VISTA INMERSIVA (pseudo-3D: conductor + exterior) =====
// El motor es 2.5D (x, z, psi) — no hay altura/pitch/roll real, así que
// esto es proyección en perspectiva sobre sprites 2D (como OutRun), no
// una cámara 3D de verdad. Es un MODO ALTERNABLE al de arriba, no un
// reemplazo: todo lo demás (clima, minimapa, transmisión, sonido,
// controles táctiles) sigue funcionando igual en ambos modos.
var viewMode = 'topdown';
var driverCanvas = document.getElementById('driverCanvas');
var driverCtx = driverCanvas ? driverCanvas.getContext('2d') : null;
var chaseCanvas = document.getElementById('chaseCanvas');
var chaseCtx = chaseCanvas ? chaseCanvas.getContext('2d') : null;
var immersiveHorizonY = 0;

function resizeImmersiveCanvases(){
  [driverCanvas, chaseCanvas].forEach(function(cv){
    if (!cv) return;
    var rect = cv.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    cv.width = rect.width * dpr;
    cv.height = rect.height * dpr;
    cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  });
}

var viewToggleBtn = document.getElementById('viewToggleBtn');
if (viewToggleBtn){
  viewToggleBtn.addEventListener('click', function(){
    viewMode = (viewMode === 'topdown') ? 'immersive' : 'topdown';
    var immersiveEl = document.getElementById('immersiveWrap');
    if (immersiveEl) immersiveEl.style.display = (viewMode === 'immersive') ? 'grid' : 'none';
    viewToggleBtn.classList.toggle('active', viewMode === 'immersive');
    viewToggleBtn.textContent = (viewMode === 'immersive') ? '📹 Vista superior' : '📹 Vista inmersiva';
    // El texto de ayuda se solapaba con la etiqueta "Vista conductor" — en
    // modo inmersivo el propio salpicadero ya muestra velocidad/marcha/RPM.
    if (hint) hint.style.display = (viewMode === 'immersive') ? 'none' : '';
    if (viewMode === 'immersive') resizeImmersiveCanvases();
  });
}
window.addEventListener('resize', resizeImmersiveCanvases);

function projectToScreen(worldLateral, worldForward, refLateral, refForward, canvasW, canvasH){
  var dLat = worldLateral - refLateral;
  var depth = worldForward - refForward;
  if (depth < 0.1) depth = 0.1; // detrás de la cámara: no se dibuja (el llamador lo filtra), pero nunca ÷0
  var perspective = 1 / depth;
  return {
    x: canvasW / 2 + dLat * perspective * 100,
    y: immersiveHorizonY + (2.5 * perspective * 100),
    scale: perspective * 100,
    depth: depth
  };
}

var worldObjects = [];
function generateWorldObjects(){
  worldObjects = [];
  for (var i = 0; i < 60; i++){
    worldObjects.push({ lateral: (i % 2 === 0 ? -8 : 8), forward: i * 20, type: 'tree', size: 2 });
  }
  for (var j = 0; j < 30; j++){
    worldObjects.push({ lateral: (j % 2 === 0 ? -6 : 6), forward: j * 40, type: 'pole', size: 0.5 });
  }
}
generateWorldObjects();

// Reloj propio que se acumula con el tiempo real, no con dt de un solo
// fotograma — antes el temblor de colisión usaba Math.sin(dt*50), y dt
// (~0.0167s a 60fps) apenas cambia de un fotograma al siguiente, así que
// no era un temblor: era un desplazamiento fijo, casi constante siempre.
var immersiveClock = 0;

function drawDriverView(out, dt){
  if (!driverCtx) return;
  var rect = driverCanvas.getBoundingClientRect();
  var w = rect.width, h = rect.height;
  driverCtx.clearRect(0, 0, w, h);

  var forward = out.state.x, lateral = out.state.z;
  immersiveHorizonY = h * 0.45;

  driverCtx.fillStyle = '#1a1e23'; driverCtx.fillRect(0, 0, w, immersiveHorizonY);
  driverCtx.fillStyle = '#0f1114'; driverCtx.fillRect(0, immersiveHorizonY, w, h - immersiveHorizonY);

  var roadLeftFar = projectToScreen(lateral - 3.5, forward + 100, lateral, forward, w, h);
  var roadRightFar = projectToScreen(lateral + 3.5, forward + 100, lateral, forward, w, h);
  var roadLeftNear = projectToScreen(lateral - 3.5, forward + 2, lateral, forward, w, h);
  var roadRightNear = projectToScreen(lateral + 3.5, forward + 2, lateral, forward, w, h);
  driverCtx.fillStyle = '#252a30';
  driverCtx.beginPath();
  driverCtx.moveTo(roadLeftFar.x, roadLeftFar.y);
  driverCtx.lineTo(roadRightFar.x, roadRightFar.y);
  driverCtx.lineTo(roadRightNear.x, roadRightNear.y);
  driverCtx.lineTo(roadLeftNear.x, roadLeftNear.y);
  driverCtx.closePath(); driverCtx.fill();

  driverCtx.strokeStyle = '#f0c040'; driverCtx.lineWidth = 2;
  for (var i = 0; i < 20; i++){
    var zPos = forward + 2 + i * 5;
    if (i % 2 === 0){
      var lf = projectToScreen(lateral, zPos + 2.5, lateral, forward, w, h);
      var ln = projectToScreen(lateral, zPos, lateral, forward, w, h);
      driverCtx.beginPath(); driverCtx.moveTo(lf.x, lf.y); driverCtx.lineTo(ln.x, ln.y); driverCtx.stroke();
    }
  }

  var shaking = out.collisionForce > 500;
  if (shaking){
    driverCtx.save();
    driverCtx.translate(Math.sin(immersiveClock * 60) * 4, Math.cos(immersiveClock * 55) * 4);
  }

  driverCtx.fillStyle = 'rgba(10,12,15,0.9)';
  driverCtx.fillRect(0, h - 80, w, 80);
  driverCtx.fillStyle = '#e8ebef';
  driverCtx.font = 'bold 32px monospace';
  driverCtx.textAlign = 'center';
  driverCtx.fillText(Math.round(Math.abs(out.state.u) * 3.6) + ' km/h', w / 2, h - 30);
  driverCtx.font = '16px monospace';
  driverCtx.fillStyle = '#838b97';
  driverCtx.fillText(Math.round(out.engineRPM) + ' RPM', w / 2 + 100, h - 40);
  driverCtx.fillText(out.gearName, w / 2 - 100, h - 40);
  driverCtx.textAlign = 'left';

  if (shaking){
    driverCtx.restore();
    driverCtx.fillStyle = 'rgba(255,0,0,0.25)';
    driverCtx.fillRect(0, 0, w, h);
  }
}

function drawChaseView(out, dt){
  if (!chaseCtx) return;
  var rect = chaseCanvas.getBoundingClientRect();
  var w = rect.width, h = rect.height;
  chaseCtx.clearRect(0, 0, w, h);

  var forward = out.state.x, lateral = out.state.z;
  immersiveHorizonY = h * 0.35;

  var skyGrad = chaseCtx.createLinearGradient(0, 0, 0, immersiveHorizonY);
  skyGrad.addColorStop(0, '#0a0c0f'); skyGrad.addColorStop(1, '#2a3a4a');
  chaseCtx.fillStyle = skyGrad; chaseCtx.fillRect(0, 0, w, immersiveHorizonY);
  chaseCtx.fillStyle = '#13161a'; chaseCtx.fillRect(0, immersiveHorizonY, w, h - immersiveHorizonY);

  // La cámara de esta vista va detrás del coche (con el mismo lerp que
  // la vista superior, camX/camZ), no pegada a él como la del conductor.
  for (var i = 0; i < worldObjects.length; i++){
    var obj = worldObjects[i];
    if (obj.forward - camZ < -10 || obj.forward - camZ > 150) continue; // fuera de rango razonable, ahorra dibujo
    var os = projectToScreen(obj.lateral, obj.forward, camX, camZ, w, h);
    if (os.x < -100 || os.x > w + 100 || os.y < -100 || os.y > h + 100) continue;
    var osize = obj.size * os.scale;
    if (obj.type === 'tree'){
      chaseCtx.fillStyle = '#1a4a2a';
      chaseCtx.beginPath(); chaseCtx.arc(os.x, os.y - osize, osize, 0, Math.PI*2); chaseCtx.fill();
      chaseCtx.fillStyle = '#5a3a1a';
      chaseCtx.fillRect(os.x - 2, os.y - 2, 4, osize * 0.5);
    } else {
      chaseCtx.fillStyle = '#888';
      chaseCtx.fillRect(os.x - osize/2, os.y - osize*3, osize, osize*3);
      chaseCtx.fillStyle = '#ff0';
      chaseCtx.beginPath(); chaseCtx.arc(os.x, os.y - osize*3, osize*0.3, 0, Math.PI*2); chaseCtx.fill();
    }
  }

  var roadLeftFar = projectToScreen(lateral - 3.5, forward + 100, camX, camZ, w, h);
  var roadRightFar = projectToScreen(lateral + 3.5, forward + 100, camX, camZ, w, h);
  var roadLeftNear = projectToScreen(lateral - 3.5, forward - 20, camX, camZ, w, h);
  var roadRightNear = projectToScreen(lateral + 3.5, forward - 20, camX, camZ, w, h);
  chaseCtx.fillStyle = '#252a30';
  chaseCtx.beginPath();
  chaseCtx.moveTo(roadLeftFar.x, roadLeftFar.y);
  chaseCtx.lineTo(roadRightFar.x, roadRightFar.y);
  chaseCtx.lineTo(roadRightNear.x, roadRightNear.y);
  chaseCtx.lineTo(roadLeftNear.x, roadLeftNear.y);
  chaseCtx.closePath(); chaseCtx.fill();

  chaseCtx.strokeStyle = '#f0c040'; chaseCtx.lineWidth = 3;
  for (var j = 0; j < 30; j++){
    var zPos = forward - 20 + j * 5;
    if (j % 2 === 0){
      var lf2 = projectToScreen(lateral, zPos + 2.5, camX, camZ, w, h);
      var ln2 = projectToScreen(lateral, zPos, camX, camZ, w, h);
      chaseCtx.beginPath(); chaseCtx.moveTo(lf2.x, lf2.y); chaseCtx.lineTo(ln2.x, ln2.y); chaseCtx.stroke();
    }
  }

  for (var k = 0; k < car.obstacles.length; k++){
    var obs = car.obstacles[k];
    if (obs.x - camZ < -5) continue; // ya quedó atrás
    var oS = projectToScreen(obs.z, obs.x, camX, camZ, w, h);
    var oSize = obs.radius * oS.scale;
    if (oS.y > immersiveHorizonY && oS.y < h + 200){
      chaseCtx.fillStyle = '#ff5d5d';
      chaseCtx.beginPath(); chaseCtx.arc(oS.x, oS.y - oSize, oSize, 0, Math.PI*2); chaseCtx.fill();
    }
  }

  if (forward - camZ > 0.05 || true){ // el coche siempre está frente a esta cámara (mira hacia delante)
    var cS = projectToScreen(lateral, forward, camX, camZ, w, h);
    var carSize = 4.4 * cS.scale;
    chaseCtx.fillStyle = 'rgba(0,0,0,0.5)';
    chaseCtx.beginPath(); chaseCtx.ellipse(cS.x, cS.y, carSize*0.6, carSize*0.3, 0, 0, Math.PI*2); chaseCtx.fill();
    chaseCtx.fillStyle = '#ff8a3d';
    chaseCtx.fillRect(cS.x - carSize/2, cS.y - carSize/2, carSize, carSize);
    chaseCtx.fillStyle = '#0a0c0f';
    chaseCtx.fillRect(cS.x - carSize/2 + 2, cS.y - carSize/2 + 2, carSize - 4, carSize*0.4);
  }
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
  immersiveClock += dt;
  if (viewMode === 'immersive'){
    drawDriverView(out, dt);
    drawChaseView(out, dt);
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
