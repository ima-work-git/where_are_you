/**
 * 地図モジュール - Leaflet + OpenStreetMap
 * GPS誤差円の表示、マーカー管理を担当
 */
const MapModule = (() => {
  let map = null;
  let callerMarker = null;
  let accuracyCircle = null;

  // 日本全体が見える初期位置
  const DEFAULT_CENTER = [36.0, 137.0];
  const DEFAULT_ZOOM = 5;

  function init(elementId) {
    map = L.map(elementId).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    // OSM タイルレイヤー
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    return map;
  }

  function updateCallerLocation(lat, lng, accuracy) {
    const latlng = L.latLng(lat, lng);

    // マーカー更新 or 作成
    if (callerMarker) {
      callerMarker.setLatLng(latlng);
    } else {
      callerMarker = L.marker(latlng, {
        icon: L.divIcon({
          className: 'caller-marker',
          html: '<div class="marker-pin"></div>',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      }).addTo(map);
    }

    // 誤差円の更新 or 作成
    if (accuracyCircle) {
      accuracyCircle.setLatLng(latlng);
      accuracyCircle.setRadius(accuracy);
    } else {
      accuracyCircle = L.circle(latlng, {
        radius: accuracy,
        color: '#e74c3c',
        fillColor: '#e74c3c',
        fillOpacity: 0.12,
        weight: 2,
        dashArray: '6, 4',
      }).addTo(map);
    }

    // 誤差円が収まるようにズーム
    map.fitBounds(accuracyCircle.getBounds(), {
      padding: [50, 50],
      maxZoom: 18,
    });

    // ポップアップ
    callerMarker.bindPopup(
      `<strong>通報者位置</strong><br>` +
      `緯度: ${lat.toFixed(6)}<br>` +
      `経度: ${lng.toFixed(6)}<br>` +
      `精度: ±${Math.round(accuracy)}m`
    );
  }

  function getMap() {
    return map;
  }

  function invalidateSize() {
    if (map) {
      map.invalidateSize();
    }
  }

  return { init, updateCallerLocation, getMap, invalidateSize };
})();
