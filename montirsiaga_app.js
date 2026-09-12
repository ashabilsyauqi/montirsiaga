/**
 * MontirSiaga.com - Mobile App Core Logic Engine
 * Implements 1-Click SOS, 3s Rapid Preset Auto-Timer, Multi-tier Geofencing Radar (Ring 1 & Ring 2),
 * Fallback Hotline Escalation, Live Dispatch Simulation, Driver/Mechanic Dual Modes, and Transparent Accounting.
 */

// --- App State ---
const APP_STATE = {
  currentTab: 'home', // home, guide, tariff, partner
  userRole: 'driver', // driver | mechanic
  flowStep: 'IDLE',   // IDLE | PRESET | SEARCHING | DISPATCHED | COMPLETED | HOTLINE_FALLBACK
  
  userLocation: {
    lat: -6.2615,
    lng: 107.0542,
    address: "Jln. Kalijambe RT 04/04, Lambangsari, Tambun Selatan, Bekasi"
  },
  
  selectedPreset: null,
  presetTimer: 3,
  presetInterval: null,
  
  searchRing: 1,      // 1 (0-2.5km) | 2 (2.6-5.0km)
  searchTimer: 15,
  searchInterval: null,
  
  assignedMechanic: null,
  etaMinutes: 8,
  etaDistanceKm: 2.1,
  trackingInterval: null,
  
  // Audio context / buzzer simulation
  soundEnabled: true
};

// --- Web Audio API Emergency Sound Synthesizer ---
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(freq, type = 'sine', duration = 0.15, gainVal = 0.1) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(gainVal, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch(e) {}
}

function playSirenSound() {
  try {
    playTone(880, 'sawtooth', 0.18, 0.12);
    setTimeout(() => playTone(660, 'sawtooth', 0.18, 0.12), 160);
    setTimeout(() => playTone(880, 'sawtooth', 0.22, 0.12), 320);
  } catch(e) {}
}

function playCountdownBeep() {
  playTone(587.33, 'sine', 0.08, 0.07);
}

function playSuccessChime() {
  playTone(523.25, 'triangle', 0.12, 0.1);
  setTimeout(() => playTone(659.25, 'triangle', 0.12, 0.1), 100);
  setTimeout(() => playTone(783.99, 'triangle', 0.25, 0.12), 200);
}

function playAlertAlarm() {
  playTone(900, 'square', 0.15, 0.08);
  setTimeout(() => playTone(1200, 'square', 0.2, 0.08), 150);
}

// Preset Options Config
const PRESETS = [
  { id: 'tire', title: 'Ban Bocor / Kempes', icon: '🛞', desc: 'Tambal ban di tempat / ganti ban cadangan', baseFee: 45000, serviceFee: 35000 },
  { id: 'battery', title: 'Mesin Mati & Aki', icon: '⚡', desc: 'Jumper aki darurat & cek pengisian dinamo', baseFee: 45000, serviceFee: 50000 },
  { id: 'fuel', title: 'BBM Habis', icon: '⛽', desc: 'Pengiriman 3-5 Liter BBM darurat ke lokasi', baseFee: 45000, serviceFee: 30000 },
  { id: 'towing', title: 'Derek / Towing', icon: '🚛', desc: 'Gendong/Towing ke bengkel rujukan terdekat', baseFee: 150000, serviceFee: 100000 },
  { id: 'general', title: 'Bantuan Darurat Umum', icon: '🚨', desc: 'Pengecekan mekanik umum & diagnosa di jalan', baseFee: 45000, serviceFee: 45000 }
];

// Sample Verified Partner Mechanics in Radius
const SAMPLE_MECHANICS = [
  {
    name: "Rahmat Hidayat, S.T.",
    phone: "081298765432",
    wa: "6281298765432",
    workshop: "Bengkel Mandiri Jaya Motor",
    rating: "4.9 (142 ulasan)",
    bnsp: "BNSP-OTO-2024-8819",
    vehicle: "Honda Vario 160 (Toolbox Lengkap)",
    plate: "B 4912 KTF",
    avatar: "👨‍🔧",
    latOffset: 0.012,
    lngOffset: 0.008
  },
  {
    name: "Ahmad Fauzi",
    phone: "085711223344",
    wa: "6285711223344",
    workshop: "Sentosa Auto Service",
    rating: "4.8 (98 ulasan)",
    bnsp: "BNSP-OTO-2023-4512",
    vehicle: "Yamaha NMAX (Jumper & Kompresor)",
    plate: "B 3810 FXL",
    avatar: "🛠️",
    latOffset: -0.015,
    lngOffset: 0.010
  }
];

// Brand Escalation Hotlines
const BRAND_HOTLINES = [
  { brand: "Jasa Marga (Derek Tol Resmi)", phone: "14080", desc: "Bantuan Derek Tol 24 Jam Seluruh Indonesia" },
  { brand: "Toyota 24h Emergency Roadside", phone: "1500315", desc: "AstraWorld Emergency Support" },
  { brand: "Honda Experience 24h", phone: "08001446632", desc: "Layanan Darurat Mobil Honda" },
  { brand: "Daihatsu Emergency Service", phone: "1500898", desc: "AstraWorld Daihatsu Response" },
  { brand: "Mitsubishi Motors Emergency", phone: "08041300300", desc: "24 Hours Customer Care" },
  { brand: "Suzuki Emergency Service", phone: "08001100800", desc: "Halo Suzuki Siaga" }
];

// Leaflet Map instance & layers
let mapInstance = null;
let userMarker = null;
let mechanicMarker = null;
let ring1Circle = null;
let ring2Circle = null;

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', () => {
  initLiveTime();
  bindEventHandlers();
  renderView();
  setInterval(updateTimeDisplay, 1000);
});

function updateTimeDisplay() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const timeEl = document.getElementById('mobile-clock');
  if (timeEl) timeEl.textContent = timeStr;
}

function initLiveTime() {
  updateTimeDisplay();
}

