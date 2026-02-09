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
  let addressLayerGroup = null;

  const DEFAULT_CENTER = [36.0, 137.0];
  const DEFAULT_ZOOM = 5;

  const POI_COLORS = [
    '#e67e22', '#8e44ad', '#27ae60', '#2980b9',
    '#d35400', '#16a085', '#c0392b', '#2c3e50',
  ];
  let colorIndex = 0;

  // ランキング用カラー (#1=金, #2=銀, #3=銅, #4-5=青)
  const RANK_COLORS = ['#e67e22', '#95a5a6', '#cd7f32', '#2980b9', '#2c3e50'];

  function init(elementId) {
    map = L.map(elementId).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    poiLayerGroup = L.layerGroup().addTo(map);
    addressLayerGroup = L.layerGroup().addTo(map);

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
   * POI検索結果をマーカーで表示（ランキング付き）
   * @param {Array} results - スコア付きPOI結果の配列（スコア降順）
   */
  function showPOIResults(results) {
    colorIndex = 0;

    let count = 0;
    for (let i = 0; i < results.length; i++) {
      const poi = results[i];
      const rank = i + 1;
      const color = RANK_COLORS[i] || RANK_COLORS[RANK_COLORS.length - 1];

      const marker = L.marker([poi.lat, poi.lng], {
        icon: L.divIcon({
          className: 'poi-marker',
          html: `<div class="poi-rank-pin" style="background:${color}">${rank}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        zIndexOffset: 100 - i,
      });

      marker.bindPopup(formatPOIPopup(poi, color, rank));

      marker.bindTooltip(`#${rank} ${poi.name}`, {
        permanent: true,
        direction: 'top',
        offset: [0, -16],
        className: 'poi-tooltip',
      });

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
   * POIポップアップ: ランク + スコア + 名前 + 検索カテゴリ + OSMタグ一覧
   */
  function formatPOIPopup(poi, color, rank) {
    let html = '';
    if (rank) {
      html += `<div style="font-size:12px;font-weight:700;color:${color};margin-bottom:4px">` +
              `#${rank} — ${poi.totalScore || 0}点` +
              `<span style="font-weight:400;font-size:10px;color:#888"> ` +
              `(距離${poi.distanceScore || 0}×40%+テキスト${poi.textScore || 0}×60%)</span>` +
              `</div>`;
    }
    html += `<strong>${escapePopup(poi.name)}</strong><br>` +
            `<span style="color:${color}">[${escapePopup(poi.type)}]</span>`;
    if (poi.distance !== undefined) {
      html += ` <span style="font-size:11px;color:#666">${poi.distance}m</span>`;
    }

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

  /**
   * 通報者申告住所のマーカーを表示（POIとは別レイヤー）
   * boundingbox がある場合は範囲矩形も表示
   * @param {number} lat
   * @param {number} lng
   * @param {string} address
   * @param {string} displayName
   * @param {Array|null} boundingbox - [south, north, west, east] or null
   * @param {number} rank - 候補の順位 (1-based)
   */
  function showAddressMarker(lat, lng, address, displayName, boundingbox, rank) {
    clearAddressMarker();

    // boundingbox 範囲矩形を表示
    if (boundingbox && boundingbox.length === 4) {
      const [south, north, west, east] = boundingbox;
      const rect = L.rectangle(
        [[south, west], [north, east]],
        {
          color: '#e91e63',
          fillColor: '#e91e63',
          fillOpacity: 0.1,
          weight: 2,
          dashArray: '6, 4',
          interactive: false,
        }
      );
      addressLayerGroup.addLayer(rect);
    }

    const rankLabel = rank ? `#${rank} ` : '';
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'address-marker',
        html: `<div class="address-pin">${rank || '住所'}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      }),
      zIndexOffset: 500,
    });

    marker.bindPopup(
      '<strong style="color:#e91e63">[通報者申告住所] ' + rankLabel + '</strong><br>' +
      '<strong>' + escapePopup(address) + '</strong><br>' +
      '<span style="font-size:11px;color:#666">' + escapePopup(displayName) + '</span>'
    );

    marker.bindTooltip(rankLabel + address, {
      permanent: true,
      direction: 'top',
      offset: [0, -22],
      className: 'address-tooltip',
    });

    addressLayerGroup.addLayer(marker);
  }

  /**
   * 住所候補を複数表示（#1 は大きなマーカー+範囲、#2以降は小さなマーカー）
   * @param {Array} candidates - [{lat, lng, address, displayName, boundingbox}, ...]
   */
  function showAddressCandidates(candidates) {
    clearAddressMarker();
    if (!candidates || candidates.length === 0) return;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const rank = i + 1;
      const isTop = (i === 0);

      // #1 のみ boundingbox 範囲矩形を表示
      if (isTop && c.boundingbox && c.boundingbox.length === 4) {
        const [south, north, west, east] = c.boundingbox;
        const rect = L.rectangle(
          [[south, west], [north, east]],
          {
            color: '#e91e63',
            fillColor: '#e91e63',
            fillOpacity: 0.1,
            weight: 2,
            dashArray: '6, 4',
            interactive: false,
          }
        );
        addressLayerGroup.addLayer(rect);
      }

      const marker = L.marker([c.lat, c.lng], {
        icon: L.divIcon({
          className: 'address-marker',
          html: isTop
            ? `<div class="address-pin">${rank}</div>`
            : `<div class="address-pin-sub">${rank}</div>`,
          iconSize: isTop ? [40, 40] : [28, 28],
          iconAnchor: isTop ? [20, 20] : [14, 14],
        }),
        zIndexOffset: 500 - i,
      });

      marker.bindPopup(
        `<strong style="color:#e91e63">[住所候補 #${rank}]</strong><br>` +
        '<strong>' + escapePopup(c.address) + '</strong><br>' +
        '<span style="font-size:11px;color:#666">' + escapePopup(c.displayName) + '</span>'
      );

      marker.bindTooltip(`#${rank} ${c.address}`, {
        permanent: isTop,
        direction: 'top',
        offset: isTop ? [0, -22] : [0, -16],
        className: 'address-tooltip',
      });

      addressLayerGroup.addLayer(marker);
    }
  }

  function clearAddressMarker() {
    if (addressLayerGroup) addressLayerGroup.clearLayers();
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
    showAddressMarker, showAddressCandidates, clearAddressMarker,
  };
})();
