/**
 * 地図モジュール - Leaflet + OpenStreetMap
 * GPS誤差円の表示、POIマーカー管理を担当
 */
const MapModule = (() => {
  let map = null;
  let callerMarker = null;
  let accuracyCircle = null;
  let searchCircle = null;
  let poiLayerGroup = null;

  const DEFAULT_CENTER = [36.0, 137.0];
  const DEFAULT_ZOOM = 5;

  const POI_COLORS = [
    '#e67e22', '#8e44ad', '#27ae60', '#2980b9',
    '#d35400', '#16a085', '#c0392b', '#2c3e50',
  ];
  let colorIndex = 0;

  function init(elementId) {
    map = L.map(elementId).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    poiLayerGroup = L.layerGroup().addTo(map);

    return map;
  }

  function updateCallerLocation(lat, lng, accuracy) {
    const latlng = L.latLng(lat, lng);

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

    map.fitBounds(accuracyCircle.getBounds(), {
      padding: [50, 50],
      maxZoom: 18,
    });

    callerMarker.bindPopup(
      `<strong>通報者位置</strong><br>` +
      `緯度: ${lat.toFixed(6)}<br>` +
      `経度: ${lng.toFixed(6)}<br>` +
      `精度: ±${Math.round(accuracy)}m`
    );
  }

  /**
   * POI検索範囲の円を表示（黄色破線）
   */
  function showSearchRadius(lat, lng, radius) {
    if (searchCircle) {
      searchCircle.setLatLng([lat, lng]);
      searchCircle.setRadius(radius);
    } else {
      searchCircle = L.circle([lat, lng], {
        radius,
        color: '#f39c12',
        fillColor: '#f39c12',
        fillOpacity: 0.05,
        weight: 1,
        dashArray: '4, 8',
      }).addTo(map);
    }
  }

  /**
   * POI検索結果をマーカーで表示（カテゴリごとに色分け）
   * @param {Array} results - POI結果の配列
   * @param {Object} options - { dimmed: true でグレー表示(交差外) }
   */
  function showPOIResults(results, options = {}) {
    const dimmed = options.dimmed || false;
    const color = dimmed ? '#aaa' : POI_COLORS[colorIndex % POI_COLORS.length];
    if (!dimmed) colorIndex++;

    let count = 0;
    for (const poi of results) {
      const pinClass = dimmed ? 'poi-pin dimmed' : 'poi-pin';
      const marker = L.marker([poi.lat, poi.lng], {
        icon: L.divIcon({
          className: 'poi-marker',
          html: `<div class="${pinClass}" style="background:${color}"></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        zIndexOffset: dimmed ? -100 : 0,
      });

      marker.bindPopup(formatPOIPopup(poi, color));

      if (!dimmed) {
        marker.bindTooltip(poi.name, {
          permanent: true,
          direction: 'top',
          offset: [0, -12],
          className: 'poi-tooltip',
        });
      }

      poiLayerGroup.addLayer(marker);
      count++;
    }
    return count;
  }

  /**
   * 交差クラスターをハイライト円で表示
   */
  function showIntersectionCluster(lat, lng, radius) {
    const circle = L.circle([lat, lng], {
      radius: Math.min(radius, 300),
      color: '#27ae60',
      fillColor: '#27ae60',
      fillOpacity: 0.15,
      weight: 3,
      dashArray: '8, 4',
    }).addTo(poiLayerGroup);
    return circle;
  }

  /**
   * POIマーカーをクリア
   */
  function clearPOIResults() {
    if (poiLayerGroup) poiLayerGroup.clearLayers();
    if (searchCircle) {
      map.removeLayer(searchCircle);
      searchCircle = null;
    }
    colorIndex = 0;
  }

  /**
   * POIポップアップ: 名前 + 検索カテゴリ + OSMタグ一覧
   */
  function formatPOIPopup(poi, color) {
    let html = `<strong>${escapePopup(poi.name)}</strong><br>` +
               `<span style="color:${color}">[${escapePopup(poi.type)}]</span>`;

    if (poi.tags && Object.keys(poi.tags).length > 0) {
      html += '<div class="poi-tags">';
      // 重要タグを先に、残りをソートして表示
      const priority = ['amenity', 'shop', 'tourism', 'leisure', 'railway', 'highway',
                         'cuisine', 'phone', 'website', 'opening_hours', 'addr:full',
                         'addr:housenumber', 'addr:street', 'addr:city'];
      const shown = new Set();

      for (const key of priority) {
        if (poi.tags[key]) {
          html += `<span class="tag"><b>${escapePopup(key)}</b>=${escapePopup(poi.tags[key])}</span>`;
          shown.add(key);
        }
      }

      // 残りのタグ (name は既に表示済みなので除外)
      const rest = Object.keys(poi.tags)
        .filter(k => !shown.has(k) && k !== 'name')
        .sort();
      for (const key of rest) {
        html += `<span class="tag"><b>${escapePopup(key)}</b>=${escapePopup(poi.tags[key])}</span>`;
      }
      html += '</div>';
    }

    return html;
  }

  function escapePopup(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function getMap() {
    return map;
  }

  function invalidateSize() {
    if (map) map.invalidateSize();
  }

  return {
    init, updateCallerLocation, getMap, invalidateSize,
    showSearchRadius, showPOIResults, clearPOIResults,
    showIntersectionCluster,
  };
})();