// --- Map Initialization (Leaflet) ---
function initLeafletMap() {
  const mapContainer = document.getElementById('leaflet-map');
  if (!mapContainer || typeof L === 'undefined') return;

  try {
    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
      userMarker = null;
      mechanicMarker = null;
      ring1Circle = null;
      ring2Circle = null;
    }

    mapInstance = L.map('leaflet-map', {
      zoomControl: false,
      attributionControl: false
    }).setView([APP_STATE.userLocation.lat, APP_STATE.userLocation.lng], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(mapInstance);

    // Custom User Pin
    const userIcon = L.divIcon({
      className: 'custom-user-pin',
      html: '<div style="background:#ef4444; width:22px; height:22px; border-radius:50%; border:3px solid #ffffff; box-shadow:0 0 15px #ef4444; animation:radarPulse 1.5s infinite;"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    userMarker = L.marker([APP_STATE.userLocation.lat, APP_STATE.userLocation.lng], { icon: userIcon }).addTo(mapInstance);

    if (APP_STATE.flowStep === 'SEARCHING') {
      updateMapRadius(APP_STATE.searchRing);
    }
  } catch (err) {
    console.error("Map init error:", err);
  }
}

// --- Trigger 1-Click SOS Action ---
function triggerOneClickSOS() {
  playSirenSound();
  APP_STATE.flowStep = 'PRESET';
  renderView();
  startPresetCountdown();
}

// --- 3-Second Preset Auto-Countdown ---
function startPresetCountdown() {
  APP_STATE.presetTimer = 3;
  clearInterval(APP_STATE.presetInterval);

  const timerEl = document.getElementById('preset-countdown-val');
  if (timerEl) timerEl.textContent = APP_STATE.presetTimer;

  APP_STATE.presetInterval = setInterval(() => {
    APP_STATE.presetTimer -= 1;
    playCountdownBeep();
    const el = document.getElementById('preset-countdown-val');
    if (el) el.textContent = APP_STATE.presetTimer;

    if (APP_STATE.presetTimer <= 0) {
      clearInterval(APP_STATE.presetInterval);
      if (!APP_STATE.selectedPreset) {
        // Auto default to general emergency
        selectPresetAndDispatch('general');
      }
    }
  }, 1000);
}

function selectPresetAndDispatch(presetId) {
  clearInterval(APP_STATE.presetInterval);
  APP_STATE.selectedPreset = PRESETS.find(p => p.id === presetId) || PRESETS[4];
  startGeofencingPipeline();
}

// --- Geofencing Pipeline (Ring 1 -> Ring 2 -> Fallback Hotline) ---
function startGeofencingPipeline() {
  APP_STATE.flowStep = 'SEARCHING';
  APP_STATE.searchRing = 1;
  APP_STATE.searchTimer = 15;
  renderView();

  updateMapRadius(1);

  clearInterval(APP_STATE.searchInterval);
  APP_STATE.searchInterval = setInterval(() => {
    APP_STATE.searchTimer -= 1;
    
    // Update active timer display in UI
    const ring1TimerEl = document.getElementById('ring1-timer');
    const ring2TimerEl = document.getElementById('ring2-timer');

    if (APP_STATE.searchRing === 1 && ring1TimerEl) {
      ring1TimerEl.textContent = `${APP_STATE.searchTimer}s`;
    } else if (APP_STATE.searchRing === 2 && ring2TimerEl) {
      ring2TimerEl.textContent = `${APP_STATE.searchTimer}s`;
    }

    // Trigger mechanic match simulation at 10s mark in Ring 1 for realistic response!
    if (APP_STATE.searchRing === 1 && APP_STATE.searchTimer === 10) {
      clearInterval(APP_STATE.searchInterval);
      dispatchFoundMechanic();
      return;
    }

    // If Ring 1 expires without match, expand to Ring 2
    if (APP_STATE.searchRing === 1 && APP_STATE.searchTimer <= 0) {
      APP_STATE.searchRing = 2;
      APP_STATE.searchTimer = 15;
      updateMapRadius(2);
      updatePipelineUI();
    } 
    // If Ring 2 expires, escalate to Fallback Hotline
    else if (APP_STATE.searchRing === 2 && APP_STATE.searchTimer <= 0) {
      clearInterval(APP_STATE.searchInterval);
      escalateToHotline();
    }
  }, 1000);
}

function updateMapRadius(ring) {
  if (!mapInstance) return;

  if (ring1Circle) mapInstance.removeLayer(ring1Circle);
  if (ring2Circle) mapInstance.removeLayer(ring2Circle);

  if (ring === 1) {
    ring1Circle = L.circle([APP_STATE.userLocation.lat, APP_STATE.userLocation.lng], {
      radius: 2500,
      color: '#ef4444',
      fillColor: '#ef4444',
      fillOpacity: 0.15,
      weight: 2,
      dashArray: '5, 5'
    }).addTo(mapInstance);
    mapInstance.setView([APP_STATE.userLocation.lat, APP_STATE.userLocation.lng], 13);
  } else if (ring === 2) {
    ring2Circle = L.circle([APP_STATE.userLocation.lat, APP_STATE.userLocation.lng], {
      radius: 5000,
      color: '#f59e0b',
      fillColor: '#f59e0b',
      fillOpacity: 0.12,
      weight: 2,
      dashArray: '6, 6'
    }).addTo(mapInstance);
    mapInstance.setView([APP_STATE.userLocation.lat, APP_STATE.userLocation.lng], 12);
  }
}

function updatePipelineUI() {
  const step1 = document.getElementById('pipeline-step-1');
  const step2 = document.getElementById('pipeline-step-2');
  if (step1 && step2) {
    step1.classList.remove('active');
    step1.classList.add('completed');
    step2.classList.add('active');
  }
}

// --- Found & Dispatched Mechanic ---
function dispatchFoundMechanic() {
  playSuccessChime();
  APP_STATE.flowStep = 'DISPATCHED';
  APP_STATE.assignedMechanic = SAMPLE_MECHANICS[0];
  APP_STATE.etaMinutes = 7;
  APP_STATE.etaDistanceKm = 1.8;
  renderView();

  // Add Mechanic on Map
  if (mapInstance && typeof L !== 'undefined') {
    const mechLat = APP_STATE.userLocation.lat + APP_STATE.assignedMechanic.latOffset;
    const mechLng = APP_STATE.userLocation.lng + APP_STATE.assignedMechanic.lngOffset;

    const mechIcon = L.divIcon({
      className: 'custom-mech-pin',
      html: '<div style="background:#2563eb; width:26px; height:26px; border-radius:50%; border:3px solid #ffffff; box-shadow:0 0 15px #2563eb; display:flex; align-items:center; justify-content:center; color:white; font-size:12px;">🏍️</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    if (mechanicMarker) mapInstance.removeLayer(mechanicMarker);
    mechanicMarker = L.marker([mechLat, mechLng], { icon: mechIcon }).addTo(mapInstance);

    // Fit bounds to show both
    const bounds = L.latLngBounds([[APP_STATE.userLocation.lat, APP_STATE.userLocation.lng], [mechLat, mechLng]]);
    mapInstance.fitBounds(bounds, { padding: [40, 40] });

    // Simulate real-time movement
    startMechanicMovementSimulation(mechLat, mechLng);
  }
}

function startMechanicMovementSimulation(startLat, startLng) {
  clearInterval(APP_STATE.trackingInterval);
  let currentLat = startLat;
  let currentLng = startLng;

  APP_STATE.trackingInterval = setInterval(() => {
    if (APP_STATE.flowStep !== 'DISPATCHED') {
      clearInterval(APP_STATE.trackingInterval);
      return;
    }

    // Step closer to user
    const dLat = (APP_STATE.userLocation.lat - currentLat) * 0.1;
    const dLng = (APP_STATE.userLocation.lng - currentLng) * 0.1;

    currentLat += dLat;
    currentLng += dLng;

    if (mechanicMarker) {
      mechanicMarker.setLatLng([currentLat, currentLng]);
    }

    if (APP_STATE.etaMinutes > 1) {
      APP_STATE.etaMinutes -= 1;
      APP_STATE.etaDistanceKm = Math.max(0.2, (APP_STATE.etaDistanceKm - 0.3)).toFixed(1);
      
      const etaTimeEl = document.getElementById('live-eta-time');
      const etaDistEl = document.getElementById('live-eta-distance');
      if (etaTimeEl) etaTimeEl.textContent = `${APP_STATE.etaMinutes} Menit`;
      if (etaDistEl) etaDistEl.textContent = `${APP_STATE.etaDistanceKm} km`;
    }
  }, 4000);
}

// --- Escalation to Official Hotlines ---
function escalateToHotline() {
  APP_STATE.flowStep = 'HOTLINE_FALLBACK';
  renderView();
}

// --- Finish Service & Generate Transparent Bill ---
function completeEmergencyService() {
  APP_STATE.flowStep = 'COMPLETED';
  renderView();
}

function resetToHome() {
  clearInterval(APP_STATE.presetInterval);
  clearInterval(APP_STATE.searchInterval);
  clearInterval(APP_STATE.trackingInterval);
  
  if (ring1Circle && mapInstance) mapInstance.removeLayer(ring1Circle);
  if (ring2Circle && mapInstance) mapInstance.removeLayer(ring2Circle);
  if (mechanicMarker && mapInstance) mapInstance.removeLayer(mechanicMarker);

  APP_STATE.flowStep = 'IDLE';
  APP_STATE.selectedPreset = null;
  APP_STATE.assignedMechanic = null;
  renderView();
}

// --- Switch Driver / Mechanic Mode ---
function toggleUserRole() {
  APP_STATE.userRole = APP_STATE.userRole === 'driver' ? 'mechanic' : 'driver';
  const roleBtn = document.getElementById('role-toggle-btn');
  if (roleBtn) {
    roleBtn.classList.toggle('active-mechanic', APP_STATE.userRole === 'mechanic');
    roleBtn.innerHTML = APP_STATE.userRole === 'driver' 
      ? '<span>🚗 Mode Pengendara</span>' 
      : '<span>👨‍🔧 Mode Mitra Montir</span>';
  }
  renderView();
}

// --- Switch Bottom Nav Tabs ---
function switchTab(tabId) {
  APP_STATE.currentTab = tabId;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabId);
  });
  renderView();
}

// --- Main View Renderer ---
function renderView() {
  const container = document.getElementById('app-viewport-content');
  if (!container) return;

  // If in other tabs (Guide, Tariff, Partner)
  if (APP_STATE.currentTab === 'guide') {
    container.innerHTML = renderGuideView();
    return;
  }
  if (APP_STATE.currentTab === 'tariff') {
    container.innerHTML = renderTariffView();
    return;
  }
  if (APP_STATE.currentTab === 'partner') {
    container.innerHTML = renderPartnerView();
    return;
  }

  // Mechanic Mode Screen
  if (APP_STATE.userRole === 'mechanic') {
    container.innerHTML = renderMechanicModeView();
    return;
  }

  // Driver Mode Flows
  switch (APP_STATE.flowStep) {
    case 'IDLE':
      container.innerHTML = renderIdleSOSView();
      setTimeout(initLeafletMap, 50);
      break;

    case 'PRESET':
      container.innerHTML = renderPresetSelectionView();
      break;

    case 'SEARCHING':
      container.innerHTML = renderSearchingRadarView();
      setTimeout(initLeafletMap, 50);
      break;

    case 'DISPATCHED':
      container.innerHTML = renderDispatchedTrackingView();
      setTimeout(initLeafletMap, 50);
      break;

    case 'HOTLINE_FALLBACK':
      container.innerHTML = renderHotlineFallbackView();
      break;

    case 'COMPLETED':
      container.innerHTML = renderCompletedInvoiceView();
      break;

    default:
      container.innerHTML = renderIdleSOSView();
  }
}

// --- Sub-View Templates ---

function renderIdleSOSView() {
  return `
    <div class="gps-bar">
      <div class="gps-info">
        <div class="gps-pulse-icon">📍</div>
        <div class="gps-text-wrap">
          <div class="gps-label">Titik Darurat Anda Terkunci:</div>
          <div class="gps-address">${APP_STATE.userLocation.address}</div>
        </div>
      </div>
      <button class="gps-refresh-btn" onclick="alert('GPS koordinat diperbarui secara presisi.')" title="Refresh GPS">🔄</button>
    </div>

    <div class="sos-trigger-screen">
      <div class="sos-button-wrapper">
        <div class="sos-pulse-ring"></div>
        <div class="sos-pulse-ring-2"></div>
        <button class="btn-sos-main" onclick="triggerOneClickSOS()" id="sos-btn">
          <span class="sos-icon">🚨</span>
          <span class="sos-main-text">SOS</span>
          <span class="sos-sub-text">PENCET DARURAT</span>
        </button>
      </div>

      <div class="sos-instruction-card">
        ⚡ <strong>One-Click Action:</strong> Cukup 1 kali pencet, sinyal darurat langsung disebar ke mitra montir & bengkel terdekat dalam radius 5 km.
      </div>

      <div style="width: 100%; text-align: left; margin-bottom: 8px;">
        <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Pilih Kendala Cepat (Opsional):</span>
      </div>

      <div class="preset-grid">
        ${PRESETS.slice(0, 4).map(p => `
          <div class="preset-card" onclick="selectPresetAndDispatch('${p.id}')">
            <span class="preset-icon">${p.icon}</span>
            <span class="preset-title">${p.title}</span>
            <span class="preset-estimate">${p.desc}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderPresetSelectionView() {
  return `
    <div class="sos-trigger-screen" style="padding-top: 24px;">
      <div class="countdown-banner">
        <div>
          <strong style="font-size: 0.88rem; color: var(--amber-warning);">Pilih Jenis Kendala</strong>
          <p style="font-size: 0.74rem; color: var(--text-muted);">Atau tunggu 3 detik untuk bantuan umum...</p>
        </div>
        <div class="countdown-timer-badge" id="preset-countdown-val">3</div>
      </div>

      <div class="preset-grid">
        ${PRESETS.map(p => `
          <div class="preset-card ${p.id === 'general' ? 'selected' : ''}" onclick="selectPresetAndDispatch('${p.id}')">
            <span class="preset-icon">${p.icon}</span>
            <span class="preset-title">${p.title}</span>
            <span class="preset-estimate">${p.desc}</span>
          </div>
        `).join('')}
      </div>

      <button class="btn-primary-block" onclick="selectPresetAndDispatch('general')" style="margin-top: 10px;">
        Langsung Cari Bantuan Sekarang 🚀
      </button>
    </div>
  `;
}

function renderSearchingRadarView() {
  const selected = APP_STATE.selectedPreset || PRESETS[4];
  return `
    <div class="geofencing-screen">
      <div style="margin-bottom: 12px; width: 100%; text-align: left;">
        <span class="section-badge" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; padding: 4px 10px; border-radius: 99px; font-size: 0.75rem; font-weight: 800;">
          ${selected.icon} ${selected.title}
        </span>
        <h3 style="font-size: 1.15rem; font-weight: 800; margin-top: 6px;">Mencari Montir Terdekat...</h3>
      </div>

      <div class="radar-map-box">
        <div id="leaflet-map"></div>
      </div>

      <div class="pipeline-progress-box">
        <div class="pipeline-step ${APP_STATE.searchRing === 1 ? 'active' : 'completed'}" id="pipeline-step-1">
          <div class="pipeline-icon-box">1</div>
          <div class="pipeline-text">
            <h4>Ring 1 (Radius 0 – 2,5 km)</h4>
            <p>Broadcast sinyal ke mitra bengkel terdekat. <span class="ring-timer-text" id="ring1-timer">15s</span></p>
          </div>
        </div>

        <div class="pipeline-step ${APP_STATE.searchRing === 2 ? 'active' : ''}" id="pipeline-step-2">
          <div class="pipeline-icon-box">2</div>
          <div class="pipeline-text">
            <h4>Ring 2 (Radius 2,6 – 5,0 km)</h4>
            <p>Perluasan jangkauan otomatis jika Ring 1 nihil. <span class="ring-timer-text" id="ring2-timer">15s</span></p>
          </div>
        </div>

        <div class="pipeline-step" id="pipeline-step-3">
          <div class="pipeline-icon-box">🚨</div>
          <div class="pipeline-text">
            <h4>Jalur Cadangan (Eskalasi Hotline)</h4>
            <p>Panggilan darurat derek tol resmi 14080 & bengkel resmi.</p>
          </div>
        </div>
      </div>

      <button class="btn-action btn-cancel" style="width: 100%;" onclick="resetToHome()">
        Batalkan Pencarian ✕
      </button>
    </div>
  `;
}

function renderDispatchedTrackingView() {
  const m = APP_STATE.assignedMechanic || SAMPLE_MECHANICS[0];
  const p = APP_STATE.selectedPreset || PRESETS[0];

  return `
    <div class="dispatch-screen">
      <div class="eta-strip">
        <div>
          <span style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Estimasi Kedatangan Montir:</span>
          <div class="eta-time" id="live-eta-time">${APP_STATE.etaMinutes} Menit</div>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 0.72rem; color: var(--text-muted);">Jarak:</span>
          <div style="font-weight: 800; font-size: 1rem; color: #38bdf8;" id="live-eta-distance">${APP_STATE.etaDistanceKm} km</div>
        </div>
      </div>

      <div class="radar-map-box" style="height: 190px;">
        <div id="leaflet-map"></div>
      </div>

      <!-- Mechanic Profile Card -->
      <div class="mechanic-profile-card">
        <div class="mechanic-avatar">
          ${m.avatar}
          <span class="bnsp-badge">BNSP</span>
        </div>
        <div class="mechanic-info">
          <div class="mechanic-name">${m.name}</div>
          <div class="mechanic-meta">⭐ ${m.rating} • ${m.workshop}</div>
          <div style="font-size: 0.72rem; color: #38bdf8; font-weight: 700; margin-top: 2px;">${m.vehicle} • [${m.plate}]</div>
        </div>
      </div>

      <!-- Quick Communication Buttons -->
      <div class="action-buttons-grid">
        <a href="tel:${m.phone}" class="btn-action btn-call">
          📞 Telepon Montir
        </a>
        <a href="https://wa.me/${m.wa}?text=Halo%20Mas%20${encodeURIComponent(m.name)}%2C%20saya%20pemesan%20darurat%20MontirSiaga%20di%20${encodeURIComponent(APP_STATE.userLocation.address)}" target="_blank" class="btn-action btn-wa">
          💬 WhatsApp
        </a>
      </div>

      <!-- Price Breakdown -->
      <div class="price-sheet">
        <div class="price-sheet-title">
          <span>Rincian Biaya Transparan</span>
          <span style="font-size: 0.72rem; color: #10b981; font-weight: 700;">Verified App</span>
        </div>
        <div class="price-row">
          <span>Biaya Kedatangan (Call-Out Fee)</span>
          <span>Rp ${p.baseFee.toLocaleString('id-ID')}</span>
        </div>
        <div class="price-row">
          <span>Jasa Penanganan (${p.title})</span>
          <span>Rp ${p.serviceFee.toLocaleString('id-ID')}</span>
        </div>
        <div class="price-row total">
          <span>Total Estimasi Biaya</span>
          <span style="color: #38bdf8;">Rp ${(p.baseFee + p.serviceFee).toLocaleString('id-ID')}</span>
        </div>
        <div class="revenue-split-badge">
          💰 Pembagian: 80% Mitra Montir (Rp ${((p.baseFee + p.serviceFee) * 0.8).toLocaleString('id-ID')}) • 20% Platform
        </div>
      </div>

      <button class="btn-success-block" onclick="completeEmergencyService()">
        Selesaikan & Bayar di Tempat ✔️
      </button>

      <button class="btn-action btn-cancel" onclick="resetToHome()" style="width: 100%;">
        Batalkan Pesanan
      </button>
    </div>
  `;
}

function renderHotlineFallbackView() {
  return `
    <div class="geofencing-screen" style="padding-top: 20px;">
      <div class="hotline-card">
        <div style="font-size: 2.2rem; margin-bottom: 6px;">⚠️</div>
        <h3 style="font-size: 1.15rem; font-weight: 800; color: #fca5a5; margin-bottom: 4px;">Mitra Terdekat Sedang Penuh</h3>
        <p style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4;">
          Pencarian Ring 1 & Ring 2 (5 km) belum menemukan montir luang dalam 30 detik. Silakan gunakan hotline darurat resmi di bawah ini:
        </p>

        <div class="hotline-btn-grid">
          <a href="tel:14080" class="btn-hotline btn-hotline-tol">
            <span>🚛 Derek Tol Resmi Jasa Marga</span>
            <span style="font-family: monospace; font-size: 1rem;">14080 📞</span>
          </a>

          ${BRAND_HOTLINES.slice(1).map(b => `
            <a href="tel:${b.phone}" class="btn-hotline btn-hotline-brand">
              <div style="text-align: left;">
                <div style="font-size: 0.82rem; font-weight: 700;">${b.brand}</div>
                <div style="font-size: 0.68rem; color: var(--text-muted);">${b.desc}</div>
              </div>
              <span style="font-family: monospace; font-size: 0.85rem; color: #38bdf8;">${b.phone} 📞</span>
            </a>
          `).join('')}
        </div>
      </div>

      <button class="btn-primary-block" onclick="triggerOneClickSOS()" style="margin-top: 10px;">
        Ulangi Pencarian Montir Siaga 🔄
      </button>
      <button class="btn-action btn-cancel" onclick="resetToHome()" style="width: 100%; margin-top: 8px;">
        Kembali ke Beranda
      </button>
    </div>
  `;
}

function renderCompletedInvoiceView() {
  const m = APP_STATE.assignedMechanic || SAMPLE_MECHANICS[0];
  const p = APP_STATE.selectedPreset || PRESETS[0];
  const total = p.baseFee + p.serviceFee;

  return `
    <div class="dispatch-screen" style="text-align: center;">
      <div style="font-size: 3rem; margin: 10px 0;">🎉</div>
      <h3 style="font-size: 1.3rem; font-weight: 800; margin-bottom: 4px;">Kendala Teratasi!</h3>
      <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 16px;">
        Terima kasih telah menggunakan MontirSiaga.com. Montir datang, panik hilang, perjalanan kembali lancar!
      </p>

      <div class="price-sheet" style="text-align: left;">
        <div class="price-sheet-title">
          <span>Nota Pembayaran Digital</span>
          <span style="color: #10b981; font-weight: 800;">LUNAS</span>
        </div>
        <div class="price-row">
          <span>Mekanik Bertugas</span>
          <span style="color: var(--text-main); font-weight: 700;">${m.name}</span>
        </div>
        <div class="price-row">
          <span>Layanan Selesai</span>
          <span style="color: var(--text-main); font-weight: 700;">${p.title}</span>
        </div>
        <div class="price-row total">
          <span>Total Pembayaran</span>
          <span style="color: #10b981; font-size: 1.1rem;">Rp ${total.toLocaleString('id-ID')}</span>
        </div>
      </div>

      <div style="margin: 18px 0; background: var(--bg-card); padding: 14px; border-radius: var(--radius-md); border: 1px solid var(--border-light);">
        <div style="font-size: 0.82rem; font-weight: 700; margin-bottom: 8px;">Beri Nilai Kepuasan Layanan:</div>
        <div style="font-size: 1.6rem; color: #f59e0b; cursor: pointer;">⭐⭐⭐⭐⭐</div>
      </div>

      <button class="btn-primary-block" onclick="resetToHome()">
        Selesai & Kembali ke Menu Utama
      </button>
    </div>
  `;
}

// --- Mechanic Mode Incoming Job Simulator ---
function renderMechanicModeView() {
  let partnerProfile = null;
  try {
    const saved = localStorage.getItem('montirsiaga_verified_partner');
    if (saved) partnerProfile = JSON.parse(saved);
  } catch (e) {}

  const partnerName = partnerProfile ? partnerProfile.name : "Rahmat Hidayat, S.T.";
  const workshopName = partnerProfile ? partnerProfile.workshop : "Bengkel Mandiri Jaya Motor";
  const photoHtml = (partnerProfile && partnerProfile.photo) 
    ? `<img src="${partnerProfile.photo}" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #10b981;" alt="Mitra Montir">`
    : `<div style="font-size: 1.8rem;">👨‍🔧</div>`;

  return `
    <div class="dispatch-screen">
      <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-md); padding: 12px; margin-bottom: 12px; display: flex; align-items: center; gap: 12px;">
        ${photoHtml}
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <strong style="font-size: 0.92rem; color: #ffffff;">${partnerName}</strong>
            <span style="background: #10b981; color: #000; font-size: 0.65rem; font-weight: 800; padding: 1px 6px; border-radius: 99px;">TERVERIFIKASI</span>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${workshopName}</div>
        </div>
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span class="section-badge" style="background: rgba(16, 185, 129, 0.2); color: #6ee7b7; padding: 4px 10px; border-radius: 99px; font-size: 0.75rem; font-weight: 800;">
          🟢 Status: SIAGA AKTIF
        </span>
        <span style="font-size: 0.75rem; color: var(--text-muted);">Radius Siaga: 5.0 km</span>
      </div>

      <div class="mechanic-incoming-card">
        <div style="font-size: 2rem; margin-bottom: 4px;">🚨</div>
        <div class="incoming-title">ORDER DARURAT MASUK!</div>
        <p style="font-size: 0.85rem; color: var(--text-main); font-weight: 700; margin-bottom: 4px;">
          🛞 Ban Bocor & Kempes (Mobil Avanza)
        </p>
        <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 12px;">
          📍 Lokasi: ${APP_STATE.userLocation.address} (1.8 km dari posisi Anda)
        </p>
        <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px; margin-bottom: 14px; font-size: 0.82rem;">
          <div style="display: flex; justify-content: space-between; color: #94a3b8;">
            <span>Potensi Pendapatan Bersih:</span>
            <strong style="color: #10b981; font-size: 0.95rem;">Rp 64.000 (80%)</strong>
          </div>
        </div>
        <button class="btn-success-block" onclick="alert('Order Diterima! Rute navigasi Google Maps segera dibuka.'); toggleUserRole(); dispatchFoundMechanic();">
          TERIMA ORDER SEKARANG ⚡
        </button>
      </div>

      <div class="price-sheet">
        <div class="price-sheet-title">
          <span>Ringkasan Saldo Mitra</span>
          <span style="color: #38bdf8; font-weight: 800;">Rp 480.000</span>
        </div>
        <div class="price-row">
          <span>Pekerjaan Selesai Hari Ini</span>
          <span>4 Order</span>
        </div>
        <div class="price-row">
          <span>Bagi Hasil Jasa</span>
          <span>80% Montir / 20% App</span>
        </div>
      </div>
    </div>
  `;
}

// --- Guide / Safety Tab ---
function renderGuideView() {
  return `
    <div style="padding: 16px; display: flex; flex-direction: column; gap: 14px;">
      <h3 style="font-size: 1.15rem; font-weight: 800;">Panduan Keselamatan Darurat di Jalan</h3>

      <div class="price-sheet">
        <h4 style="color: var(--sos-red); font-size: 0.95rem; margin-bottom: 6px;">1. Mogok di Jalan Tol</h4>
        <p style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.5;">
          Nyalakan lampu hazard, tepi kendaraan ke bahu jalan sebelah kiri, pasang segitiga pengaman minimal 50-100 meter di belakang mobil, dan seluruh penumpang berdiri di luar pagar pembatas tol.
        </p>
      </div>

      <div class="price-sheet">
        <h4 style="color: var(--amber-warning); font-size: 0.95rem; margin-bottom: 6px;">2. Mesin Overheat</h4>
        <p style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.5;">
          Segera matikan AC dan pinggirkan mobil. Matikan mesin dan JANGAN PERNAH membuka tutup radiator saat mesin masih panas mendidih. Tunggu minimal 20 menit sebelum mengisi air cadangan.
        </p>
      </div>

      <div class="price-sheet">
        <h4 style="color: #38bdf8; font-size: 0.95rem; margin-bottom: 6px;">3. Cara Jumper Aki Aman</h4>
        <p style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.5;">
          Sambungkan kabel MERAH ke kutub Positif (+) aki donor lalu ke (+) aki mogok. Sambungkan kabel HITAM ke kutub Negatif (-) aki donor lalu ke bodi logam mobil mogok.
        </p>
      </div>
    </div>
  `;
}

// --- Tariff Tab ---
function renderTariffView() {
  return `
    <div style="padding: 16px; display: flex; flex-direction: column; gap: 14px;">
      <h3 style="font-size: 1.15rem; font-weight: 800;">Struktur Tarif & Transparansi Biaya</h3>

      <div class="price-sheet">
        <div class="price-sheet-title">
          <span>Struktur Biaya Kedatangan</span>
          <span style="color: #38bdf8;">Call-Out Fee</span>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">
          Tarif dasar kedatangan montir ke lokasi darurat adalah tetap, menjamin kepastian bagi pengendara dan kompensasi layak bagi mitra montir.
        </p>
        <div class="price-row">
          <span>Tarif Kedatangan Standar</span>
          <strong>Rp 45.000</strong>
        </div>
        <div class="price-row">
          <span>Bagi Hasil Jasa</span>
          <strong style="color: #10b981;">80% Montir / 20% Platform</strong>
        </div>
      </div>

      <div class="price-sheet">
        <h4 style="font-size: 0.9rem; font-weight: 700; margin-bottom: 10px;">Daftar Estimasi Jasa Darurat</h4>
        ${PRESETS.map(p => `
          <div class="price-row">
            <span>${p.icon} ${p.title}</span>
            <strong style="color: #38bdf8;">Rp ${p.serviceFee.toLocaleString('id-ID')}</strong>
          </div>
        `).join('')}
      </div>

      <div class="sos-instruction-card" style="color: #93c5fd; background: rgba(37, 99, 235, 0.1); border-color: rgba(37, 99, 235, 0.3);">
        🛡️ <strong>Verifikasi Suku Cadang:</strong> Harga suku cadang (aki/oli/ban dalam) wajib diverifikasi via aplikasi sebelum pengerjaan dilakukan di tempat.
      </div>
    </div>
  `;
}

// --- Partner / Workshop Registration Engine (Step 1 Info -> Step 2 Document Upload) ---
let partnerStep = 1;
let partnerFormData = {
  name: 'Hendra Wijaya',
  phone: '081234567890',
  workshop: 'Bengkel Sumber Rezeki - Tambun Selatan',
  certType: 'Sertifikat BNSP Otomotif Resmi'
};

let uploadedDocs = {
  photo: null,
  ktp: null,
  nib: null,
  cert: null,
  workshop: null
};

function handlePartnerStep1Submit(event) {
  if (event) event.preventDefault();
  
  const nameEl = document.getElementById('partner-name');
  const phoneEl = document.getElementById('partner-phone');
  const workshopEl = document.getElementById('partner-workshop');
  const certTypeEl = document.getElementById('partner-cert-type');

  partnerFormData.name = (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : 'Hendra Wijaya';
  partnerFormData.phone = (phoneEl && phoneEl.value.trim()) ? phoneEl.value.trim() : '081234567890';
  partnerFormData.workshop = (workshopEl && workshopEl.value.trim()) ? workshopEl.value.trim() : 'Bengkel Sumber Rezeki - Tambun';
  partnerFormData.certType = (certTypeEl && certTypeEl.value) ? certTypeEl.value : 'Sertifikat BNSP Otomotif Resmi';

  partnerStep = 2;
  renderView();
}

function handlePartnerStep1DirectClick() {
  handlePartnerStep1Submit(null);
}

function handleFileUpload(docType, event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    uploadedDocs[docType] = {
      name: file.name,
      dataUrl: e.target.result,
      size: (file.size / 1024).toFixed(1) + ' KB'
    };
    renderView();
  };
  reader.readAsDataURL(file);
}

function handleFinalPartnerSubmit() {
  if (!uploadedDocs.photo) {
    alert('Mohon unggah Pas Foto Montir (Foto Profil) untuk verifikasi armada.');
    return;
  }

  if (!uploadedDocs.ktp) {
    alert('Mohon unggah Foto e-KTP Asli untuk verifikasi identitas mitra.');
    return;
  }

  const refId = 'MITRA-' + Math.floor(100000 + Math.random() * 900000);
  const waText = `Halo Admin MontirSiaga.com, saya ingin mendaftar sebagai Mitra Bengkel/Montir Siaga:\n\n` +
    `📋 No. Registrasi: ${refId}\n` +
    `👤 Nama Montir: ${partnerFormData.name}\n` +
    `📱 WhatsApp: ${partnerFormData.phone}\n` +
    `🏢 Bengkel: ${partnerFormData.workshop}\n` +
    `📜 Tipe Legalitas: ${partnerFormData.certType}\n` +
    `📸 Pas Foto Montir: Terlampir (${uploadedDocs.photo ? uploadedDocs.photo.name : '-'})\n` +
    `🪪 Foto e-KTP: Terlampir (${uploadedDocs.ktp ? uploadedDocs.ktp.name : '-'})\n` +
    `📄 Dokumen Pendukung: ${uploadedDocs.nib ? 'NIB Ada' : 'Menyusul'}, ${uploadedDocs.cert ? 'Sertifikat BNSP Ada' : 'Menyusul'}, ${uploadedDocs.workshop ? 'Foto Bengkel Ada' : 'Menyusul'}\n\n` +
    `Mohon segera diverifikasi untuk aktivasi akun siaga. Terima kasih!`;

  const waUrl = `https://wa.me/6287781047453?text=${encodeURIComponent(waText)}`;

  alert(`✅ Berkas Pendaftaran & Foto Montir Berhasil Dikirim!\n\nNomor Registrasi: ${refId}\nPas Foto Montir & Dokumen KTP Anda telah diverifikasi sistem. Anda akan diarahkan ke WhatsApp Admin Verifikasi.`);
  
  // Persist partner in localStorage for active mechanic mode
  try {
    localStorage.setItem('montirsiaga_verified_partner', JSON.stringify({
      name: partnerFormData.name,
      phone: partnerFormData.phone,
      workshop: partnerFormData.workshop,
      certType: partnerFormData.certType,
      photo: uploadedDocs.photo ? uploadedDocs.photo.dataUrl : null,
      refId: refId,
      registeredAt: new Date().toLocaleDateString('id-ID')
    }));
  } catch (e) {
    console.error("Local storage error:", e);
  }

  window.open(waUrl, '_blank');
  
  // Reset state
  partnerStep = 1;
  uploadedDocs = { photo: null, ktp: null, nib: null, cert: null, workshop: null };
  switchTab('home');
}

function renderPartnerView() {
  if (partnerStep === 2) {
    return renderPartnerUploadStep();
  }
  return renderPartnerInfoStep();
}

function loadMockDocsForTesting() {
  const canvas = document.createElement('canvas');
  canvas.width = 120;
  canvas.height = 120;
  const ctx = canvas.getContext('2d');
  
  // Create mock mechanic photo
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(0, 0, 120, 120);
  ctx.fillStyle = '#ffffff';
  ctx.font = '50px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('👨‍🔧', 60, 60);
  const mockPhotoData = canvas.toDataURL('image/png');

  // Create mock KTP
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 120, 120);
  ctx.fillStyle = '#10b981';
  ctx.font = '40px sans-serif';
  ctx.fillText('🪪', 60, 60);
  const mockKtpData = canvas.toDataURL('image/png');

  uploadedDocs.photo = {
    name: 'pas_foto_montir_terverifikasi.png',
    dataUrl: mockPhotoData,
    size: '14.2 KB'
  };

  uploadedDocs.ktp = {
    name: 'ktp_asli_terverifikasi.png',
    dataUrl: mockKtpData,
    size: '18.5 KB'
  };

  uploadedDocs.cert = {
    name: 'sertifikat_bnsp_otomotif.pdf',
    dataUrl: '#',
    size: '128.0 KB'
  };

  playSuccessChime();
  renderView();
}

function renderPartnerInfoStep() {
  return `
    <div style="padding: 16px; display: flex; flex-direction: column; gap: 14px;">
      <div style="background: linear-gradient(135deg, rgba(239,68,68,0.15), rgba(245,158,11,0.15)); border: 1px solid rgba(245,158,11,0.3); border-radius: var(--radius-md); padding: 14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span class="section-badge" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; padding: 2px 8px; font-size: 0.7rem; border-radius: 99px; font-weight: 800;">
            🔥 KUOTA MITRA TERBATAS
          </span>
          <span class="section-badge" style="background: rgba(37,99,235,0.2); color: #60a5fa; padding: 2px 8px; font-size: 0.7rem; border-radius: 99px; font-weight: 800;">
            Langkah 1/2
          </span>
        </div>
        <h3 style="font-size: 1.22rem; font-weight: 900; line-height: 1.3; color: #ffffff; margin-bottom: 6px;">
          🚀 Raih Rp 5 – 10 Juta/Bulan Tambahan dari Order Darurat di Jalan!
        </h3>
        <p style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.45; margin: 0;">
          Daftar sekarang sebagai Mitra Bengkel/Montir Siaga. Dapatkan panggilan darurat harian dalam radius 5 km dengan <strong style="color:#10b981;">Bagi Hasil 80% Langsung Cair</strong> setiap selesai order.
        </p>
      </div>

      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        <span style="font-size: 0.7rem; background: rgba(16,185,129,0.15); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.3); padding: 3px 8px; border-radius: 6px; font-weight: 700;">⚡ Order Masuk ke HP</span>
        <span style="font-size: 0.7rem; background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); padding: 3px 8px; border-radius: 6px; font-weight: 700;">💰 80% Milik Anda</span>
        <span style="font-size: 0.7rem; background: rgba(245,158,11,0.15); color: #fde047; border: 1px solid rgba(245,158,11,0.3); padding: 3px 8px; border-radius: 6px; font-weight: 700;">📍 Radius Bebas Macet</span>
      </div>

      <form onsubmit="handlePartnerStep1Submit(event)" class="price-sheet" style="display:flex; flex-direction:column; gap:12px;">
        <div>
          <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 700;">Nama Lengkap Montir / Pemilik Bengkel *</label>
          <input type="text" id="partner-name" value="${partnerFormData.name}" placeholder="Contoh: Hendra Wijaya" required style="width:100%; background:var(--bg-app); border:1px solid var(--border-light); color:white; padding:10px 12px; border-radius:8px; margin-top:4px; font-size:0.85rem;">
        </div>

        <div>
          <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 700;">Nomor WhatsApp Aktif *</label>
          <input type="tel" id="partner-phone" value="${partnerFormData.phone}" placeholder="081234567890" required style="width:100%; background:var(--bg-app); border:1px solid var(--border-light); color:white; padding:10px 12px; border-radius:8px; margin-top:4px; font-size:0.85rem;">
        </div>

        <div>
          <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 700;">Nama Bengkel / Wilayah Operasi (Radius 5 km) *</label>
          <input type="text" id="partner-workshop" value="${partnerFormData.workshop}" placeholder="Bengkel Sumber Rezeki - Tambun Selatan" required style="width:100%; background:var(--bg-app); border:1px solid var(--border-light); color:white; padding:10px 12px; border-radius:8px; margin-top:4px; font-size:0.85rem;">
        </div>

        <div>
          <label style="font-size: 0.78rem; color: var(--text-muted); font-weight: 700;">Legalitas / Sertifikasi (NIB / Sertifikat BNSP) *</label>
          <select id="partner-cert-type" style="width:100%; background:var(--bg-app); border:1px solid var(--border-light); color:white; padding:10px 12px; border-radius:8px; margin-top:4px; font-size:0.85rem;">
            <option ${partnerFormData.certType === 'Sertifikat BNSP Otomotif Resmi' ? 'selected' : ''}>Sertifikat BNSP Otomotif Resmi</option>
            <option ${partnerFormData.certType === 'NIB Bengkel Resmi Mandiri' ? 'selected' : ''}>NIB Bengkel Resmi Mandiri</option>
            <option ${partnerFormData.certType === 'Pengalaman Kerja Bengkel > 3 Tahun' ? 'selected' : ''}>Pengalaman Kerja Bengkel &gt; 3 Tahun</option>
          </select>
        </div>

        <button type="submit" onclick="handlePartnerStep1DirectClick()" class="btn-primary-block" style="margin-top: 8px;">
          Lanjut ke Upload Foto & KTP ➔
        </button>
      </form>
    </div>
  `;
}

function renderPartnerUploadStep() {
  return `
    <div style="padding: 16px; display: flex; flex-direction: column; gap: 14px;">
      
      <!-- Persuasive Motivational Banner -->
      <div style="background: linear-gradient(135deg, rgba(16,185,129,0.2), rgba(59,130,246,0.18)); border: 1px solid rgba(16,185,129,0.4); border-radius: var(--radius-md); padding: 14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 6px;">
          <span class="section-badge" style="background: rgba(16,185,129,0.3); color: #6ee7b7; padding: 2px 8px; font-size: 0.7rem; border-radius: 99px; font-weight: 800;">
            ⚡ 1 LANGKAH TERAKHIR!
          </span>
          <span class="section-badge" style="background: rgba(59,130,246,0.3); color: #93c5fd; padding: 2px 8px; font-size: 0.7rem; border-radius: 99px; font-weight: 800;">
            Langkah 2/2
          </span>
        </div>
        <h3 style="font-size: 1.25rem; font-weight: 900; line-height: 1.3; color: #ffffff; margin-bottom: 6px;">
          🔥 Lengkapi Berkas Sekarang & Langsung Mulai Terima Order Hari Ini!
        </h3>
        <p style="font-size: 0.8rem; color: #e2e8f0; line-height: 1.45; margin: 0;">
          Pengendara mogok memilih montir yang profilnya jelas. Upload pas foto wajah & e-KTP Anda untuk mengaktifkan status <strong style="color: #10b981;">Mitra Resmi Terverifikasi</strong> dan prioritas radar darurat.
        </p>
      </div>

      <!-- Trust Benefit Points -->
      <div style="background: rgba(0,0,0,0.25); border-radius: 8px; padding: 10px 12px; font-size: 0.75rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 4px;">
        <div style="color: #6ee7b7; font-weight: 700;">💎 Mengapa Wajib Upload Foto & KTP?</div>
        <div>✔ Akun Anda langsung aktif di radar broadcast radius 5 km.</div>
        <div>✔ Pengendara 100% lebih yakin dan percaya dengan montir bertanda verifikasi resmi.</div>
        <div>✔ Hak proteksi tarif pasti & saldo langsung masuk rekening / dompet digital.</div>
      </div>

      <button type="button" onclick="loadMockDocsForTesting()" class="btn-primary-block" style="background: linear-gradient(135deg, #10b981, #059669); font-size: 0.78rem; padding: 9px 12px; border-radius: 8px; font-weight: 800;">
        ⚡ Pakai Contoh Pas Foto & KTP (Simulasi Cepat 1-Detik)
      </button>

      <div class="upload-card-group">
        
        <!-- 1. Upload Pas Foto Montir / Wajah Profil -->
        <div class="upload-card ${uploadedDocs.photo ? 'uploaded' : ''}">
          <div class="upload-header">
            <div class="upload-title">
              <span>📸</span>
              <span>Pas Foto Montir / Foto Profil (Wajib) *</span>
            </div>
            <span class="upload-status ${uploadedDocs.photo ? 'verified' : ''}">
              ${uploadedDocs.photo ? '✔ Terunggah' : 'Belum Ada'}
            </span>
          </div>
          <label class="upload-dropzone">
            <span>📷 Ambil Foto / Upload Wajah Montir</span>
            <input type="file" accept="image/*" onchange="handleFileUpload('photo', event)" style="display:none;">
          </label>
          ${uploadedDocs.photo ? `
            <div class="upload-preview-container">
              <img src="${uploadedDocs.photo.dataUrl}" class="upload-preview-img" style="width:48px; height:48px; border-radius:50%; object-fit:cover;" alt="Foto Montir">
              <div style="font-size:0.72rem; color:#10b981; font-weight:700;">
                <div>Foto Profil Montir Siap Ditampilkan</div>
                <div style="color:var(--text-muted); font-size:0.68rem;">${uploadedDocs.photo.name} (${uploadedDocs.photo.size})</div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- 2. Upload Foto e-KTP -->
        <div class="upload-card ${uploadedDocs.ktp ? 'uploaded' : ''}">
          <div class="upload-header">
            <div class="upload-title">
              <span>🪪</span>
              <span>Foto e-KTP Asli (Wajib) *</span>
            </div>
            <span class="upload-status ${uploadedDocs.ktp ? 'verified' : ''}">
              ${uploadedDocs.ktp ? '✔ Terunggah' : 'Belum Ada'}
            </span>
          </div>
          <label class="upload-dropzone">
            <span>📷 Pilih / Foto e-KTP</span>
            <input type="file" accept="image/*" onchange="handleFileUpload('ktp', event)" style="display:none;">
          </label>
          ${uploadedDocs.ktp ? `
            <div class="upload-preview-container">
              <img src="${uploadedDocs.ktp.dataUrl}" class="upload-preview-img" alt="KTP Preview">
              <div style="font-size:0.72rem; color:#10b981; font-weight:700;">
                <div>${uploadedDocs.ktp.name}</div>
                <div style="color:var(--text-muted); font-size:0.68rem;">${uploadedDocs.ktp.size}</div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- 3. Dokumen NIB / SKU Bengkel -->
        <div class="upload-card ${uploadedDocs.nib ? 'uploaded' : ''}">
          <div class="upload-header">
            <div class="upload-title">
              <span>📜</span>
              <span>Dokumen NIB / SKU Bengkel</span>
            </div>
            <span class="upload-status ${uploadedDocs.nib ? 'verified' : ''}">
              ${uploadedDocs.nib ? '✔ Terunggah' : 'Opsional'}
            </span>
          </div>
          <label class="upload-dropzone">
            <span>📄 Upload File NIB / Surat Usaha</span>
            <input type="file" accept="image/*,.pdf" onchange="handleFileUpload('nib', event)" style="display:none;">
          </label>
          ${uploadedDocs.nib ? `
            <div class="upload-preview-container">
              <div style="font-size:0.72rem; color:#10b981; font-weight:700;">
                <div>✔ ${uploadedDocs.nib.name} (${uploadedDocs.nib.size})</div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- 4. Sertifikat BNSP / Ijazah Keahlian -->
        <div class="upload-card ${uploadedDocs.cert ? 'uploaded' : ''}">
          <div class="upload-header">
            <div class="upload-title">
              <span>🏅</span>
              <span>Sertifikat BNSP / Ijazah Keahlian</span>
            </div>
            <span class="upload-status ${uploadedDocs.cert ? 'verified' : ''}">
              ${uploadedDocs.cert ? '✔ Terunggah' : 'Opsional'}
            </span>
          </div>
          <label class="upload-dropzone">
            <span>📄 Upload Sertifikat Keahlian</span>
            <input type="file" accept="image/*,.pdf" onchange="handleFileUpload('cert', event)" style="display:none;">
          </label>
          ${uploadedDocs.cert ? `
            <div class="upload-preview-container">
              <div style="font-size:0.72rem; color:#10b981; font-weight:700;">
                <div>✔ ${uploadedDocs.cert.name} (${uploadedDocs.cert.size})</div>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- 5. Foto Bengkel / Motor & Toolbox -->
        <div class="upload-card ${uploadedDocs.workshop ? 'uploaded' : ''}">
          <div class="upload-header">
            <div class="upload-title">
              <span>🏍️</span>
              <span>Foto Bengkel / Motor & Toolbox</span>
            </div>
            <span class="upload-status ${uploadedDocs.workshop ? 'verified' : ''}">
              ${uploadedDocs.workshop ? '✔ Terunggah' : 'Opsional'}
            </span>
          </div>
          <label class="upload-dropzone">
            <span>📷 Foto Armada / Toolbox</span>
            <input type="file" accept="image/*" onchange="handleFileUpload('workshop', event)" style="display:none;">
          </label>
          ${uploadedDocs.workshop ? `
            <div class="upload-preview-container">
              <img src="${uploadedDocs.workshop.dataUrl}" class="upload-preview-img" alt="Armada Preview">
              <div style="font-size:0.72rem; color:#10b981; font-weight:700;">
                <div>${uploadedDocs.workshop.name}</div>
              </div>
            </div>
          ` : ''}
        </div>

      </div>

      <button class="btn-success-block" onclick="handleFinalPartnerSubmit()" style="margin-top: 8px;">
        Kirim Berkas Verifikasi Kemitraan 🚀
      </button>

      <button class="btn-action btn-cancel" onclick="partnerStep = 1; renderView();" style="width: 100%;">
        ← Kembali Edit Data
      </button>
    </div>
  `;
}

// --- Event Handlers & Listeners ---
function bindEventHandlers() {
  const roleToggle = document.getElementById('role-toggle-btn');
  if (roleToggle) {
    roleToggle.addEventListener('click', toggleUserRole);
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const tab = item.dataset.tab;
      if (tab) switchTab(tab);
    });
  });
}

