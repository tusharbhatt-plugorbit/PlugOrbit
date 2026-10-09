import {TILE_ATTRIBUTION, TILE_MAX_ZOOM, TILE_URL} from '../config/mapTiles';
import {colors} from '../theme';
import {LEAFLET_CSS, LEAFLET_JS} from './leafletAsset';

/**
 * The fallback map: a Leaflet page that runs inside a WebView and needs no API
 * key. React Native talks to it through `window.PO` (see OsmMap.tsx); it talks
 * back with `ReactNativeWebView.postMessage`.
 */

export type PinKind = 'charger' | 'stop' | 'start' | 'end' | 'me' | 'pin';

export type MapPin = {
  id: string;
  latitude: number;
  longitude: number;
  kind: PinKind;
  /** charger: the open one (larger, lime). stop: the one to emphasise. */
  selected?: boolean;
  /** Taps are reported to React Native. */
  pressable?: boolean;
  /** Read out by screen readers. */
  label?: string;
};

export type MapRoute = {
  points: readonly [number, number][];
  color: string;
  width: number;
};

export type MapState = {pins: MapPin[]; route: MapRoute | null};

export type MapMessage =
  | {type: 'ready'}
  | {type: 'marker'; id: string}
  | {type: 'press'}
  | {type: 'move'; lat: number; lng: number}
  | {type: 'tiles'; ok: boolean}
  | {type: 'error'; message: string};

export type MapHtmlOptions = {
  center: {latitude: number; longitude: number};
  zoom: number;
  /** Pan and zoom by touch. Off for the small preview maps. */
  interactive: boolean;
  /** Show +/- buttons (handy on an emulator and for one-handed use). */
  zoomButtons: boolean;
};

// Embedded as JSON in a <script> tag, so `<` must not appear literally.
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

const PAGE_SCRIPT = `
(function () {
  var cfg = JSON.parse(document.getElementById('po-config').textContent);
  var rn = window.ReactNativeWebView;
  function send(m) {
    try { if (rn && rn.postMessage) { rn.postMessage(JSON.stringify(m)); } } catch (e) {}
  }
  var started = Date.now();
  var ready = false;
  window.onerror = function (msg) {
    if (!ready) { send({type: 'error', message: String(msg)}); }
  };
  if (typeof L === 'undefined') {
    send({type: 'error', message: 'Leaflet did not load'});
    return;
  }

  var map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    dragging: cfg.interactive,
    touchZoom: cfg.interactive,
    doubleClickZoom: cfg.interactive,
    scrollWheelZoom: cfg.interactive,
    boxZoom: false,
    keyboard: false,
    inertia: true,
    maxZoom: cfg.maxZoom,
    worldCopyJump: false
  });
  map.setView(cfg.center, cfg.zoom, {animate: false});
  L.control.attribution({position: 'bottomleft', prefix: false}).addTo(map);

  var tiles = L.tileLayer(cfg.tileUrl, {
    maxZoom: cfg.maxZoom,
    attribution: cfg.attribution,
    crossOrigin: false
  }).addTo(map);
  var loaded = 0;
  tiles.on('tileload', function () {
    loaded += 1;
    if (loaded === 1) { send({type: 'tiles', ok: true}); }
  });
  setTimeout(function () {
    if (loaded === 0) { send({type: 'tiles', ok: false}); }
  }, 10000);

  // Moves we start ourselves must not look like the person panning the map.
  var lastProgrammatic = 0;
  var userMoved = false;
  function programmatic() { lastProgrammatic = Date.now(); }
  function byUser() { return Date.now() - lastProgrammatic > 900; }

  map.on('dragstart', function () { userMoved = true; });
  map.on('zoomstart', function () { if (byUser()) { userMoved = true; } });
  map.on('moveend', function () {
    if (!ready || !byUser()) { return; }
    var c = map.getCenter();
    send({type: 'move', lat: c.lat, lng: c.lng});
  });
  map.on('click', function () { send({type: 'press'}); });

  var zap = function (size, color) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" ' +
      'fill="' + color + '" stroke="' + color + '" stroke-width="2" ' +
      'stroke-linejoin="round" stroke-linecap="round">' +
      '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
  };

  function iconFor(p) {
    var c = cfg.colors;
    var html, size, anchor;
    if (p.kind === 'charger') {
      var head = p.selected ? 40 : 32;
      var tone = p.selected ? c.lime : c.bg;
      var edge = p.selected ? c.limeDark : c.bg;
      html = '<div class="po-pin"><div class="po-head" style="width:' + head +
        'px;height:' + head + 'px;border-radius:50%;background:' + tone +
        ';border-color:' + edge + '">' +
        zap(p.selected ? 18 : 15, p.selected ? c.ink : c.lime) +
        '</div><div class="po-tip" style="border-top-color:' + tone + '"></div></div>';
      size = [44, 54]; anchor = [22, 54];
    } else if (p.kind === 'stop') {
      html = '<div class="po-dot" style="width:30px;height:30px;background:' +
        (p.selected ? c.lime : c.bg) + ';border:2px solid ' +
        (p.selected ? c.limeDark : '#FFFFFF') + '">' +
        zap(14, p.selected ? c.ink : c.lime) + '</div>';
      size = [30, 30]; anchor = [15, 15];
    } else if (p.kind === 'start' || p.kind === 'end') {
      html = '<div class="po-dot" style="width:16px;height:16px;background:' +
        (p.kind === 'end' ? c.lime : '#FFFFFF') + ';border:4px solid ' + c.bg + '"></div>';
      size = [16, 16]; anchor = [8, 8];
    } else if (p.kind === 'me') {
      html = '<div class="po-dot po-me" style="width:18px;height:18px;' +
        'background:#2563EB;border:3px solid #FFFFFF"></div>';
      size = [18, 18]; anchor = [9, 9];
    } else {
      html = '<div class="po-dot" style="width:34px;height:34px;background:' + c.lime +
        ';border:3px solid ' + c.bg + '">' + zap(16, c.ink) + '</div>';
      size = [34, 34]; anchor = [17, 17];
    }
    return L.divIcon({className: 'po-icon', html: html, iconSize: size, iconAnchor: anchor});
  }

  var pins = {};
  function applyPins(list) {
    var seen = {};
    list.forEach(function (p) {
      seen[p.id] = true;
      var sig = p.kind + '|' + (p.selected ? 1 : 0) + '|' + (p.pressable ? 1 : 0);
      var cur = pins[p.id];
      if (cur && cur.sig === sig) {
        cur.marker.setLatLng([p.latitude, p.longitude]);
        return;
      }
      if (cur) { map.removeLayer(cur.marker); }
      var marker = L.marker([p.latitude, p.longitude], {
        icon: iconFor(p),
        title: p.label || '',
        alt: p.label || '',
        keyboard: false,
        interactive: !!p.pressable,
        zIndexOffset: p.selected ? 1000 : (p.kind === 'me' ? 500 : 0)
      }).addTo(map);
      if (p.pressable) {
        marker.on('click', function () { send({type: 'marker', id: p.id}); });
      }
      pins[p.id] = {marker: marker, sig: sig};
    });
    Object.keys(pins).forEach(function (id) {
      if (!seen[id]) { map.removeLayer(pins[id].marker); delete pins[id]; }
    });
  }

  var line = null;
  function applyRoute(route) {
    if (line) { map.removeLayer(line); line = null; }
    if (route && route.points.length > 1) {
      line = L.polyline(route.points, {
        color: route.color, weight: route.width, opacity: 1,
        lineJoin: 'round', lineCap: 'round', interactive: false
      }).addTo(map);
    }
  }

  var lastFit = null;
  function fit(points, maxZoom) {
    lastFit = {points: points, maxZoom: maxZoom};
    programmatic();
    if (points.length === 1) {
      map.setView(points[0], maxZoom, {animate: false});
      return;
    }
    map.fitBounds(L.latLngBounds(points), {
      padding: [28, 28], maxZoom: maxZoom, animate: false
    });
  }
  // The WebView can be laid out after the page loads; keep a fitted view fitted.
  map.on('resize', function () {
    if (lastFit && !userMoved) { fit(lastFit.points, lastFit.maxZoom); }
  });

  window.PO = {
    set: function (state) {
      applyPins(state.pins || []);
      applyRoute(state.route || null);
    },
    view: function (lat, lng, zoom) {
      programmatic();
      map.setView([lat, lng], zoom, {animate: true, duration: 0.35});
    },
    fit: fit
  };

  if (cfg.zoomButtons) {
    var box = document.getElementById('po-zoom');
    box.style.display = 'flex';
    L.DomEvent.disableClickPropagation(box);
    document.getElementById('po-zoom-in').onclick = function () { map.zoomIn(); };
    document.getElementById('po-zoom-out').onclick = function () { map.zoomOut(); };
  }

  map.whenReady(function () {
    ready = true;
    send({type: 'ready'});
  });
})();
`;

