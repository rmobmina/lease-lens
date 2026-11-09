// Building X-Ray: materials. One registry so the scene can restyle (palette, theme) and fade groups
// of materials without touching geometry. Colours come from CSS tokens (--xr-*) via the palette object.
//
//   Structure   off-white concrete, warm neutral interiors, slate glazing — never recoloured by data
//   Overlays    one translucent material per inspection category, coloured by its status
//   Tiles       record items, coloured by their actual rating class

const SPEC = {
  facade: { roughness: 0.86 }, wallInside: { roughness: 0.9 }, facadeApprox: { roughness: 0.9 }, band: { roughness: 0.8 },
  base: { roughness: 0.9 }, frame: { roughness: 0.5, metalness: 0.3 }, door: { roughness: 0.55, metalness: 0.35 },
  glass: { roughness: 0.16, metalness: 0.25, envMapIntensity: 1.1 },
  roof: { roughness: 0.95 }, roofEdge: { roughness: 0.9 }, parapet: { roughness: 0.85 }, penthouse: { roughness: 0.85 },
  floor: { roughness: 0.8 }, slabEdge: { roughness: 0.85 }, concrete: { roughness: 0.9 }, partition: { roughness: 0.85 }, poche: { roughness: 0.7 },
  equipment: { roughness: 0.45, metalness: 0.45 }, cab: { roughness: 0.45, metalness: 0.45 }, equipmentDark: { roughness: 0.5, metalness: 0.3 },
  car: { roughness: 0.4, metalness: 0.3 }, carGlass: { roughness: 0.2, metalness: 0.2 }, paint: { roughness: 0.7 },
  context: { roughness: 0.95 }, contextFaded: { roughness: 0.95, transparent: true, opacity: 0.18, depthWrite: false },
  ground: { roughness: 1 }, plinth: { roughness: 0.8 },
  pad: { roughness: 1 }, paving: { roughness: 0.95 }, asphalt: { roughness: 0.95 }, trunk: { roughness: 0.9 }, foliage: { roughness: 0.9, flatShading: true },
  overlay: { roughness: 0.5, transparent: true, opacity: 0, depthWrite: false, side: 2 /* DoubleSide */ },
  tile: { roughness: 0.6 },
};
const LINES = { outline: 0.75, contextEdge: 0.35, contextEdgeFaded: 0.06 };

export function createMaterials(THREE) {
  const mats = new Map();
  const hatchFine = hatch(THREE, 0.5), hatchCoarse = hatch(THREE, 0.08);
  const contactTex = radial(THREE);

  function mat(name, variant = '') {
    const key = `${name}|${variant}`;
    let m = mats.get(key);
    if (m) return m;
    if (name === 'guide') {
      m = new THREE.LineDashedMaterial({ dashSize: 0.55, gapSize: 0.45, transparent: true, opacity: 0, depthWrite: false });
    } else if (name in LINES) {
      m = new THREE.LineBasicMaterial({ transparent: true, opacity: LINES[name], depthWrite: false });
    } else if (name === 'contact') {
      m = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: contactTex, transparent: true, opacity: 0.32, depthWrite: false });
    } else {
      const { envMapIntensity = 0.4, ...rest } = SPEC[name] ?? {};
      m = new THREE.MeshStandardMaterial({ envMapIntensity, emissiveIntensity: 0, ...rest });
    }
    m.userData = { name, variant, base: m.opacity };
    mats.set(key, m);
    return m;
  }

  // palette: from sections/xray.js readPalette(); statuses: zone -> 'ok' | 'some' | 'high' | 'none'
  function applyPalette(P, statuses) {
    for (const m of mats.values()) {
      const { name, variant } = m.userData;
      if (name === 'contact') continue;
      if (name === 'guide') { m.color.set(P.mat.guide ?? P.outline); continue; }
      if (name === 'overlay') {
        const s = statuses[variant] ?? 'none';
        m.color.set(P.overlay[s]);
        setMap(m, s === 'none' ? hatchFine : null);
      } else if (name === 'tile') {
        m.color.set(P.rating[variant] ?? P.rating.none);
        setMap(m, variant === 'none' || variant === 'na' ? hatchFine : null);
      } else if (name === 'facadeApprox') {
        m.color.set(P.mat.facade);
        setMap(m, hatchCoarse);
      } else {
        m.color.set(P.mat[name] ?? P.mat.facade);
      }
    }
  }
  function setMap(m, map) { if (m.map !== map) { m.map = map; m.needsUpdate = true; } }

  return {
    mat,
    applyPalette,
    all: () => mats.values(),
    named: (name) => [...mats.values()].filter((m) => m.userData.name === name),
    dispose() { for (const m of mats.values()) m.dispose(); hatchFine.dispose(); hatchCoarse.dispose(); contactTex.dispose(); },
  };
}

function hatch(THREE, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(0,0,0,0.24)';
  g.lineWidth = 5;
  for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// soft square-ish falloff for the contact shadow under the building
function radial(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 18, 64, 64, 64);
  grd.addColorStop(0, '#fff');
  grd.addColorStop(0.55, '#888');
  grd.addColorStop(1, '#000');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
