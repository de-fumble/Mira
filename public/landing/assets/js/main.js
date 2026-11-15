/* ==========================================================================
   Mira — Landing page interactions
   ========================================================================== */
(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- Year ---------- */
  const year = $("#year");
  if (year) year.textContent = new Date().getFullYear();

  /* ---------- Nav state ---------- */
  const nav = $("#nav");
  const darkSections = $$(".dark");
  const onNav = () => {
    nav.classList.toggle("is-scrolled", window.scrollY > 8);
    const y = nav.offsetHeight / 2;
    const overDark = darkSections.some((s) => {
      const r = s.getBoundingClientRect();
      return r.top <= y && r.bottom >= y;
    });
    nav.classList.toggle("is-dark", overDark);
  };
  onNav();
  window.addEventListener("scroll", onNav, { passive: true });

  /* ---------- Reveal on scroll ---------- */
  const revealIO = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("is-in"); revealIO.unobserve(e.target); }
    }),
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
  $$(".reveal").forEach((el) => revealIO.observe(el));

  /* ---------- Voices ----------
     Natural Deepgram Aura-2 voices, played through /api/voice. If that
     isn't available (offline, busy), the browser's own voice is used. */
  // Keep in sync with VOICES in src/app/api/voice/route.ts.
  const VOICES = [
    { id: "athena", name: "Athena", note: "Calm" },
    { id: "helena", name: "Helena", note: "Caring" },
    { id: "vesta", name: "Vesta", note: "Patient" },
    { id: "orion", name: "Orion", note: "Easygoing" },
    { id: "mars", name: "Mars", note: "Steady" },
    { id: "pandora", name: "Pandora", note: "British" },
    { id: "draco", name: "Draco", note: "British" },
    { id: "hyperion", name: "Hyperion", note: "Australian" },
  ];
  let voiceId = VOICES[0].id;
  const voiceName = (id) => VOICES.find((v) => v.id === id)?.name || "Mira";

  const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
  let voices = [];
  const loadVoices = () => { if (synth) voices = synth.getVoices(); };
  loadVoices();
  if (synth) synth.addEventListener?.("voiceschanged", loadVoices);

  const pickVoice = () => {
    const en = voices.filter((v) => /^en(-|_)/i.test(v.lang));
    const preferred = ["Samantha", "Ava", "Serena", "Karen", "Moira", "Google UK English Female", "Google US English", "Microsoft Aria", "Microsoft Jenny"];
    for (const name of preferred) {
      const v = en.find((x) => x.name.includes(name));
      if (v) return v;
    }
    return en.find((v) => v.localService) || en[0] || null;
  };

  const browserSpeak = (text, { rate, onstart, onend }) => {
    if (!synth) return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = rate; u.pitch = 1;
    u.onstart = () => onstart?.();
    u.onend = u.onerror = () => onend?.();
    synth.speak(u);
    return true;
  };

  // Only one thing speaks at a time; starting something new stops the last.
  let current = null;
  const stopSpeaking = () => {
    const c = current;
    current = null;
    if (c) { c.audio.pause(); c.audio.src = ""; c.done(); }
    synth?.cancel();
  };

  const speak = (text, { rate = 1, voice = voiceId, onstart, onend } = {}) => {
    stopSpeaking();
    const audio = new Audio(`/api/voice?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text.slice(0, 300))}`);
    audio.preservesPitch = true;
    audio.defaultPlaybackRate = audio.playbackRate = rate;
    let started = false, finished = false;
    const done = () => { if (finished) return; finished = true; onend?.(); };
    const me = { audio, done };
    current = me;
    const fail = () => {
      if (current !== me) return; // stopped or replaced already
      current = null;
      if (started) { done(); return; }
      finished = true; // the browser voice reports its own end
      if (!browserSpeak(text, { rate, onstart, onend })) onend?.();
    };
    audio.addEventListener("playing", () => { if (!started) { started = true; onstart?.(); } });
    audio.addEventListener("ended", () => { if (current === me) current = null; done(); });
    audio.addEventListener("error", fail);
    audio.play().catch((e) => { if (e?.name !== "AbortError") fail(); });
    return true;
  };

  /* ---------- "Hear Mira" ---------- */
  const hear = $("#hearMira");
  if (hear) {
    const label = hear.querySelector("span");
    const reset = () => { hear.classList.remove("is-speaking", "is-loading"); label.textContent = "Hear Mira"; };
    hear.addEventListener("click", () => {
      if (hear.classList.contains("is-speaking") || hear.classList.contains("is-loading")) { stopSpeaking(); reset(); return; }
      hear.classList.add("is-loading");
      label.textContent = "Loading…";
      speak(`Hello, I’m Mira, speaking as ${voiceName(voiceId)}. I’ll help you follow every conversation, and I’ll speak for you whenever you need me to. Every word, within reach.`, {
        onstart: () => { hear.classList.remove("is-loading"); hear.classList.add("is-speaking"); label.textContent = "Stop"; },
        onend: reset,
      });
    });
  }

  /* ---------- Hero device: scroll tilt ---------- */
  const device = $(".device");
  if (device && !reduceMotion) {
    let ticking = false;
    const tilt = () => {
      const r = device.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when device top is at bottom of viewport, 1 when it's ~25% from top
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.75)));
      device.style.setProperty("--tilt", `${(1 - p) * 16}deg`);
      device.style.setProperty("--dscale", (0.92 + p * 0.08).toFixed(4));
      ticking = false;
    };
    tilt();
    window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(tilt); } }, { passive: true });
    window.addEventListener("resize", tilt);
  }

  /* ---------- Hero device: live conversation demo ---------- */
  const convo = $("#demoConvo");
  const status = $("#demoStatus");
  const dot = $(".live-dot");
  const bars = $$("#demoWave i");

  let waveTimer = null;
  const wave = (on) => {
    clearInterval(waveTimer);
    if (!on) { bars.forEach((b) => (b.style.height = "18%")); return; }
    waveTimer = setInterval(() => {
      bars.forEach((b, i) => {
        const base = 0.35 + 0.65 * Math.abs(Math.sin(Date.now() / 260 + i * 0.7));
        b.style.height = `${Math.round((0.15 + Math.random() * 0.85 * base) * 100)}%`;
      });
    }, 110);
  };

  const setStatus = (text, mode = "listen") => {
    status.textContent = text;
    dot.classList.toggle("is-speak", mode === "speak");
  };

  const script = [
    { kind: "them", who: "Dr. Patel", text: "Good morning, Margaret. How have you been sleeping lately?" },
    { kind: "me", who: "You · typed", text: "Not very well. I keep waking up around three." },
    { kind: "them", who: "Dr. Patel", text: "Let’s move your evening tablet to dinnertime, and see how that feels." },
    { kind: "mira", who: "Mira’s note", text: "Take your evening tablet with dinner, starting tonight." },
  ];

  const lineEl = (item) => {
    const el = document.createElement("div");
    el.className = `line line--${item.kind}`;
    const who = document.createElement("span");
    who.className = "line__who";
    if (item.kind === "mira") who.innerHTML = '<span class="brand__orb brand__orb--sm"></span>';
    who.append(item.who);
    const text = document.createElement("span");
    text.className = "line__text";
    el.append(who, text);
    return { el, text };
  };

  const trim = () => { while (convo.children.length > 3) convo.firstElementChild.remove(); };

  const renderStatic = () => {
    convo.innerHTML = "";
    script.slice(1).forEach((item) => {
      const { el, text } = lineEl(item);
      text.textContent = item.text;
      convo.append(el);
    });
    setStatus("Listening");
  };

  const runDemo = async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      convo.classList.remove("is-fading");
      convo.innerHTML = "";
      await sleep(700);

      for (const item of script) {
        const { el, text } = lineEl(item);
        convo.append(el);
        trim();

        if (item.kind === "them") {
          setStatus("Listening");
          wave(true);
          const words = item.text.split(" ");
          for (const w of words) {
            const s = document.createElement("span");
            s.className = "w";
            s.textContent = w;
            text.append(s, " ");
            await sleep(150 + Math.random() * 120);
          }
          wave(false);
          await sleep(1100);
        } else if (item.kind === "me") {
          setStatus("Typing");
          const caret = document.createElement("span");
          caret.className = "caret";
          const node = document.createTextNode("");
          text.append(node, caret);
          for (const ch of item.text) {
            node.data += ch;
            await sleep(ch === " " ? 70 : 38 + Math.random() * 40);
          }
          await sleep(350);
          caret.remove();
          setStatus("Speaking for you", "speak");
          wave(true);
          await sleep(2000);
          wave(false);
          setStatus("Listening");
          await sleep(500);
        } else {
          setStatus("Saving note", "speak");
          text.textContent = item.text;
          await sleep(3800);
        }
      }

      convo.classList.add("is-fading");
      await sleep(800);
    }
  };

  if (convo) {
    if (reduceMotion) renderStatic();
    else runDemo();
  }

  /* ---------- Statement: words light up on scroll ---------- */
  const st = $("#statementText");
  if (st) {
    // Everything from "Mira" onward gets the brand gradient once lit.
    const words = st.textContent.trim().split(/\s+/);
    const accentStart = words.indexOf("Mira");
    st.innerHTML = "";
    const spans = words.map((w, i) => {
      const s = document.createElement("span");
      s.className = "sw" + (accentStart > -1 && i >= accentStart ? " is-accent" : "");
      s.textContent = w;
      st.append(s, " ");
      return s;
    });

    if (reduceMotion) {
      spans.forEach((s) => s.classList.add("is-lit"));
    } else {
      const section = st.closest(".statement");
      let ticking = false;
      const update = () => {
        const r = section.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        const p = Math.min(1, Math.max(0, -r.top / (total * 0.85)));
        const lit = Math.round(p * spans.length);
        spans.forEach((s, i) => s.classList.toggle("is-lit", i < lit));
        ticking = false;
      };
      update();
      window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
      window.addEventListener("resize", update);
    }
  }

  /* ---------- Story: sticky stage synced to steps ---------- */
  const steps = $$(".step");
  const layers = $$(".stage__layer");

  // Clone each visual into its step for the stacked mobile layout
  steps.forEach((step, i) => {
    const slot = $(".step__visual-mobile", step);
    if (slot && layers[i]) slot.append(layers[i].cloneNode(true));
  });

  const stepIO = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const idx = Number(e.target.dataset.step);
      steps.forEach((s, i) => s.classList.toggle("is-active", i === idx));
      layers.forEach((l, i) => l.classList.toggle("is-active", i === idx));
    }),
    { rootMargin: "-45% 0px -45% 0px" }
  );
  steps.forEach((s) => stepIO.observe(s));

  /* ---------- Range fill helper ---------- */
  const fill = (input) => {
    const p = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty("--p", `${p}%`);
  };

  /* ---------- Text size demo ---------- */
  const sizeRange = $("#sizeRange");
  const sizeText = $("#sizeText");
  if (sizeRange && sizeText) {
    const apply = () => { sizeText.style.fontSize = `${sizeRange.value}px`; fill(sizeRange); };
    sizeRange.addEventListener("input", apply);
    apply();
  }

  /* ---------- Voice list + picker (kept in step) ---------- */
  const voiceList = $("#voiceList");
  const voicePick = $("#voicePick");
  const setVoice = (id) => {
    voiceId = id;
    $$("#voiceList li").forEach((li) => {
      const on = li.dataset.voice === id;
      li.classList.toggle("is-on", on);
      li.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (voicePick) voicePick.value = id;
  };
  if (voicePick) {
    VOICES.forEach((v) => voicePick.add(new Option(`${v.name} · ${v.note}`, v.id)));
    voicePick.addEventListener("change", () => setVoice(voicePick.value));
  }
  if (voiceList) {
    VOICES.forEach((v) => {
      const li = document.createElement("li");
      li.dataset.voice = v.id;
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-label", `${v.name}, ${v.note}. Play a sample`);
      const dot = document.createElement("span"); dot.className = "voice-dot";
      const name = document.createElement("span"); name.className = "voice-name"; name.textContent = v.name;
      const note = document.createElement("em"); note.textContent = v.note;
      li.append(dot, name, note);
      const play = () => {
        setVoice(v.id);
        li.classList.add("is-loading");
        speak(`Hello, I’m ${v.name}. It’s lovely to meet you.`, {
          voice: v.id,
          onstart: () => { li.classList.remove("is-loading"); li.classList.add("is-playing"); },
          onend: () => li.classList.remove("is-loading", "is-playing"),
        });
      };
      li.addEventListener("click", play);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); } });
      voiceList.append(li);
    });
  }
  setVoice(voiceId);

  /* ---------- Try: speak for me ---------- */
  const pace = $("#pace");
  const paceOut = $("#paceOut");
  const sayBtn = $("#sayBtn");
  const sayText = $("#sayText");
  if (pace) {
    const label = () => {
      const v = Number(pace.value);
      paceOut.textContent = v < 0.8 ? "Slow" : v < 0.98 ? "Relaxed" : v < 1.1 ? "Natural" : "Brisk";
      fill(pace);
    };
    pace.addEventListener("input", label);
    label();
  }
  if (sayBtn) {
    const sayLabel = sayBtn.lastChild;
    const idle = sayLabel.textContent;
    const reset = () => { sayLabel.textContent = idle; sayBtn.classList.remove("is-speaking"); };
    sayBtn.addEventListener("click", () => {
      if (sayBtn.classList.contains("is-speaking")) { stopSpeaking(); reset(); return; }
      const t = sayText.value.trim();
      if (!t) { sayText.focus(); return; }
      sayBtn.classList.add("is-speaking");
      sayLabel.textContent = " Loading…";
      speak(t, {
        rate: Number(pace.value),
        onstart: () => { sayLabel.textContent = " Stop"; },
        onend: reset,
      });
    });
    pace?.addEventListener("input", () => { if (current) current.audio.playbackRate = Number(pace.value); });
  }

  /* ---------- Try: live captions ---------- */
  const micBtn = $("#micBtn");
  const captions = $("#captions");
  const micHint = $("#micHint");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (micBtn) {
    if (!SR) {
      micHint.textContent = "Live captions preview works in Chrome, Edge and Safari.";
      micBtn.disabled = true;
      micBtn.style.opacity = ".4";
    } else {
      let rec = null;
      let listening = false;
      let finalText = "";

      const render = (interim = "") => {
        captions.innerHTML = "";
        if (!finalText && !interim) {
          const ph = document.createElement("span");
          ph.className = "captions__placeholder";
          ph.textContent = listening ? "Listening…" : "Your words will appear here, nice and large.";
          captions.append(ph);
          return;
        }
        // Keep the last ~28 words so text stays large
        const keepFinal = finalText.trim().split(/\s+/).slice(-28).join(" ");
        const box = document.createElement("span");
        box.textContent = keepFinal + " ";
        if (interim) {
          const i = document.createElement("span");
          i.className = "interim";
          i.textContent = interim;
          box.append(i);
        }
        captions.append(box);
      };

      const stop = () => {
        listening = false;
        micBtn.setAttribute("aria-pressed", "false");
        micBtn.setAttribute("aria-label", "Start live captions");
        micHint.textContent = "Tap the microphone and start talking";
        try { rec?.stop(); } catch (_) { /* noop */ }
        render();
      };

      const start = () => {
        rec = new SR();
        rec.lang = navigator.language || "en-US";
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (ev) => {
          let interim = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            if (r.isFinal) finalText += r[0].transcript + " ";
            else interim += r[0].transcript;
          }
          render(interim);
        };
        rec.onerror = (ev) => {
          if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
            micHint.textContent = "Microphone access was blocked. Allow it in your browser to try captions.";
          }
          stop();
        };
        rec.onend = () => { if (listening) { try { rec.start(); } catch (_) { stop(); } } };
        listening = true;
        finalText = "";
        micBtn.setAttribute("aria-pressed", "true");
        micBtn.setAttribute("aria-label", "Stop live captions");
        micHint.textContent = "Listening — tap again to stop";
        render();
        try { rec.start(); } catch (_) { stop(); }
      };

      micBtn.addEventListener("click", () => (listening ? stop() : start()));
    }
  }

  /* ---------- Moments tabs ---------- */
  const tabs = $$('[role="tab"]');
  const panels = $$('[role="tabpanel"]');
  const activate = (idx, focus = false) => {
    tabs.forEach((t, i) => {
      const on = i === idx;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
    if (focus) tabs[idx].focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => activate(i));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") activate((i + 1) % tabs.length, true);
      if (e.key === "ArrowLeft") activate((i - 1 + tabs.length) % tabs.length, true);
      if (e.key === "Home") activate(0, true);
      if (e.key === "End") activate(tabs.length - 1, true);
    });
  });

  /* ---------- Waitlist ---------- */
  const form = $("#waitlistForm");
  const msg = $("#formMsg");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = form.email.value.trim();
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      msg.className = "form-msg " + (ok ? "is-ok" : "is-err");
      if (!ok) {
        msg.textContent = "Please enter a valid email address.";
        form.email.focus();
        return;
      }
      // TODO: connect to the real waitlist backend.
      msg.textContent = "Thank you — you’re on the list. We’ll be in touch soon.";
      form.reset();
    });
  }
})();