const PAGE_CSS = `
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden;
  background: ${colors.mapBg}; -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent; -webkit-user-select: none; user-select: none; }
#map { position: absolute; top: 0; right: 0; bottom: 0; left: 0; background: ${colors.mapBg}; }
.po-icon { background: none; border: none; }
.po-pin { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; }
.po-head { box-sizing: border-box; border: 2px solid; display: flex; align-items: center; justify-content: center; }
.po-tip { width: 0; height: 0; margin-top: -2px; border-left: 6px solid transparent;
  border-right: 6px solid transparent; border-top: 9px solid; }
.po-dot { box-sizing: border-box; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.po-me { box-shadow: 0 0 0 8px rgba(37, 99, 235, 0.18); }
.leaflet-control-attribution { font-size: 10px; padding: 1px 5px; }
#po-zoom { display: none; position: absolute; right: 16px; top: 124px; z-index: 1000;
  flex-direction: column; background: #FFFFFF; border-radius: 14px; overflow: hidden;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.25); }
#po-zoom button { width: 44px; height: 44px; border: 0; background: #FFFFFF; color: ${colors.ink};
  font: 700 22px/44px sans-serif; padding: 0; }
#po-zoom button + button { border-top: 1px solid ${colors.divider}; }
#po-zoom button:active { background: ${colors.mapBg}; }
`;

export function buildMapHtml(opts: MapHtmlOptions): string {
  const config = {
    center: [opts.center.latitude, opts.center.longitude],
    zoom: opts.zoom,
    interactive: opts.interactive,
    zoomButtons: opts.zoomButtons,
    tileUrl: TILE_URL,
    attribution: TILE_ATTRIBUTION,
    maxZoom: TILE_MAX_ZOOM,
    colors: {
      bg: colors.bg,
      lime: colors.lime,
      limeDark: colors.limeDark,
      ink: colors.ink,
    },
  };
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>${LEAFLET_CSS}</style>
<style>${PAGE_CSS}</style>
</head>
<body>
<div id="map"></div>
<div id="po-zoom">
  <button id="po-zoom-in" aria-label="Zoom in">+</button>
  <button id="po-zoom-out" aria-label="Zoom out">&minus;</button>
</div>
<script type="application/json" id="po-config">${safeJson(config)}</script>
<script>${LEAFLET_JS}</script>
<script>${PAGE_SCRIPT}</script>
</body>
</html>`;
}
