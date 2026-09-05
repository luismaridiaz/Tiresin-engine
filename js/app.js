(function(){
"use strict";

var canvas = document.getElementById('demoCanvas');
var ctx = canvas.getContext('2d');
var hint = document.getElementById('demoHint');
var engineStateEl = document.getElementById('teleEngineState');

function resize(){
  var rect = canvas.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

var car = TireSimEngine.createVehicle({
  mass: 1150, wheelbase: 2.5, track: 1.45, numWheels: 4,
  drivetrain: 'REAR', transmissionMode: 'auto', restitution: 0.2
});
car.setGear(1);
car.addObstacle(1000, 1000, 0.5, 1.0, 1.0); // fuera de la pista, solo para que el sistema de colisiones esté vivo

var keys = {};
window.addEventListener('keydown', function(e){
  keys[e.key.toLowerCase()] = true;
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].indexOf(e.key.toLowerCase()) > -1) e.preventDefault();
});
window.addEventListener('keyup', function(e){ keys[e.key.toLowerCase()] = false; });

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

// Cámara de persecución simple, en coordenadas de mundo (metros) -> pantalla
var camX = 0, camZ = 0;
var trackHalfWidth = 5.5;

function worldToScreen(x, z, w, h, scale){
  return { x: w/2 + (x - camX) * scale, y: h/2 + (z - camZ) * scale };
}

function draw(out){
  var rect = canvas.getBoundingClientRect();
  var w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);

  var scale = 9; // px por metro
  // "Adelante" en este motor es el eje X (a psi=0, u mueve x, no z) — la
  // demo dibujaba la carretera y las marcas de distancia sobre Z, que
  // apenas cambia yendo recto: el cuentakilómetros se quedaba en 0.0
  // pese a que la velocidad subía con normalidad. worldToScreen toma
  // ahora (lateral, adelante) en vez de (x, z) directamente.
  camX = out.state.z; // camX = referencia lateral (para worldToScreen)
  camZ = out.state.x; // camZ = referencia de avance
  var forward = out.state.x, lateral = out.state.z;

  // Carretera (franja recta con marcas centrales, referencia de movimiento)
  ctx.fillStyle = '#1a1e23';
  var roadP1 = worldToScreen(lateral - trackHalfWidth, forward - 200, w, h, scale);
  var roadP2 = worldToScreen(lateral + trackHalfWidth, forward + 200, w, h, scale);
  ctx.fillRect(roadP1.x, 0, roadP2.x - roadP1.x, h);

  ctx.strokeStyle = '#30363d';
  ctx.setLineDash([14, 14]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  var lineTop = worldToScreen(lateral, forward - 200, w, h, scale);
  var lineBot = worldToScreen(lateral, forward + 200, w, h, scale);
  ctx.moveTo(lineTop.x, 0); ctx.lineTo(lineBot.x, h);
  ctx.stroke();
  ctx.setLineDash([]);

  // Marcas de distancia cada 20m, con la cota en metros — sin un número
  // que cambie, la cámara seguidora hace casi imperceptible que el
  // coche se está moviendo de verdad.
  ctx.strokeStyle = '#262b33';
  ctx.lineWidth = 1;
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.fillStyle = '#565e6a';
  var startMark = Math.floor((forward - 40) / 20) * 20;
  for (var fM = startMark; fM < forward + 40; fM += 20){
    var p1 = worldToScreen(lateral - trackHalfWidth, fM, w, h, scale);
    var p2 = worldToScreen(lateral + trackHalfWidth, fM, w, h, scale);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.fillText(Math.round(fM) + 'm', p2.x + 8, p2.y + 4);
  }

  // Coche (rectángulo orientado según psi)
  var p = worldToScreen(lateral, forward, w, h, scale);
  var carL = 4.4 * scale, carW = 1.9 * scale;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(-out.state.psi);
  ctx.fillStyle = '#ff8a3d';
  ctx.fillRect(-carW/2, -carL/2, carW, carL);
  ctx.fillStyle = '#0a0c0f';
  ctx.fillRect(-carW/2 + 4, -carL/2 + 6, carW - 8, carL * 0.32);
  ctx.restore();
}

function fmt(n, d){ return (isFinite(n) ? n : 0).toFixed(d == null ? 1 : d); }

var last = performance.now();
function loop(now){
  var dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  var controls = readControls();
  var out = car.step(dt, controls);

  draw(out);

  document.getElementById('teleSpeed').textContent = fmt(Math.abs(out.state.u) * 3.6, 1) + ' km/h';
  document.getElementById('teleGear').textContent = out.gearName;
  document.getElementById('teleDist').textContent = fmt(Math.abs(out.state.x), 1) + ' m';
  document.getElementById('teleRpm').textContent = fmt(out.engineRPM, 0);
  var ids = ['w0', 'w1', 'w2', 'w3'];
  for (var i = 0; i < 4 && i < out.wheels.length; i++){
    var el = document.getElementById(ids[i] + 's');
    var elf = document.getElementById(ids[i] + 'f');
    if (el) el.textContent = fmt(out.wheels[i].slip, 2);
    if (elf) elf.textContent = fmt(out.wheels[i].Fz, 0);
  }

  if (hasMoved) { hint.style.opacity = '0'; engineStateEl.textContent = 'en marcha'; }
  else { engineStateEl.textContent = 'en ralentí — pulsa una tecla'; }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

})();
