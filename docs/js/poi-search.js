/**
 * POI検索モジュール
 * チャットの自然言語からキーワードを抽出し、Overpass APIでOSM施設を検索
 * LLM/BERT不使用 - 辞書ベースのキーワードマッチング
 */
const POISearch = (() => {

  const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

  // ========== キーワード辞書 ==========
  // { pattern: 正規表現, tags: Overpass QLフィルタ, label: 表示名 }
  // patternは口語・略称・表記揺れを網羅
  const KEYWORDS = [
    // --- コンビニ ---
    { pattern: /セブン(?:イレブン)?/i, tags: '[amenity=convenience]["name"~"セブン"]', label: 'セブンイレブン' },
    { pattern: /ローソン/i, tags: '[amenity=convenience]["name"~"ローソン"]', label: 'ローソン' },
    { pattern: /ファミ(?:マ|リーマート)/i, tags: '[amenity=convenience]["name"~"ファミリーマート"]', label: 'ファミリーマート' },
    { pattern: /ミニストップ/i, tags: '[amenity=convenience]["name"~"ミニストップ"]', label: 'ミニストップ' },
    { pattern: /デイリー(?:ヤマザキ)?/i, tags: '[amenity=convenience]["name"~"デイリー"]', label: 'デイリーヤマザキ' },
    { pattern: /コンビニ/i, tags: '[amenity=convenience]', label: 'コンビニ' },

    // --- 飲食 ---
    { pattern: /マック|マクド(?:ナルド)?/i, tags: '["name"~"マクドナルド"]', label: 'マクドナルド' },
    { pattern: /すき家|すきや/i, tags: '["name"~"すき家"]', label: 'すき家' },
    { pattern: /吉野家|よしのや/i, tags: '["name"~"吉野家"]', label: '吉野家' },
    { pattern: /松屋|まつや/i, tags: '["name"~"松屋"]', label: '松屋' },
    { pattern: /ガスト/i, tags: '["name"~"ガスト"]', label: 'ガスト' },
    { pattern: /スタバ|スターバックス/i, tags: '["name"~"スターバックス|Starbucks"]', label: 'スターバックス' },
    { pattern: /ケンタ(?:ッキー)?|KFC/i, tags: '["name"~"ケンタッキー|KFC"]', label: 'ケンタッキー' },
    { pattern: /モス(?:バーガー)?/i, tags: '["name"~"モスバーガー"]', label: 'モスバーガー' },
    { pattern: /ココイチ|CoCo壱/i, tags: '["name"~"CoCo壱番屋|ココ壱"]', label: 'CoCo壱番屋' },

    // --- スーパー・ドラッグストア ---
    { pattern: /(?:スーパー(?:マーケット)?)/i, tags: '[shop=supermarket]', label: 'スーパー' },
    { pattern: /イオン/i, tags: '["name"~"イオン"]', label: 'イオン' },
    { pattern: /ドラッグ(?:ストア)?|薬局/i, tags: '[amenity=pharmacy]', label: '薬局・ドラッグストア' },
    { pattern: /マツキヨ|マツモトキヨシ/i, tags: '["name"~"マツモトキヨシ"]', label: 'マツモトキヨシ' },

    // --- 公共施設 ---
    { pattern: /交番|こうばん/i, tags: '[amenity=police]', label: '交番' },
    { pattern: /消防署|しょうぼうしょ/i, tags: '[amenity=fire_station]', label: '消防署' },
    { pattern: /警察(?:署)?/i, tags: '[amenity=police]', label: '警察' },
    { pattern: /郵便局|ゆうびんきょく/i, tags: '[amenity=post_office]', label: '郵便局' },
    { pattern: /市役所|区役所|町役場|村役場|役所|役場/i, tags: '[amenity=townhall]', label: '役所' },
    { pattern: /図書館|としょかん/i, tags: '[amenity=library]', label: '図書館' },
    { pattern: /裁判所/i, tags: '[amenity=courthouse]', label: '裁判所' },

    // --- 医療 ---
    { pattern: /病院|びょういん/i, tags: '[amenity~"hospital|clinic"]', label: '病院' },
    { pattern: /クリニック/i, tags: '[amenity=clinic]', label: 'クリニック' },

    // --- 教育 ---
    { pattern: /小学校/i, tags: '[amenity=school]["name"~"小学校"]', label: '小学校' },
    { pattern: /中学校/i, tags: '[amenity=school]["name"~"中学校"]', label: '中学校' },
    { pattern: /高校|高等学校/i, tags: '[amenity=school]["name"~"高等学校|高校"]', label: '高校' },
    { pattern: /大学/i, tags: '[amenity=university]', label: '大学' },
    { pattern: /学校|がっこう/i, tags: '[amenity~"school|university"]', label: '学校' },
    { pattern: /幼稚園|ようちえん/i, tags: '[amenity=kindergarten]', label: '幼稚園' },
    { pattern: /保育(?:園|所)/i, tags: '[amenity~"kindergarten|childcare"]', label: '保育園' },

    // --- 宗教施設 ---
    { pattern: /神社|じんじゃ/i, tags: '[amenity=place_of_worship][religion=shinto]', label: '神社' },
    { pattern: /(?:お)?寺|てら/i, tags: '[amenity=place_of_worship][religion=buddhist]', label: '寺' },
    { pattern: /教会|きょうかい/i, tags: '[amenity=place_of_worship][religion=christian]', label: '教会' },

    // --- レジャー ---
    { pattern: /公園|こうえん/i, tags: '[leisure=park]', label: '公園' },
    { pattern: /グラウンド|運動場/i, tags: '[leisure~"pitch|sports_centre"]', label: 'グラウンド' },
    { pattern: /プール/i, tags: '[leisure=swimming_pool]', label: 'プール' },

    // --- 交通 ---
    { pattern: /駅|えき/i, tags: '[railway=station]', label: '駅' },
    { pattern: /バス停|バスてい/i, tags: '[highway=bus_stop]', label: 'バス停' },
    { pattern: /信号|しんごう/i, tags: '[highway=traffic_signals]', label: '信号機' },
    { pattern: /踏切|ふみきり/i, tags: '[railway=level_crossing]', label: '踏切' },
    { pattern: /歩道橋|ほどうきょう/i, tags: '[highway=footway][bridge=yes]', label: '歩道橋' },
    { pattern: /ガソリンスタンド|ガソスタ|給油所/i, tags: '[amenity=fuel]', label: 'ガソリンスタンド' },
    { pattern: /駐車場|パーキング/i, tags: '[amenity=parking]', label: '駐車場' },

    // --- 商業施設 ---
    { pattern: /銀行|ぎんこう/i, tags: '[amenity=bank]', label: '銀行' },
    { pattern: /ATM/i, tags: '[amenity=atm]', label: 'ATM' },
    { pattern: /ホテル|旅館/i, tags: '[tourism~"hotel|guest_house"]', label: 'ホテル・旅館' },

    // --- 目印になる建造物 ---
    { pattern: /鳥居|とりい/i, tags: '["man_made"="torii"]', label: '鳥居' },
    { pattern: /橋|はし/i, tags: '[man_made=bridge]', label: '橋' },
    { pattern: /川|かわ/i, tags: '[waterway=river]', label: '川' },
  ];

  // ========== テキストからキーワード抽出 ==========
  function extractKeywords(text) {
    // 口語ノイズを除去: フィラー、句読点、感嘆詞
    const cleaned = text
      .replace(/[えーっと|あのー?|ええと|うーん|そのー?|なんか|あー+|えー+|うー+|っと]/g, '')
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
    // Overpass QL を構築
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

  // ========== メインの解析・検索関数 ==========
  async function analyzeMessage(text, callerLocation) {
    if (!callerLocation) return null;

    const keywords = extractKeywords(text);
    if (keywords.length === 0) return null;

    const radius = Math.max(callerLocation.accuracy * 5, 500); // 最低500m
    const results = [];

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

    for (const r of searchResults) {
      results.push(...r.pois.map(poi => ({
        ...poi,
        searchKeyword: r.keyword.label,
      })));
    }

    return {
      keywords: keywords.map(k => k.label),
      radius,
      results,
    };
  }

  return { extractKeywords, searchNearby, analyzeMessage };
})();
