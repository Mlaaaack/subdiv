// ==========================================================================
// Slider Chords — logique RNBO / Web Audio + rendu "gravure lino"
// Les formes des commandes sont dessinées à la main (au sens : par du
// code, avec de l'aléatoire contrôlé) via rough.js plutôt qu'en CSS pur.
// Pour changer de patch : remplacer patch/patch_export.json (et
// patch/dependencies.json si besoin) — rien ici à modifier.
// ==========================================================================
(function () {
  "use strict";

  // ---- config : chemins des fichiers du patch ----
  const PATCH_URL = "patch/patch_export.json";
  const DEPENDENCIES_URL = "patch/dependencies.json";

  // Libellés français pour les paramètres RNBO connus.
  const LABELS = {
    bpm: "Tempo",
    metro: "Métronome",
    tempo_delta: "Variation de tempo",
    beat_slide: "Glissando rythmique",
    slide: "Glissando",
    div_one: "Subdivision",
    tempo: "Tempo",
    loop: "Boucle"
  };

  // Libellés pour les boutons de déclenchement générés à partir des
  // "inports" du patch. Tag inconnu => on affiche le tag tel quel
  // (avec une majuscule), donc un nouveau patch fonctionne sans
  // modifier ce fichier.
  const INPORT_LABELS = {
    in1: "Déclencher les accords",
    one: "1", two: "2", three: "3", four: "4",
    five: "5", six: "6", seven: "7", eight: "8"
  };
  // Ordre d'affichage préféré quand les tags correspondent à des
  // nombres écrits en toutes lettres (l'ordre du patch lui-même est
  // souvent arbitraire).
  const INPORT_ORDER = ["in1", "one", "two", "three", "four", "five", "six", "seven", "eight"];

  // ---- couleurs pour rough.js (doivent rester cohérentes avec style.css) ----
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function palette() {
    return {
      paper: cssVar("--paper") || "#f1e9d2",
      paper2: cssVar("--paper-2") || "#e8dfc2",
      ink: cssVar("--ink") || "#211a12",
      spot: cssVar("--spot") || "#a83a2c"
    };
  }

  function seedFromString(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (Math.abs(h) % 9973) + 1;
  }

  // ---- storage helpers (confort par visiteur uniquement) ----
  function loadSaved() {
    try {
      const raw = localStorage.getItem("slider-chords-params");
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveParam(name, value) {
    try {
      const all = loadSaved();
      all[name] = value;
      localStorage.setItem("slider-chords-params", JSON.stringify(all));
    } catch (e) { /* ignore */ }
  }

  const errBox = document.getElementById("errBox");
  function showError(msg) {
    errBox.style.display = "block";
    errBox.textContent = msg;
  }

  let context = null;
  let device = null;
  let analyser = null;
  let masterGain = null;
  let running = false;
  let rafId = null;
  let patcher = null;
  let dependencies = [];

  const powerBtn = document.getElementById("powerBtn");
  const powerLabel = document.getElementById("powerLabel");
  const powerLed = document.getElementById("powerLed");
  const controlsEl = document.getElementById("controls");
  const triggerRow = document.getElementById("triggerRow");
  const canvas = document.getElementById("scopeCanvas");
  const ctx2d = canvas.getContext("2d");
  const moduleFrame = document.getElementById("moduleFrame");
  const scopeFrame = document.getElementById("scopeFrame");
  let padFrames = []; // {redraw} pour redessiner au redimensionnement


  // ==== dessin "gravure lino" (rough.js) ====================================

  function clearSvg(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }

  // Cadre hachuré, taille fluide : utilisé pour le contour du module et
  // celui de l'oscilloscope. Redessiné au redimensionnement.
  function drawFrame(svgEl, seedKey) {
    const parent = svgEl.parentElement;
    const w = parent.clientWidth, h = parent.clientHeight;
    if (!w || !h) return;
    svgEl.setAttribute("width", w);
    svgEl.setAttribute("height", h);
    svgEl.setAttribute("viewBox", "0 0 " + w + " " + h);
    clearSvg(svgEl);
    const rc = rough.svg(svgEl);
    const pal = palette();
    const node = rc.rectangle(3, 3, w - 6, h - 6, {
      roughness: 1.4, bowing: 1.2,
      stroke: pal.ink, strokeWidth: 2.4,
      fill: "none",
      seed: seedFromString(seedKey)
    });
    svgEl.appendChild(node);
  }

  // Cadre d'un emplacement de fichier (buffer) : creux/pointillé quand
  // vide, hachuré plein une fois un son chargé.
  function drawSlotFrame(svgEl, seedKey, loaded) {
    const w = svgEl.parentElement.clientWidth, h = svgEl.parentElement.clientHeight;
    if (!w || !h) return;
    svgEl.setAttribute("width", w);
    svgEl.setAttribute("height", h);
    svgEl.setAttribute("viewBox", "0 0 " + w + " " + h);
    clearSvg(svgEl);
    const rc = rough.svg(svgEl);
    const pal = palette();
    const node = rc.rectangle(4, 4, w - 8, h - 8, {
      roughness: 2, bowing: 2,
      fill: loaded ? pal.spot : pal.paper2,
      fillStyle: "hachure", hachureGap: loaded ? 2.4 : 4.5,
      stroke: pal.ink, strokeWidth: 2,
      seed: seedFromString(seedKey)
    });
    svgEl.appendChild(node);
  }

  function drawFramesNow() {
    drawFrame(moduleFrame, "module-frame");
    drawFrame(scopeFrame, "scope-frame");
    padFrames.forEach(function (p) { p.redraw(); });
  }
  let resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawFramesNow, 120);
  });

  // Bouton de déclenchement : rectangle tamponné, hachures pleines.
  // Générique : dessine le cadre d'un pad donné, quelle que soit sa taille.
  function drawPadFrame(svgEl, seedKey) {
    const w = svgEl.parentElement.clientWidth, h = svgEl.parentElement.clientHeight;
    if (!w || !h) return;
    svgEl.setAttribute("width", w);
    svgEl.setAttribute("height", h);
    svgEl.setAttribute("viewBox", "0 0 " + w + " " + h);
    clearSvg(svgEl);
    const rc = rough.svg(svgEl);
    const pal = palette();
    const node = rc.rectangle(4, 4, w - 8, h - 8, {
      roughness: 2.2, bowing: 2.6,
      fill: pal.spot, fillStyle: "solid",
      stroke: pal.ink, strokeWidth: 2.4,
      seed: seedFromString(seedKey)
    });
    svgEl.appendChild(node);
  }

  // Voyant d'alimentation : cercle simple, "étincelles" quand actif.
  function drawPowerLed(on) {
    const size = 22;
    let svgEl = powerLed.querySelector("svg");
    if (!svgEl) {
      svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      powerLed.appendChild(svgEl);
    }
    svgEl.setAttribute("width", size);
    svgEl.setAttribute("height", size);
    svgEl.setAttribute("viewBox", "0 0 " + size + " " + size);
    clearSvg(svgEl);
    const rc = rough.svg(svgEl);
    const pal = palette();
    const seed = seedFromString("power-led");
    const circle = rc.circle(11, 11, 14, {
      roughness: 1.6, bowing: 1.4,
      fill: on ? pal.spot : "none",
      fillStyle: on ? "hachure" : "solid",
      hachureGap: 2,
      stroke: pal.ink, strokeWidth: 2,
      seed: seed
    });
    svgEl.appendChild(circle);
    if (on) {
      // petits traits façon étincelle autour du voyant
      const rays = [
        [11, -1, 11, 3], [11, 19, 11, 23],
        [-1, 11, 3, 11], [19, 11, 23, 11]
      ];
      rays.forEach(function (r, i) {
        const line = rc.line(r[0], r[1], r[2], r[3], {
          roughness: 1.8, stroke: pal.spot, strokeWidth: 1.6, seed: seed + i + 1
        });
        svgEl.appendChild(line);
      });
    }
  }

  // Interrupteur (paramètre à 2 valeurs) : piste en forme de pilule +
  // curseur rond, tous deux hachurés à la main.
  function createRoughToggle(container, opts) {
    const w = 62, h = 34;
    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.setAttribute("width", w);
    svgEl.setAttribute("height", h);
    svgEl.setAttribute("viewBox", "0 0 " + w + " " + h);
    container.appendChild(svgEl);

    const seed = seedFromString(opts.seedKey);
    let state = !!opts.value;

    function render() {
      clearSvg(svgEl);
      const rc = rough.svg(svgEl);
      const pal = palette();
      const track = rc.path(
        "M17,4 H45 A13,13 0 0 1 45,30 H17 A13,13 0 0 1 17,4 Z",
        {
          roughness: 1.5, bowing: 1.4,
          fill: state ? pal.spot + "22" : pal.paper2,
          fillStyle: "solid",
          stroke: pal.ink, strokeWidth: 2,
          seed: seed
        }
      );
      svgEl.appendChild(track);
      const cx = state ? 45 : 17;
      const dot = rc.circle(cx, 17, 20, {
        roughness: 1.6, bowing: 1.4,
        fill: state ? pal.spot : pal.ink,
        fillStyle: "hachure", hachureGap: 2.2,
        stroke: pal.ink, strokeWidth: 2,
        seed: seed + 1
      });
      svgEl.appendChild(dot);
    }
    render();

    container.style.cursor = "pointer";
    container.addEventListener("click", function () {
      state = !state;
      render();
      if (opts.onChange) opts.onChange(state);
    });

    return { setState: function (v) { state = !!v; render(); } };
  }

  // Bouton rotatif : cercle hachuré fixe + aiguille redessinée à
  // chaque changement de valeur (même "graine" aléatoire => même
  // caractère de trait à chaque redessin).
  function createRoughKnob(container, opts) {
    const { min, max, value, step, onChange, seedKey } = opts;
    const size = container.clientWidth || 64;
    const cx = size / 2, cy = size / 2;
    const bodyR = size * 0.42;
    const pointerOuterR = size * 0.34;
    const pointerInnerR = size * 0.1;

    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.setAttribute("viewBox", "0 0 " + size + " " + size);
    container.appendChild(svgEl);

    const bodyGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const pointerGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svgEl.appendChild(bodyGroup);
    svgEl.appendChild(pointerGroup);

    const seed = seedFromString(seedKey);
    let val = value;

    function drawBody() {
      clearSvg(bodyGroup);
      const rc = rough.svg(svgEl);
      const pal = palette();
      const circle = rc.circle(cx, cy, bodyR * 2, {
        roughness: 1.7, bowing: 1.3,
        fill: pal.paper2, fillStyle: "hachure",
        hachureGap: 3, hachureAngle: seed % 180,
        stroke: pal.ink, strokeWidth: 2.2,
        seed: seed
      });
      bodyGroup.appendChild(circle);
    }

    function normalize(v) { return (v - min) / (max - min || 1); }

    function drawPointer() {
      clearSvg(pointerGroup);
      const rc = rough.svg(svgEl);
      const pal = palette();
      const n = Math.min(1, Math.max(0, normalize(val)));
      const angle = (-135 + n * 270) * Math.PI / 180;
      const x1 = cx + pointerInnerR * Math.sin(angle);
      const y1 = cy - pointerInnerR * Math.cos(angle);
      const x2 = cx + pointerOuterR * Math.sin(angle);
      const y2 = cy - pointerOuterR * Math.cos(angle);
      const line = rc.line(x1, y1, x2, y2, {
        roughness: 1.5, stroke: pal.spot, strokeWidth: 3, seed: seed + 1
      });
      pointerGroup.appendChild(line);
      const dot = rc.circle(cx, cy, 6, {
        roughness: 1.4, fill: pal.ink, fillStyle: "solid",
        stroke: pal.ink, strokeWidth: 1, seed: seed + 2
      });
      pointerGroup.appendChild(dot);
    }

    function setValue(v, notify) {
      v = Math.min(max, Math.max(min, v));
      if (step) v = Math.round(v / step) * step;
      val = v;
      drawPointer();
      if (notify !== false && onChange) onChange(val);
    }

    drawBody();
    drawPointer();

    let dragging = false, startY = 0, startVal = 0;
    const sensitivity = (max - min) / 140;

    container.addEventListener("pointerdown", function (e) {
      dragging = true;
      startY = e.clientY;
      startVal = val;
      container.setPointerCapture(e.pointerId);
    });
    container.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      const dy = startY - e.clientY;
      setValue(startVal + dy * sensitivity);
    });
    function pointerUp(e) {
      dragging = false;
      try { container.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    container.addEventListener("pointerup", pointerUp);
    container.addEventListener("pointercancel", pointerUp);
    container.addEventListener("dblclick", function () {
      setValue(opts.defaultValue !== undefined ? opts.defaultValue : min);
    });
    container.addEventListener("wheel", function (e) {
      e.preventDefault();
      setValue(val + (e.deltaY < 0 ? 1 : -1) * (max - min) / 50);
    }, { passive: false });

    return { setValue: function (v) { setValue(v, false); }, getValue: function () { return val; } };
  }

  // ==== oscilloscope (papier + encre spot) ==================================

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawIdle() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const pal = palette();
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.strokeStyle = pal.ink;
    ctx2d.globalAlpha = 0.35;
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath();
    ctx2d.moveTo(0, h / 2);
    ctx2d.lineTo(w, h / 2);
    ctx2d.stroke();
    ctx2d.globalAlpha = 1;
  }

  function drawScope() {
    if (!analyser) return;
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);
    const pal = palette();

    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.lineWidth = 2;
    ctx2d.strokeStyle = pal.spot;
    ctx2d.beginPath();
    const slice = w / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
      x += slice;
    }
    ctx2d.stroke();
    rafId = requestAnimationFrame(drawScope);
  }

  function fmt(n) {
    if (Math.abs(n) >= 100) return Math.round(n).toString();
    return (Math.round(n * 100) / 100).toString();
  }

  // ==== construction des commandes à partir des paramètres RNBO ============

  function buildControls() {
    controlsEl.innerHTML = "";
    const saved = loadSaved();

    (patcher.desc.parameters || []).forEach(function (p) {
      if (p.visible === false) return;
      const isToggle = p.isEnum && p.enumValues && p.enumValues.length === 2;
      const isStepped = p.isEnum && p.enumValues && p.enumValues.length > 2;
      const label = LABELS[p.name] || p.name;
      const initial = (saved[p.name] !== undefined) ? saved[p.name] : p.initialValue;

      const wrap = document.createElement("div");
      wrap.className = "ctrl";

      const labelEl = document.createElement("div");
      labelEl.className = "label";
      labelEl.textContent = label;
      wrap.appendChild(labelEl);

      if (isToggle) {
        const t = document.createElement("div");
        t.className = "toggle-wrap";
        const sw = document.createElement("div");
        sw.className = "toggle";
        t.appendChild(sw);
        wrap.appendChild(t);

        const valueEl = document.createElement("div");
        valueEl.className = "value";
        valueEl.textContent = initial >= 1 ? "On" : "Off";
        wrap.appendChild(valueEl);

        createRoughToggle(sw, {
          value: initial >= 1,
          seedKey: "toggle-" + p.name,
          onChange: function (on) {
            valueEl.textContent = on ? "On" : "Off";
            setParam(p.name, on ? 1 : 0);
            saveParam(p.name, on ? 1 : 0);
          }
        });
      } else {
        const knobEl = document.createElement("div");
        knobEl.className = "knob";
        wrap.appendChild(knobEl);

        // Pour un paramètre à choix multiples (ex. subdivisions
        // rythmiques 1/2/3/4/6/8...), l'index tourne sur le knob mais
        // l'affichage montre la vraie valeur (enumValues[index]).
        function displayText(v) {
          if (isStepped) {
            const idx = Math.round(Math.min(p.enumValues.length - 1, Math.max(0, v)));
            return String(p.enumValues[idx]);
          }
          return fmt(v);
        }

        const valueEl = document.createElement("div");
        valueEl.className = "value";
        valueEl.textContent = displayText(initial);
        wrap.appendChild(valueEl);

        createRoughKnob(knobEl, {
          min: p.minimum, max: p.maximum, value: initial,
          defaultValue: p.initialValue,
          seedKey: "knob-" + p.name,
          step: isStepped
            ? (p.maximum - p.minimum) / (p.enumValues.length - 1)
            : (p.steps > 0 ? (p.maximum - p.minimum) / p.steps : (p.maximum - p.minimum) / 1000),
          onChange: function (v) {
            valueEl.textContent = displayText(v);
            setParam(p.name, v);
            saveParam(p.name, v);
          }
        });
      }

      controlsEl.appendChild(wrap);
    });
  }

  function setParam(name, value) {
    if (!device) return;
    const param = device.parametersById.get(name);
    if (param) param.value = value;
  }

  function applyAllParamsToDevice() {
    const saved = loadSaved();
    (patcher.desc.parameters || []).forEach(function (p) {
      const v = (saved[p.name] !== undefined) ? saved[p.name] : p.initialValue;
      setParam(p.name, v);
    });
  }

  function sendBang(tag) {
    if (!device) return;
    // Un message sans payload (undefined) = un "bang" pour @rnbo/js.
    // Un tableau vide [] enverrait une liste vide, pas un bang.
    device.scheduleEvent(new RNBO.MessageEvent(RNBO.TimeNow, tag));
  }

  // Génère un pad de déclenchement par "inport" déclaré dans le patch —
  // fonctionne pour 1 inport (un gros bouton) comme pour 8 (une grille).
  // Si l'inport correspond à un buffer déclaré dans externalDataRefs
  // (un objet buffer~ nommé pareil), on génère un sélecteur de fichier
  // audio à la place d'un simple bouton "bang".
  function buildTriggers() {
    triggerRow.innerHTML = "";
    padFrames = [];
    const inports = (patcher.desc.inports || []).slice();
    inports.sort(function (a, b) {
      const ia = INPORT_ORDER.indexOf(a.tag);
      const ib = INPORT_ORDER.indexOf(b.tag);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    const compact = inports.length > 1;
    const bufferIds = new Set(
      (patcher.desc.externalDataRefs || [])
        .filter(function (d) { return d.type === "Float32Buffer"; })
        .map(function (d) { return d.id; })
    );

    inports.forEach(function (inport) {
      const tag = inport.tag;
      if (bufferIds.has(tag)) {
        triggerRow.appendChild(buildBufferSlot(tag, compact));
      } else {
        triggerRow.appendChild(buildBangPad(tag, compact));
      }
    });
  }

  function buildBangPad(tag, compact) {
    const label = INPORT_LABELS[tag] || (tag.charAt(0).toUpperCase() + tag.slice(1));

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "trigger-pad" + (compact ? " trigger-pad--compact" : "");

    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    btn.appendChild(svgEl);
    const span = document.createElement("span");
    span.textContent = label;
    btn.appendChild(span);

    btn.addEventListener("click", async function () {
      try {
        if (!running) await start();
        sendBang(tag);
      } catch (err) {
        console.error(err);
        showError("Impossible de déclencher : " + (err && err.message ? err.message : err));
      }
    });

    triggerRow.appendChild(btn);
    padFrames.push({ redraw: function () { drawPadFrame(svgEl, "pad-" + tag); } });
    drawPadFrame(svgEl, "pad-" + tag);
    return btn;
  }

  // Sélecteur de fichier pour un buffer nommé (ex. "one".."eight").
  // On ne peut pas transmettre un chemin disque au patch depuis un
  // navigateur : on lit le fichier choisi, on le décode en AudioBuffer,
  // et on le pousse dans le buffer RNBO via setDataBuffer(id, ...).
  function buildBufferSlot(tag, compact) {
    const label = INPORT_LABELS[tag] || (tag.charAt(0).toUpperCase() + tag.slice(1));

    const wrap = document.createElement("div");
    wrap.className = "buffer-slot" + (compact ? " buffer-slot--compact" : "");

    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.className = "buffer-slot-pick";
    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    pickBtn.appendChild(svgEl);
    const num = document.createElement("span");
    num.className = "buffer-slot-num";
    num.textContent = label;
    pickBtn.appendChild(num);
    wrap.appendChild(pickBtn);

    const status = document.createElement("div");
    status.className = "buffer-slot-status";
    status.textContent = "Choisir un son…";
    wrap.appendChild(status);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "audio/*";
    fileInput.className = "buffer-slot-input";
    wrap.appendChild(fileInput);

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "buffer-slot-play";
    playBtn.textContent = "▶";
    playBtn.title = "Déclencher " + label;
    wrap.appendChild(playBtn);

    let loaded = false;
    function redraw() { drawSlotFrame(svgEl, "slot-" + tag, loaded); }
    redraw();
    padFrames.push({ redraw: redraw });

    pickBtn.addEventListener("click", function () { fileInput.click(); });

    fileInput.addEventListener("change", async function () {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      status.textContent = "Chargement…";
      try {
        await ensureAudio();
        const arrayBuf = await file.arrayBuffer();
        const audioBuf = await context.decodeAudioData(arrayBuf);
        await device.setDataBuffer(tag, audioBuf);
        loaded = true;
        redraw();
        status.textContent = file.name;
      } catch (err) {
        console.error(err);
        loaded = false;
        redraw();
        status.textContent = "Choisir un son…";
        showError("Impossible de charger le fichier pour « " + label + " » : " + (err && err.message ? err.message : err));
      }
    });

    playBtn.addEventListener("click", async function () {
      try {
        if (!running) await start();
        sendBang(tag);
      } catch (err) {
        console.error(err);
        showError("Impossible de déclencher : " + (err && err.message ? err.message : err));
      }
    });

    return wrap;
  }

  // ---- volume principal ----
  const masterKnobEl = document.getElementById("masterKnob");
  const savedMaster = (function () {
    try {
      const v = localStorage.getItem("slider-chords-master");
      return v !== null ? parseFloat(v) : 0.8;
    } catch (e) { return 0.8; }
  })();

  // ---- chargement du runtime RNBO correspondant à la version du patch ----
  function loadRNBOScript(version) {
    return new Promise(function (resolve, reject) {
      if (window.RNBO && window.RNBO.version === version) return resolve();
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@rnbo/js@" + version + "/dist/rnbo.webaudio.js";
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("Impossible de charger @rnbo/js v" + version + " depuis jsDelivr."));
      };
      document.body.appendChild(script);
    });
  }

  async function loadPatchFiles() {
    const [patchRes, depsRes] = await Promise.all([
      fetch(PATCH_URL),
      fetch(DEPENDENCIES_URL).catch(function () { return null; })
    ]);
    if (!patchRes.ok) throw new Error("Impossible de charger " + PATCH_URL);
    patcher = await patchRes.json();
    dependencies = (depsRes && depsRes.ok) ? await depsRes.json() : [];
  }

  async function ensureAudio() {
    if (context) return;
    const WAContext = window.AudioContext || window.webkitAudioContext;
    context = new WAContext();

    await loadRNBOScript(patcher.desc.meta.rnboversion);
    if (typeof RNBO === "undefined") {
      throw new Error("La librairie RNBO n'a pas pu être chargée (rnbo.js).");
    }

    device = await RNBO.createDevice({ context, patcher });

    if (dependencies && dependencies.length) {
      try { await device.loadDataBufferDependencies(dependencies); } catch (e) { /* pas de sample dans ce patch */ }
    }

    masterGain = context.createGain();
    masterGain.gain.value = savedMaster;

    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;

    device.node.connect(masterGain);
    masterGain.connect(analyser);
    analyser.connect(context.destination);

    applyAllParamsToDevice();
  }

  async function start() {
    await ensureAudio();
    await context.resume();
    running = true;
    powerLabel.textContent = "Actif";
    drawPowerLed(true);
    cancelAnimationFrame(rafId);
    drawScope();
  }

  async function stop() {
    await context.suspend();
    running = false;
    powerLabel.textContent = "Démarrer";
    drawPowerLed(false);
    cancelAnimationFrame(rafId);
    drawIdle();
  }

  powerBtn.addEventListener("click", async function () {
    try {
      if (!running) await start(); else await stop();
    } catch (err) {
      console.error(err);
      showError("Impossible de démarrer l'audio : " + (err && err.message ? err.message : err));
    }
  });

  // ---- boot ----
  (async function init() {
    resizeCanvas();
    drawIdle();
    drawFramesNow();
    drawPowerLed(false);
    createRoughKnob(masterKnobEl, {
      min: 0, max: 1, value: savedMaster, defaultValue: 0.8, step: 0.01,
      seedKey: "master-volume",
      onChange: function (v) {
        if (masterGain) masterGain.gain.setTargetAtTime(v, context.currentTime, 0.01);
        try { localStorage.setItem("slider-chords-master", String(v)); } catch (e) {}
      }
    });
    try {
      await loadPatchFiles();
      buildControls();
      buildTriggers();
    } catch (err) {
      console.error(err);
      showError("Impossible de charger le patch : " + (err && err.message ? err.message : err));
    }
  })();


})();
