const TireSimEngine = (() => {

  class DahlStribeckContact {
    constructor(params = {}) {
      this.muStatic = params.muStatic ?? 1.0;
      this.muDynamic = params.muDynamic ?? 0.85;
      this.contactStiffness = params.contactStiffness ?? 120000;
      this.viscousDamping = params.viscousDamping ?? 80;
      this.stribeckSpeed = params.stribeckSpeed ?? 0.05;
      this.regularization = params.regularization ?? 0.02;
      this.z = 0;
      this.temperature = params.temperature ?? 25;
    }

    muCurve(v) {
      const absV = Math.abs(v);
      const vs = this.stribeckSpeed;
      if (absV < 1e-12) return this.muStatic;
      let mu = this.muDynamic + (this.muStatic - this.muDynamic) / (1 + (absV / vs) * (absV / vs));
      const T = this.temperature;
      const tempFactor = T < 30 ? 0.6 + 0.4 * (T - 10) / 20 :
                          T < 70 ? 0.8 + 0.2 * (T - 30) / 40 :
                          T < 90 ? 1.0 :
                          T < 120 ? 1.0 - 0.3 * (T - 90) / 30 : 0.5;
      return mu * tempFactor;
    }

    smoothSlip(v) {
      const eps = this.regularization;
      const absV = Math.abs(v);
      const smooth = 1 - Math.exp(-absV / eps);
      return (v / (absV + eps)) * smooth;
    }

    dahlStep(v, F_c, dt) {
      const sigma0 = this.contactStiffness * 0.01;
      const absV = Math.abs(v);
      if (absV < 1e-12) return 0;
      const dz = v * (1 - sigma0 * this.z / (F_c + 1e-10) * (v / absV)) * dt;
      this.z += dz;
      const z_max = F_c / sigma0;
      this.z = Math.max(-z_max, Math.min(z_max, this.z));
      return sigma0 * this.z;
    }

    compute(vs, Fz, dt) {
      // vs = deslizamiento real (ω·R − v_suelo), no la velocidad del
      // vehículo. Y F_accel/F_brake/F_gravity se han quitado del todo:
      // se recibían pero no se usaban en ningún sitio del cuerpo de la
      // función — el par del motor se calculaba en toda la cadena de
      // transmisión y se tiraba antes de llegar aquí. Probado: 3s de
      // acelerador a fondo sin mover el coche ni un milímetro.
      const K = this.contactStiffness;
      const C = this.viscousDamping;
      const mu_eff = this.muCurve(vs);
      const slip = this.smoothSlip(vs);

      const F_spring = K * slip * 0.008;
      const F_damper = C * vs;
      let F_contact = F_spring + F_damper;

      const F_max = mu_eff * Fz;
      const F_hysteresis = this.dahlStep(vs, F_max, dt);
      let F_total = F_contact + F_hysteresis * 0.3;

      const sat = F_max * (2 / Math.PI) * Math.atan(F_total / (F_max + 0.001));
      F_total = sat;

      const Fmag = Math.abs(F_total);
      const grip = Fmag > 0 ? Math.min(1, Fmag / (F_max + 1e-10)) : 1;

      return { Fx: F_total, Fz, mu: mu_eff, slip, grip, F_max };
    }

    reset() { this.z = 0; }
  }

  class Transmission {
    constructor(params = {}) {
      this.gearRatios = params.gearRatios ?? {
        '-1': -3.2, '0': 0, '1': 3.6, '2': 2.2,
        '3': 1.5, '4': 1.1, '5': 0.85, '6': 0.68
      };
      this.finalDrive = params.finalDrive ?? 3.42;
      this.engineTorque = params.engineTorque ?? 250;
      this.engineInertia = params.engineInertia ?? 0.15;
      this.wheelRadius = params.wheelRadius ?? 0.32;
      this.efficiency = params.efficiency ?? 0.92;
      this.maxRPM = params.maxRPM ?? 7000;
      this.shiftThreshold = params.shiftThreshold ?? 4500;
      this.mode = params.mode ?? 'manual';
      this.currentGear = params.initialGear ?? 0;
      this.engineRPM = 0;
      this.clutch = params.clutch ?? 1.0;
    }

    setGear(gear) { this.currentGear = gear; }
    setClutch(engagement) { this.clutch = Math.max(0, Math.min(1, engagement)); }

    autoShift(vehicleSpeed) {
      const rpm = this.engineRPM;
      const current = this.currentGear;
      const maxGear = 6;
      const minGear = 1;
      if (rpm > this.shiftThreshold && current < maxGear) return current + 1;
      if (rpm < this.shiftThreshold * 0.5 && current > minGear) return current - 1;
      if (rpm < 800 && current > minGear && vehicleSpeed < 2) return current - 1;
      return current;
    }

    step(vehicleSpeed, throttle, dt) {
      const gear = this.currentGear;
      const ratio = this.gearRatios[String(gear)] || 0;
      const finalDrive = this.finalDrive;
      const wheelRadius = this.wheelRadius;

      let targetRPM = 0;
      if (ratio !== 0 && vehicleSpeed > 0.1) {
        targetRPM = (vehicleSpeed * 60 * ratio * finalDrive) / (2 * Math.PI * wheelRadius);
        targetRPM = Math.max(0, targetRPM);
      }

      const engineAccel = (targetRPM - this.engineRPM) * 10;
      this.engineRPM += engineAccel * dt;
      this.engineRPM = Math.max(0, Math.min(this.maxRPM, this.engineRPM));

      const rpmNorm = this.engineRPM / this.maxRPM;
      const torqueFactor = Math.max(0, 1 - 0.8 * Math.pow(rpmNorm - 0.4, 2));
      const availableTorque = this.engineTorque * torqueFactor * throttle;

      let wheelTorque = 0, transmissionForce = 0;
      if (ratio !== 0 && this.clutch > 0.01) {
        wheelTorque = availableTorque * ratio * finalDrive * this.efficiency * this.clutch;
        transmissionForce = wheelTorque / wheelRadius;
      }

      const inertiaLoss = this.engineInertia * (this.engineRPM / 100) * 0.01;

      return {
        engineRPM: this.engineRPM,
        transmissionForce: transmissionForce - inertiaLoss,
        wheelTorque: wheelTorque,
        gearRatio: ratio,
        availableTorque: availableTorque
      };
    }

    getGearName(gear) {
      const names = { '-1': 'R', '0': 'N', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6' };
      return names[String(gear)] || 'N';
    }

    reset() { this.engineRPM = 0; }
  }

  class Vehicle {
    constructor(params = {}) {
      this.mass = params.mass ?? 1200;
      this.wheelbase = params.wheelbase ?? 2.6;
      this.track = params.track ?? 1.5;
      this.numWheels = params.numWheels ?? 4;
      this.drivetrain = params.drivetrain ?? 'REAR';
      this.wheelRadius = params.wheelRadius ?? 0.32;
      this.CGHeight = params.CGHeight ?? 0.45;
      this.gravity = params.gravity ?? 9.81;
      this.weightDistribution = params.weightDistribution ?? 0.55;
      this.Izz = params.Izz ?? 2500;

      this.x = 0; this.z = 0; this.psi = 0;
      this.u = 0; this.v = 0; this.r = 0;

      this.suspensionSpring = params.suspensionSpring ?? 40000;
      this.suspensionDamping = params.suspensionDamping ?? 3000;
      this.suspensionTravel = [0, 0, 0, 0];
      this.suspensionVelocity = [0, 0, 0, 0];
      this.suspensionMaxTravel = params.suspensionMaxTravel ?? 0.10;

      this.Cd = params.Cd ?? 0.32;
      this.area = params.area ?? 2.2;
      this.downforceFactor = params.downforceFactor ?? 1.0;
      this.rho = params.rho ?? 1.225;
      this.aeroLoad = 0;
      this.dragForce = 0;

      this.collisionsEnabled = params.collisionsEnabled ?? true;
      this.chassisStiffness = params.chassisStiffness ?? 500000;
      this.restitution = params.restitution ?? 0.3;
      this.obstacles = params.obstacles ?? [];
      this.collisionForce = 0;
      this.collisionActive = false;
      this.collisionEnergy = 0;

      this.wheelInertia = params.wheelInertia ?? 0.12;
      this.wheelOmega = [0, 0, 0, 0];
      this.wheelFz = [0, 0, 0, 0];
      this.wheelFx = [0, 0, 0, 0];
      this.wheelFy = [0, 0, 0, 0];
      this.wheelSlip = [0, 0, 0, 0];

      // Antes había UN solo this.contact compartido por las 4 ruedas — el
      // modelo Dahl-Stribeck mantiene estado interno persistente (zX, zY,
      // la deformación de la "cerda" de contacto) que debe ser POR RUEDA,
      // no global. Con un solo objeto, cada rueda pisaba el estado que
      // dejó la anterior en la misma vuelta del bucle — comprobado como
      // causa real de que, con volante a fondo y acelerador a fondo a la
      // vez, Fx oscilara entre -2000N y +2000N cada sub-paso y el coche
      // apenas avanzara (u convergía a ~0.045 m/s incluso con el paso de
      // integración 1000 veces más fino, descartando que fuera un
      // problema de resolución numérica).
      const contactParams = {
        muStatic: params.muStatic ?? 1.0,
        muDynamic: params.muDynamic ?? 0.85,
        contactStiffness: params.contactStiffness ?? 120000,
        viscousDamping: params.viscousDamping ?? 80,
        stribeckSpeed: params.stribeckSpeed ?? 0.05,
        regularization: params.regularization ?? 0.02,
        temperature: params.temperature ?? 25
      };
      this.contacts = [0, 1, 2, 3].map(() => new DahlStribeckContact(contactParams));

      this.transmission = new Transmission({
        gearRatios: params.gearRatios,
        finalDrive: params.finalDrive ?? 3.42,
        engineTorque: params.engineTorque ?? 250,
        engineInertia: params.engineInertia ?? 0.15,
        wheelRadius: this.wheelRadius,
        efficiency: params.efficiency ?? 0.92,
        maxRPM: params.maxRPM ?? 7000,
        shiftThreshold: params.shiftThreshold ?? 4500,
        mode: params.transmissionMode ?? 'manual',
        initialGear: params.initialGear ?? 0,
        clutch: params.clutch ?? 1.0
      });

      this.tcsEnabled = params.tcsEnabled ?? true;
      this.tcsThreshold = params.tcsThreshold ?? 0.12;
      this.absEnabled = params.absEnabled ?? true;
      this.absThreshold = params.absThreshold ?? 0.18;

      this.dt = 0.01;
      this.time = 0;
      this.engineRPM = 0;
      this.absCycle = 0;
      this.temp = params.temperature ?? 25;

      this.gravityLong = 0;
      this.gravityLat = 0;

      // Suavizado de ABS/TCS (ver step()) y factor de sub-pasos.
      this._tcsFactor = 1;
      this._absFactor = 1;
    }

    setSlope(angleDeg, directionDeg) {
      const angleRad = angleDeg * Math.PI / 180;
      const dirRad = directionDeg * Math.PI / 180;
      const g = this.gravity;
      this.gravityLong = g * Math.sin(angleRad) * Math.cos(dirRad);
      this.gravityLat = g * Math.sin(angleRad) * Math.sin(dirRad);
    }

    setObstacles(obstacles) {
      this.obstacles = obstacles.map(o => ({
        x: o.x ?? 0, z: o.z ?? 0, radius: o.radius ?? 0.3,
        height: o.height ?? 0.5, stiffness: o.stiffness ?? 1.0
      }));
    }

    addObstacle(x, z, radius, height, stiffness) {
      this.obstacles.push({ x, z, radius: radius ?? 0.3, height: height ?? 0.5, stiffness: stiffness ?? 1.0 });
    }

    clearObstacles() { this.obstacles = []; }

    setGear(gear) { this.transmission.setGear(gear); }
    setTransmissionMode(mode) { this.transmission.mode = mode; }

    // step() público: sub-divide en pasos internos más pequeños antes de
    // integrar. Con la suspensión y el contacto acoplados (ambos
    // rígidos: K=40000 y K=120000 respectivamente) el sistema es
    // numéricamente rígido — probado en la v2: a 100Hz sin sub-pasos el
    // par de la rueda oscilaba entre signos opuestos sin converger.
    step(dt, controls) {
      dt = dt || 0.01;
      const maxSubDt = 0.002;
      const nSub = Math.max(1, Math.ceil(dt / maxSubDt));
      const subDt = dt / nSub;
      let out = null;
      for (let s = 0; s < nSub; s++) {
        out = this._step(subDt, controls);
      }
      return out;
    }

    _step(dt, controls) {
      this.dt = dt || 0.01;
      this.time += this.dt;

      const throttle = Math.max(0, Math.min(1, controls.throttle ?? 0));
      const brake = Math.max(0, Math.min(1, controls.brake ?? 0));
      let steer = Math.max(-1, Math.min(1, controls.steer ?? 0));

      const maxSteerAngle = 35 * Math.PI / 180;
      const steerAngle = steer * maxSteerAngle;

      if (this.transmission.mode === 'auto') {
        const newGear = this.transmission.autoShift(this.u);
        this.transmission.setGear(newGear);
      }

      const transResult = this.transmission.step(this.u, throttle, this.dt);
      this.engineRPM = transResult.engineRPM;
      let F_transmission = transResult.transmissionForce;
      if (this.transmission.currentGear === 0) F_transmission = 0;
      if (brake > 0.1) F_transmission = 0;

      let Fx_drive = [0, 0, 0, 0];
      const numDriven = this.drivetrain === 'ALL' ? 4 : 2;
      const perWheel = F_transmission / numDriven;

      if (this.drivetrain === 'REAR') {
        Fx_drive[2] = perWheel; Fx_drive[3] = perWheel;
      } else if (this.drivetrain === 'FRONT') {
        Fx_drive[0] = perWheel; Fx_drive[1] = perWheel;
      } else {
        Fx_drive[0] = perWheel * 0.4; Fx_drive[1] = perWheel * 0.4;
        Fx_drive[2] = perWheel * 0.6; Fx_drive[3] = perWheel * 0.6;
      }

      let F_brake_total = brake * 12000;
      const brakeFrontRatio = 0.6;
      let F_brake = [
        F_brake_total * brakeFrontRatio / 2,
        F_brake_total * brakeFrontRatio / 2,
        F_brake_total * (1 - brakeFrontRatio) / 2,
        F_brake_total * (1 - brakeFrontRatio) / 2
      ];

      this.absCycle += this.dt;
      if (this.absEnabled && brake > 0.1) {
        // Deslizamiento real por rueda (del sub-paso anterior), no la
        // velocidad del coche — y suavizado exponencial: sin él, cortar
        // el freno de golpe según el deslizamiento del paso anterior
        // entra en una oscilación de control con retardo (probado en la
        // v2: el par alternaba de signo sin converger).
        const slipEst = Math.max(Math.abs(this.wheelSlip[0]||0), Math.abs(this.wheelSlip[1]||0), Math.abs(this.wheelSlip[2]||0), Math.abs(this.wheelSlip[3]||0));
        let absTarget = 1;
        if (slipEst > this.absThreshold || (Math.abs(this.u) < 0.5 && brake > 0.3)) {
          const phase = Math.sin(2 * Math.PI * 10 * this.absCycle);
          const reduction = 0.3 + 0.7 * (0.5 + 0.5 * phase);
          const slipFactor = Math.min(1, (slipEst - this.absThreshold) / 0.2);
          absTarget = 1 - (0.5 + 0.5 * slipFactor) * (1 - reduction);
        }
        this._absFactor += (absTarget - this._absFactor) * Math.min(1, this.dt / 0.04);
        F_brake = F_brake.map(f => f * this._absFactor);
      } else {
        this._absFactor = 1;
      }

      let tcsReduction = 0;
      if (this.tcsEnabled && throttle > 0.1) {
        const drivenIdx = this.drivetrain === 'FRONT' ? [0, 1] : (this.drivetrain === 'ALL' ? [0, 1, 2, 3] : [2, 3]);
        const slipEst = Math.max(...drivenIdx.map(i => Math.abs(this.wheelSlip[i] || 0)));
        let tcsTarget = 1;
        if (slipEst > this.tcsThreshold) {
          tcsReduction = Math.min(1, (slipEst - this.tcsThreshold) / 0.2);
          tcsTarget = 1 - tcsReduction * 0.9;
        }
        this._tcsFactor += (tcsTarget - this._tcsFactor) * Math.min(1, this.dt / 0.04);
        Fx_drive = Fx_drive.map(f => f * this._tcsFactor);
      } else {
        this._tcsFactor = 1;
      }

      const v_abs = Math.abs(this.u);
      // El arrastre debe oponerse al sentido real de la marcha, no
      // empujar siempre hacia atrás — antes se sumaba sin más a Fgx
      // (fuerza "de gravedad"), así que con el coche circulando marcha
      // atrás el arrastre lo aceleraba más hacia atrás en vez de frenarlo.
      this.dragForce = 0.5 * this.rho * this.Cd * this.area * this.u * v_abs;
      this.aeroLoad = 0.5 * this.rho * this.Cd * this.area * v_abs * v_abs * this.downforceFactor * 0.3;

      const Fz_static = (this.mass * this.gravity + this.aeroLoad) / this.numWheels;
      const accelFactor = this.u / 10;
      const latAccel = this.v * this.r;

      const Fz_trans_long = this.mass * this.u * 0.1 / this.wheelbase;
      const Fz_trans_lat = this.mass * latAccel * this.CGHeight / this.track;

      let Fz = [
        Fz_static - Fz_trans_long * 0.5 - Fz_trans_lat * 0.5,
        Fz_static - Fz_trans_long * 0.5 + Fz_trans_lat * 0.5,
        Fz_static + Fz_trans_long * 0.5 - Fz_trans_lat * 0.5,
        Fz_static + Fz_trans_long * 0.5 + Fz_trans_lat * 0.5
      ];
      Fz = Fz.map(f => Math.max(50, f));
      this.wheelFz = Fz;

      const K = this.suspensionSpring;
      const C = this.suspensionDamping;
      const maxTravel = this.suspensionMaxTravel;

      // Suspensión: converge hacia la Fz objetivo (transferencia de
      // carga ya calculada), no intenta que el muelle por sí solo
      // iguale una fuerza de ~3000N partiendo de reposo — eso es lo que
      // hacía antes (F_susp arrancaba en 0, Fz[i] en ~3000N) y disparaba
      // el recorrido al tope en menos de medio segundo, con la carga de
      // la rueda desplomándose al suelo de 50N (casi sin agarre en
      // ningún sitio). El "recorrido" ahora representa la desviación de
      // la Fz respecto al reparto estático, con su propio equilibrio en 0.
      // Suspensión: converge hacia la Fz objetivo (transferencia de
      // carga ya calculada) en vez de intentar que el muelle por sí solo
      // iguale una fuerza de ~3000N partiendo de recorrido=0 — eso es lo
      // que hacía antes y disparaba el recorrido al tope en menos de
      // medio segundo, con la carga de la rueda desplomándose al suelo
      // de 50N (casi sin agarre en ningún sitio). El recorrido de
      // equilibrio (en metros) es el que hace que K·recorrido iguale la
      // parte dinámica de la carga (la transferencia por encima/debajo
      // del reparto estático).
      for (let i = 0; i < this.numWheels; i++) {
        const targetForce = Fz[i] - Fz_static; // parte dinámica de la carga (transferencia)
        const travelEq = targetForce / K; // recorrido (m) en el que el muelle la sostiene
        const cornerMass = this.mass * 0.03 + 20;
        const a_corner = (K * (travelEq - this.suspensionTravel[i]) - C * this.suspensionVelocity[i]) / cornerMass;
        this.suspensionVelocity[i] += a_corner * this.dt;
        this.suspensionTravel[i] += this.suspensionVelocity[i] * this.dt;
        this.suspensionTravel[i] = Math.max(-maxTravel, Math.min(maxTravel, this.suspensionTravel[i]));
        if (this.u > 0.5) {
          const bump = Math.sin(this.time * 5 + i * 1.5) * 0.001 * Math.min(1, this.u / 10);
          this.suspensionTravel[i] += bump;
        }
        Fz[i] = Fz_static + K * this.suspensionTravel[i];
        Fz[i] = Math.max(50, Fz[i]);
      }

      this.collisionActive = false;
      this.collisionForce = 0;

      if (this.collisionsEnabled && this.obstacles.length) {
        const cosPsi0 = Math.cos(this.psi), sinPsi0 = Math.sin(this.psi);
        const worldVx = this.u * cosPsi0 - this.v * sinPsi0;
        const worldVz = this.u * sinPsi0 + this.v * cosPsi0;
        for (const obs of this.obstacles) {
          const dx = this.x - obs.x;
          const dz = this.z - obs.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const radius = this.wheelbase * 0.3 + obs.radius;

          if (dist < radius) {
            this.collisionActive = true;
            const overlapRaw = radius - dist;
            // A alta velocidad el coche puede penetrar una fracción
            // grande del radio en un solo sub-paso, antes de que la
            // fuerza tenga ocasión de frenarlo — eso es lo que inyectaba
            // energía de la nada (probado: entraba a 54km/h y rebotaba a
            // 93km/h, imposible en una colisión pasiva). Se limita la
            // profundidad de solape que puede alimentar la fuerza a una
            // fracción razonable del radio, no la penetración real.
            const overlap = Math.min(overlapRaw, radius * 0.25);
            const stiffness = this.chassisStiffness * obs.stiffness;

            // Antes 'restForce' se calculaba y no se usaba en ningún
            // sitio: la restitución no tenía ningún efecto real, y sin
            // amortiguación era un rebote puramente elástico (energía
            // devuelta casi entera) — mismo fallo que ya encontré y
            // corregí en tiresim-pro.html: el amortiguador debe frenar
            // tanto al acercarse como al separarse, si no el muelle
            // empuja sin ningún freno durante el rebote hacia fuera.
            const closingSpeed = -((worldVx * dx + worldVz * dz) / Math.max(0.01, dist));
            const zetaCol = Math.max(0.15, Math.min(1.2, 1.15 - this.restitution));
            const cCol = 2 * zetaCol * Math.sqrt(stiffness * this.mass);
            let force = Math.max(0, stiffness * overlap * 2 + cCol * closingSpeed);
            // Límite de seguridad: a alta velocidad el coche puede
            // penetrar una parte notable del radio de colisión en un
            // solo sub-paso antes de que la fuerza tenga ocasión de
            // frenarlo — probado: un pico de ~970 000N (más de 80g)
            // lanzaba el coche a 165 km/h de rebote desde un impacto de
            // 54 km/h. Se limita a un pico físicamente extremo pero no
            // absurdo (~50g), como ya se hace con otros picos del motor.
            const maxForce = 50 * this.gravity * this.mass;
            force = Math.min(force, maxForce);

            const angle = Math.atan2(dz, dx);
            const fx = force * Math.cos(angle);
            const fz = force * Math.sin(angle);

            this.collisionForce = Math.sqrt(fx * fx + fz * fz);
            this.collisionEnergy += this.collisionForce * overlap * 0.5;

            const psi = this.psi;
            const cosPsi = Math.cos(psi);
            const sinPsi = Math.sin(psi);
            const fx_local = fx * cosPsi + fz * sinPsi;
            const fz_local = -fx * sinPsi + fz * cosPsi;

            this.u += fx_local * this.dt / this.mass * 0.5;
            this.v += fz_local * this.dt / this.mass * 0.5;

            // Antes había aquí un teletransporte directo de posición
            // (mitad del solape cada fotograma) además de la fuerza —
            // con el coche avanzando por su propia velocidad, ambos
            // efectos se cancelaban entre sí de un frame al siguiente,
            // dejando el solape (y por tanto la fuerza) clavado en ~0
            // para siempre: el coche se quedaba pegado en el sitio sin
            // decelerar de verdad (probado con traza fina: F=0 constante
            // durante todo el "choque"). Se deja que sea solo la fuerza
            // muelle-amortiguador la que resuelva el solape con el
            // tiempo, como en el resto del motor.

            // Antes usaba Math.random(): un motor de física debe ser
            // determinista para un mismo historial de entradas (si no,
            // el replay y las pruebas reproducibles son imposibles). El
            // momento de guiñada ahora sale de la propia geometría del
            // impacto (el punto de contacto no suele coincidir con el
            // CDG salvo un choque perfectamente frontal).
            const yawMoment = force * 0.01 * Math.sin(angle - psi);
            this.r += yawMoment * this.dt / this.Izz;
          }
        }
      }

      const L = this.wheelbase;
      const T = this.track;
      let steerAngles = [0, 0, 0, 0];
      if (Math.abs(steerAngle) > 0.001) {
        // Igual que en la v2: el signo estaba invertido (la interior
        // giraba MENOS que la exterior, al revés de Ackermann real) y
        // siempre asumía la rueda 0 como interior, válido solo para un
        // sentido de giro.
        const sign = steerAngle > 0 ? 1 : -1;
        const absSteer = Math.abs(steerAngle);
        const delta_o = absSteer;
        const cotO = 1 / Math.tan(absSteer);
        const delta_iRaw = Math.atan2(1, Math.max(0.001, cotO - T / L));
        // Ackermann puro puede pedirle a la rueda interior un ángulo mucho
        // mayor que el máximo de dirección nominal en radios muy cerrados
        // (con este batalla/vía, hasta 50° pidiendo 35°) — un coche real
        // no lo permite, el propio mecanismo de la cremallera lo limita.
        // Comprobado como parte de la causa de que, con volante y
        // acelerador a fondo a la vez desde parado, Fx oscilara de forma
        // errática (hasta 50° un ángulo modesto de deslizamiento genera,
        // al proyectarlo, una fuerza longitudinal desproporcionada).
        const delta_i = Math.min(delta_iRaw, maxSteerAngle * 1.15);
        if (sign > 0) { steerAngles[0] = sign * delta_i; steerAngles[1] = sign * delta_o; }
        else { steerAngles[0] = sign * delta_o; steerAngles[1] = sign * delta_i; }
        steerAngles[2] = steerAngle * 0.1;
        steerAngles[3] = steerAngle * 0.1;
      }

      const wheelStates = [];
      let Fx_total = 0, Fy_total = 0;
      const R = this.wheelRadius;

      for (let i = 0; i < this.numWheels; i++) {
        const steer_i = steerAngles[i] || 0;
        const cS = Math.cos(steer_i), sS = Math.sin(steer_i);

        const vx_wheel = this.u * cS + this.v * sS;
        const vy_wheel = -this.u * sS + this.v * cS;

        const vs = this.wheelOmega[i] * R - vx_wheel;
        const result = this.contacts[i].compute(vs, Fz[i], this.dt);
        const Fx_wheelFrame = result.Fx;

        const alphaSlip = Math.atan2(vy_wheel, Math.max(0.5, Math.abs(vx_wheel)));
        const Ca = 8.0 * Fz[i];
        let Fy_wheelFrame = -Ca * alphaSlip;
        const Fy_max = Math.sqrt(Math.max(0, result.F_max * result.F_max - Fx_wheelFrame * Fx_wheelFrame));
        Fy_wheelFrame = Math.max(-Fy_max, Math.min(Fy_max, Fy_wheelFrame));

        const Fx_w = Fx_wheelFrame * cS - Fy_wheelFrame * sS;
        const Fy_w = Fx_wheelFrame * sS + Fy_wheelFrame * cS;

        const F_accel = Fx_drive[i] || 0;
        const F_brake_i = F_brake[i] || 0;
        const T_drive_i = F_accel * R;
        const omegaSign = this.wheelOmega[i] > 1e-6 ? 1 : (this.wheelOmega[i] < -1e-6 ? -1 : 0);
        const T_brake_i = -omegaSign * F_brake_i * R;
        const torque = T_drive_i + T_brake_i - Fx_wheelFrame * R;
        const alphaAng = torque / this.wheelInertia;
        this.wheelOmega[i] += alphaAng * this.dt;
        this.wheelOmega[i] = Math.max(-180, Math.min(180, this.wheelOmega[i]));

        this.wheelFx[i] = Fx_w;
        this.wheelFy[i] = Fy_w;
        this.wheelSlip[i] = result.slip || 0;

        wheelStates.push({
          Fx: Fx_w, Fy: Fy_w, omega: this.wheelOmega[i],
          slip: result.slip || 0, Fz: Fz[i], mu: result.mu || 0, grip: result.grip || 1,
          suspensionTravel: this.suspensionTravel[i], suspensionVelocity: this.suspensionVelocity[i]
        });

        Fx_total += Fx_w;
        Fy_total += Fy_w;
      }

      const psi = this.psi;
      const cosPsi = Math.cos(psi);
      const sinPsi = Math.sin(psi);

      const Fx_global = Fx_total * cosPsi - Fy_total * sinPsi;
      const Fy_global = Fx_total * sinPsi + Fy_total * cosPsi;

      const Fgx = this.mass * this.gravityLong + this.dragForce;
      const Fgz = this.mass * this.gravityLat;

      const ax = (Fx_global - Fgx) / this.mass;
      const ay = (Fy_global - Fgz) / this.mass;

      const a_u = ax * cosPsi + ay * sinPsi;
      const a_v = -ax * sinPsi + ay * cosPsi;

      this.u += a_u * this.dt;
      this.v += a_v * this.dt;

      const Mz = (this.wheelFx[1] + this.wheelFx[3]) * this.track / 2 -
        (this.wheelFx[0] + this.wheelFx[2]) * this.track / 2 +
        (this.wheelFy[0] + this.wheelFy[1]) * this.wheelbase / 2 -
        (this.wheelFy[2] + this.wheelFy[3]) * this.wheelbase / 2;

      // Sin amortiguación, un momento de guiñada sostenido (Mz) hace
      // crecer r sin límite para siempre — matemáticamente correcto para
      // esta ecuación, pero irreal: un neumático real pierde agarre
      // lateral progresivamente pasado el ángulo de deslizamiento
      // óptimo (curva con pico y caída), lo que auto-limita el giro.
      // Ese efecto no está modelado aquí (Fy_wheelFrame satura pero no
      // decae), así que sin nada que lo frene, un volantazo sostenido a
      // baja velocidad hace que el coche gire sobre sí mismo sin
      // estabilizarse — comprobado con el motor real: r creció de
      // -0.02 a -1.7 rad/s en menos de un segundo, sin parar. La
      // amortiguación es pequeña a propósito: a velocidad de giro
      // normal (cornering en equilibrio) es insignificante frente al
      // propio Mz de los neumáticos; solo importa cuando no hay nada
      // más frenando la guiñada.
      const yawDamping = 1.5;
      this.r += (Mz / this.Izz) * this.dt - yawDamping * this.r * this.dt;

      this.x += (this.u * cosPsi - this.v * sinPsi) * this.dt;
      this.z += (this.u * sinPsi + this.v * cosPsi) * this.dt;
      this.psi += this.r * this.dt;

      if (this.psi > Math.PI) this.psi -= 2 * Math.PI;
      if (this.psi < -Math.PI) this.psi += 2 * Math.PI;

      const heatGen = Math.abs(this.u) * 0.1 + Math.abs(this.r) * 0.5 + Math.abs(this.collisionForce) * 0.001;
      this.temp += (heatGen - 0.02 * (this.temp - 25)) * this.dt;
      this.temp = Math.max(25, Math.min(120, this.temp));
      this.contacts.forEach(c => c.temperature = this.temp);

      return {
        state: { x: this.x, z: this.z, psi: this.psi, u: this.u, v: this.v, r: this.r },
        wheels: wheelStates,
        engineRPM: this.engineRPM,
        gear: this.transmission.currentGear,
        gearName: this.transmission.getGearName(this.transmission.currentGear),
        throttle: throttle, brake: brake, steer: steer,
        time: this.time,
        temp: this.temp,
        aeroLoad: this.aeroLoad,
        dragForce: this.dragForce,
        collisionActive: this.collisionActive,
        collisionForce: this.collisionForce,
        collisionEnergy: this.collisionEnergy,
        suspensionTravel: this.suspensionTravel,
        suspensionVelocity: this.suspensionVelocity
      };
    }

    reset() {
      this.x = 0; this.z = 0; this.psi = 0;
      this.u = 0; this.v = 0; this.r = 0;
      this.time = 0;
      this.engineRPM = 0;
      this.temp = 25;
      this.collisionForce = 0;
      this.collisionActive = false;
      this.collisionEnergy = 0;
      this.wheelOmega = [0, 0, 0, 0];
      this.suspensionTravel = [0, 0, 0, 0];
      this.suspensionVelocity = [0, 0, 0, 0];
      this._tcsFactor = 1;
      this._absFactor = 1;
      this.contacts.forEach(c => c.reset());
      this.transmission.reset();
    }

    getSpeedKmh() { return this.u * 3.6; }
    getSpeedMph() { return this.u * 2.23694; }
  }

  return {
    createVehicle: (params = {}) => new Vehicle(params),
    VERSION: '3.0.0',
    LICENSE: 'MIT - Libre para uso en juegos y simulaciones'
  };

})();

if (typeof window !== 'undefined') window.TireSimEngine = TireSimEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = TireSimEngine;
if (typeof exports !== 'undefined') exports.TireSimEngine = TireSimEngine;
