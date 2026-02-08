/**
 * POI検索モジュール
 * チャットの自然言語からキーワードを抽出し、Overpass APIでOSM施設を検索
 * LLM/BERT不使用 - 辞書ベースのキーワードマッチング
 *
 * モード:
 *  単一キーワード → 誤差円×5 内の該当施設を全てマーク
 *  複数キーワード → 各カテゴリを検索 → 全カテゴリが近接する地点を絞り込み
 */
const POISearch = (() => {

  const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

  // ========== キーワード辞書 ==========
  const KEYWORDS = [
    // --- コンビニ (shop=convenience) ---
    { pattern: /セブン(?:イレブン)?/i, tags: '[shop=convenience]["name"~"セブン"]', label: 'セブンイレブン' },
    { pattern: /ローソン/i, tags: '["name"~"ローソン"][shop=convenience]', label: 'ローソン' },
    { pattern: /ファミ(?:マ|リーマート)/i, tags: '[shop=convenience]["name"~"ファミリーマート"]', label: 'ファミリーマート' },
    { pattern: /ミニストップ/i, tags: '[shop=convenience]["name"~"ミニストップ"]', label: 'ミニストップ' },
    { pattern: /デイリー(?:ヤマザキ)?/i, tags: '[shop=convenience]["name"~"デイリー"]', label: 'デイリーヤマザキ' },
    { pattern: /コンビニ/i, tags: '[shop=convenience]', label: 'コンビニ' },

    // --- ファストフード (amenity=fast_food) ---
    { pattern: /マック|マクド(?:ナルド)?/i, tags: '[amenity=fast_food]["name"~"マクドナルド|McDonald"]', label: 'マクドナルド' },
    { pattern: /すき家|すきや/i, tags: '[amenity~"fast_food|restaurant"]["name"~"すき家"]', label: 'すき家' },
    { pattern: /吉野家|よしのや/i, tags: '[amenity~"fast_food|restaurant"]["name"~"吉野家"]', label: '吉野家' },
    { pattern: /松屋(?!.{0,2}(?:銀座|呉服))/i, tags: '[amenity~"fast_food|restaurant"]["name"~"松屋"]', label: '松屋' },
    { pattern: /ケンタ(?:ッキー)?|KFC/i, tags: '[amenity=fast_food]["name"~"ケンタッキー|KFC"]', label: 'ケンタッキー' },
    { pattern: /モス(?:バーガー)?/i, tags: '[amenity=fast_food]["name"~"モスバーガー|MOS"]', label: 'モスバーガー' },
    { pattern: /ココイチ|CoCo壱/i, tags: '[amenity~"fast_food|restaurant"]["name"~"CoCo壱番屋|ココ壱"]', label: 'CoCo壱番屋' },

    // --- カフェ・レストラン ---
    { pattern: /スタバ|スターバックス/i, tags: '[amenity=cafe]["name"~"スターバックス|Starbucks"]', label: 'スターバックス' },
    { pattern: /ドトール/i, tags: '[amenity=cafe]["name"~"ドトール"]', label: 'ドトール' },
    { pattern: /ガスト/i, tags: '[amenity=restaurant]["name"~"ガスト"]', label: 'ガスト' },
    { pattern: /サイゼ(?:リヤ)?/i, tags: '[amenity=restaurant]["name"~"サイゼリヤ"]', label: 'サイゼリヤ' },
    { pattern: /ジョナサン/i, tags: '[amenity=restaurant]["name"~"ジョナサン"]', label: 'ジョナサン' },

    // --- パン屋 (shop=bakery) ---
    { pattern: /パン屋|パンや|ベーカリー|bakery/i, tags: '[shop=bakery]', label: 'パン屋' },

    // --- スーパー (shop=supermarket) ---
    { pattern: /スーパー(?:マーケット)?/i, tags: '[shop=supermarket]', label: 'スーパー' },
    { pattern: /イオン/i, tags: '[shop~"supermarket|mall"]["name"~"イオン"]', label: 'イオン' },
    { pattern: /ライフ/i, tags: '[shop=supermarket]["name"~"ライフ"]', label: 'ライフ' },
    { pattern: /マルエツ/i, tags: '[shop=supermarket]["name"~"マルエツ"]', label: 'マルエツ' },
    { pattern: /東急ストア/i, tags: '[shop=supermarket]["name"~"東急ストア"]', label: '東急ストア' },

    // --- ドラッグストア (shop=chemist) + 薬局 (amenity=pharmacy) ---
    { pattern: /ドラッグ(?:ストア)?/i, tags: '[shop~"chemist|pharmacy"]', label: 'ドラッグストア' },
    { pattern: /薬局|やっきょく/i, tags: '[amenity=pharmacy]', label: '薬局' },
    { pattern: /マツキヨ|マツモトキヨシ/i, tags: '["name"~"マツモトキヨシ"]', label: 'マツモトキヨシ' },
    { pattern: /ウエルシア/i, tags: '["name"~"ウエルシア"]', label: 'ウエルシア' },
    { pattern: /ツルハ/i, tags: '["name"~"ツルハ"]', label: 'ツルハ' },
    { pattern: /スギ薬局|スギ(?=薬)/i, tags: '["name"~"スギ薬局"]', label: 'スギ薬局' },

    // --- 公共施設 ---
    { pattern: /交番|こうばん/i, tags: '[amenity=police]', label: '交番' },
    { pattern: /消防署|しょうぼうしょ/i, tags: '[amenity=fire_station]', label: '消防署' },
    { pattern: /警察(?:署)?/i, tags: '[amenity=police]', label: '警察' },
    { pattern: /郵便局|ゆうびんきょく|ポスト/i, tags: '[amenity=post_office]', label: '郵便局' },
    { pattern: /市役所|区役所|町役場|村役場|役所|役場/i, tags: '[amenity=townhall]', label: '役所' },
    { pattern: /図書館|としょかん/i, tags: '[amenity=library]', label: '図書館' },

    // --- 医療 ---
    { pattern: /病院|びょういん/i, tags: '[amenity~"hospital|clinic"]', label: '病院' },
    { pattern: /クリニック/i, tags: '[amenity=clinic]', label: 'クリニック' },
    { pattern: /歯医者|歯科|しか/i, tags: '[amenity~"dentist|clinic"]["name"~"歯科|デンタル"]', label: '歯科' },

    // --- 教育 ---
    { pattern: /小学校/i, tags: '[amenity=school]["name"~"小学校"]', label: '小学校' },
    { pattern: /中学校/i, tags: '[amenity=school]["name"~"中学校"]', label: '中学校' },
    { pattern: /高校|高等学校/i, tags: '[amenity=school]["name"~"高等学校|高校"]', label: '高校' },
    { pattern: /大学|だいがく/i, tags: '[amenity=university]', label: '大学' },
    { pattern: /学校|がっこう/i, tags: '[amenity~"school|university"]', label: '学校' },
    { pattern: /幼稚園|ようちえん/i, tags: '[amenity=kindergarten]', label: '幼稚園' },
    { pattern: /保育(?:園|所)|ほいくえん/i, tags: '[amenity~"kindergarten|childcare"]', label: '保育園' },

    // --- 宗教施設 ---
    { pattern: /神社|じんじゃ/i, tags: '[amenity=place_of_worship][religion=shinto]', label: '神社' },
    { pattern: /(?:お)?寺(?!子屋)|てら/i, tags: '[amenity=place_of_worship][religion=buddhist]', label: '寺' },
    { pattern: /教会|きょうかい/i, tags: '[amenity=place_of_worship][religion=christian]', label: '教会' },

    // --- レジャー ---
    { pattern: /公園|こうえん/i, tags: '[leisure=park]', label: '公園' },
    { pattern: /グラウンド|運動場/i, tags: '[leisure~"pitch|sports_centre"]', label: 'グラウンド' },

    // --- 交通 ---
    { pattern: /駅(?!前|ビル|構内)/i, tags: '[railway=station]', label: '駅' },
    { pattern: /バス停|バスてい/i, tags: '[highway=bus_stop]', label: 'バス停' },
    { pattern: /信号(?!無視)/i, tags: '[highway=traffic_signals]', label: '信号機' },
    { pattern: /踏切|ふみきり/i, tags: '[railway=level_crossing]', label: '踏切' },
    { pattern: /歩道橋|ほどうきょう/i, tags: '[highway=footway][bridge=yes]', label: '歩道橋' },
    { pattern: /ガソリンスタンド|ガソスタ|給油所/i, tags: '[amenity=fuel]', label: 'ガソリンスタンド' },
    { pattern: /駐車場|パーキング|コインパーキング/i, tags: '[amenity=parking]', label: '駐車場' },

    // --- 商業施設 ---
    { pattern: /銀行|ぎんこう/i, tags: '[amenity=bank]', label: '銀行' },
    { pattern: /ATM/i, tags: '[amenity=atm]', label: 'ATM' },
    { pattern: /ホテル/i, tags: '[tourism=hotel]', label: 'ホテル' },
    { pattern: /旅館|りょかん/i, tags: '[tourism=guest_house]', label: '旅館' },
    { pattern: /クリーニング/i, tags: '[shop=dry_cleaning]', label: 'クリーニング' },
    { pattern: /美容(?:院|室)|床屋|散髪|理容/i, tags: '[shop~"hairdresser|beauty"]', label: '美容院・理容室' },
    { pattern: /花屋|はなや/i, tags: '[shop=florist]', label: '花屋' },
    { pattern: /本屋|書店|ほんや/i, tags: '[shop=books]', label: '本屋' },
    { pattern: /100均|百均|ダイソー|セリア/i, tags: '[shop=variety_store]', label: '100円ショップ' },

    // --- 目印 ---
    { pattern: /橋(?!本)/i, tags: '[bridge=yes][highway]', label: '橋' },
    { pattern: /川(?!崎|口|越|上|下)/i, tags: '[waterway~"river|stream"]', label: '川' },
    { pattern: /鳥居/i, tags: '[man_made=torii]', label: '鳥居' },

    // --- 固有名詞 ---
    { pattern: /NEC|エヌイーシー|日本電気/i, tags: '["name"~"NEC|日本電気"]', label: 'NEC' },
  ];

  // ========== テキストからキーワード抽出 ==========
  function extractKeywords(text) {
    const cleaned = text
      .replace(/えーっと|あのー?|ええと|うーん|そのー?|なんか|あー+|えー+|うー+|っと/g, '')
      .replace(/[、。！？!?,.\s]+/g, ' ')
      .trim();

    const matches = [];
    for (const kw of KEYWORDS) {
      if (kw.pattern.test(cleaned) || kw.pattern.test(text)) {
        matches.push(kw);
      }
    }
    return matches;
  }

  // ========== Overpass API クエリ ==========
  async function searchNearby(lat, lng, radiusMeters, keyword) {
    const query = `
      [out:json][timeout:10];
      (
        node${keyword.tags}(around:${radiusMeters},${lat},${lng});
        way${keyword.tags}(around:${radiusMeters},${lat},${lng});
        relation${keyword.tags}(around:${radiusMeters},${lat},${lng});
      );
      out center body;
    `;

    const res = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);

    const data = await res.json();
    return data.elements.map(el => ({
      id: el.id,
      name: el.tags?.name || keyword.label,
      lat: el.lat || el.center?.lat,
      lng: el.lon || el.center?.lon,
      tags: el.tags || {},
      type: keyword.label,
    })).filter(el => el.lat && el.lng);
  }

  // ========== 2点間の距離(m) ==========
  function distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ========== 複数カテゴリの交差絞り込み ==========
  // 各カテゴリのPOI同士が proximityRadius 以内にあるペア/グループを抽出
  function findIntersections(searchResults, proximityRadius) {
    if (searchResults.length < 2) return null;

    // カテゴリごとにPOIを分類
    const categories = searchResults.map(r => ({
      label: r.keyword.label,
      pois: r.pois,
    })).filter(c => c.pois.length > 0);

    if (categories.length < 2) return null;

    // 基準: 最もPOI数が少ないカテゴリの各POIに対して、
    // 他の全カテゴリから proximityRadius 以内にPOIがあるか判定
    categories.sort((a, b) => a.pois.length - b.pois.length);
    const base = categories[0];
    const others = categories.slice(1);

    const clusters = [];

    for (const basePoi of base.pois) {
      // このbasePOIの近くに全カテゴリのPOIがあるか
      const nearbyFromEach = [];
      let allFound = true;

      for (const other of others) {
        const nearby = other.pois.filter(p =>
          distanceMeters(basePoi.lat, basePoi.lng, p.lat, p.lng) <= proximityRadius
        );
        if (nearby.length === 0) {
          allFound = false;
          break;
        }
        nearbyFromEach.push(...nearby);
      }

      if (allFound) {
        clusters.push({
          anchor: basePoi,
          nearby: nearbyFromEach,
          all: [basePoi, ...nearbyFromEach],
        });
      }
    }

    return clusters.length > 0 ? clusters : null;
  }

  // ========== メインの解析・検索関数 ==========
  async function analyzeMessage(text, callerLocation) {
    if (!callerLocation) return null;

    const keywords = extractKeywords(text);
    if (keywords.length === 0) return null;

    const radius = callerLocation.accuracy * 5;

    // 全キーワードを並列検索
    const searches = keywords.map(async (kw) => {
      try {
        const pois = await searchNearby(
          callerLocation.lat,
          callerLocation.lng,
          radius,
          kw
        );
        return { keyword: kw, pois };
      } catch (e) {
        console.error(`POI検索エラー (${kw.label}):`, e);
        return { keyword: kw, pois: [] };
      }
    });

    const searchResults = await Promise.all(searches);

    // 全結果をフラットに
    const allResults = [];
    for (const r of searchResults) {
      allResults.push(...r.pois.map(poi => ({
        ...poi,
        searchKeyword: r.keyword.label,
      })));
    }

    // 複数カテゴリの交差判定
    let intersections = null;
    if (keywords.length >= 2) {
      intersections = findIntersections(searchResults, radius);
    }

    return {
      keywords: keywords.map(k => k.label),
      radius,
      results: allResults,
      intersections,
      isMultiKeyword: keywords.length >= 2,
    };
  }

  return { extractKeywords, searchNearby, analyzeMessage, distanceMeters };
})();
